/**
 * Habit Details: analytics (port of android HabitAnalyticsTest) and the screen's helpers and chart geometry
 * (HabitDetailScreen.kt private helpers, Charts.kt).
 */
import { describe, expect, it } from 'vitest';

import { MIN_ELIGIBLE_DAYS, overview, period, rateOf } from '@/domain/analytics';
import {
  AXIS_W,
  barAlpha,
  barIndexAt,
  barLayout,
  historyMax,
  historySeries,
  historyTicks,
  isTrendUp,
  lineIndexAt,
  linePoints,
  monthLabel,
  niceMax,
  plotRect,
  scoreSeries,
  signed,
  smoothPath,
  tooltipBox,
  X_LABEL_H,
  yAt,
} from '@/domain/habitDetail';
import { streakOf } from '@/domain/schedule';
import { addDays, addMonths, atEndOfMonth, daysInMonth, minusYears } from '@/utils/date';
import { range, sched, WEEKENDS } from './helpers';

const between = (from: string, to: string) => range(from, Math.round((new Date(`${to}T12:00:00`).getTime() - new Date(`${from}T12:00:00`).getTime()) / 86_400_000) + 1);

describe('date helpers (YearMonth / LocalDate equivalents)', () => {
  it('days in month, including leap years', () => {
    expect(daysInMonth('2024-02')).toBe(29);
    expect(daysInMonth('2023-02')).toBe(28);
    expect(daysInMonth('2024-04')).toBe(30);
    expect(daysInMonth('2024-12')).toBe(31);
    expect(atEndOfMonth('2024-02')).toBe('2024-02-29');
  });
  it('adds months across years in both directions', () => {
    expect(addMonths('2024-01', -1)).toBe('2023-12');
    expect(addMonths('2023-12', 1)).toBe('2024-01');
    expect(addMonths('2024-03', 12)).toBe('2025-03');
    expect(addMonths('2024-03', -15)).toBe('2022-12');
  });
  it('minusYears maps Feb 29 to Feb 28', () => {
    expect(minusYears('2024-02-29', 1)).toBe('2023-02-28');
    expect(minusYears('2024-06-10', 1)).toBe('2023-06-10');
    expect(minusYears('2024-02-29', 4)).toBe('2020-02-29');
  });
});

describe('HabitAnalytics (Kotlin HabitAnalyticsTest)', () => {
  it('rest days and the future are excluded from the denominator', () => {
    // Mon 3 Jun - Sun 9 Jun 2024, weekends off, today Wednesday. Today is not completed yet, so it is not counted.
    const h = sched('a', ['2024-06-03', '2024-06-04'], WEEKENDS, { createdDate: '2024-06-03' });
    expect(period(h, '2024-06-03', '2024-06-09', '2024-06-05')).toEqual({ completed: 2, eligible: 2 });
  });

  it('a day completed today counts', () => {
    const h = sched('a', between('2024-06-03', '2024-06-05'), [], { createdDate: '2024-06-03' });
    expect(period(h, '2024-06-01', '2024-06-30', '2024-06-05')).toEqual({ completed: 3, eligible: 3 });
  });

  it('missed and frozen days count as not completed', () => {
    const h = sched('a', ['2024-06-03', '2024-06-06'], [], { freezes: ['2024-06-04'], createdDate: '2024-06-03' });
    const p = period(h, '2024-06-03', '2024-06-06', '2024-06-07');
    expect(p).toEqual({ completed: 2, eligible: 4 });
    expect(rateOf(p)).toBe(50);
  });

  it('completions on rest days are ignored', () => {
    const h = sched('a', ['2024-06-07', '2024-06-08'], WEEKENDS, { createdDate: '2024-06-07' });
    expect(period(h, '2024-06-07', '2024-06-09', '2024-06-10')).toEqual({ completed: 1, eligible: 1 });
  });

  it('days before the start are not eligible', () => {
    const h = sched('a', between('2024-06-20', '2024-06-29'), [], { createdDate: '2024-06-20' });
    expect(period(h, '2024-06-01', '2024-06-30', '2024-06-30')).toEqual({ completed: 10, eligible: 10 });
  });

  it('too few days give no rate', () => {
    expect(MIN_ELIGIBLE_DAYS).toBe(3);
    expect(rateOf({ completed: 1, eligible: 1 })).toBeNull();
    expect(rateOf({ completed: 2, eligible: 2 })).toBeNull();
    expect(rateOf({ completed: 3, eligible: 3 })).toBe(100);
  });

  it('month-over-month compares the same day span', () => {
    // May: all done; June: 1-5 done.
    const done = [...between('2024-05-01', '2024-05-31'), ...between('2024-06-01', '2024-06-05')];
    const o = overview(sched('a', done, [], { createdDate: '2024-05-01' }), '2024-06-10');
    expect(o.monthToDate).toEqual({ completed: 5, eligible: 9 }); // 10 June itself is not completed yet
    expect(o.monthChange).toBe(56 - 100);
  });

  it('the month change clamps to the shorter month', () => {
    // 31 March compares against 1-29 Feb (leap year).
    const o = overview(sched('a', between('2024-02-01', '2024-03-31'), [], { createdDate: '2024-02-01' }), '2024-03-31');
    expect(o.monthChange).toBe(0);
  });

  it('no previous data means no change', () => {
    const o = overview(sched('a', between('2024-06-01', '2024-06-10'), [], { createdDate: '2024-06-01' }), '2024-06-10');
    expect(o.monthChange).toBeNull();
    expect(o.yearChange).toBeNull();
  });

  it('year-over-year across the year boundary', () => {
    // Last year: every day of Jan 1-15 2023 done. This year: Jan 1-15 2024, odd days only.
    const done = [...between('2023-01-01', '2023-01-15'), ...between('2024-01-01', '2024-01-15').filter((d) => Number(d.slice(8)) % 2 === 1)];
    const o = overview(sched('a', done, [], { createdDate: '2023-01-01' }), '2024-01-16');
    expect(o.yearToDate).toEqual({ completed: 8, eligible: 15 });
    expect(o.yearChange).toBe(53 - 100);
  });

  it('the monthly series spans months and years', () => {
    const o = overview(sched('a', between('2023-12-30', '2024-01-02'), [], { createdDate: '2023-12-30' }), '2024-02-01');
    expect(o.months.map((m) => m.month)).toEqual(['2023-12', '2024-01', '2024-02']);
    expect(o.months.map((m) => m.stats.completed)).toEqual([2, 2, 0]);
    expect(o.totalCompleted).toBe(4);
  });

  it('a legacy habit without a created date starts at its first completion', () => {
    const h = sched('a', ['2024-06-05']);
    expect(period(h, '2024-06-01', '2024-06-30', '2024-06-08')).toEqual({ completed: 1, eligible: 3 });
  });

  it('unchecking updates the stats', () => {
    const all = between('2024-06-03', '2024-06-07');
    const h = sched('a', all, [], { createdDate: '2024-06-03' });
    expect(rateOf(period(h, '2024-06-01', '2024-06-30', '2024-06-08'))).toBe(100);
    const unchecked = sched('a', all.filter((d) => d !== '2024-06-05'), [], { createdDate: '2024-06-03' });
    expect(rateOf(period(unchecked, '2024-06-01', '2024-06-30', '2024-06-08'))).toBe(80);
  });

  it('a protected streak period is one run', () => {
    const r = streakOf(sched('a', ['2024-06-03', '2024-06-05'], [], { freezes: ['2024-06-04'] }), '2024-06-05');
    expect(r.runs).toEqual([{ start: '2024-06-03', end: '2024-06-05', days: 2 }]);
  });

  it('a habit with no history has an empty overview', () => {
    const o = overview(sched('a', []), '2024-06-10');
    expect(o).toMatchObject({ monthToDate: { completed: 0, eligible: 0 }, monthChange: null, yearChange: null, totalCompleted: 0, months: [] });
  });

  it('the overview follows the schedule in effect on each day (a past schedule change is not rewritten)', () => {
    // Weekends rest until Jun 10, then no rest days. Sat 8 / Sun 9 were rest days then: not counted against the rate.
    const history = [
      { from: '2024-06-03', restDays: ['Sat', 'Sun'], daysPerWeek: 5 },
      { from: '2024-06-10', restDays: [], daysPerWeek: 7 },
    ];
    const h = sched('a', ['2024-06-03', '2024-06-04', '2024-06-05', '2024-06-06', '2024-06-07'], [], { createdDate: '2024-06-03', history });
    expect(period(h, '2024-06-03', '2024-06-09', '2024-06-10')).toEqual({ completed: 5, eligible: 5 });
  });
});

describe('Habit Details helpers (HabitDetailScreen.kt)', () => {
  it('month labels: the year on the first point and every January', () => {
    expect(monthLabel('2025-02', false)).toBe('Feb');
    expect(monthLabel('2025-02', true)).toBe("Feb'25");
    expect(monthLabel('2026-01', false)).toBe("Jan'26");
    expect(monthLabel('2009-03', true)).toBe("Mar'09");
  });

  it('niceMax rounds up to a multiple of 5, at least 5', () => {
    expect([0, 1, 5, 6, 10, 11, 22, 25].map(niceMax)).toEqual([5, 5, 5, 10, 10, 15, 25, 25]);
  });

  it('signed shows an explicit plus', () => {
    expect(signed(7)).toBe('+7%');
    expect(signed(-5)).toBe('-5%');
    expect(signed(0)).toBe('0%');
    expect(isTrendUp(0)).toBe(true);
    expect(isTrendUp(-1)).toBe(false);
  });

  it('bar tints by days completed', () => {
    expect([0, 7, 8, 14, 15, 30].map(barAlpha)).toEqual([0.33, 0.33, 0.67, 0.67, 1, 1]);
  });

  it('history ticks are five whole numbers up to the max', () => {
    expect(historyTicks(5)).toEqual([1, 2, 3, 4, 5]);
    expect(historyTicks(25)).toEqual([5, 10, 15, 20, 25]);
    expect(historyMax([{ label: 'a', value: 17 }, { label: 'b', value: 3 }])).toBe(20);
    expect(historyMax([])).toBe(5);
  });

  it('the score series keeps only months with a rate, labels the first of the last 13 with its year', () => {
    const months = Array.from({ length: 15 }, (_, i) => ({ month: addMonths('2025-01', i), stats: i === 4 ? { completed: 1, eligible: 1 } : { completed: 8, eligible: 10 } }));
    const o = { monthToDate: { completed: 0, eligible: 0 }, monthChange: null, yearToDate: { completed: 0, eligible: 0 }, yearChange: null, totalCompleted: 0, months };
    const s = scoreSeries(o);
    // last 13 of 15 months = indexes 2..14; index 4 has too few days and is skipped
    expect(s).toHaveLength(12);
    expect(s[0].label).toBe("Mar'25"); // first of the 13 carries the year
    expect(s.every((p) => p.value === 80)).toBe(true);
    expect(s.some((p) => p.label === "Jan'26")).toBe(true); // January always carries the year
  });

  it('the history series is the last 11 months of completed days', () => {
    const months = Array.from({ length: 13 }, (_, i) => ({ month: addMonths('2025-01', i), stats: { completed: i, eligible: 20 } }));
    const o = { monthToDate: { completed: 0, eligible: 0 }, monthChange: null, yearToDate: { completed: 0, eligible: 0 }, yearChange: null, totalCompleted: 0, months };
    const s = historySeries(o);
    expect(s).toHaveLength(11);
    expect(s.map((p) => p.value)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(s[0].label).toBe("Mar'25");
  });

  it('with no overview both series are empty (the "Not enough data yet" / "No completions yet" states)', () => {
    expect(scoreSeries(null)).toEqual([]);
    expect(historySeries(null)).toEqual([]);
  });
});

describe('chart geometry (Charts.kt)', () => {
  const p = plotRect(300, 160);

  it('reserves the axis and label space', () => {
    expect(p).toEqual({ left: AXIS_W, top: 6, right: 292, bottom: 160 - X_LABEL_H });
  });

  it('maps values to y: 0 at the bottom, max at the top', () => {
    expect(yAt(p, 0, 100)).toBe(p.bottom);
    expect(yAt(p, 100, 100)).toBe(p.top);
    expect(yAt(p, 50, 100)).toBeCloseTo((p.top + p.bottom) / 2, 5);
  });

  it('line points are evenly spaced; a single point sits at the left', () => {
    const pts = linePoints([{ label: 'a', value: 0 }, { label: 'b', value: 100 }, { label: 'c', value: 0 }], p, 100);
    expect(pts.map((q) => q.x)).toEqual([p.left, (p.left + p.right) / 2, p.right]);
    expect(linePoints([{ label: 'a', value: 50 }], p, 100)[0].x).toBe(p.left);
  });

  it('the smooth path uses cubic segments with horizontal-midpoint controls', () => {
    const d = smoothPath([{ x: 0, y: 10 }, { x: 10, y: 20 }]);
    expect(d).toBe('M 0 10 C 5 10 5 20 10 20');
    expect(smoothPath([])).toBe('');
  });

  it('tapping a line chart selects the nearest point, clamped; fewer than two points cannot be tapped', () => {
    expect(lineIndexAt(p.left, p, 5)).toBe(0);
    expect(lineIndexAt(p.right, p, 5)).toBe(4);
    expect(lineIndexAt(-100, p, 5)).toBe(0);
    expect(lineIndexAt(10_000, p, 5)).toBe(4);
    expect(lineIndexAt((p.left + p.right) / 2, p, 5)).toBe(2);
    expect(lineIndexAt(100, p, 1)).toBeNull();
    expect(lineIndexAt(100, p, 0)).toBeNull();
  });

  it('tapping a bar chart selects the band under the tap, clamped', () => {
    const band = (p.right - p.left) / 4;
    expect(barIndexAt(p.left + 1, p, 4)).toBe(0);
    expect(barIndexAt(p.left + band * 2.5, p, 4)).toBe(2);
    expect(barIndexAt(p.right + 50, p, 4)).toBe(3);
    expect(barIndexAt(0, p, 4)).toBe(0);
    expect(barIndexAt(100, p, 0)).toBeNull();
  });

  it('bars are centred in their bands', () => {
    const bars = barLayout([{ label: 'a', value: 5 }, { label: 'b', value: 10 }], p, 10);
    const band = (p.right - p.left) / 2;
    expect(bars[0].cx).toBe(p.left + band * 0.5);
    expect(bars[1].cx).toBe(p.left + band * 1.5);
    expect(bars[1].top).toBe(p.top);
  });

  it('the tooltip sits right of the anchor, flips left near the edge and stays inside vertically', () => {
    expect(tooltipBox({ x: 50, y: 80 }, 60, 40, 300, 160)).toEqual({ x: 60, y: 60 });
    expect(tooltipBox({ x: 280, y: 80 }, 60, 40, 300, 160).x).toBe(280 - 60 - 10);
    expect(tooltipBox({ x: 50, y: 2 }, 60, 40, 300, 160).y).toBe(0);
    expect(tooltipBox({ x: 50, y: 158 }, 60, 40, 300, 160).y).toBe(120);
  });

  it('handles the next day helper used by the series builders', () => {
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
  });
});
