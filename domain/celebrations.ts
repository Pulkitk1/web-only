/**
 * Rules for the celebrations (android: `RestDayCelebrations.qualifies`, `MilestoneEvent`, the milestone queue in
 * AppViewModel, `HabitsScreen` ordering of overlays). Pure; persistence lives in services/devicePrefs.ts.
 */
import type { DateKey } from '@/utils/date';

/** Celebrate only completing *today's* planned rest day; back-filled older rest days never celebrate. */
export const restDayQualifies = (date: DateKey, today: DateKey, isRest: boolean) => isRest && date === today;

/** A streak milestone that was granted and is waiting to be celebrated; `coins` is the bonus that reached the wallet. */
export type MilestoneEvent = { habitId: string; milestone: number; coins: number };

/** Queue add: one entry per (habit, milestone) (`enqueueMilestone`). */
export function enqueueMilestone(queue: readonly MilestoneEvent[], e: MilestoneEvent): MilestoneEvent[] {
  return queue.some((q) => q.habitId === e.habitId && q.milestone === e.milestone) ? [...queue] : [...queue, e];
}

export const MILESTONE_ROLL_STEPS = 6;

/** The rows the milestone counter rolls through: the day before the start, up to the day after the milestone. */
export function milestoneCounterRange(milestone: number) {
  const start = Math.max(1, milestone - MILESTONE_ROLL_STEPS);
  const first = start - 1;
  const last = milestone + 1;
  return { start, first, last, steps: milestone - start, count: last - first + 1 };
}

/** "N  DAYS" label text of a counter row (two spaces, as Kotlin `dayLabel`). */
export const milestoneDayText = (day: number) => `${day}  DAYS`;

/** The streak celebration fill: days of a 14-day goal, capped at 100 (`StreakCelebration` fillPct). */
export const streakFillPct = (streak: number) => Math.min(Math.round((streak / 14) * 100), 100);
