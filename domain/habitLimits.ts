/**
 * Validation and limits for habit documents (Phase 11B). Pure functions, no Firebase.
 *
 * Two layers use the same numbers:
 *   - the Firestore rules (`firebase/firestore.rules`, `validHabit`) refuse a malformed or oversized habit on the server;
 *   - this file stops the Web app from ever sending one (a programming error, a corrupt local copy, or a guest import of edited data), and
 *     explains why in words.
 *
 * The bounds are deliberately generous: Android has no length limit when a habit is created ("Names have no limit when created" in
 * HabitNameRules.kt), the rules validate the WHOLE resulting document on every update, and a bound tighter than real legacy data would block
 * ordinary check-ins. The tighter limits the user actually meets (100-character names, 300-character goals) stay where they were, in
 * `habitRules.ts` and `normalizeGoal`, and are unchanged.
 */
import { WEEKDAYS, parseKey } from '@/utils/date';
import type { Habit } from '@/types/habit';

export const HABIT_LIMITS = {
  /** Habit name / goal / why, in characters. Mirrors the rules. */
  NAME_MAX: 1000,
  TEXT_MAX: 1000,
  REST_DAYS_MAX: 7,
  COMPLETED_DATES_MAX: 20_000,
  SCHEDULE_PERIODS_MAX: 2_000,
  FIELDS_MAX: 40,
  /** The Web refuses to create more habits than this in one account (Android has no cap, so an account can already hold more). */
  HABITS_PER_ACCOUNT_MAX: 200,
  /** The most habits one guest import will take. */
  IMPORT_HABITS_MAX: 200,
} as const;

const DAY_NAMES: ReadonlySet<string> = new Set(WEEKDAYS);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isDateKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && parseKey(v) !== null;
const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** A field that is an array operation (`arrayUnion`) rather than a value is checked by the rules, not here. */
const isOp = (v: unknown): boolean => isObj(v) && ('kind' in v || 'values' in v);

/**
 * What is wrong with these habit fields (a complete document or a partial update; every field is optional, exactly like the rules), as short
 * sentences. Empty means valid.
 */
export function habitFieldProblems(d: Record<string, unknown>): string[] {
  const p: string[] = [];
  const has = (k: string) => k in d && d[k] !== undefined;
  if (Object.keys(d).length > HABIT_LIMITS.FIELDS_MAX) p.push('too many fields');
  if (has('name') && !(typeof d.name === 'string' && d.name.trim().length >= 1 && d.name.length <= HABIT_LIMITS.NAME_MAX)) p.push(`the name must be 1 to ${HABIT_LIMITS.NAME_MAX} characters`);
  for (const k of ['goal', 'why']) if (has(k) && !(typeof d[k] === 'string' && (d[k] as string).length <= HABIT_LIMITS.TEXT_MAX)) p.push(`the ${k} must be text of at most ${HABIT_LIMITS.TEXT_MAX} characters`);
  if (has('daysPerWeek') && !(Number.isInteger(d.daysPerWeek) && (d.daysPerWeek as number) >= 1 && (d.daysPerWeek as number) <= 7)) p.push('the weekly target must be a whole number from 1 to 7');
  if (has('restDays') && !(Array.isArray(d.restDays) && d.restDays.length <= HABIT_LIMITS.REST_DAYS_MAX && d.restDays.every((x) => typeof x === 'string' && DAY_NAMES.has(x)))) p.push('rest days must be at most 7 day names (Mon to Sun)');
  if (has('createdDate') && !isDateKey(d.createdDate)) p.push('the created date must be a valid yyyy-MM-dd date');
  if (has('rewardsIgnoredThrough') && !isDateKey(d.rewardsIgnoredThrough)) p.push('rewardsIgnoredThrough must be a valid yyyy-MM-dd date');
  if (has('completedDates') && !isOp(d.completedDates) && !(Array.isArray(d.completedDates) && d.completedDates.length <= HABIT_LIMITS.COMPLETED_DATES_MAX && d.completedDates.every(isDateKey))) p.push(`completed dates must be at most ${HABIT_LIMITS.COMPLETED_DATES_MAX} valid dates`);
  if (has('scheduleHistory')) {
    const h = d.scheduleHistory;
    const ok =
      Array.isArray(h) &&
      h.length <= HABIT_LIMITS.SCHEDULE_PERIODS_MAX &&
      h.every((x) => isObj(x) && isDateKey(x.from) && Array.isArray(x.restDays) && x.restDays.length <= 7 && x.restDays.every((r) => typeof r === 'string' && DAY_NAMES.has(r)) && Number.isInteger(x.daysPerWeek) && (x.daysPerWeek as number) >= 1 && (x.daysPerWeek as number) <= 7);
    if (!ok) p.push(`the schedule history must be at most ${HABIT_LIMITS.SCHEDULE_PERIODS_MAX} valid periods`);
  }
  for (const k of ['archived', 'reminderEnabled']) if (has(k) && typeof d[k] !== 'boolean') p.push(`${k} must be true or false`);
  if (has('reminderTime') && d.reminderTime !== null && !(typeof d.reminderTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(d.reminderTime))) p.push('the reminder time must be HH:mm');
  for (const k of ['streak', 'bestStreak', 'sortOrder', 'color']) if (has(k) && !isFiniteNumber(d[k])) p.push(`${k} must be a number`);
  if (has('migratedFrom') && !(typeof d.migratedFrom === 'string' && d.migratedFrom.length <= 200)) p.push('migratedFrom must be text of at most 200 characters');
  return p;
}

/** Thrown by the write layer before anything is sent. `code` makes the Web's error handling treat it like a refused write. */
export class InvalidHabitError extends Error {
  readonly code = 'invalid-argument';
  constructor(readonly problems: string[]) {
    super(`Invalid habit: ${problems.join('; ')}`);
  }
}

export function assertValidHabitFields(d: Record<string, unknown>): void {
  const problems = habitFieldProblems(d);
  if (problems.length > 0) throw new InvalidHabitError(problems);
}

/**
 * Why a guest habit cannot be imported as it is, or null. The import skips nothing silently: the preview shows this reason and the habit
 * cannot be ticked.
 */
export function habitImportProblem(h: Habit): string | null {
  if (h.name.trim().length === 0) return 'It has no name.';
  if (h.name.length > HABIT_LIMITS.NAME_MAX) return `Its name is longer than ${HABIT_LIMITS.NAME_MAX} characters.`;
  if (h.completedDates.length > HABIT_LIMITS.COMPLETED_DATES_MAX) return `It has more than ${HABIT_LIMITS.COMPLETED_DATES_MAX.toLocaleString('en-US')} check-ins.`;
  if (h.scheduleHistory.length > HABIT_LIMITS.SCHEDULE_PERIODS_MAX) return 'Its schedule history is too long.';
  if (h.goal !== null && h.goal.length > HABIT_LIMITS.TEXT_MAX) return 'Its goal is too long.';
  if (!(Number.isInteger(h.daysPerWeek) && h.daysPerWeek >= 1 && h.daysPerWeek <= 7)) return 'Its weekly target is not valid.';
  if (h.restDays.length > HABIT_LIMITS.REST_DAYS_MAX || !h.restDays.every((d) => DAY_NAMES.has(d))) return 'Its rest days are not valid.';
  return null;
}
