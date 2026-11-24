/**
 * Pure logic of the Calendar screen, ported from android/.../ui/screens/HabitCalendarScreen.kt (`CalendarRange`,
 * `monthGrid`, `DayState`/`stateOf`, `onTileTap`, `onTileDoubleTap`, `bestStreakRows`, `HabitHealthCard`) and
 * ui/components/HorizontalMonthStrip.kt (`MonthStripRules`). No React here, so it is unit-tested directly.
 */
import type { StreakRun } from '@/types/habit';
import { addDays, addMonths, atDay, atEndOfMonth, daysInMonth, isAfter, isBefore, monthKeyOf, parseKey, type DateKey, type MonthKey } from '@/utils/date';

// ─── Range and grid ──────────────────────────────────────────────────────────

/** How far back the calendar reaches (`CalendarRange.HISTORY_YEARS`). */
export const HISTORY_YEARS = 10;

export type CalendarRange = { start: DateKey; end: DateKey };

/**
 * The months the calendar can show: from 10 years back (or the habit's first activity if that is even earlier) to the
 * current month. Past days can be recorded even before the habit was created, so the range doesn't stop at its creation.
 */
export function calendarRange(firstActivity: DateKey | null, today: DateKey): CalendarRange {
  const month = monthKeyOf(today);
  const floor = addMonths(month, -HISTORY_YEARS * 12);
  const first = firstActivity && monthKeyOf(firstActivity) < floor ? monthKeyOf(firstActivity) : floor;
  return { start: atDay(first, 1), end: atEndOfMonth(month) };
}

export const inRange = (r: CalendarRange, d: DateKey) => !isBefore(d, r.start) && !isAfter(d, r.end);
export const firstMonth = (r: CalendarRange): MonthKey => monthKeyOf(r.start);
export const lastMonth = (r: CalendarRange): MonthKey => monthKeyOf(r.end);

/** Clamp a month into [first, last] (`YearMonth.coerceIn`). */
export const coerceMonth = (m: MonthKey, first: MonthKey, last: MonthKey): MonthKey => (m < first ? first : m > last ? last : m);

/** Sunday-first weeks covering `month`, including the leading/trailing days of the neighbouring months. */
export function monthGrid(month: MonthKey): DateKey[][] {
  const first = atDay(month, 1);
  const dow = parseKey(first)!.getDay(); // 0 = Sunday
  let cur = addDays(first, -dow);
  const weeks: DateKey[][] = [];
  const end = atEndOfMonth(month);
  while (!isAfter(cur, end)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(cur, i)));
    cur = addDays(cur, 7);
  }
  return weeks;
}

// ─── Month strip (MonthStripRules) ───────────────────────────────────────────

export const MonthStripRules = {
  /** Months from `first` to `month`; the position of `month` in the strip (0 = first). */
  indexOf: (first: MonthKey, month: MonthKey): number => (Number(month.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + (Number(month.slice(5)) - Number(first.slice(5))),
  canPreviousMonth: (selected: MonthKey, first: MonthKey) => selected > first,
  canNextMonth: (selected: MonthKey, last: MonthKey) => selected < last,
  canPreviousYear: (selected: MonthKey, first: MonthKey) => Number(selected.slice(0, 4)) > Number(first.slice(0, 4)),
  canNextYear: (selected: MonthKey, last: MonthKey) => Number(selected.slice(0, 4)) < Number(last.slice(0, 4)),
  /** The same month a year earlier, or the earliest available month if that would be too early. */
  previousYear: (selected: MonthKey, first: MonthKey): MonthKey => {
    const m = addMonths(selected, -12);
    return m < first ? first : m;
  },
  /** The same month a year later, or the latest available month if that would be in the future. */
  nextYear: (selected: MonthKey, last: MonthKey): MonthKey => {
    const m = addMonths(selected, 12);
    return m > last ? last : m;
  },
};

// ─── Day states and tile taps ────────────────────────────────────────────────

/** What a calendar cell shows. Priority: done, then rest, then freeze; today is never "missed". */
export type DayState = 'Outside' | 'Inactive' | 'Future' | 'Done' | 'Rest' | 'Frozen' | 'Today' | 'Missed';

/** What the calendar knows about a habit and the date (callbacks mirror the Kotlin local functions). */
export type DayContext = {
  month: MonthKey;
  today: DateKey;
  range: CalendarRange;
  /** `isRest(d)`: planned rest day under the schedule in effect then (false outside the range). */
  isRest: (d: DateKey) => boolean;
  isDone: (d: DateKey) => boolean;
  isFrozen: (d: DateKey) => boolean;
  createdOn: DateKey | null;
};

/** Before the habit was created with nothing recorded (a completion or a freeze makes the day real). */
export const isUntracked = (c: DayContext, d: DateKey): boolean => c.createdOn !== null && isBefore(d, c.createdOn) && !c.isDone(d) && !c.isFrozen(d);

export function dayStateOf(c: DayContext, d: DateKey): DayState {
  if (monthKeyOf(d) !== c.month) return 'Outside';
  if (!inRange(c.range, d)) return 'Inactive';
  if (isAfter(d, c.today)) return 'Future';
  if (c.isDone(d)) return 'Done'; // a recorded day counts even before the habit was created
  if (isUntracked(c, d)) return 'Inactive'; // neutral, never "missed" (still editable by double-tap)
  if (c.isRest(d)) return 'Rest';
  if (c.isFrozen(d)) return 'Frozen';
  if (d === c.today) return 'Today';
  return 'Missed';
}

export type TapAction =
  | { kind: 'none' }
  | { kind: 'toast'; message: string }
  /** Edit mode (or a double tap): mark done / not done. */
  | { kind: 'toggle'; message?: string }
  /** Completed days (active or rest) open the note sheet. */
  | { kind: 'note' }
  /** Missed or frozen days open the freeze sheet. */
  | { kind: 'freeze' };

export type TapInput = {
  c: DayContext;
  d: DateKey;
  hasHabit: boolean;
  editMode: boolean;
  /** `vm.canHaveNote(habit, d)` for the open habit. */
  canNote: boolean;
};

/** Single tap on a cell in the displayed month (`onTileTap`). */
export function tileTap({ c, d, hasHabit, editMode, canNote }: TapInput): TapAction {
  if (!inRange(c.range, d)) return { kind: 'none' };
  if (isAfter(d, c.today)) return { kind: 'toast', message: 'Upcoming day' };
  // Edit mode toggles like double-tap, rest days included.
  if (editMode) return hasHabit ? { kind: 'toggle' } : { kind: 'none' };
  const done = c.isDone(d);
  if (isUntracked(c, d)) return { kind: 'toast', message: 'No activity recorded before this habit was created · double-tap to record it' };
  // Completed days (active or rest) open the note sheet: a journal entry for the day.
  if (done && hasHabit && canNote) return { kind: 'note' };
  if (c.isRest(d)) return { kind: 'toast', message: done ? '✅ Rest Day · completed voluntarily' : '🔵 Rest Day' };
  if (done) return { kind: 'toast', message: '✅ Completed' };
  if (c.isFrozen(d) && hasHabit && d !== c.today) return { kind: 'freeze' };
  if (c.isFrozen(d)) return { kind: 'toast', message: '❄️ Protected by a Streak Freeze' };
  if (d === c.today) return { kind: 'toast', message: '⏳ Not completed yet today' };
  if (hasHabit) return { kind: 'freeze' };
  return { kind: 'toast', message: '❌ Missed — streak breaks' };
}

/**
 * Double tap marks the habit done / not done for that day, like the dashboard checkbox. Planned rest days can be
 * completed too (voluntary bonus effort, +1 streak day); undoing restores the rest day (`onTileDoubleTap`).
 */
export function tileDoubleTap({ c, d, hasHabit }: Pick<TapInput, 'c' | 'd' | 'hasHabit'>): TapAction {
  if (!hasHabit) return { kind: 'none' };
  if (!inRange(c.range, d)) return { kind: 'none' };
  if (isAfter(d, c.today)) return { kind: 'toast', message: "You can't complete a future day" };
  const done = c.isDone(d);
  if (c.isFrozen(d) && !done) return { kind: 'toast', message: '❄️ This day is protected by a Streak Freeze' };
  const rest = c.isRest(d);
  return {
    kind: 'toggle',
    message: done ? (rest ? '↩️ Marked as not done · back to a rest day' : '↩️ Marked as not done') : rest ? '✅ Completed on a rest day · +1 streak day' : '✅ Marked as done',
  };
}

// ─── Best streaks and habit health ───────────────────────────────────────────

export type BarStyle = 'bright' | 'yellow' | 'muted' | 'dark' | 'subdued';
export type BestStreak = { start: string; end: string; days: number; style: BarStyle };

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** "dd-MMM-yyyy" (e.g. 08-May-2024). */
export const formatStreakDate = (k: DateKey): string => `${k.slice(8, 10)}-${MONTH_ABBR[Number(k.slice(5, 7)) - 1]}-${k.slice(0, 4)}`;

/** Top 4 streak runs, most recent first, with the personal best highlighted (`bestStreakRows`). */
export function bestStreakRows(runs: readonly StreakRun[]): BestStreak[] {
  const top = [...runs].sort((a, b) => b.days - a.days).slice(0, 4);
  const best = top[0]?.days ?? 0;
  return [...top]
    .sort((a, b) => (a.end < b.end ? 1 : a.end > b.end ? -1 : 0))
    .map((r) => ({ start: formatStreakDate(r.start), end: formatStreakDate(r.end), days: r.days, style: r.days === best ? 'bright' : 'muted' }));
}

/** Demo rows shown only when no habit matches the route (Kotlin `BEST_STREAKS`). */
export const DEMO_BEST_STREAKS: BestStreak[] = [
  { start: '08-May-2024', end: '12-May-2024', days: 5, style: 'dark' },
  { start: '08-Mar-2024', end: '11-Mar-2024', days: 4, style: 'dark' },
  { start: '26-Feb-2024', end: '29-Feb-2024', days: 4, style: 'dark' },
  { start: '05-Feb-2024', end: '14-Feb-2024', days: 10, style: 'yellow' },
  { start: '21-Jan-2024', end: '24-Jan-2024', days: 4, style: 'dark' },
  { start: '15-Dec-2023', end: '23-Dec-2023', days: 9, style: 'yellow' },
  { start: '14-Oct-2023', end: '20-Oct-2023', days: 7, style: 'muted' },
  { start: '07-Oct-2023', end: '12-Oct-2023', days: 6, style: 'muted' },
  { start: '13-Sep-2023', end: '23-Sep-2023', days: 11, style: 'bright' },
  { start: '04-Sep-2023', end: '09-Sep-2023', days: 6, style: 'subdued' },
];
export const DEMO_MAX_STREAK_DAYS = 11;

/** Width of a best-streak bar in px: at least 36, else proportional to the longest (148 at full). */
export const streakBarWidth = (days: number, maxDays: number): number => Math.max(36, (days / Math.max(maxDays, 1)) * 148);

/** The gauge of the Habit Health card: current streak relative to the personal best, 0..1 (`fraction`). */
export const healthFraction = (streak: number, best: number): number => (best <= 0 ? 0 : Math.min(1, Math.max(0, streak / best)));

/** Consistency label from the month's completion rate, or null when there are too few days (`HabitHealthCard`). */
export function consistencyLabel(rate: number | null): string | null {
  if (rate === null) return null;
  const label = rate >= 80 ? 'Great consistency' : rate >= 50 ? 'Good consistency' : 'Building consistency';
  return `${label} (${rate}%)`;
}

/** "Monthly Completion" percentage: null when nothing is eligible (shown as "–"). */
export const monthlyPercent = (completed: number, eligible: number): number | null => (eligible === 0 ? null : Math.round((completed * 100) / eligible));

export { daysInMonth };
