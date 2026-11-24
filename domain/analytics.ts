/**
 * Port of the parts of android/.../data/HabitAnalytics.kt used by the dashboard:
 * `daysCompletion` (the ring on each card), `dayProgress` (Today's Progress), and `percent`.
 */
import type { PeriodStats } from '@/types/habit';
import { isAfter, isBefore, type DateKey } from '@/utils/date';
import { isActiveOn, isRest, isTracked, startDate, type HabitSchedule } from './schedule';

/**
 * Completion over exactly `days` (Home's visible window), matching what the day circles show:
 * - days before the habit's start and future days are left out;
 * - a completed day counts on both sides, including a voluntarily completed rest day (so it never exceeds 100%);
 * - an uncompleted planned rest day is left out (under the schedule in effect on that day);
 * - any other day, today included while still unticked, is eligible but not completed, as is a frozen day.
 */
export function daysCompletion(habit: HabitSchedule, days: readonly DateKey[], today: DateKey): PeriodStats {
  const start = startDate(habit);
  if (start === null) return { completed: 0, eligible: 0 };
  let completed = 0;
  let eligible = 0;
  for (const day of days) {
    if (isBefore(day, start) || isAfter(day, today) || !isTracked(habit, day)) continue;
    if (habit.completed.has(day)) {
      completed++;
      eligible++;
    } else if (isRest(habit, day)) {
      // left out
    } else {
      eligible++;
    }
  }
  return { completed, eligible };
}

/**
 * Habits done on `day` out of habits due that day. A habit is due unless it's a rest day or the day is before it was
 * created; a rest day completed anyway counts on both sides.
 */
export function dayProgress(habits: readonly HabitSchedule[], day: DateKey): PeriodStats {
  let completed = 0;
  let due = 0;
  for (const h of habits) {
    if (h.completed.has(day)) {
      completed++;
      due++;
    } else if (isActiveOn(h, day)) {
      due++;
    }
  }
  return { completed, eligible: due };
}

/** Whole-number percentage; 0 when nothing is eligible (Kotlin `roundToInt` rounds half up for positives). */
export const percent = (s: PeriodStats): number => (s.eligible === 0 ? 0 : Math.round((s.completed * 100) / s.eligible));

// ─── Habit overview (HabitAnalytics.kt: period, overview) ────────────────────

import { addMonths, atDay, atEndOfMonth, daysInMonth, minusYears, monthKeyOf, yearOf, yearStart, addDays, type MonthKey } from '@/utils/date';

/** Fewer eligible days than this give no percentage (e.g. "100%" from a single day would mislead). */
export const MIN_ELIGIBLE_DAYS = 3;

/** The completion rate, or null when there are too few eligible days to be meaningful (`PeriodStats.rate`). */
export const rateOf = (s: PeriodStats): number | null => (s.eligible >= MIN_ELIGIBLE_DAYS ? Math.round((s.completed * 100) / s.eligible) : null);

export type MonthStats = { month: MonthKey; stats: PeriodStats };

export type HabitOverview = {
  monthToDate: PeriodStats;
  /** Change in completion rate vs the same days of last month, in percentage points; null if either side lacks data. */
  monthChange: number | null;
  yearToDate: PeriodStats;
  /** Change vs the same span of last year, in percentage points; null if either side lacks data. */
  yearChange: number | null;
  totalCompleted: number;
  /** Months from the habit's start to today, oldest first. */
  months: MonthStats[];
};

/**
 * A day is eligible if it is a scheduled active day (not a rest day), on or after the habit's start, and not in the
 * future. Today is eligible only once completed, so an unfinished day never drags the rate down.
 */
export function isEligible(habit: HabitSchedule, start: DateKey, day: DateKey, today: DateKey): boolean {
  return !isBefore(day, start) && !isRest(habit, day) && isTracked(habit, day) && (isBefore(day, today) || (day === today && habit.completed.has(day)));
}

/**
 * Completed vs eligible active days over [from, to]. Completions on rest days are ignored, missed and frozen days count
 * as eligible-but-not-completed (a freeze protects the streak, not the completion rate), and days before the habit's
 * start are neutral.
 */
export function period(habit: HabitSchedule, from: DateKey, to: DateKey, today: DateKey): PeriodStats {
  const start = startDate(habit);
  if (start === null) return { completed: 0, eligible: 0 };
  let completed = 0;
  let eligible = 0;
  const end = to < today ? to : today;
  for (let day = from > start ? from : start; !isAfter(day, end); day = addDays(day, 1)) {
    if (isEligible(habit, start, day, today)) {
      eligible++;
      if (habit.completed.has(day)) completed++;
    }
  }
  return { completed, eligible };
}

const change = (current: PeriodStats, previous: PeriodStats): number | null => {
  const c = rateOf(current);
  const p = rateOf(previous);
  return c === null || p === null ? null : c - p;
};

export function overview(habit: HabitSchedule, today: DateKey): HabitOverview {
  const month = monthKeyOf(today);
  const mtd = period(habit, atDay(month, 1), today, today);
  // Same day-of-month span last month (clamped for shorter months), so both sides cover comparable days. Today only
  // counts once completed, so comparisons end yesterday until then, on both sides.
  const cmpEnd = habit.completed.has(today) ? today : addDays(today, -1);
  const prevMonth = addMonths(month, -1);
  const prevMtd =
    cmpEnd < atDay(month, 1)
      ? { completed: 0, eligible: 0 }
      : period(habit, atDay(prevMonth, 1), atDay(prevMonth, Math.min(Number(cmpEnd.slice(8, 10)), daysInMonth(prevMonth))), today);
  const ytd = period(habit, yearStart(today), today, today);
  const lastYearEnd = minusYears(cmpEnd, 1); // Feb 29 maps to Feb 28
  const prevYtd = yearOf(cmpEnd) !== yearOf(today) ? { completed: 0, eligible: 0 } : period(habit, yearStart(lastYearEnd), lastYearEnd, today);

  const start = startDate(habit);
  const months: MonthStats[] = [];
  if (start !== null) {
    for (let m = monthKeyOf(start); m <= month; m = addMonths(m, 1)) months.push({ month: m, stats: period(habit, atDay(m, 1), atEndOfMonth(m), today) });
  }
  const total = start !== null ? period(habit, start, today, today).completed : 0;
  return { monthToDate: mtd, monthChange: change(mtd, prevMtd), yearToDate: ytd, yearChange: change(ytd, prevYtd), totalCompleted: total, months };
}

// ─── Month breakdown for the Calendar summary (HabitAnalytics.monthBreakdown) ─

/** A month's day counts for the Calendar summary. */
export type MonthBreakdown = { stats: PeriodStats; missed: number; restDays: number; frozen: number };

/**
 * One calendar month, from the habit's start up to `today`. `stats` is `period` for the month; every eligible day is
 * exactly one of completed, `frozen` or `missed`. `restDays` counts rest days not completed (a completed rest day is
 * bonus effort and not part of the rate). Today only counts once completed, so it is never "missed".
 */
export function monthBreakdown(habit: HabitSchedule, month: MonthKey, today: DateKey): MonthBreakdown {
  const stats = period(habit, atDay(month, 1), atEndOfMonth(month), today);
  const start = startDate(habit);
  if (start === null) return { stats, missed: 0, restDays: 0, frozen: 0 };
  let missed = 0;
  let rest = 0;
  let frozen = 0;
  const from = atDay(month, 1) > start ? atDay(month, 1) : start;
  const end = atEndOfMonth(month) < today ? atEndOfMonth(month) : today;
  for (let day = from; !isAfter(day, end); day = addDays(day, 1)) {
    if (!isTracked(habit, day)) continue; // before the habit was created and not recorded: neutral
    if (isRest(habit, day)) {
      if (!habit.completed.has(day)) rest++;
    } else if (!isEligible(habit, start, day, today) || habit.completed.has(day)) {
      // not part of the missed/frozen split
    } else if (habit.freezes.has(day)) frozen++;
    else missed++;
  }
  return { stats, missed, restDays: rest, frozen };
}
