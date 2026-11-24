import { describe, expect, it } from 'vitest';

import { monthBreakdown } from '@/domain/analytics';
import {
  bestStreakRows,
  calendarRange,
  coerceMonth,
  consistencyLabel,
  dayStateOf,
  formatStreakDate,
  healthFraction,
  HISTORY_YEARS,
  inRange,
  monthGrid,
  monthlyPercent,
  MonthStripRules,
  streakBarWidth,
  tileDoubleTap,
  tileTap,
  type DayContext,
} from '@/domain/calendar';
import { checkFreeze, FREEZE_ELIGIBILITY_MESSAGE } from '@/domain/freeze';
import { updateSchedule } from '@/domain/habitRules';
import { canHaveNote, deleteNote, NOTE_ERR_EMPTY, NOTE_ERR_NOT_ALLOWED, NOTE_MAX_LENGTH, normalizeNote, notesWithoutHabit, saveNote } from '@/domain/notes';
import { isRest, scheduleOf } from '@/domain/schedule';
import type { Habit } from '@/types/habit';
import { range, sched, WEEKENDS } from './helpers';

const TODAY = '2026-11-21'; // a Saturday
const MONTH = '2026-11';

function ctx(over: Partial<DayContext> & { done?: string[]; frozen?: string[]; rest?: string[] } = {}): DayContext {
  const done = new Set(over.done ?? []);
  const frozen = new Set(over.frozen ?? []);
  const rest = new Set(over.rest ?? []);
  return {
    month: MONTH,
    today: TODAY,
    range: { start: '2016-11-01', end: '2026-11-30' },
    isRest: (d) => rest.has(d),
    isDone: (d) => done.has(d),
    isFrozen: (d) => frozen.has(d),
    createdOn: null,
    ...over,
  };
}

describe('calendar range and month grid', () => {
  it('reaches 10 years back to the end of the current month', () => {
    expect(HISTORY_YEARS).toBe(10);
    expect(calendarRange(null, TODAY)).toEqual({ start: '2016-11-01', end: '2026-11-30' });
  });
  it('reaches further back only when the habit has earlier activity', () => {
    expect(calendarRange('2010-03-05', TODAY).start).toBe('2010-03-01');
    expect(calendarRange('2025-01-01', TODAY).start).toBe('2016-11-01');
  });
  it('inRange and coerceMonth clamp to the range', () => {
    const r = calendarRange(null, TODAY);
    expect(inRange(r, '2026-11-30')).toBe(true);
    expect(inRange(r, '2026-12-01')).toBe(false);
    expect(inRange(r, '2016-10-31')).toBe(false);
    expect(coerceMonth('2030-01', '2016-11', '2026-11')).toBe('2026-11');
    expect(coerceMonth('2000-01', '2016-11', '2026-11')).toBe('2016-11');
    expect(coerceMonth('2024-05', '2016-11', '2026-11')).toBe('2024-05');
  });
  it('lays the month out in Sunday-first weeks, including neighbouring days', () => {
    const grid = monthGrid(MONTH); // 1 Nov 2026 is a Sunday
    expect(grid).toHaveLength(5);
    expect(grid[0][0]).toBe('2026-11-01');
    expect(grid[4][6]).toBe('2026-12-05');
    expect(grid.every((w) => w.length === 7)).toBe(true);
    const oct = monthGrid('2026-10'); // 1 Oct 2026 is a Thursday
    expect(oct[0][0]).toBe('2026-09-27');
    expect(oct[0][4]).toBe('2026-10-01');
  });
});

describe('month strip rules', () => {
  const first = '2016-11';
  const last = '2026-11';
  it('indexes months from the first one', () => {
    expect(MonthStripRules.indexOf(first, first)).toBe(0);
    expect(MonthStripRules.indexOf(first, last)).toBe(120);
  });
  it('limits month arrows to the range', () => {
    expect(MonthStripRules.canPreviousMonth(first, first)).toBe(false);
    expect(MonthStripRules.canPreviousMonth('2020-01', first)).toBe(true);
    expect(MonthStripRules.canNextMonth(last, last)).toBe(false);
    expect(MonthStripRules.canNextMonth('2026-10', last)).toBe(true);
  });
  it('jumps a year at a time and clamps at the ends', () => {
    expect(MonthStripRules.previousYear('2020-05', first)).toBe('2019-05');
    expect(MonthStripRules.previousYear('2017-02', first)).toBe(first);
    expect(MonthStripRules.nextYear('2020-05', last)).toBe('2021-05');
    expect(MonthStripRules.nextYear('2026-03', last)).toBe(last);
    expect(MonthStripRules.canPreviousYear('2016-12', first)).toBe(false);
    expect(MonthStripRules.canPreviousYear('2017-01', first)).toBe(true);
    expect(MonthStripRules.canNextYear('2026-01', last)).toBe(false);
    expect(MonthStripRules.canNextYear('2025-12', last)).toBe(true);
  });
});

describe('day states', () => {
  it('outside the displayed month is Outside, outside the range is Inactive, later than today is Future', () => {
    expect(dayStateOf(ctx(), '2026-10-31')).toBe('Outside');
    expect(dayStateOf(ctx({ range: { start: '2026-11-10', end: '2026-11-30' } }), '2026-11-05')).toBe('Inactive');
    expect(dayStateOf(ctx(), '2026-11-25')).toBe('Future');
  });
  it('a completed day is Done even on a rest day or before the habit existed', () => {
    expect(dayStateOf(ctx({ done: ['2026-11-14'], rest: ['2026-11-14'] }), '2026-11-14')).toBe('Done');
    expect(dayStateOf(ctx({ createdOn: '2026-11-10', done: ['2026-11-05'] }), '2026-11-05')).toBe('Done');
  });
  it('days before creation with nothing recorded are neutral (never Missed); a freeze makes them real', () => {
    expect(dayStateOf(ctx({ createdOn: '2026-11-10' }), '2026-11-05')).toBe('Inactive');
    expect(dayStateOf(ctx({ createdOn: '2026-11-10', frozen: ['2026-11-05'] }), '2026-11-05')).toBe('Frozen');
  });
  it('rest, frozen, today and missed, in that priority', () => {
    expect(dayStateOf(ctx({ rest: ['2026-11-14'], frozen: ['2026-11-14'] }), '2026-11-14')).toBe('Rest');
    expect(dayStateOf(ctx({ frozen: ['2026-11-18'] }), '2026-11-18')).toBe('Frozen');
    expect(dayStateOf(ctx(), TODAY)).toBe('Today');
    expect(dayStateOf(ctx(), '2026-11-18')).toBe('Missed');
  });
});

describe('single tap', () => {
  const tap = (d: string, over: { editMode?: boolean; hasHabit?: boolean; canNote?: boolean; c?: DayContext } = {}) =>
    tileTap({ c: over.c ?? ctx(), d, hasHabit: over.hasHabit ?? true, editMode: over.editMode ?? false, canNote: over.canNote ?? false });

  it('does nothing outside the range and reports upcoming days', () => {
    expect(tap('2026-12-02')).toEqual({ kind: 'none' });
    expect(tap('2026-11-25')).toEqual({ kind: 'toast', message: 'Upcoming day' });
  });
  it('edit mode toggles, rest days included, but only for a real habit', () => {
    expect(tap('2026-11-18', { editMode: true })).toEqual({ kind: 'toggle' });
    expect(tap('2026-11-14', { editMode: true, c: ctx({ rest: ['2026-11-14'] }) })).toEqual({ kind: 'toggle' });
    expect(tap('2026-11-18', { editMode: true, hasHabit: false })).toEqual({ kind: 'none' });
    // Edit mode still can't touch the future.
    expect(tap('2026-11-25', { editMode: true })).toEqual({ kind: 'toast', message: 'Upcoming day' });
  });
  it('days before creation explain how to record them', () => {
    const c = ctx({ createdOn: '2026-11-10' });
    expect(tap('2026-11-05', { c })).toEqual({ kind: 'toast', message: 'No activity recorded before this habit was created · double-tap to record it' });
  });
  it('completed days open the note sheet (active or rest) when a note is allowed', () => {
    expect(tap('2026-11-17', { c: ctx({ done: ['2026-11-17'] }), canNote: true })).toEqual({ kind: 'note' });
    expect(tap('2026-11-15', { c: ctx({ done: ['2026-11-15'], rest: ['2026-11-15'] }), canNote: true })).toEqual({ kind: 'note' });
  });
  it('rest and completed days explain themselves when there is no note sheet', () => {
    expect(tap('2026-11-14', { c: ctx({ rest: ['2026-11-14'] }) })).toEqual({ kind: 'toast', message: '🔵 Rest Day' });
    expect(tap('2026-11-14', { c: ctx({ rest: ['2026-11-14'], done: ['2026-11-14'] }) })).toEqual({ kind: 'toast', message: '✅ Rest Day · completed voluntarily' });
    expect(tap('2026-11-17', { c: ctx({ done: ['2026-11-17'] }) })).toEqual({ kind: 'toast', message: '✅ Completed' });
  });
  it('missed and frozen past days open the freeze sheet', () => {
    expect(tap('2026-11-18')).toEqual({ kind: 'freeze' });
    expect(tap('2026-11-18', { c: ctx({ frozen: ['2026-11-18'] }) })).toEqual({ kind: 'freeze' });
  });
  it('today is never missed; a frozen today only reports protection', () => {
    expect(tap(TODAY)).toEqual({ kind: 'toast', message: '⏳ Not completed yet today' });
    expect(tap(TODAY, { c: ctx({ frozen: [TODAY] }) })).toEqual({ kind: 'toast', message: '❄️ Protected by a Streak Freeze' });
  });
  it('without a habit (demo) a missed day only says the streak breaks', () => {
    expect(tap('2026-11-18', { hasHabit: false })).toEqual({ kind: 'toast', message: '❌ Missed — streak breaks' });
  });
});

describe('double tap', () => {
  const dbl = (d: string, c = ctx(), hasHabit = true) => tileDoubleTap({ c, d, hasHabit });
  it('needs a habit and a day in range', () => {
    expect(dbl('2026-11-18', ctx(), false)).toEqual({ kind: 'none' });
    expect(dbl('2026-12-02')).toEqual({ kind: 'none' });
  });
  it("refuses the future and frozen days that aren't completed", () => {
    expect(dbl('2026-11-25')).toEqual({ kind: 'toast', message: "You can't complete a future day" });
    expect(dbl('2026-11-18', ctx({ frozen: ['2026-11-18'] }))).toEqual({ kind: 'toast', message: '❄️ This day is protected by a Streak Freeze' });
  });
  it('marks a day done / not done with the Kotlin messages', () => {
    expect(dbl('2026-11-18')).toEqual({ kind: 'toggle', message: '✅ Marked as done' });
    expect(dbl('2026-11-18', ctx({ done: ['2026-11-18'] }))).toEqual({ kind: 'toggle', message: '↩️ Marked as not done' });
  });
  it('a rest day can be completed as bonus effort and undone back to a rest day', () => {
    expect(dbl('2026-11-14', ctx({ rest: ['2026-11-14'] }))).toEqual({ kind: 'toggle', message: '✅ Completed on a rest day · +1 streak day' });
    expect(dbl('2026-11-14', ctx({ rest: ['2026-11-14'], done: ['2026-11-14'] }))).toEqual({ kind: 'toggle', message: '↩️ Marked as not done · back to a rest day' });
  });
});

describe('best streaks and habit health', () => {
  const runs = [
    { start: '2026-01-01', end: '2026-01-05', days: 5 },
    { start: '2026-02-01', end: '2026-02-10', days: 10 },
    { start: '2026-03-01', end: '2026-03-03', days: 3 },
    { start: '2026-04-01', end: '2026-04-04', days: 4 },
    { start: '2026-05-01', end: '2026-05-02', days: 2 },
  ];
  it('keeps the top four runs by length, shown most recent first, best highlighted', () => {
    const rows = bestStreakRows(runs);
    expect(rows.map((r) => r.days)).toEqual([4, 3, 10, 5]);
    expect(rows.map((r) => r.style)).toEqual(['muted', 'muted', 'bright', 'muted']);
    expect(rows[2]).toMatchObject({ start: '01-Feb-2026', end: '10-Feb-2026' });
  });
  it('has no rows for no runs', () => {
    expect(bestStreakRows([])).toEqual([]);
  });
  it('formats dates as dd-MMM-yyyy', () => {
    expect(formatStreakDate('2024-05-08')).toBe('08-May-2024');
  });
  it('bar width is at least 36 and 148 for the longest', () => {
    expect(streakBarWidth(1, 11)).toBe(36);
    expect(streakBarWidth(11, 11)).toBe(148);
    expect(streakBarWidth(5, 10)).toBe(74);
  });
  it('gauge fraction is streak over best, clamped', () => {
    expect(healthFraction(5, 10)).toBe(0.5);
    expect(healthFraction(0, 0)).toBe(0);
    expect(healthFraction(12, 10)).toBe(1);
  });
  it('consistency label thresholds', () => {
    expect(consistencyLabel(80)).toBe('Great consistency (80%)');
    expect(consistencyLabel(79)).toBe('Good consistency (79%)');
    expect(consistencyLabel(50)).toBe('Good consistency (50%)');
    expect(consistencyLabel(49)).toBe('Building consistency (49%)');
    expect(consistencyLabel(null)).toBeNull();
  });
  it('monthly percentage shows a dash (null) when nothing is eligible', () => {
    expect(monthlyPercent(0, 0)).toBeNull();
    expect(monthlyPercent(1, 3)).toBe(33);
    expect(monthlyPercent(3, 3)).toBe(100);
  });
});

describe('monthly completion breakdown', () => {
  // Mon 2 Nov created; done Mon-Wed; Thu 5 frozen; weekends are rest days.
  const h = sched('h', ['2026-11-02', '2026-11-03', '2026-11-04'], WEEKENDS, { createdDate: '2026-11-02', freezes: ['2026-11-05'] });
  it('splits eligible days into completed, frozen and missed, and counts rest days', () => {
    const b = monthBreakdown(h, MONTH, TODAY);
    expect(b.stats.completed).toBe(3);
    expect(b.frozen).toBe(1);
    expect(b.missed).toBe(b.stats.eligible - 3 - 1);
    expect(b.restDays).toBe(5); // 7, 8, 14, 15 and today (Sat 21st)
  });
  it('an earlier month the habit did not exist in is empty', () => {
    expect(monthBreakdown(h, '2026-09', TODAY)).toMatchObject({ missed: 0, restDays: 0, frozen: 0, stats: { completed: 0, eligible: 0 } });
  });
  it('a completed rest day is bonus effort and not counted as a rest day', () => {
    const withBonus = sched('h', ['2026-11-07'], WEEKENDS, { createdDate: '2026-11-02' });
    expect(monthBreakdown(withBonus, MONTH, TODAY).restDays).toBe(4);
  });
});

describe('notes', () => {
  it('are allowed on completed days, including rest days and today', () => {
    expect(canHaveNote('2026-11-17', TODAY, false, true)).toBe(true);
    expect(canHaveNote('2026-11-15', TODAY, true, true)).toBe(true);
    expect(canHaveNote(TODAY, TODAY, false, true)).toBe(true);
  });
  it('are allowed on past missed days only', () => {
    expect(canHaveNote('2026-11-18', TODAY, false, false)).toBe(true);
    expect(canHaveNote(TODAY, TODAY, false, false)).toBe(false); // today not over yet
    expect(canHaveNote('2026-11-14', TODAY, true, false)).toBe(false); // uncompleted rest day
    expect(canHaveNote('2026-11-25', TODAY, false, false)).toBe(false); // future
    expect(canHaveNote('2026-11-25', TODAY, false, true)).toBe(false); // future even if somehow completed
  });
  it('are not allowed on unrecorded days before the habit was created, unless completed', () => {
    expect(canHaveNote('2026-11-05', TODAY, false, false, '2026-11-10')).toBe(false);
    expect(canHaveNote('2026-11-05', TODAY, false, true, '2026-11-10')).toBe(true);
  });
  it('are trimmed and capped at 200 characters; blank is nothing', () => {
    expect(normalizeNote('  hi  ')).toBe('hi');
    expect(normalizeNote('   ')).toBeNull();
    expect(normalizeNote('x'.repeat(300))).toHaveLength(NOTE_MAX_LENGTH);
  });
  it('save creates, replaces and keeps other habits and days untouched', () => {
    const a = saveNote({}, 'h1', '2026-11-18', 'first', true);
    expect(a.ok && a.notes).toEqual({ h1: { '2026-11-18': 'first' } });
    const b = saveNote(a.ok ? a.notes : {}, 'h1', '2026-11-18', 'edited', true);
    expect(b.ok && b.notes).toEqual({ h1: { '2026-11-18': 'edited' } });
    const c = saveNote(b.ok ? b.notes : {}, 'h2', '2026-11-18', 'other', true);
    expect(c.ok && c.notes).toEqual({ h1: { '2026-11-18': 'edited' }, h2: { '2026-11-18': 'other' } });
  });
  it('save refuses empty text and disallowed days with the Kotlin messages', () => {
    expect(saveNote({}, 'h1', '2026-11-18', '  ', true)).toEqual({ ok: false, message: NOTE_ERR_EMPTY });
    expect(saveNote({}, 'h1', '2026-11-25', 'x', false)).toEqual({ ok: false, message: NOTE_ERR_NOT_ALLOWED });
  });
  it('delete removes only that note', () => {
    const r = deleteNote({ h1: { '2026-11-18': 'a', '2026-11-19': 'b' } }, 'h1', '2026-11-18');
    expect(r.ok && r.notes).toEqual({ h1: { '2026-11-19': 'b' } });
    expect(r.message).toBe('🗑️ Note deleted');
  });
  it('are removed with their habit', () => {
    expect(notesWithoutHabit({ h1: { '2026-11-18': 'a' }, h2: { '2026-11-18': 'b' } }, 'h1')).toEqual({ h2: { '2026-11-18': 'b' } });
  });
});

describe('freeze eligibility from the calendar', () => {
  // Completed 10..17 Nov, missed 18 Nov, today Sat 21 Nov with 19 and 20 also missed.
  const h = sched('h', range('2026-11-10', 8), [], { createdDate: '2026-11-10' });
  it('only the oldest missed day inside the 3-day window is eligible', () => {
    expect(checkFreeze(h, '2026-11-18', TODAY)).toBe('Eligible');
    expect(checkFreeze(h, '2026-11-19', TODAY)).toBe('EarlierDayFirst');
    expect(checkFreeze(h, '2026-11-20', TODAY)).toBe('EarlierDayFirst');
  });
  it('explains why other days cannot be frozen', () => {
    expect(checkFreeze(h, '2026-11-17', TODAY)).toBe('Completed');
    expect(checkFreeze(h, TODAY, TODAY)).toBe('Today');
    expect(checkFreeze(h, '2026-11-22', TODAY)).toBe('Future');
    expect(checkFreeze(h, '2026-11-12', TODAY)).toBe('Completed');
    expect(FREEZE_ELIGIBILITY_MESSAGE.TooOld).toContain('3 days');
  });
  it('older misses are out of the recovery window', () => {
    const old = sched('h', range('2026-11-01', 5), [], { createdDate: '2026-11-01' });
    expect(checkFreeze(old, '2026-11-06', TODAY)).toBe('TooOld');
  });
  it('a frozen day reports AlreadyFrozen, and freezing the oldest unlocks the next', () => {
    const frozen = sched('h', range('2026-11-10', 8), [], { createdDate: '2026-11-10', freezes: ['2026-11-18'] });
    expect(checkFreeze(frozen, '2026-11-18', TODAY)).toBe('AlreadyFrozen');
    expect(checkFreeze(frozen, '2026-11-19', TODAY)).toBe('Eligible');
  });
  it('planned rest days never need a freeze', () => {
    const rest = sched('h', range('2026-11-10', 8), ['Wed'], { createdDate: '2026-11-10' }); // 18 Nov is a Wednesday
    expect(checkFreeze(rest, '2026-11-18', TODAY)).toBe('RestDay');
  });
  it('the calendar offers the freeze sheet exactly for eligible missed days', () => {
    const c = ctx({ done: range('2026-11-10', 8) });
    expect(dayStateOf(c, '2026-11-18')).toBe('Missed');
    expect(tileTap({ c, d: '2026-11-18', hasHabit: true, editMode: false, canNote: true })).toEqual({ kind: 'freeze' });
  });
});

describe('historical schedule changes', () => {
  const habit: Habit = {
    id: 'h',
    name: 'Reading',
    color: '#5FE3A1',
    completedDates: [],
    daysPerWeek: 7,
    restDays: [],
    createdDate: '2026-11-02',
    scheduleHistory: [],
    archived: false,
    goal: null,
    reminderEnabled: false,
    reminderTime: null,
  };
  it('applies from tomorrow, so today and every past day keep the old schedule', () => {
    const updated = updateSchedule(habit, 5, WEEKENDS, TODAY);
    expect(updated.daysPerWeek).toBe(5);
    const s = scheduleOf(updated, []);
    expect(isRest(s, '2026-11-14')).toBe(false); // an earlier Saturday
    expect(isRest(s, TODAY)).toBe(false); // today, a Saturday
    expect(isRest(s, '2026-11-28')).toBe(true); // next Saturday
    expect(isRest(s, '2026-11-29')).toBe(true); // next Sunday
  });
  it('past Saturdays still show as Missed (not Rest) after the change', () => {
    const s = scheduleOf(updateSchedule(habit, 5, WEEKENDS, TODAY), []);
    const c = ctx({ isRest: (d) => isRest(s, d) });
    expect(dayStateOf(c, '2026-11-14')).toBe('Missed');
  });
  it('a second change keeps the first period for the days between', () => {
    const first = updateSchedule(habit, 5, WEEKENDS, '2026-11-10'); // from 11 Nov
    const second = updateSchedule(first, 6, ['Sun'], '2026-11-17'); // from 18 Nov
    const s = scheduleOf(second, []);
    expect(isRest(s, '2026-11-14')).toBe(true); // Saturday under the first change
    expect(isRest(s, '2026-11-21')).toBe(false); // Saturday under the second
    expect(isRest(s, '2026-11-22')).toBe(true); // Sunday still rest
    expect(isRest(s, '2026-11-07')).toBe(false); // before the first change
  });
  it('completions are preserved across a schedule change', () => {
    const done = { ...habit, completedDates: ['2026-11-14'] };
    expect(updateSchedule(done, 5, WEEKENDS, TODAY).completedDates).toEqual(['2026-11-14']);
  });
});

describe('notes surviving edits', () => {
  it('stay independent of completion and freeze data', () => {
    const notes = { h: { '2026-11-18': 'tired' } };
    const r = saveNote(notes, 'h', '2026-11-19', 'busy', true);
    expect(r.ok && r.notes.h['2026-11-18']).toBe('tired');
  });
});
