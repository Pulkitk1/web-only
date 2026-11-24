/**
 * Port of android/.../data/StreakEngine.kt (`calculate` with per-date rest days).
 *
 * Walks the local calendar day by day from the first completion up to `today`:
 * - Completed day: streak + 1, active or planned rest day alike.
 * - Scheduled rest day, not completed: skipped.
 * - Missed active day covered by an applied freeze: skipped, streak preserved.
 * - `today` not yet completed: skipped, so yesterday's streak stays alive until the day is over.
 * - Any other missed active day: the run ends (streak resets to 0).
 * Completions after `today` are ignored, and completions are a set, so a day can never count twice.
 */
import type { StreakResult, StreakRun } from '@/types/habit';
import { addDays, isAfter, type DateKey } from '@/utils/date';

export function calculateStreak(
  completed: ReadonlySet<DateKey>,
  isRest: (d: DateKey) => boolean,
  freezes: ReadonlySet<DateKey>,
  today: DateKey,
): StreakResult {
  let first: DateKey | null = null;
  for (const d of completed) if (!isAfter(d, today) && (first === null || d < first)) first = d;
  if (first === null) return { current: 0, best: 0, runs: [] };

  const runs: StreakRun[] = [];
  let count = 0;
  let start: DateKey | null = null;
  let end: DateKey | null = null;
  const closeRun = () => {
    if (count > 0) runs.push({ start: start!, end: end!, days: count });
    count = 0;
    start = null;
    end = null;
  };

  let day = first;
  while (!isAfter(day, today)) {
    if (completed.has(day)) {
      if (count === 0) start = day;
      count++;
      end = day;
    } else if (isRest(day)) {
      // skipped
    } else if (freezes.has(day)) {
      // skipped
    } else if (day === today) {
      // skipped
    } else {
      closeRun();
    }
    day = addDays(day, 1);
  }
  const current = count;
  closeRun();
  return { current, best: runs.reduce((m, r) => Math.max(m, r.days), 0), runs };
}
