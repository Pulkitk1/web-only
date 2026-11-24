/** Port of android WalletTest.kt: FreezeRulesTest, FreezeRecoveryWindowTest, FreezeCreatedDateRegressionTest. */
import { describe, expect, it } from 'vitest';

import {
  checkFreeze,
  FREEZE_PRICE_COINS,
  latestEligibleMiss,
  MAX_FREEZE_APPLICATIONS_PER_MONTH,
  STREAK_FREEZE_RECOVERY_DAYS,
  streakEntering,
  WELCOME_FREEZE_ID,
  windowStart,
} from '@/domain/freeze';
import { startDate, streakOf } from '@/domain/schedule';
import { range, sched, withCompleted, withFreezes, WEEKENDS } from './helpers';

describe('verified freeze constants (Kotlin WalletLedger.kt)', () => {
  it('costs 20 coins, 3 applications per month, 3-day window, one welcome freeze id', () => {
    expect(FREEZE_PRICE_COINS).toBe(20);
    expect(MAX_FREEZE_APPLICATIONS_PER_MONTH).toBe(3);
    expect(STREAK_FREEZE_RECOVERY_DAYS).toBe(3);
    expect(WELCOME_FREEZE_ID).toBe('welcome_freeze');
  });
  it('the window starts 3 days before today', () => expect(windowStart('2024-06-13')).toBe('2024-06-10'));
});

describe('FreezeRules', () => {
  const today = '2024-06-11'; // Tuesday; yesterday = Monday 10th
  // Thu 6, Fri 7 done, weekend rest, Mon 10 missed.
  const habit = sched('a', ['2024-06-06', '2024-06-07'], WEEKENDS);
  const check = (h = habit, date: string, on = today) => checkFreeze(h, date, on);

  it("yesterday's miss with an active streak is eligible", () => {
    expect(check(habit, '2024-06-10')).toBe('Eligible');
    expect(streakEntering(habit, '2024-06-10')).toBe(2);
    expect(latestEligibleMiss([habit], today)).toEqual({ habit, date: '2024-06-10' });
  });

  it('today and the future are not eligible', () => {
    expect(check(habit, '2024-06-11')).toBe('Today');
    expect(check(habit, '2024-06-12')).toBe('Future');
  });

  it('a rest day never uses a freeze', () => {
    expect(checkFreeze(habit, '2024-06-09', '2024-06-10')).toBe('RestDay');
  });

  it('a completed day is not eligible', () => {
    expect(check(withCompleted(habit, [...habit.completed, '2024-06-10']), '2024-06-10')).toBe('Completed');
  });

  it('an already protected day is not eligible', () => {
    expect(check(withFreezes(habit, ['2024-06-10']), '2024-06-10')).toBe('AlreadyFrozen');
  });

  it('older than the recovery window is not eligible', () => {
    // Today is Tue 11th, so the window is Sat 8th..Mon 10th; Fri 7th is four days ago.
    expect(check(sched('a', ['2024-06-06']), '2024-06-07')).toBe('TooOld');
  });

  it('no streak to protect is not eligible', () => {
    expect(check(sched('a', ['2024-06-05']), '2024-06-10')).toBe('NoStreak');
    expect(check(sched('a', []), '2024-06-10')).toBe('NoStreak');
  });

  it('a rest day before the miss still counts as an active streak', () => {
    expect(check(sched('a', ['2024-06-07'], WEEKENDS), '2024-06-10')).toBe('Eligible');
  });

  it('uses the schedule in effect on that day', () => {
    // Monday became a rest day from the 10th, so it can't be frozen even though it was active before.
    const h = {
      ...habit,
      history: [
        { from: '2024-06-01', restDays: WEEKENDS, daysPerWeek: 5 },
        { from: '2024-06-10', restDays: [...WEEKENDS, 'Mon'], daysPerWeek: 4 },
      ],
    };
    expect(check(h, '2024-06-10')).toBe('RestDay');
  });

  it('the streak recalculates after a freeze', () => {
    const done = [...habit.completed, today];
    expect(streakOf(sched('a', done, WEEKENDS), today).current).toBe(1);
    const frozen = streakOf(sched('a', done, WEEKENDS, { freezes: ['2024-06-10'] }), today);
    expect(frozen.current).toBe(3); // Thu, Fri, Tue: the frozen Monday preserves but does not add
    expect(frozen.best).toBe(3);
    expect(frozen.runs).toEqual([{ start: '2024-06-06', end: today, days: 3 }]);
  });
});

describe('the 3-day recovery window (today = Thu 13 June 2024)', () => {
  const today = '2024-06-13'; // window = Mon 10th .. Wed 12th
  const check = (h: ReturnType<typeof sched>, date: string, on = today) => checkFreeze(h, date, on);
  // Done every day Jun 1..9 (active streak), nothing since: Mon 10, Tue 11, Wed 12 missed.
  const missedThree = sched('a', range('2024-06-01', 9));

  it('the window is yesterday through three days ago, inclusive', () => {
    // Each day is checked as if it were the only miss, so the window bound is what decides.
    const onlyMiss = (date: string) => sched('a', range('2024-06-01', 12).filter((d) => d !== date));
    expect(check(onlyMiss('2024-06-12'), '2024-06-12')).toBe('Eligible'); // yesterday
    expect(check(onlyMiss('2024-06-11'), '2024-06-11')).toBe('Eligible'); // 2 days ago
    expect(check(onlyMiss('2024-06-10'), '2024-06-10')).toBe('Eligible'); // 3 days ago
    expect(check(onlyMiss('2024-06-09'), '2024-06-09')).toBe('TooOld'); // 4 days ago
    expect(check(missedThree, '2024-06-13')).toBe('Today');
  });

  it('completed, rest and already-frozen days are ineligible', () => {
    const h = { ...missedThree, completed: new Set([...missedThree.completed, '2024-06-11']), freezes: new Set(['2024-06-10']), restDays: new Set(['Wed']) };
    expect(check(h, '2024-06-10')).toBe('AlreadyFrozen');
    expect(check(h, '2024-06-11')).toBe('Completed');
    expect(check(h, '2024-06-12')).toBe('RestDay');
  });

  it('days before the habit was created are ineligible', () => {
    expect(check(sched('a', ['2024-06-12'], [], { createdDate: '2024-06-11' }), '2024-06-10')).toBe('NotStarted');
  });

  it('consecutive misses need one freeze each, oldest first', () => {
    expect(check(missedThree, '2024-06-10')).toBe('Eligible');
    expect(check(missedThree, '2024-06-11')).toBe('EarlierDayFirst');
    expect(check(missedThree, '2024-06-12')).toBe('EarlierDayFirst');
    const afterMon = withFreezes(missedThree, ['2024-06-10']);
    expect(check(afterMon, '2024-06-11')).toBe('Eligible');
    expect(check(afterMon, '2024-06-12')).toBe('EarlierDayFirst');
    expect(check(withFreezes(afterMon, ['2024-06-10', '2024-06-11']), '2024-06-12')).toBe('Eligible');
  });

  it('a streak already broken before the window stays unprotectable', () => {
    // Streak already broke on Sun 9th (outside the window), so nothing inside the window can restore it.
    const h = sched('a', range('2024-06-01', 8));
    expect(check(h, '2024-06-10')).toBe('NoStreak');
    expect(check(h, '2024-06-12')).toBe('NoStreak');
  });

  it('freezing Monday after completing Tuesday and Wednesday restores the streak', () => {
    const h = sched('a', [...range('2024-06-01', 9), '2024-06-11', '2024-06-12']);
    expect(streakOf(h, today).current).toBe(2); // Tue, Wed after the missed Monday
    expect(check(h, '2024-06-10')).toBe('Eligible');
    const restored = streakOf(withFreezes(h, ['2024-06-10']), today);
    expect(restored.current).toBe(11); // Jun 1..9 + Tue + Wed; the frozen Monday preserves but doesn't add
    expect(restored.best).toBe(11);
  });

  it('recovering only some misses does not restore the streak', () => {
    const partly = withFreezes(missedThree, ['2024-06-10', '2024-06-11']);
    expect(streakOf(partly, today).current).toBe(0); // Wed 12th is still an unprotected miss
    expect(streakOf(withFreezes(partly, ['2024-06-10', '2024-06-11', '2024-06-12']), today).current).toBe(9);
  });

  it('rest days between missed and completed days', () => {
    // Weekends rest. Fri 7 done, Sat/Sun rest, Mon 10 missed, Tue 11 + Wed 12 done.
    const h = sched('a', ['2024-06-06', '2024-06-07', '2024-06-11', '2024-06-12'], WEEKENDS);
    expect(check(h, '2024-06-09')).toBe('RestDay');
    expect(check(h, '2024-06-10')).toBe('Eligible');
    expect(streakOf(withFreezes(h, ['2024-06-10']), today).current).toBe(4);
  });

  it('crosses a month boundary', () => {
    const on = '2024-07-02'; // window Jun 29 .. Jul 1
    const h = sched('a', range('2024-06-20', 9)); // done through Jun 28
    expect(check(h, '2024-06-29', on)).toBe('Eligible');
    expect(check(withCompleted(h, [...h.completed].filter((d) => d !== '2024-06-28')), '2024-06-28', on)).toBe('TooOld'); // 4 days ago, missed
  });

  it('crosses a year boundary', () => {
    const on = '2025-01-02'; // window Dec 30 .. Jan 1
    const h = sched('a', range('2024-12-20', 10)); // done through Dec 29
    expect(check(h, '2024-12-30', on)).toBe('Eligible');
    expect(check(withCompleted(h, [...h.completed].filter((d) => d !== '2024-12-29')), '2024-12-29', on)).toBe('TooOld');
    expect(streakOf(withFreezes(h, ['2024-12-30', '2024-12-31', '2025-01-01']), on).current).toBe(10);
  });

  it("uses historical rest days, not today's schedule", () => {
    // Monday was a rest day until the 11th, when the schedule changed to no rest days.
    const h = {
      ...missedThree,
      history: [
        { from: '2024-06-01', restDays: ['Mon'], daysPerWeek: 6 },
        { from: '2024-06-11', restDays: [], daysPerWeek: 7 },
      ],
    };
    expect(check(h, '2024-06-10')).toBe('RestDay'); // still a rest day under the old schedule
    expect(check(h, '2024-06-11')).toBe('Eligible');
  });
});

describe('regression: a habit created Oct 28 with Oct 8-26 history filled in', () => {
  const today = '2026-10-28';
  const backfilled = [...range('2026-10-08', 19), today]; // Oct 8..26 + today
  const rp = sched('rp', backfilled, [], { createdDate: today });

  it('a missed day inside back-filled history is eligible', () => {
    expect(startDate(rp)).toBe('2026-10-08');
    expect(streakEntering(rp, '2026-10-27')).toBe(19);
    expect(checkFreeze(rp, '2026-10-27', today)).toBe('Eligible');
  });

  it('freezing it restores the streak without touching history', () => {
    expect(streakOf(rp, today).current).toBe(1);
    const frozen = withFreezes(rp, ['2026-10-27']);
    expect(streakOf(frozen, today).current).toBe(20); // Oct 8-26 + today; the freeze bridges but doesn't add
    expect(frozen.completed).toEqual(rp.completed);
  });

  it('genuine days before the habit start stay ineligible', () => {
    expect(checkFreeze(sched('n', ['2026-10-27'], [], { createdDate: '2026-10-27' }), '2026-10-26', today)).toBe('NotStarted');
    expect(checkFreeze(sched('l', ['2026-10-26'], [], { createdDate: today }), '2026-10-25', today)).toBe('NotStarted');
  });

  it('the recovery window still applies to back-filled habits', () => {
    const gaps = sched('g', backfilled.filter((d) => d !== '2026-10-24' && d !== '2026-10-27'), [], { createdDate: today });
    expect(checkFreeze(gaps, '2026-10-24', today)).toBe('TooOld'); // 4 days ago
    expect(checkFreeze(gaps, '2026-10-27', today)).toBe('Eligible');
  });
});
