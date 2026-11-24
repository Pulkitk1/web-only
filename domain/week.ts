/** Home week window helpers (HabitsScreen.kt `windowDays`, `weekRangeLabel`, `weekTitle`). */
import { addDays, formatMonthDay, type DateKey } from '@/utils/date';

/** Days shown on Home: 5 consecutive days, newest first (HabitsScreen.kt `WINDOW_DAYS`). */
export const WINDOW_DAYS = 5;

/** WINDOW_DAYS consecutive days, newest first (left to right). Window 0 ends today; -1 the 5 days before it, and so on. */
export function windowDays(today: DateKey, offset = 0): DateKey[] {
  const end = addDays(today, offset * WINDOW_DAYS);
  return Array.from({ length: WINDOW_DAYS }, (_, i) => addDays(end, -i));
}

/** "Nov 11 – Nov 17" for the week selector. */
export function weekRangeLabel(days: readonly DateKey[]): string {
  const sorted = [...days].sort();
  return `${formatMonthDay(sorted[0])} – ${formatMonthDay(sorted[sorted.length - 1])}`;
}

export const weekTitle = (offset: number) => (offset === 0 ? 'This Week' : offset === -1 ? 'Previous 5 Days' : 'Earlier');
