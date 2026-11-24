/**
 * Home dashboard maths: ring completion (HomeCompletionTest), week windows (WeekStripTest), progress icon geometry and
 * day progress (ProgressIconTest), and the responsive column metrics at desktop and phone widths.
 */
import { describe, expect, it } from 'vitest';

import { dayProgress, daysCompletion, percent } from '@/domain/analytics';
import { progressIconGeometry, progressOf } from '@/domain/progressIcon';
import { weekRangeLabel, weekTitle, windowDays, WINDOW_DAYS } from '@/domain/week';
import { CARD_END, CARD_START, gridMetrics, LIST_PADDING, MENU_WIDTH, NAME_MIN, RING_GAP } from '@/components/dashboard/layout';
import { readableOn } from '@/utils/color';
import { formatMonthDay } from '@/utils/date';
import { sched } from './helpers';

describe('Home ring: daysCompletion over the five visible days (Nov 12-16, 2026; today = Mon Nov 16)', () => {
  const d = (n: number) => `2026-11-${String(n).padStart(2, '0')}`;
  const today = d(16);
  const window = [16, 15, 14, 13, 12].map(d); // newest first, as Home shows it
  const sunday = ['Sun']; // Nov 15

  const pct = (done: number[], rest: string[] = [], freezes: number[] = [], created = 1) =>
    percent(daysCompletion(sched('h', done.map(d), rest, { freezes: freezes.map(d), createdDate: d(created) }), window, today));

  it('all five done', () => expect(pct([12, 13, 14, 15, 16])).toBe(100));
  it('four of five', () => expect(pct([12, 13, 14, 15])).toBe(80));
  it('two of five', () => expect(pct([12, 13])).toBe(40));
  it('none done', () => expect(pct([])).toBe(0));
  it('a rest day is left out of the denominator', () => {
    expect(pct([12, 13], sunday)).toBe(50); // 2 of 4 scheduled days
    expect(pct([12, 13, 14, 16], sunday)).toBe(100); // 4 of 4
  });
  it('a completed rest day counts on both sides (never above 100%)', () => {
    expect(pct([12, 13, 14, 15, 16], sunday)).toBe(100);
    expect(pct([12, 15, 16], sunday)).toBe(60); // 3 of 5
  });
  it('a freeze is not a completion', () => expect(pct([12, 13, 14, 16], [], [15])).toBe(80));
  it('days before creation are left out', () => expect(pct([15, 16], [], [], 15)).toBe(100));
  it('future days are left out', () => {
    const h = sched('h', [d(15)], [], { createdDate: d(1) });
    expect(daysCompletion(h, [d(15), d(16), d(17), d(18)], today)).toEqual({ completed: 1, eligible: 2 });
  });
  it('nothing eligible is zero, not a division by zero', () => {
    expect(percent(daysCompletion(sched('h', [], [], { createdDate: d(20) }), window, today))).toBe(0);
  });
  it('rounds to the nearest whole percent', () => expect(percent({ completed: 2, eligible: 3 })).toBe(67));
});

describe('week strip', () => {
  it('the default window is five days, newest first, starting today', () => {
    const days = windowDays('2026-11-14');
    expect(days).toEqual(['2026-11-14', '2026-11-13', '2026-11-12', '2026-11-11', '2026-11-10']);
    expect(weekRangeLabel(days)).toBe('Nov 10 – Nov 14'); // the label stays chronological
    expect(WINDOW_DAYS).toBe(5);
  });
  it('older windows are consecutive and non-overlapping', () => {
    const today = '2026-11-14';
    const all = [0, -1, -2, -3].flatMap((o) => windowDays(today, o));
    expect(new Set(all).size).toBe(20);
    expect(all[0]).toBe(today);
    const asTime = (k: string) => new Date(`${k}T12:00:00`).getTime();
    all.slice(1).forEach((day, i) => expect(Math.round((asTime(all[i]) - asTime(day)) / 86_400_000)).toBe(1));
  });
  it('crosses month and year boundaries', () => {
    expect(weekRangeLabel(windowDays('2026-11-02'))).toBe('Oct 29 – Nov 2');
    expect(weekRangeLabel(windowDays('2027-01-02'))).toBe('Dec 29 – Jan 2');
    expect(weekRangeLabel(windowDays('2027-01-02', -1))).toBe('Dec 24 – Dec 28');
  });
  it('titles', () => {
    expect(weekTitle(0)).toBe('This Week');
    expect(weekTitle(-1)).toBe('Previous 5 Days');
    expect(weekTitle(-3)).toBe('Earlier');
  });
  it('formats "MMM d"', () => expect(formatMonthDay('2026-03-05')).toBe('Mar 5'));
});

describe('progress icon and day progress', () => {
  const near = (a: number | null, b: number) => expect(a).toBeCloseTo(b, 3);

  it('zero', () => {
    const g = progressIconGeometry(0);
    expect(g.fillWidth).toBe(0);
    near(g.tipX, 24);
    near(g.dot1X, 38);
    near(g.dot2X, 47);
    expect(g.complete).toBe(false);
  });
  it('twenty percent', () => {
    const g = progressIconGeometry(0.2);
    near(g.fillWidth, 16.8);
    near(g.tipX, 34.8);
    near(g.dot1X, 48.8);
    near(g.dot2X, 57.8);
  });
  it('sixty percent', () => {
    const g = progressIconGeometry(0.6);
    near(g.fillWidth, 50.4);
    near(g.tipX, 68.4);
    near(g.dot1X, 82.4);
    near(g.dot2X, 91.4);
  });
  it('eighty percent drops the second dot', () => {
    const g = progressIconGeometry(0.8);
    near(g.fillWidth, 67.2);
    near(g.tipX, 85.2);
    near(g.dot1X, 99.2);
    expect(g.dot2X).toBeNull();
  });
  it('complete has no dots ahead and a centre', () => {
    const g = progressIconGeometry(1);
    near(g.fillWidth, 84);
    near(g.tipX, 94);
    expect([g.dot1X, g.dot2X, g.complete]).toEqual([null, null, true]);
  });
  it('out of range is clamped', () => {
    expect(progressIconGeometry(-0.5)).toEqual(progressIconGeometry(0));
    expect(progressIconGeometry(3)).toEqual(progressIconGeometry(1));
    expect(progressIconGeometry(NaN)).toEqual(progressIconGeometry(0));
  });
  it('zero habits is zero progress', () => {
    expect(progressOf(0, 0)).toBe(0);
    expect(dayProgress([], '2026-11-16')).toEqual({ completed: 0, eligible: 0 });
  });
  it('progress is done over due', () => {
    expect(progressOf(9, 15)).toBeCloseTo(0.6, 4);
    expect(progressOf(3, 3)).toBe(1);
  });
  it('day progress counts only habits due that day', () => {
    const today = '2026-11-16'; // Monday
    const created = '2026-11-01';
    const habits = [
      sched('done', [today], [], { createdDate: created }),
      sched('open', [], [], { createdDate: created }),
      sched('rest', [], ['Mon'], { createdDate: created }), // left out
      sched('restDone', [today], ['Mon'], { createdDate: created }), // counts both sides
      sched('future', [], [], { createdDate: '2026-11-17' }), // not created yet
    ];
    expect(dayProgress(habits, today)).toEqual({ completed: 2, eligible: 3 });
  });
});

describe('responsive layout: grid metrics at desktop and mobile widths', () => {
  const FIXED = CARD_START + 34 + RING_GAP + NAME_MIN + MENU_WIDTH + CARD_END;
  const widths = [320, 360, 390, 412, 600, 768, 1280, 1920];

  it('columns and dots stay within their clamps at every width', () => {
    for (const w of widths) {
      const m = gridMetrics(w);
      expect(m.column).toBeGreaterThanOrEqual(28);
      expect(m.column).toBeLessThanOrEqual(44);
      expect(m.dot).toBeGreaterThanOrEqual(22);
      expect(m.dot).toBeLessThanOrEqual(30);
      expect(m.ring).toBe(34);
    }
  });

  it('phone widths use the available space exactly (no clamping at 390)', () => {
    const m = gridMetrics(390);
    expect(m.column).toBeCloseTo((390 - LIST_PADDING * 2 - FIXED) / 5, 5);
    expect(m.dot).toBeCloseTo(m.column - 6, 5);
  });

  it('a very narrow screen (320) bottoms out at the minimum column', () => {
    expect(gridMetrics(320).column).toBe(28);
    expect(gridMetrics(320).dot).toBe(22);
  });

  it('desktop widths cap at the maximum column (the content column is max 560 wide anyway)', () => {
    expect(gridMetrics(560).column).toBe(44);
    expect(gridMetrics(1920).column).toBe(44);
    expect(gridMetrics(1920).dot).toBe(30);
  });

  it('wider screens never get a smaller column than narrower ones', () => {
    const cols = widths.map((w) => gridMetrics(w).column);
    expect(cols).toEqual([...cols].sort((a, b) => a - b));
  });

  it('the five columns plus the fixed parts fit in the card at 390 and 560', () => {
    for (const w of [390, 560]) {
      const m = gridMetrics(w);
      expect(m.column * 5 + FIXED).toBeLessThanOrEqual(w - LIST_PADDING * 2 + 0.0001);
    }
  });
});

describe('light-theme habit colours (readableOn)', () => {
  it('keeps habit colours as they are in dark mode', () => expect(readableOn('#FDE68A', true)).toBe('#FDE68A'));
  it('darkens pale colours in light mode so text stays readable', () => {
    expect(readableOn('#FDE68A', false)).not.toBe('#FDE68A');
    expect(readableOn('#F1F5F9', false)).not.toBe('#F1F5F9');
  });
  it('keeps deep colours in light mode', () => expect(readableOn('#818CF8', false)).toBe('#818CF8'));
});
