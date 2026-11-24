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

/** Widest a day column may grow: phones/tablets (5 days) as before; desktop spreads the 7 days a little wider. */
export const MAX_COLUMN = 44;
export const MAX_COLUMN_DESKTOP = 64;

export type Breakpoint = 'mobile' | 'tablet' | 'desktop';
/** Below 768 px phone layout (unchanged); 768-1023 tablet (5 days); 1024 and up desktop (7 days, side panel). */
export const breakpointFor = (windowWidth: number): Breakpoint => (windowWidth >= 1024 ? 'desktop' : windowWidth >= 768 ? 'tablet' : 'mobile');
/** Desktop content never grows past this, so cards are not stretched on very large screens. */
export const DESKTOP_MAX_WIDTH = 1280;
export const TABLET_MAX_WIDTH = 720;
export const SIDE_PANEL_WIDTH = 380;

export function gridMetrics(width: number, dayCount = WINDOW_DAYS, maxColumn = MAX_COLUMN): GridMetrics {
  const ring = 34;
  const card = width - LIST_PADDING * 2;
  const column = clamp((card - CARD_START - ring - RING_GAP - NAME_MIN - MENU_WIDTH - CARD_END) / dayCount, 28, maxColumn);
  return { ring, column, dot: clamp(column - 6, 22, 30) };
}
