/**
 * Weekly goal arithmetic of the New Habit flow (android CreateHabitSheet.kt `WeeklyStep` / `RestStep`).
 * A habit's weekly target is "days per week"; the rest days are what remains: rest days = 7 - days per week.
 */

/** The three preset targets and their helper text (`WEEKLY_OPTIONS`). */
export const WEEKLY_OPTIONS: ReadonlyArray<readonly [number, string]> = [
  [5, '2 rest days'],
  [6, '1 rest day'],
  [7, '0 rest days'],
];

/** Most rest days that may be picked for a weekly target. */
export const maxRestDays = (daysPerWeek: number | null): number => (daysPerWeek ? 7 - daysPerWeek : 0);

export type CustomRest = { valid: true; restDays: number; daysPerWeek: number; label: string } | { valid: false };

/**
 * The custom "number of rest days" field: 0 to 6 is valid and sets the target to 7 minus it. The helper line reads
 * "→ N active day(s)/week", with " (custom)" unless N is one of the presets (5, 6, 7).
 */
export function parseCustomRest(text: string): CustomRest {
  const n = parseInt(text, 10);
  if (Number.isNaN(n) || n < 0 || n > 6) return { valid: false };
  const active = 7 - n;
  return { valid: true, restDays: n, daysPerWeek: active, label: `→ ${active} active ${active === 1 ? 'day' : 'days'}/week${active >= 5 ? '' : ' (custom)'}` };
}

/** What the stepper buttons do to the field: "-" never goes below 0, "+" never above 6. */
export const stepRestDays = (current: number, delta: 1 | -1): number => Math.min(6, Math.max(0, current + delta));

/** The custom field only accepts up to two digits (`v.length <= 2 && all digits`). */
export const isAcceptableRestInput = (v: string): boolean => v.length <= 2 && /^\d*$/.test(v);

/** Next step after the weekly goal: a 7-day habit has no rest days to choose. */
export const nextStepAfterWeekly = (daysPerWeek: number): 'create' | 'rest' => (daysPerWeek === 7 ? 'create' : 'rest');

/** "Continue" on the rest step is enabled only when exactly the allowed number of rest days is picked. */
export const canContinueRest = (picked: number, daysPerWeek: number | null): boolean => picked === maxRestDays(daysPerWeek);

/** Toggling a rest day: removes it, adds it, or refuses when the cap is reached (`error`). */
export function toggleRestDay(restDays: readonly string[], day: string, max: number): { restDays: string[]; error: boolean } {
  if (restDays.includes(day)) return { restDays: restDays.filter((d) => d !== day), error: false };
  if (restDays.length >= max) return { restDays: [...restDays], error: true };
  return { restDays: [...restDays, day], error: false };
}

/** The message under the chips when the cap is hit. */
export const restCapMessage = (max: number): string => `You already selected ${max} rest ${max === 1 ? 'day' : 'days'}.`;

/** Create is enabled for a non-blank name (names have no length cap when created). */
export const canCreateHabit = (name: string): boolean => name.trim().length > 0;
