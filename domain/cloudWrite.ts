/**
 * The exact Firestore fields the Android app writes for habit changes (Stage 1: create, edit, goal, reminder, schedule,
 * archive, delete). Pure functions that build the field maps; `services/habitWriter.ts` sends them. The `updatedAt` /
 * `createdAt` server timestamps are added there, as in Kotlin's `HabitRepository.createHabit` / `updateHabit`.
 *
 * References (android/app/src/main/java/com/habittracker/app/):
 *   create     AppViewModel.addHabit          → HabitRepository.createHabit
 *   name/colour AppViewModel.editHabit         → HabitRepository.updateHabit   (only changed fields)
 *   goal       AppViewModel.updateGoal        → updateHabit   ("" when cleared)
 *   reminder   AppViewModel.updateHabitReminder → updateHabit  (both fields)
 *   schedule   AppViewModel.updateSchedule    → updateHabit   (+ streak, bestStreak)
 *   archive    AppViewModel.setArchived       → updateHabit
 *   delete     AppViewModel.deleteHabit       → HabitRepository.deleteHabit (+ FirestoreNoteStore.deleteNotesFor)
 *
 * Known limitation: Android stores `color` as a 64-bit integer. The Firestore web SDK writes any number above 2^53 as a
 * double (an `integerValue` cannot be produced from a JavaScript number), and Compose colour values are above 2^53. The
 * stored number is identical and Android reads it with `(value as? Number).toLong()`, which is exact for a double that
 * holds an integer, so Android shows the same colour; only Firestore's internal type tag differs.
 */
import type { Habit, SchedulePeriod } from '@/types/habit';
import { hexToComposeColor } from './cloudMapping';
import { orderedDays } from './habitRules';
import { parseRestDays } from './schedule';

export type FieldMap = Record<string, unknown>;

/** `ScheduleHistory.toFirestore`: rest days as week-ordered "Mon".."Sun" names, recognised names only. */
export const scheduleHistoryToFirestore = (periods: readonly SchedulePeriod[]): { from: string; restDays: string[]; daysPerWeek: number }[] =>
  periods.map((p) => ({ from: p.from, restDays: orderedDays(parseRestDays(p.restDays)), daysPerWeek: p.daysPerWeek }));

function colorLong(hex: string): number {
  const v = hexToComposeColor(hex);
  if (v === null) throw new Error(`Unsupported habit colour: ${hex}`);
  return v;
}

/**
 * `addHabit`'s document. Optional fields are only written when set, so habits without them look exactly like before;
 * the reminder fields only when the reminder is on. `sortOrder` is the creation time in ms, which is always above the
 * 0..n-1 positions a reorder writes, so new habits appear at the bottom.
 */
export function habitCreateFields(h: Habit, sortOrder: number): FieldMap {
  const remind = h.reminderEnabled && !!h.reminderTime;
  return {
    name: h.name,
    color: colorLong(h.color),
    completedDates: [],
    streak: 0,
    bestStreak: 0,
    daysPerWeek: h.daysPerWeek,
    restDays: h.restDays,
    createdDate: h.createdDate,
    sortOrder,
    scheduleHistory: scheduleHistoryToFirestore([{ from: h.createdDate, restDays: h.restDays, daysPerWeek: h.daysPerWeek }]),
    ...(h.goal ? { goal: h.goal } : {}),
    ...(remind ? { reminderEnabled: true, reminderTime: h.reminderTime } : {}),
  };
}

/** `editHabit`: only the fields that changed. */
export function habitEditFields(before: Habit, after: Habit): FieldMap {
  return {
    ...(after.name !== before.name ? { name: after.name } : {}),
    ...(after.color.toLowerCase() !== before.color.toLowerCase() ? { color: colorLong(after.color) } : {}),
  };
}

/** `updateSchedule`: the new schedule, the full history, and the re-derived streak values Kotlin persists with it. */
export function habitScheduleFields(updated: Habit, streak: { current: number; best: number }): FieldMap {
  return {
    daysPerWeek: updated.daysPerWeek,
    restDays: updated.restDays,
    scheduleHistory: scheduleHistoryToFirestore(updated.scheduleHistory),
    streak: streak.current,
    bestStreak: streak.best,
  };
}

/** `updateGoal`: blank is stored for "removed" so every reader and older app version sees no value. */
export const habitGoalFields = (goal: string | null): FieldMap => ({ goal: goal ?? '' });

/** `updateHabitReminder`: both fields, the time is kept while the reminder is off. */
export const habitReminderFields = (enabled: boolean, time: string | null): FieldMap => ({ reminderEnabled: enabled, reminderTime: time });

/** `setArchived`. */
export const habitArchiveFields = (archived: boolean): FieldMap => ({ archived });
