/**
 * Local-calendar date helpers. Dates are plain "YYYY-MM-DD" strings (the same keys Kotlin stores in `completedDates`),
 * so they sort lexicographically and never involve time zones. Equivalent of java.time.LocalDate usage in the Android app.
 */

export type DateKey = string; // "YYYY-MM-DD"

const pad = (n: number) => String(n).padStart(2, '0');

export function toKey(d: Date): DateKey {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parses "YYYY-MM-DD" as a local date at noon (avoids DST edge cases). Returns null if malformed. */
export function parseKey(key: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12);
  return toKey(d) === key ? d : null;
}

export const todayKey = (): DateKey => toKey(new Date());

export function addDays(key: DateKey, days: number): DateKey {
  const d = parseKey(key)!;
  d.setDate(d.getDate() + days);
  return toKey(d);
}

export const isBefore = (a: DateKey, b: DateKey) => a < b;
export const isAfter = (a: DateKey, b: DateKey) => a > b;

/** "Mon".."Sun" names as the Android app stores them. */
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const; // index = JS getDay()
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const dayName = (key: DateKey) => DAY_NAMES[parseKey(key)!.getDay()];
export const dayOfMonth = (key: DateKey) => parseKey(key)!.getDate();
/** "yyyy-MM" */
export const monthOf = (key: DateKey) => key.slice(0, 7);

/** "Nov 11" (Kotlin pattern "MMM d"). */
export function formatMonthDay(key: DateKey): string {
  const d = parseKey(key)!;
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

/** "Mon, Nov 11" (Kotlin pattern "EEE, MMM d"). */
export const formatWeekdayMonthDay = (key: DateKey) => `${dayName(key)}, ${formatMonthDay(key)}`;

/** Milliseconds until the next local midnight. */
export function msUntilMidnight(now = new Date()): number {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return next.getTime() - now.getTime();
}

// ─── Year-month helpers (java.time.YearMonth / LocalDate equivalents) ─────────

/** "yyyy-MM" keys. */
export type MonthKey = string;

export const monthKeyOf = (key: DateKey): MonthKey => key.slice(0, 7);
export const daysInMonth = (ym: MonthKey): number => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
export const atDay = (ym: MonthKey, day: number): DateKey => `${ym}-${String(day).padStart(2, '0')}`;
export const atEndOfMonth = (ym: MonthKey): DateKey => atDay(ym, daysInMonth(ym));

/** The month `n` months after `ym` (negative goes back). */
export function addMonths(ym: MonthKey, n: number): MonthKey {
  const total = Number(ym.slice(0, 4)) * 12 + (Number(ym.slice(5, 7)) - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

/** `date` minus `n` years; Feb 29 maps to Feb 28 (java `minusYears`). */
export function minusYears(key: DateKey, n: number): DateKey {
  const y = Number(key.slice(0, 4)) - n;
  const m = key.slice(5, 7);
  const d = Math.min(Number(key.slice(8, 10)), daysInMonth(`${y}-${m}`));
  return `${y}-${m}-${String(d).padStart(2, '0')}`;
}

export const yearStart = (key: DateKey): DateKey => `${key.slice(0, 4)}-01-01`;
export const yearOf = (key: DateKey): number => Number(key.slice(0, 4));
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
