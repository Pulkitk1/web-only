/**
 * Column metrics shared by the day header and every habit row, so labels and circles line up
 * (HabitsScreen.kt `gridMetrics`, with its dp constants).
 */
import { WINDOW_DAYS } from '@/domain/week';

export const LIST_PADDING = 12;
export const CARD_START = 10;
export const CARD_END = 2;
export const MENU_WIDTH = 24;
export const NAME_MIN = 120;
export const RING_GAP = 8;

export type GridMetrics = { ring: number; column: number; dot: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function gridMetrics(width: number): GridMetrics {
  const ring = 34;
  const card = width - LIST_PADDING * 2;
  const column = clamp((card - CARD_START - ring - RING_GAP - NAME_MIN - MENU_WIDTH - CARD_END) / WINDOW_DAYS, 28, 44);
  return { ring, column, dot: clamp(column - 6, 22, 30) };
}
