/**
 * Port of `HabitReminderRules` (android/.../data/HabitReminderRules.kt) and `GoalWhyRules` (data/HabitRecordParsing.kt).
 * Each habit stores `reminderEnabled` and `reminderTime` ("HH:mm", 24-hour). The time is kept while the reminder is
 * off. (Scheduling the reminders is a platform concern; the web app only stores the choice for now.)
 */
import type { DateKey } from '@/utils/date';
import { isActiveOn, type HabitSchedule } from './schedule';

export const DEFAULT_REMINDER_TIME = '09:00';
/** A reminder that runs later than this after its time is dropped, never sent late. */
export const REMINDER_GRACE_MILLIS = 3 * 60 * 60 * 1000;

const FORMAT = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export type Hhmm = { hour: number; minute: number };

/** The time for a stored "HH:mm" string, or null if missing or malformed. */
export function parseTime(text: string | null | undefined): Hhmm | null {
  if (!text || !FORMAT.test(text)) return null;
  return { hour: Number(text.slice(0, 2)), minute: Number(text.slice(3, 5)) };
}

export const formatTime = (t: Hhmm): string => `${String(t.hour).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;

/** "9:00 AM" (Kotlin pattern "h:mm a"). */
export function formatTime12h(text: string): string {
  const t = parseTime(text) ?? parseTime(DEFAULT_REMINDER_TIME)!;
  const h = t.hour % 12 === 0 ? 12 : t.hour % 12;
  return `${h}:${String(t.minute).padStart(2, '0')} ${t.hour < 12 ? 'AM' : 'PM'}`;
}

/** When the habit should be scheduled: only if enabled and the saved time is valid. */
export const scheduledTime = (enabled: boolean, time: string | null | undefined): Hhmm | null => (enabled ? parseTime(time) : null);

/** Whether the reminder may be shown today (`shouldNotify`). `masterOn` is Settings > Habit Reminders. */
export function shouldNotify(habit: HabitSchedule | null, enabled: boolean, today: DateKey, masterOn = true): boolean {
  return masterOn && enabled && habit !== null && isActiveOn(habit, today) && !habit.completed.has(today);
}

export const withinGrace = (scheduledAtMillis: number, nowMillis: number) => nowMillis - scheduledAtMillis <= REMINDER_GRACE_MILLIS;

export const GOAL_MAX_LENGTH = 300;

/** Trimmed goal text (max 300), or null when empty: an empty field means "not set" (`GoalWhyRules.normalize`). */
export function normalizeGoal(text: string | null | undefined): string | null {
  const t = text?.trim().slice(0, GOAL_MAX_LENGTH);
  return t ? t : null;
}
