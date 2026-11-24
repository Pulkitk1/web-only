/**
 * Pure helpers behind the Habit Details screen (android HabitDetailScreen.kt private helpers and Charts.kt geometry).
 * No React here, so they are unit-tested directly.
 */
import { MONTH_SHORT, type MonthKey } from '@/utils/date';
import { rateOf, type HabitOverview } from './analytics';

export type ChartPoint = { label: string; value: number };

/** "Feb" or, for the first point and every January, "Feb'25" (`monthLabel`). */
export function monthLabel(m: MonthKey, withYear: boolean): string {
  const month = Number(m.slice(5, 7));
  const name = MONTH_SHORT[month - 1];
  return withYear || month === 1 ? `${name}'${String(Number(m.slice(0, 4)) % 100).padStart(2, '0')}` : name;
}

/** Rounds a bar chart maximum up to a multiple of 5 (at least 5) so the five ticks are whole numbers (`niceMax`). */
export const niceMax = (v: number): number => Math.max(5, Math.floor((v + 4) / 5) * 5);

/** Percentage-point change, e.g. "+7%" / "-5%" / "0%" (`signed`). */
export const signed = (v: number): string => `${v > 0 ? '+' : ''}${v}%`;

/** Green for zero or better, red for a drop (`trendColor`). */
export const isTrendUp = (v: number): boolean => v >= 0;

/** SCORE chart: the last 13 months that have a rate; the first of those 13 months carries the year (`scoreData`). */
export function scoreSeries(o: HabitOverview | null): ChartPoint[] {
  const last = (o?.months ?? []).slice(-13);
  return last.flatMap((m, i) => {
    const rate = rateOf(m.stats);
    return rate === null ? [] : [{ label: monthLabel(m.month, i === 0), value: rate }];
  });
}

/** HISTORY chart: completed days for the last 11 months (`historyData`). */
export function historySeries(o: HabitOverview | null): ChartPoint[] {
  return (o?.months ?? []).slice(-11).map((m, i) => ({ label: monthLabel(m.month, i === 0), value: m.stats.completed }));
}

export const historyMax = (series: readonly ChartPoint[]): number => niceMax(series.reduce((m, p) => Math.max(m, p.value), 0));
/** Y ticks of the history chart: five whole numbers up to the max (`(1..5).map { it * max / 5 }`). */
export const historyTicks = (max: number): number[] => [1, 2, 3, 4, 5].map((i) => Math.floor((i * max) / 5));

/** Bar tint by days completed: >=15 full, >=8 at 67%, else 33% (`barColor`). Returns the alpha. */
export const barAlpha = (v: number): number => (v >= 15 ? 1 : v >= 8 ? 0.67 : 0.33);

// ─── Chart geometry (Charts.kt) ──────────────────────────────────────────────

export const AXIS_W = 30; // reserved for y labels
export const X_LABEL_H = 18; // reserved for x labels

export type Plot = { left: number; top: number; right: number; bottom: number };

/** The plot rectangle inside a canvas of `width` x `height` (`drawFrame`). */
export const plotRect = (width: number, height: number): Plot => ({ left: AXIS_W, top: 6, right: width - 8, bottom: height - X_LABEL_H });

/** Y position of `value` in the plot (0 at the bottom, `yMax` at the top). */
export const yAt = (p: Plot, value: number, yMax: number): number => p.bottom - (value / yMax) * (p.bottom - p.top);

export type Pt = { x: number; y: number };

/** Line chart points: evenly spaced across the plot width (`LineChart`). */
export function linePoints(data: readonly ChartPoint[], p: Plot, yMax: number): Pt[] {
  const step = data.length > 1 ? (p.right - p.left) / (data.length - 1) : 0;
  return data.map((d, i) => ({ x: p.left + i * step, y: yAt(p, d.value, yMax) }));
}

/** Smooth path through the points: cubic segments with control points at the horizontal midpoint. */
export function smoothPath(pts: readonly Pt[]): string {
  if (pts.length === 0) return '';
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const cx = (a.x + b.x) / 2;
    d += ` C ${cx} ${a.y} ${cx} ${b.y} ${b.x} ${b.y}`;
  }
  return d;
}

/** Which point a tap at x selects (nearest, clamped); null when the chart can't be tapped (<2 points). */
export function lineIndexAt(x: number, p: Plot, n: number): number | null {
  if (n < 2 || p.right <= p.left) return null;
  const step = (p.right - p.left) / (n - 1);
  return Math.min(n - 1, Math.max(0, Math.round((x - p.left) / step)));
}

/** Which bar a tap at x selects (its band, clamped). */
export function barIndexAt(x: number, p: Plot, n: number): number | null {
  if (n === 0 || p.right <= p.left) return null;
  const band = (p.right - p.left) / n;
  return Math.min(n - 1, Math.max(0, Math.floor((x - p.left) / band)));
}

export type Bar = { cx: number; top: number; bandLeft: number; band: number };
export function barLayout(data: readonly ChartPoint[], p: Plot, yMax: number): Bar[] {
  const band = data.length ? (p.right - p.left) / data.length : 0;
  return data.map((d, i) => ({ cx: p.left + band * (i + 0.5), top: yAt(p, d.value, yMax), bandLeft: p.left + band * i, band }));
}

/** Where a tooltip box goes: right of the anchor, flipped left if it would overflow; vertically centred and clamped. */
export function tooltipBox(anchor: Pt, w: number, h: number, canvasW: number, canvasH: number): { x: number; y: number } {
  const right = anchor.x + 10;
  const x = right + w > canvasW ? anchor.x - w - 10 : right;
  const y = Math.min(canvasH - h, Math.max(0, anchor.y - h / 2));
  return { x, y };
}
