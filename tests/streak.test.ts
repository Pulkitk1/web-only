/** Port of android StreakEngineTest.kt (the streak calculation every screen shares). */
import { describe, expect, it } from 'vitest';

import { calculateStreak } from '@/domain/streak';
import { parseRestDays, streakOf } from '@/domain/schedule';
import { dayName } from '@/utils/date';
import { sched, WEEKENDS } from './helpers';

// Compose of `StreakEngine.calculate(completed, restDayNames, freezes, today)`.
const calc = (done: string[], rest: string[], freezes: string[], today: string) =>
  streakOf(sched('a', done, rest, { freezes }), today);

describe('StreakEngine', () => {
  // 2024-06-03 is a Monday.
  it('calendar sanity: 2024-06-03 is Monday', () => expect(dayName('2024-06-03')).toBe('Mon'));

  it('consecutive completed active days', () => {
    const r = calc(['2024-06-03', '2024-06-04', '2024-06-05'], [], [], '2024-06-05');
    expect([r.current, r.best]).toEqual([3, 3]);
  });

  it('rest days between completions neither break nor extend', () => {
    // Thu, Fri, (Sat, Sun rest), Mon
    expect(calc(['2024-06-06', '2024-06-07', '2024-06-10'], WEEKENDS, [], '2024-06-10').current).toBe(3);
  });

  it('completing on a rest day counts once', () => {
    // Fri, Sat (rest, completed), Sun (rest, not completed), Mon: 3, not 4 and not 2.
    const r = calc(['2024-06-07', '2024-06-08', '2024-06-10'], WEEKENDS, [], '2024-06-10');
    expect([r.current, r.best]).toEqual([3, 3]);
  });

  it('missing an active day breaks the streak', () => {
    const r = calc(['2024-06-03', '2024-06-04', '2024-06-06'], [], [], '2024-06-06');
    expect([r.current, r.best]).toEqual([1, 2]);
  });

  it('missed yesterday with an incomplete today is zero', () => {
    const r = calc(['2024-06-03'], [], [], '2024-06-05');
    expect([r.current, r.best]).toEqual([0, 1]);
  });

  it("an incomplete today keeps yesterday's streak", () => {
    expect(calc(['2024-06-03', '2024-06-04'], [], [], '2024-06-05').current).toBe(2);
  });

  it('future completions are ignored', () => {
    const r = calc(['2024-06-04', '2024-06-06'], [], [], '2024-06-04');
    expect([r.current, r.best]).toEqual([1, 1]);
  });

  it('unchecking a previously completed day recalculates', () => {
    const all = ['2024-06-03', '2024-06-04', '2024-06-05'];
    expect(calc(all, [], [], '2024-06-05').current).toBe(3);
    const r = calc(all.filter((d) => d !== '2024-06-04'), [], [], '2024-06-05');
    expect([r.current, r.best]).toEqual([1, 1]);
  });

  it("unchecking today falls back to yesterday's streak", () => {
    expect(calc(['2024-06-03', '2024-06-04'], [], [], '2024-06-04').current).toBe(2);
    expect(calc(['2024-06-03'], [], [], '2024-06-04').current).toBe(1);
  });

  it('crosses week, month (incl. leap day) and year boundaries', () => {
    expect(calc(['2024-06-08', '2024-06-09', '2024-06-10'], [], [], '2024-06-10').current).toBe(3);
    expect(calc(['2024-02-28', '2024-02-29', '2024-03-01'], [], [], '2024-03-01').current).toBe(3);
    expect(calc(['2021-12-30', '2021-12-31', '2022-01-03'], WEEKENDS, [], '2022-01-03').current).toBe(3);
  });

  it('an applied freeze preserves the streak without incrementing it', () => {
    const r = calc(['2024-06-03', '2024-06-05'], [], ['2024-06-04'], '2024-06-05');
    expect(r.current).toBe(2);
    expect(r.runs).toHaveLength(1);
  });

  it('a freeze on a different day does not cover the miss', () => {
    expect(calc(['2024-06-03', '2024-06-05'], [], ['2024-06-10'], '2024-06-05').current).toBe(1);
  });

  it('custom mid-week rest day', () => {
    // 6-day schedule resting Wednesday: Tue, (Wed rest), Thu
    expect(calc(['2024-06-04', '2024-06-06'], ['Wed'], [], '2024-06-06').current).toBe(2);
    // The same history on a 7-day schedule breaks on Wednesday.
    expect(calc(['2024-06-04', '2024-06-06'], [], [], '2024-06-06').current).toBe(1);
  });

  it('saved rest-day names are parsed', () => {
    expect(calc(['2024-06-07', '2024-06-10'], ['Sat', 'Sun'], [], '2024-06-10').current).toBe(2);
    expect(parseRestDays(['sat', 'Sunday', 'bogus'])).toEqual(new Set(['Sat', 'Sun']));
  });

  it('duplicate completion keys count once', () => {
    expect(calc(['2024-06-03', '2024-06-03', '2024-06-04'], [], [], '2024-06-04').current).toBe(2);
  });

  it('personal best and runs across history', () => {
    const r = calc(['2024-06-03', '2024-06-04', '2024-06-05', '2024-06-07'], [], [], '2024-06-07');
    expect([r.current, r.best]).toEqual([1, 3]);
    expect(r.runs).toEqual([
      { start: '2024-06-03', end: '2024-06-05', days: 3 },
      { start: '2024-06-07', end: '2024-06-07', days: 1 },
    ]);
  });

  it('no completions is zero', () => {
    expect(calc([], WEEKENDS, [], '2024-06-05')).toEqual({ current: 0, best: 0, runs: [] });
  });

  it('a schedule where every day is a rest day has nothing to track', () => {
    expect(calc(['2024-06-03'], ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], [], '2024-06-03')).toEqual({ current: 0, best: 0, runs: [] });
  });

  it('the pure engine takes a per-date rest predicate', () => {
    const r = calculateStreak(new Set(['2024-06-04', '2024-06-06']), (d) => d === '2024-06-05', new Set(), '2024-06-06');
    expect(r.current).toBe(2);
  });
});

describe('rest-day completions (bonus effort)', () => {
  // Weekends rest; 2024-06-08 Sat, 06-09 Sun, 06-10 Mon.
  const tenWeekdays = ['2024-05-27', '2024-05-28', '2024-05-29', '2024-05-30', '2024-05-31', '2024-06-03', '2024-06-04', '2024-06-05', '2024-06-06', '2024-06-07'];
  const streak = (done: string[], today: string, freezes: string[] = []) => calc(done, WEEKENDS, freezes, today);

  it('a rest day not completed preserves without increasing', () => {
    expect(streak(tenWeekdays, '2024-06-08').current).toBe(10); // Saturday, resting
    expect(streak(tenWeekdays, '2024-06-09').current).toBe(10); // Sunday, resting
    expect(streak([...tenWeekdays, '2024-06-10'], '2024-06-10').current).toBe(11);
  });

  it('a completed rest day adds exactly one', () => {
    expect(streak([...tenWeekdays, '2024-06-08'], '2024-06-08').current).toBe(11);
    expect(streak([...tenWeekdays, '2024-06-08', '2024-06-10'], '2024-06-10').current).toBe(12);
  });

  it('each completed rest day counts once and uncompleted ones bridge', () => {
    expect(streak([...tenWeekdays, '2024-06-08', '2024-06-09'], '2024-06-09').current).toBe(12);
    // Completions are a set, so a repeated sync of the same day can't count twice.
    expect(streak([...tenWeekdays, '2024-06-08', '2024-06-08'], '2024-06-09').current).toBe(11);
  });

  it("undoing a rest-day completion removes its contribution", () => {
    const withRest = [...tenWeekdays, '2024-06-08'];
    expect(streak(withRest, '2024-06-08').current).toBe(11);
    const undone = streak(tenWeekdays, '2024-06-08');
    expect([undone.current, undone.best]).toEqual([10, 10]);
  });

  it('best streak includes rest-day completions', () => {
    // Run of 11 (incl. Saturday), then Tue 11th missed, then Wed 12th done.
    const r = streak([...tenWeekdays, '2024-06-08', '2024-06-12'], '2024-06-12');
    expect([r.current, r.best]).toEqual([1, 11]);
  });

  it('a missed active day still breaks the streak unless frozen', () => {
    // Mon 10th missed after a completed Saturday.
    const done = [...tenWeekdays, '2024-06-08', '2024-06-11'];
    expect(streak(done, '2024-06-11').current).toBe(1);
    expect(streak(done, '2024-06-11', ['2024-06-10']).current).toBe(12);
  });

  it('a rest day completed after a missed active day starts a new streak', () => {
    // Fri 7th missed (active), Sat 8th rest completed: a fresh streak of 1.
    expect(streak(['2024-06-05', '2024-06-06', '2024-06-08'], '2024-06-08').current).toBe(1);
  });

  it('the historical schedule decides which days are rest', () => {
    // Wednesday was a rest day only until the 10th; a completed old Wednesday counts, a missed new one breaks.
    const history = [
      { from: '2024-06-01', restDays: ['Wed'], daysPerWeek: 6 },
      { from: '2024-06-10', restDays: [], daysPerWeek: 7 },
    ];
    expect(streakOf(sched('a', ['2024-06-04', '2024-06-05', '2024-06-06'], [], { history }), '2024-06-06').current).toBe(3); // Tue, Wed (rest, completed), Thu
    expect(streakOf(sched('a', ['2024-06-11', '2024-06-13'], [], { history }), '2024-06-13').current).toBe(1); // Wed 12th is now active and was missed
  });

  it('rest-day completions across the year boundary', () => {
    // Sat 30 Dec 2023 (rest, completed), Sun 31 Dec (rest), Mon 1 Jan 2024.
    expect(streak(['2023-12-28', '2023-12-29', '2023-12-30', '2024-01-01'], '2024-01-01').current).toBe(4);
  });
});
