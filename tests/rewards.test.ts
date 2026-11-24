/** Port of android WalletTest.kt: RewardRulesTest and RestDayRewardTest (when coins are earned, never new rules). */
import { describe, expect, it } from 'vitest';

import {
  dailyRewardEligible,
  DAILY_REWARD,
  eligibleRewards,
  MILESTONE_BONUSES,
  milestoneBonus,
  milestonesReached,
  rewardWindowStart,
  STREAK_MILESTONES,
  type RewardRecord,
} from '@/domain/rewards';
import { streakOf } from '@/domain/schedule';
import { addDays } from '@/utils/date';
import { range, sched, WEEKENDS } from './helpers';

const mon = '2024-06-03';
const sat = '2024-06-08';
const ids = (gs: { id: string }[]) => gs.map((g) => g.id);

describe('daily reward', () => {
  it('is one coin', () => expect(DAILY_REWARD).toBe(1));

  it('all active habits completed earns the daily reward', () => {
    const habits = [sched('a', [mon]), sched('b', [mon], WEEKENDS)];
    expect(dailyRewardEligible(habits, mon)).toBe(true);
    expect(ids(eligibleRewards(habits, mon))).toEqual(['daily_2024-06-03']);
  });

  it('partial completion earns nothing', () => {
    const habits = [sched('a', [mon]), sched('b', [])];
    expect(dailyRewardEligible(habits, mon)).toBe(false);
    expect(eligibleRewards(habits, mon)).toEqual([]);
  });

  it('a habit on a rest day does not block the reward', () => {
    expect(dailyRewardEligible([sched('a', [sat]), sched('b', [], WEEKENDS)], sat)).toBe(true);
  });

  it('a day with no active habits earns nothing', () => {
    expect(dailyRewardEligible([sched('a', [sat], WEEKENDS)], sat)).toBe(false);
  });

  it('a habit created later is not scheduled before its creation', () => {
    const habits = [sched('a', [mon]), sched('b', [], [], { createdDate: addDays(mon, 1) })];
    expect(dailyRewardEligible(habits, mon)).toBe(true);
  });

  it('the previous month earns nothing new', () => {
    expect(eligibleRewards([sched('a', ['2024-05-31'])], '2024-06-02')).toEqual([]); // recorded in June for May 31
    // A day earlier in the same month is still eligible.
    expect(ids(eligibleRewards([sched('a', [mon])], addDays(mon, 5)))).toEqual(['daily_2024-06-03']);
  });

  it('any day of the current month is eligible when recorded; other months and the future are not', () => {
    const today = '2026-11-17';
    for (const day of ['2026-11-01', '2026-11-09', '2026-11-10', '2026-11-17']) {
      expect(ids(eligibleRewards([sched('a', [day], [], { createdDate: '2026-10-01' })], today))).toEqual([`daily_${day}`]);
    }
    for (const day of ['2026-10-31', '2026-09-15', '2026-08-10', '2026-11-18']) {
      expect(eligibleRewards([sched('a', [day], [], { createdDate: '2026-01-01' })], today)).toEqual([]);
    }
  });

  it("an edit in the next month never issues the old month's reward", () => {
    const habit = sched('a', range('2026-11-01', 30), [], { createdDate: '2026-11-01' });
    expect(eligibleRewards([habit], '2026-12-01')).toEqual([]);
  });

  it('a day recorded before creation can earn the daily coin in the current month', () => {
    const h = sched('a', ['2026-11-05', '2026-11-10'], [], { createdDate: '2026-11-10' });
    expect(dailyRewardEligible([h], '2026-11-05')).toBe(true);
    expect(dailyRewardEligible([h], '2026-11-06')).toBe(false); // untouched day before creation: neutral, not required
    expect(ids(eligibleRewards([h], '2026-11-17'))).toEqual(['daily_2026-11-05', 'daily_2026-11-10']);
  });

  it('one uncompleted habit still blocks the daily coin on a back-filled day', () => {
    const a = sched('a', ['2026-11-05'], [], { createdDate: '2026-11-01' });
    const b = sched('b', [], [], { createdDate: '2026-11-01' });
    expect(dailyRewardEligible([a, b], '2026-11-05')).toBe(false);
  });

  it('the reward window is the first of the current month', () => expect(rewardWindowStart('2024-06-17')).toBe('2024-06-01'));
});

describe('milestones', () => {
  it('follow the schedule of rewards', () => {
    expect(MILESTONE_BONUSES).toEqual({ 15: 5, 30: 5, 45: 5, 60: 5, 75: 10, 100: 20 });
    expect(STREAK_MILESTONES).toEqual([15, 30, 45, 60, 75, 100]);
  });

  it('each milestone earns its own bonus on its day', () => {
    const start = '2024-01-01';
    const habit = sched('a', range(start, 100));
    for (const [day, bonus] of [[15, 5], [30, 5], [45, 5], [60, 5], [75, 10], [100, 20]] as const) {
      const reached = addDays(start, day - 1);
      const grants = milestonesReached(habit, reached, reached);
      expect(ids(grants)).toEqual([`milestone_a_${day}_2024-01-01`]);
      expect(grants[0].amount).toBe(bonus);
      expect(grants[0].milestone).toBe(day);
      // One day earlier it hasn't been reached.
      expect(milestonesReached(habit, addDays(reached, -1), addDays(reached, -1)).some((g) => g.milestone === day)).toBe(false);
    }
  });

  it('are independent per habit', () => {
    const start = '2024-06-01';
    const today = addDays(start, 14);
    const habits = ['reading', 'workout', 'study'].map((id) => sched(id, range(start, 15)));
    const grants = habits.flatMap((h) => milestonesReached(h, today));
    expect(grants).toHaveLength(3);
    expect(new Set(ids(grants)).size).toBe(3);
    expect(grants.reduce((s, g) => s + g.amount, 0)).toBe(15);
  });

  it('a milestone reached in an earlier month is history only', () => {
    // Day 15 and 30 were reached in January; only day 45 (February 14) is in the current month.
    const start = '2024-01-01';
    expect(milestonesReached(sched('a', range(start, 50)), addDays(start, 49)).map((g) => g.milestone)).toEqual([45]);
  });

  it('back-filling a previous month issues no milestone coins but raises the best streak', () => {
    const today = '2026-11-17';
    const habit = sched('a', range('2026-09-01', 15), [], { createdDate: today });
    expect(eligibleRewards([habit], today)).toEqual([]);
    const s = streakOf(habit, today);
    expect([s.best, s.current]).toEqual([15, 0]); // the run ended in September
  });

  it('a back-filled long streak does not pay earlier milestones', () => {
    const today = '2026-11-17';
    const habit = sched('a', range('2026-08-01', 45), [], { createdDate: today }); // Aug 1 - Sep 14
    expect(eligibleRewards([habit], today)).toEqual([]);
    expect(streakOf(habit, today).best).toBe(45);
  });

  it('history from an earlier month can carry into a milestone this month', () => {
    // October 17-31 (15 days) continues through November 15 -> day 30 is reached on Nov 15.
    const today = '2026-11-15';
    const habit = sched('a', range('2026-10-17', 30), [], { createdDate: '2026-10-17' });
    const grants = eligibleRewards([habit], today).filter((g) => g.milestone !== undefined);
    expect(grants.map((g) => g.milestone)).toEqual([30]); // 15 was reached on Oct 31: history only
    expect(grants[0].date).toBe('2026-11-15');
    expect(grants[0].amount).toBe(5);
    expect(streakOf(habit, today).current).toBe(30); // October counts toward the current streak
  });

  it('an October-only milestone is not paid retroactively', () => {
    const habit = sched('a', range('2026-10-01', 16), [], { createdDate: '2026-10-01' });
    expect(eligibleRewards([habit], '2026-11-17').some((g) => g.milestone !== undefined)).toBe(false);
  });

  const paid: RewardRecord = { id: 'milestone_a_15_2026-11-01', active: true, cycle: 1, amount: 5, type: 'streak_milestone', date: '2026-11-15', habitId: 'a', milestone: 15 };

  it('an already paid milestone keeps its id when back-filling shifts the run', () => {
    const today = '2026-11-15';
    const habit = sched('a', range('2026-10-31', 16), [], { createdDate: '2026-10-31' });
    expect(ids(eligibleRewards([habit], today, [paid]).filter((g) => g.milestone === 15))).toEqual(['milestone_a_15_2026-11-01']); // same reward, not a second +5
    // Without the record the shifted milestone (Nov 14) would have been a new id.
    expect(ids(eligibleRewards([habit], today).filter((g) => g.milestone === 15))).toEqual(['milestone_a_15_2026-10-31']);
  });

  it('a paid milestone stays valid even if back-fill moves it into an earlier month', () => {
    const habit = sched('a', range('2026-10-01', 46), [], { createdDate: '2026-10-01' }); // day 15 is now Oct 15
    expect(eligibleRewards([habit], '2026-11-15', [paid]).some((g) => g.id === paid.id)).toBe(true);
  });

  it('a paid milestone no longer reached is not kept (so it can be reversed)', () => {
    const habit = sched('a', range('2026-11-01', 14), [], { createdDate: '2026-11-01' }); // a day was undone
    expect(eligibleRewards([habit], '2026-11-15', [paid]).some((g) => g.id === paid.id)).toBe(false);
  });

  it('a freeze never produces a milestone; rest-day completions extend the streak but are not counted', () => {
    const start = '2026-11-01';
    const frozen = sched('a', range(start, 14), [], { freezes: [addDays(start, 14)], createdDate: start });
    expect(milestonesReached(frozen, addDays(start, 14))).toEqual([]);
    // Nov 1 2026 is a Sunday (completed rest day): streak 15, but the milestone counts active days only.
    const withRest = sched('b', range(start, 15), ['Sun'], { createdDate: start });
    expect(streakOf(withRest, addDays(start, 14)).current).toBe(15);
  });

  it('freezes and rest days never advance a milestone', () => {
    const start = '2024-06-01'; // 14 completed days, then a freeze on day 15: no milestone
    expect(milestonesReached(sched('a', range(start, 14), [], { freezes: [addDays(start, 14)] }), addDays(start, 14))).toEqual([]);
  });

  it('the fifteen-day milestone', () => {
    const start = '2024-06-01';
    const m = milestonesReached(sched('a', range(start, 15)), addDays(start, 14));
    expect(ids(m)).toEqual(['milestone_a_15_2024-06-01']);
    expect(m[0].amount).toBe(milestoneBonus(15));
    expect(milestonesReached(sched('a', range(start, 14)), addDays(start, 13))).toEqual([]);
  });

  it('the thirty-day milestone across a month boundary', () => {
    // June 20 - July 19: day 15 (July 4) and day 30 (July 19) both fall in the current month, July.
    const start = '2024-06-20';
    const habit = sched('a', range(start, 30));
    expect(milestonesReached(habit, addDays(start, 29)).map((g) => g.milestone)).toEqual([15, 30]);
    // On August 2 only milestones reached in August would count: none.
    expect(milestonesReached(habit, '2024-08-02')).toEqual([]);
  });

  it('milestones count only active days', () => {
    // Weekends off: the 15th active day is three weeks in, on a Friday.
    const days = range('2024-06-03', 19).filter((d) => !['Sat', 'Sun'].includes(new Date(`${d}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' })));
    const m = milestonesReached(sched('a', days, WEEKENDS), '2024-06-21');
    expect(m).toHaveLength(1);
    expect(m[0].date).toBe('2024-06-21');
  });
});

describe('rest-day completions and rewards', () => {
  it('milestones still count active days only and keep their id', () => {
    // 15 weekdays from Mon 3 June; the run now starts on a completed Sunday 2 June (rest day).
    const weekdays = range('2024-06-03', 19).filter((d) => !['2024-06-08', '2024-06-09', '2024-06-15', '2024-06-16'].includes(d));
    const withRestStart = sched('a', [...weekdays, '2024-06-02', '2024-06-08'], WEEKENDS);
    const [m] = milestonesReached(withRestStart, '2024-06-21');
    expect(m.date).toBe('2024-06-21'); // still the 15th *active* completion: no earlier coins
    // Same id as without the rest-day completions, so an already-granted milestone can't be paid again.
    expect(m.id).toBe('milestone_a_15_2024-06-03');
    expect(milestonesReached(sched('a', weekdays, WEEKENDS), '2024-06-21')[0].id).toBe(m.id);
  });

  it('a rest-day completion does not change the daily reward', () => {
    expect(dailyRewardEligible([sched('a', ['2024-06-08'], WEEKENDS)], '2024-06-08')).toBe(false); // no active habits that day
  });
});
