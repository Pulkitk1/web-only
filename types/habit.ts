import type { DateKey } from '@/utils/date';

/** A weekly schedule in effect from `from` until the next period starts (Kotlin `SchedulePeriod`). */
export type SchedulePeriod = {
  from: DateKey;
  /** "Mon".."Sun" */
  restDays: string[];
  daysPerWeek: number;
};

/** Mirrors the Kotlin `Habit` data class (fields the dashboard needs). Colour is a "#RRGGBB" string. */
export type Habit = {
  id: string;
  name: string;
  color: string;
  completedDates: DateKey[];
  daysPerWeek: number;
  restDays: string[];
  createdDate: DateKey;
  scheduleHistory: SchedulePeriod[];
  archived: boolean;
  /** Optional personal goal (max 300 chars), or null. */
  goal: string | null;
  /** Per-habit reminder switch and its "HH:mm" time (kept while off; null until one is set). */
  reminderEnabled: boolean;
  reminderTime: string | null;
  /**
   * Where the habit came from, recorded only for local guest habits: `'demo'` for the seeded sample habits. Absent means
   * unknown (anything saved before this marker existed): the app never guesses. Never written to the cloud.
   */
  dataOrigin?: 'demo';
  /**
   * Set only on a habit imported from a guest's data (document field `rewardsIgnoredThrough`, the import date): through and including
   * that day the habit neither earns a reward nor takes one away. Absent on every other habit, which behaves exactly as before.
   * Android reads the same field.
   */
  rewardsIgnoredThrough?: DateKey;
};

/** Kotlin `Habit.slug`: name lower-cased with whitespace runs replaced by "-". */
export const habitSlug = (h: Pick<Habit, 'name'>) => h.name.toLowerCase().replace(/\s+/g, '-');

/** Derived by the streak engine; never stored. */
export type StreakRun = { start: DateKey; end: DateKey; days: number };
export type StreakResult = { current: number; best: number; runs: StreakRun[] };

export type PeriodStats = { completed: number; eligible: number };
