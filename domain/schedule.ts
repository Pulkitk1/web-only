/**
 * Port of android/.../data/ScheduleHistory.kt and the `HabitSchedule` class in RewardRules.kt.
 * Decides which days are rest days (under the schedule in effect then) and which days a habit tracks.
 */
import type { Habit, SchedulePeriod, StreakResult } from '@/types/habit';
import { addDays, dayName, isAfter, isBefore, parseKey, type DateKey } from '@/utils/date';
import { calculateStreak } from './streak';

/** Parses saved rest-day names ("Sat", "Sunday", "MONDAY"...); unknown names are ignored. Returns "Mon".."Sun" names. */
export function parseRestDays(names: readonly string[]): Set<string> {
  const known = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
  const out = new Set<string>();
  for (const n of names) {
    const k = n.trim().slice(0, 3).toLowerCase();
    if (known.has(k)) out.add(k.charAt(0).toUpperCase() + k.slice(1));
  }
  return out;
}

/** Kotlin `ScheduleHistory.restDaysOn`. */
export function restDaysOn(periods: readonly SchedulePeriod[], fallback: ReadonlySet<string>, date: DateKey): Set<string> {
  if (periods.length === 0) return new Set(fallback);
  const sorted = [...periods].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const inEffect = [...sorted].reverse().find((p) => !isAfter(p.from, date)) ?? sorted[0];
  return parseRestDays(inEffect.restDays);
}

/** The pieces of a habit that the streak, reward and freeze rules need (Kotlin `HabitSchedule`). */
export type HabitSchedule = {
  id: string;
  completed: Set<DateKey>;
  restDays: Set<string>;
  freezes: Set<DateKey>;
  createdDate: DateKey | null;
  history: SchedulePeriod[];
  /** Imported habits only (Habit.rewardsIgnoredThrough): days up to and including it take no part in reward decisions. */
  rewardsIgnoredThrough?: DateKey;
};

/** Kotlin `AppViewModel.Habit.schedule()`. [freezeDates] are the dates frozen for this habit. */
export function scheduleOf(habit: Habit, freezeDates: Iterable<DateKey>): HabitSchedule {
  return {
    id: habit.id,
    completed: new Set(habit.completedDates.filter((k) => parseKey(k))),
    restDays: parseRestDays(habit.restDays),
    freezes: new Set(freezeDates),
    createdDate: parseKey(habit.createdDate) ? habit.createdDate : null,
    history: habit.scheduleHistory,
    ...(habit.rewardsIgnoredThrough ? { rewardsIgnoredThrough: habit.rewardsIgnoredThrough } : {}),
  };
}

export function isRest(h: HabitSchedule, date: DateKey): boolean {
  return restDaysOn(h.history, h.restDays, date).has(dayName(date));
}

/** Where the habit's own tracking begins: `createdDate`, or its first completion if the creation date is unknown. */
export function trackedFrom(h: HabitSchedule): DateKey | null {
  if (h.createdDate) return h.createdDate;
  return minKey(h.completed);
}

/** A day that counts for this habit: on or after `trackedFrom`, or one with a recorded completion before it. */
export function isTracked(h: HabitSchedule, date: DateKey): boolean {
  const from = trackedFrom(h);
  return from === null || !isBefore(date, from) || h.completed.has(date);
}

export const isActiveOn = (h: HabitSchedule, date: DateKey) => !isRest(h, date) && isTracked(h, date);

/**
 * Whether `date` takes part in reward decisions for this habit: active that day, and not within the imported-history cutoff
 * (`rewardsIgnoredThrough`, inclusive). Without the field this is exactly `isActiveOn`.
 */
export const countsForRewards = (h: HabitSchedule, date: DateKey) => isActiveOn(h, date) && (h.rewardsIgnoredThrough === undefined || date > h.rewardsIgnoredThrough);

/** Earliest day with any history: `createdDate`, or the first completion if earlier. */
export function startDate(h: HabitSchedule): DateKey | null {
  const first = minKey(h.completed);
  const candidates = [h.createdDate, first].filter((k): k is DateKey => k !== null);
  return candidates.length ? candidates.reduce((a, b) => (a < b ? a : b)) : null;
}

/** A scheduled (non-rest) day within the habit's history: a day a freeze may protect. */
export function isScheduledOn(h: HabitSchedule, date: DateKey): boolean {
  const start = startDate(h);
  return !isRest(h, date) && (start === null || !isBefore(date, start));
}

export function streakOf(h: HabitSchedule, today: DateKey): StreakResult {
  if (h.history.length === 0) {
    // Kotlin's overload with a fixed rest-day set: a schedule where every day is rest has nothing to track.
    if (h.restDays.size >= 7) return { current: 0, best: 0, runs: [] };
  }
  return calculateStreak(h.completed, (d) => isRest(h, d), h.freezes, today);
}

export function minKey(keys: Iterable<DateKey>): DateKey | null {
  let min: DateKey | null = null;
  for (const k of keys) if (min === null || k < min) min = k;
  return min;
}

export { addDays };
