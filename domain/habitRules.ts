/**
 * Port of android/.../data/HabitNameRules.kt and the habit-editing rules in AppViewModel.kt
 * (`editHabit`, `updateSchedule`, `updateGoal`, `updateHabitReminder`, `reminderLabel`).
 * Pure functions over plain habit objects so they can be unit-tested; the store only calls them.
 */
import { WEEKDAYS, addDays, parseKey, type DateKey } from '@/utils/date';
import { habitSlug, type Habit, type SchedulePeriod } from '@/types/habit';
import { DEFAULT_REMINDER_TIME, formatTime12h, normalizeGoal, parseTime } from './reminder';
import { parseRestDays } from './schedule';

// ─── Name rules (HabitNameRules) ─────────────────────────────────────────────

/** Names have no limit when created, so this only caps edits at a sane length. */
export const NAME_MAX_LENGTH = 100;

/** The name as it will be saved: surrounding spaces removed. */
export const normalizeName = (text: string): string => text.trim();

/** Not blank (spaces only is blank) and not longer than the cap; an existing longer name is kept as is. */
export function isValidName(text: string, current = ''): boolean {
  const name = normalizeName(text);
  return name.length > 0 && (name.length <= NAME_MAX_LENGTH || name === current);
}

/** Save is offered only for a valid name that differs from `current`. */
export const canSaveName = (text: string, current: string): boolean => isValidName(text, current) && normalizeName(text) !== current;

/** The same key as `Habit.slug`, which routes to the habit; two habits with the same slug would open each other. */
export const slugOf = (name: string): string => habitSlug({ name });

// ─── Edit name / colour (AppViewModel.editHabit) ─────────────────────────────

export const ERR_NAME_INVALID = `Enter a habit name (up to ${NAME_MAX_LENGTH} characters).`;
export const ERR_NAME_DUPLICATE = 'You already have a habit with this name.';
export const ERR_NOT_FOUND = 'This habit no longer exists.';

export type EditResult = { habits: Habit[]; error: string | null };

/**
 * Changes a habit's name and/or colour. Returns an error message, or null on success (also when nothing changed, which
 * writes nothing). Only `name` and `color` change: completions, streaks, schedule, reminder, goal and freezes are untouched.
 */
export function editHabit(habits: readonly Habit[], habitId: string, newName: string, newColor: string): EditResult {
  const unchanged = { habits: [...habits], error: null };
  const old = habits.find((h) => h.id === habitId);
  if (!old) return { habits: [...habits], error: ERR_NOT_FOUND };
  const name = normalizeName(newName);
  if (!isValidName(name, old.name)) return { habits: [...habits], error: ERR_NAME_INVALID };
  const nameChanged = name !== old.name;
  const colorChanged = newColor.toLowerCase() !== old.color.toLowerCase();
  if (!nameChanged && !colorChanged) return unchanged;
  if (nameChanged) {
    // The habit is found by its name-based route, so another habit with the same name would clash.
    const slug = slugOf(name);
    if (habits.some((h) => h.id !== habitId && slugOf(h.name) === slug)) return { habits: [...habits], error: ERR_NAME_DUPLICATE };
  }
  return { habits: habits.map((h) => (h.id === habitId ? { ...h, name, color: newColor } : h)), error: null };
}

// ─── Schedule changes (ScheduleHistory.withChange + AppViewModel.updateSchedule) ──────────────────

const dayOrder = (d: string) => WEEKDAYS.indexOf(d as (typeof WEEKDAYS)[number]);
/** "Mon".."Sun" names in week order (Kotlin stores the sorted DayOfWeek set). */
export const orderedDays = (days: Iterable<string>): string[] => [...days].sort((a, b) => dayOrder(a) - dayOrder(b));

/**
 * Records a schedule change effective from `effective`. A habit without history first gets its previous schedule
 * recorded from `habitStart`, so its past is not reinterpreted. A second change on the same day replaces the first.
 */
export function withScheduleChange(
  periods: readonly SchedulePeriod[],
  previousRest: ReadonlySet<string>,
  previousDays: number,
  habitStart: DateKey,
  effective: DateKey,
  newRest: ReadonlySet<string>,
  newDays: number,
): SchedulePeriod[] {
  const base: SchedulePeriod[] = periods.length
    ? [...periods]
    : [{ from: habitStart < effective ? habitStart : effective, restDays: orderedDays(previousRest), daysPerWeek: previousDays }];
  const kept = base.filter((p) => p.from < effective);
  return [...kept, { from: effective, restDays: orderedDays(newRest), daysPerWeek: newDays }].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
}

/**
 * Changes a habit's weekly schedule from TOMORROW onward. Earlier days keep the schedule that applied then (recorded in
 * `scheduleHistory`); completions are not touched. Changes start tomorrow so today's schedule, reminders and streak are
 * never altered and no past or missed day can become a rest day. Editing again before tomorrow replaces the pending change.
 */
export function updateSchedule(habit: Habit, daysPerWeek: number, restDays: string[], today: DateKey): Habit {
  const effective = addDays(today, 1);
  const completed = habit.completedDates.filter((k) => parseKey(k)).sort();
  const candidates = [habit.createdDate && parseKey(habit.createdDate) ? habit.createdDate : null, completed[0] ?? null].filter((k): k is DateKey => k !== null);
  const start = candidates.length ? candidates.reduce((a, b) => (a < b ? a : b)) : today;
  const scheduleHistory = withScheduleChange(habit.scheduleHistory, parseRestDays(habit.restDays), habit.daysPerWeek, start, effective, parseRestDays(restDays), daysPerWeek);
  return { ...habit, daysPerWeek, restDays, scheduleHistory };
}

/** Rest days chosen in the "Edit Rest Days" sheet -> days per week is 7 minus the rest days (`updateSchedule(7 - rest.size, ...)`). */
export const daysPerWeekFor = (restDays: readonly string[]): number => 7 - restDays.length;

// ─── Goal and reminder (updateGoal, updateHabitReminder, reminderLabel) ───────────────────────────

/** Saves the Goal (null or blank removes it). Only `goal` changes. */
export const updateGoal = (habit: Habit, goal: string | null): Habit => ({ ...habit, goal: normalizeGoal(goal) });

/** Turns a habit's own reminder on or off and sets its time (kept while off). Only the two reminder fields change. */
export const updateReminder = (habit: Habit, enabled: boolean, time: string): Habit => ({
  ...habit,
  reminderEnabled: enabled,
  reminderTime: parseTime(time) ? time : habit.reminderTime ?? DEFAULT_REMINDER_TIME,
});

/**
 * Reminder status for the Habit Details bell label: "Off", "Paused" (the Settings master switch is off; the habit's own
 * setting is kept), "Blocked" (notifications not allowed), else the time as "h:mm a".
 */
export function reminderLabel(habit: Pick<Habit, 'reminderEnabled' | 'reminderTime'>, notificationsAllowed: boolean, masterOn = true): string {
  const time = parseTime(habit.reminderTime);
  if (!habit.reminderEnabled || !time) return 'Off';
  if (!masterOn) return 'Paused';
  if (!notificationsAllowed) return 'Blocked';
  return formatTime12h(habit.reminderTime!);
}
