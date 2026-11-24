/** Habit reordering: the pure logic behind drag-and-drop (android ReorderableList.kt + AppViewModel.reorderHabits). */
import { describe, expect, it } from 'vitest';

import { applyReorder, autoScrollAmount, computeSlots, isMoved, shownOrder, swapIfNeeded, TOUCH_SLOP } from '@/domain/reorder';

// Five 60px cards, 10px apart, list top 4 (HabitsScreen.kt padding/spacing): offsets 4, 74, 144, 214, 284.
const sizes = { a: 60, b: 60, c: 60, d: 60, e: 60 };
const order = ['a', 'b', 'c', 'd', 'e'];
const slots = (o = order) => computeSlots(o, sizes, 4, 10);

describe('computeSlots', () => {
  it('lays cards out top to bottom with the gap', () => {
    expect(slots().map((s) => s.offset)).toEqual([4, 74, 144, 214, 284]);
  });
  it('handles cards of different heights', () => {
    expect(computeSlots(['a', 'b'], { a: 50, b: 80 }, 4, 10).map((s) => s.offset)).toEqual([4, 64]);
  });
});

describe('swapIfNeeded (centre crossing)', () => {
  const swap = (key: string, delta: number, o = order, moved = true) => swapIfNeeded(o, slots(o), key, slots(o).find((s) => s.key === key)!.offset, delta, moved);

  it('does nothing before the finger has moved past the touch slop', () => {
    expect(swap('a', 200, order, false)).toBeNull();
    expect(isMoved(TOUCH_SLOP)).toBe(false);
    expect(isMoved(TOUCH_SLOP + 1)).toBe(true);
    expect(isMoved(-(TOUCH_SLOP + 1))).toBe(true);
  });

  it("does nothing until the dragged card's centre crosses a neighbour's centre", () => {
    // a's centre starts at 34; b's centre is 104. Needs delta > 70.
    expect(swap('a', 60)).toBeNull();
    expect(swap('a', 70)).toBeNull(); // equal is not "crossed"
    expect(swap('a', 71)).toEqual(['b', 'a', 'c', 'd', 'e']);
  });

  it('moving up swaps with the neighbour above', () => {
    expect(swap('c', -71)).toEqual(['a', 'c', 'b', 'd', 'e']);
    expect(swap('c', -60)).toBeNull();
  });

  it('a fast fling crosses several neighbours at once, to the farthest one', () => {
    expect(swap('a', 3 * 70 + 1)).toEqual(['b', 'c', 'd', 'a', 'e']);
    expect(swap('e', -(4 * 70 + 1))).toEqual(['e', 'a', 'b', 'c', 'd']);
    expect(swap('a', 10_000)).toEqual(['b', 'c', 'd', 'e', 'a']);
  });

  it("has hysteresis: after a swap the card can't swap straight back without moving the other way", () => {
    const afterSwap = swap('a', 71)!; // b a c d e; a's layout offset is now 74, its pointer position is 4 + 71 = 75
    const back = swapIfNeeded(afterSwap, slots(afterSwap), 'a', 4, 71, true);
    expect(back).toBeNull();
    // Dragging back up past b's centre swaps again.
    expect(swapIfNeeded(afterSwap, slots(afterSwap), 'a', 4, -1, true)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('works with rows of different heights', () => {
    const sz = { a: 40, b: 100, c: 40 };
    const o = ['a', 'b', 'c'];
    const sl = computeSlots(o, sz, 4, 10); // a 4..44, b 54..154, c 164..204
    // a's centre = 24 + delta; b's centre = 104 -> needs delta > 80
    expect(swapIfNeeded(o, sl, 'a', 4, 80, true)).toBeNull();
    expect(swapIfNeeded(o, sl, 'a', 4, 81, true)).toEqual(['b', 'a', 'c']);
  });

  it('ignores unknown keys and an empty list', () => {
    expect(swapIfNeeded(order, slots(), 'zzz', 0, 500, true)).toBeNull();
    expect(swapIfNeeded([], [], 'a', 0, 500, true)).toBeNull();
  });

  it('archived habits (not in the working list) stay where they are: only listed keys take part', () => {
    const home = ['a', 'b'];
    expect(swapIfNeeded(home, computeSlots(home, sizes, 4, 10), 'a', 4, 200, true)).toEqual(['b', 'a']);
  });
});

describe('applyReorder (what is saved on drop)', () => {
  it('returns the new order', () => {
    expect(applyReorder(['a', 'b', 'c'], ['c', 'a', 'b'])).toEqual(['c', 'a', 'b']);
  });
  it('returns null when nothing changed (no write)', () => {
    expect(applyReorder(['a', 'b', 'c'], ['a', 'b', 'c'])).toBeNull();
  });
  it('habits not shown on Home (archived) keep their relative order at the end', () => {
    // Home shows b and a (a & b dragged); archived x was between them before.
    expect(applyReorder(['a', 'x', 'b', 'y'], ['b', 'a'])).toEqual(['b', 'a', 'x', 'y']);
  });
  it('ignores ids that no longer exist', () => {
    expect(applyReorder(['a', 'b'], ['gone', 'b', 'a'])).toEqual(['b', 'a']);
  });
  it('is stable: applying the result again changes nothing', () => {
    const once = applyReorder(['a', 'b', 'c', 'd'], ['d', 'c'])!;
    expect(applyReorder(once, once)).toBeNull();
  });
});

describe('shownOrder (render order while dragging)', () => {
  const habits = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('is the store order when not dragging', () => expect(shownOrder(habits, null).map((h) => h.id)).toEqual(['a', 'b', 'c']));
  it('follows the working order', () => expect(shownOrder(habits, ['c', 'a', 'b']).map((h) => h.id)).toEqual(['c', 'a', 'b']));
  it('drops habits removed meanwhile and appends habits added meanwhile', () => {
    expect(shownOrder(habits, ['c', 'gone', 'a']).map((h) => h.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('autoScrollAmount', () => {
  const view = [0, 400] as const; // viewport 0..400, edge = 12% = 48px
  it('does not scroll before a real move, or in the middle of the list', () => {
    expect(autoScrollAmount(0, 5, 60, ...view, false)).toBe(0);
    expect(autoScrollAmount(100, 40, 60, ...view, true)).toBe(0);
  });
  it('scrolls down near the bottom edge, only when moving down', () => {
    expect(autoScrollAmount(280, 80, 60, ...view, true)).toBeGreaterThan(0);
    // Same position but moving up: no scroll.
    expect(autoScrollAmount(280, -1, 60, ...view, true)).toBe(0);
  });
  it('scrolls up near the top edge, only when moving up', () => {
    expect(autoScrollAmount(60, -50, 60, ...view, true)).toBeLessThan(0);
    expect(autoScrollAmount(60, 1, 60, ...view, true)).toBe(0);
  });
  it('is capped at a quarter of the edge zone per frame', () => {
    expect(autoScrollAmount(0, 5000, 60, ...view, true)).toBe(48 / 4);
    expect(autoScrollAmount(0, -5000, 60, ...view, true)).toBe(-48 / 4);
  });
});
