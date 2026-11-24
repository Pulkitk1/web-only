/** Home week window helpers (HabitsScreen.kt `windowDays`, `weekRangeLabel`, `weekTitle`). */
import { addDays, formatMonthDay, type DateKey } from '@/utils/date';

/** Days shown on Home: 5 consecutive days, newest first (HabitsScreen.kt `WINDOW_DAYS`). */
export const WINDOW_DAYS = 5;

/** Days shown on wide desktop screens (>= 1024 px); phones and tablets keep WINDOW_DAYS. */
export const DESKTOP_WINDOW_DAYS = 7;

/** `count` consecutive days (default WINDOW_DAYS), newest first (left to right). Window 0 ends today; -1 the `count` days before it, and so on. */
export function windowDays(today: DateKey, offset = 0, count = WINDOW_DAYS): DateKey[] {
  const end = addDays(today, offset * count);
  return Array.from({ length: count }, (_, i) => addDays(end, -i));
}

/** "Nov 11 – Nov 17" for the week selector. */
export function weekRangeLabel(days: readonly DateKey[]): string {
  const sorted = [...days].sort();
  return `${formatMonthDay(sorted[0])} – ${formatMonthDay(sorted[sorted.length - 1])}`;
}

export const weekTitle = (offset: number, count = WINDOW_DAYS) => (offset === 0 ? 'This Week' : offset === -1 ? `Previous ${count} Days` : 'Earlier');
