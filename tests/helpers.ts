import type { HabitSchedule } from '@/domain/schedule';
import { addDays, type DateKey } from '@/utils/date';

/** `n` consecutive days from `start` (Kotlin test helper `streakDays`/`daysFrom`). */
export const range = (start: DateKey, n: number): DateKey[] => Array.from({ length: n }, (_, i) => addDays(start, i));

export const WEEKENDS = ['Sat', 'Sun'];

type Opts = Partial<Omit<HabitSchedule, 'id' | 'completed' | 'restDays' | 'freezes'>> & { freezes?: DateKey[] };

/** Kotlin `HabitSchedule(id, completed, restDays, freezes, createdDate, history)`. */
export function sched(id: string, completed: Iterable<DateKey>, restDays: string[] = [], opts: Opts = {}): HabitSchedule {
  return {
    id,
    completed: new Set(completed),
    restDays: new Set(restDays),
    freezes: new Set(opts.freezes ?? []),
    createdDate: opts.createdDate ?? null,
    history: opts.history ?? [],
  };
}

/** `copy(...)` of a schedule with replaced/added sets. */
export const withFreezes = (h: HabitSchedule, freezes: DateKey[]): HabitSchedule => ({ ...h, freezes: new Set(freezes) });
export const withCompleted = (h: HabitSchedule, completed: Iterable<DateKey>): HabitSchedule => ({ ...h, completed: new Set(completed) });
