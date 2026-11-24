/**
 * Pure logic of long-press drag-to-reorder, ported from android/.../ui/components/ReorderableList.kt (`ReorderState`)
 * and `AppViewModel.reorderHabits`. No DOM or React here, so it is unit-tested directly.
 *
 * Coordinates are in the scroll content's space (what Compose calls the item `offset`).
 */

export type Slot = { key: string; offset: number; size: number };

/** Layout of a column of items in `order`: first item at `top`, then `gap` between items (HabitsScreen uses 10). */
export function computeSlots(order: readonly string[], sizes: Readonly<Record<string, number>>, top: number, gap: number): Slot[] {
  let y = top;
  return order.map((key) => {
    const size = sizes[key] ?? 0;
    const slot = { key, offset: y, size };
    y += size + gap;
    return slot;
  });
}

/** Finger travel (px) before a held item counts as moved; until then nothing reorders or auto-scrolls (touch slop). */
export const TOUCH_SLOP = 8;
/** Android `longPressTimeoutMillis`. */
export const LONG_PRESS_MS = 400;

export const isMoved = (delta: number, slop = TOUCH_SLOP) => Math.abs(delta) > slop;

/**
 * Moves the dragged item past every neighbour whose centre its own centre has crossed (`swapIfNeeded`). Centre
 * crossing gives hysteresis: after a swap the item sits on the far side of that neighbour's centre, so it can't swap
 * straight back, even with rows of different heights. Only neighbours still on the same side in the working order
 * count. Returns the new order, or null when nothing changes.
 */
export function swapIfNeeded(
  order: readonly string[],
  slots: readonly Slot[],
  draggingKey: string,
  initialOffset: number,
  delta: number,
  moved: boolean,
): string[] | null {
  if (!moved) return null;
  const item = slots.find((s) => s.key === draggingKey);
  if (!item) return null;
  const middle = initialOffset + delta + item.size / 2;
  const from = order.indexOf(draggingKey);
  if (from < 0) return null;
  const crossed: number[] = [];
  for (const other of slots) {
    if (other.key === draggingKey) continue;
    const i = order.indexOf(other.key);
    const centre = other.offset + other.size / 2;
    if (i > from && other.offset > item.offset && middle > centre) crossed.push(i);
    else if (i >= 0 && i < from && other.offset < item.offset && middle < centre) crossed.push(i);
  }
  if (crossed.length === 0) return null;
  const to = delta > 0 ? Math.max(...crossed) : Math.min(...crossed);
  if (to === from) return null;
  const next = [...order];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

/**
 * Pixels to scroll this frame when the dragged item has been moved near the top or bottom edge of the list. Only after
 * a real move and only in the direction of travel, so holding an item near an edge never scrolls the list.
 */
export function autoScrollAmount(
  initialOffset: number,
  delta: number,
  itemSize: number,
  viewportStart: number,
  viewportEnd: number,
  moved: boolean,
): number {
  if (!moved) return 0;
  const top = initialOffset + delta;
  const bottom = top + itemSize;
  const edge = (viewportEnd - viewportStart) * 0.12;
  if (delta < 0 && top < viewportStart + edge) return -Math.min(viewportStart + edge - top, edge) / 4;
  if (delta > 0 && bottom > viewportEnd - edge) return Math.min(bottom - (viewportEnd - edge), edge) / 4;
  return 0;
}

/**
 * Persisted order after a drop (`AppViewModel.reorderHabits`): the dragged order first (only known habits), then any
 * habit not in it (e.g. archived ones that Home doesn't show) in their previous order. Returns null if unchanged.
 */
export function applyReorder(previousIds: readonly string[], orderedIds: readonly string[]): string[] | null {
  const ids = [...orderedIds.filter((id) => previousIds.includes(id)), ...previousIds.filter((id) => !orderedIds.includes(id))];
  return ids.length === previousIds.length && ids.every((id, i) => id === previousIds[i]) ? null : ids;
}

/** The order to render while dragging: the working order, then habits added meanwhile (`HabitList` `shown`). */
export function shownOrder<T extends { id: string }>(home: readonly T[], working: readonly string[] | null): T[] {
  if (!working) return [...home];
  const byId = new Map(home.map((h) => [h.id, h]));
  const inWorking = working.map((id) => byId.get(id)).filter((h): h is T => h !== undefined);
  return [...inWorking, ...home.filter((h) => !working.includes(h.id))];
}
