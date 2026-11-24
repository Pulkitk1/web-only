/**
 * The scrolling habit list with long-press drag-to-reorder (android HabitsScreen.kt `HabitList` +
 * ReorderableList.kt). The pure decisions (when to swap, auto-scroll speed, what order is saved) live in
 * `domain/reorder.ts` and are unit-tested; this file only turns pointer events into those calls.
 *
 * Behaviour as Kotlin: a long press (400 ms, without moving past the touch slop) anywhere on a card lifts it; it follows
 * the pointer, other cards slide out of the way, near the top/bottom edge the list auto-scrolls, and the new order is
 * saved once on release. Taps on the buttons inside a card work as usual because nothing is consumed before the long
 * press; after a drag the release never triggers a click.
 */
import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type ComponentRef, type ReactNode } from 'react';
import { Animated, ScrollView, View, type LayoutChangeEvent } from 'react-native';

import { autoScrollAmount, computeSlots, isMoved, LONG_PRESS_MS, shownOrder, swapIfNeeded, TOUCH_SLOP } from '@/domain/reorder';
import { spring, timing, useValue } from '@/hooks/useAnim';
import type { HabitView } from '@/store/AppStore';
import { LIST_PADDING } from './layout';

/** HabitsScreen.kt: `contentPadding top = 4.dp`, `Arrangement.spacedBy(10.dp)`. */
const LIST_TOP = 4;
const ITEM_GAP = 10;

type Drag = {
  key: string;
  pointerId: number;
  startY: number;
  startScroll: number;
  initialOffset: number;
  initialKeys: string[];
  finger: number;
  moved: boolean;
};

type Props = {
  habits: HabitView[];
  renderCard: (habit: HabitView) => ReactNode;
  onReorder: (orderedIds: string[]) => void;
  footer: ReactNode;
};

export function HabitList({ habits, renderCard, onReorder, footer }: Props) {
  const [heights, setHeights] = useState<Record<string, number>>({});
  const heightsRef = useRef(heights);
  const [working, setWorking] = useState<string[] | null>(null);
  const workingRef = useRef<string[] | null>(null);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [settle, setSettle] = useState<{ key: string; from: number; id: number } | null>(null);
  const settleId = useRef(0);
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const drag = useRef<Drag | null>(null);
  const scrollY = useRef(0);
  const viewportH = useRef(0);
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const habitsRef = useRef(habits);
  habitsRef.current = habits;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const shown = shownOrder(habits, working);
  const shownIds = shown.map((h) => h.id);
  const slots = computeSlots(shownIds, heights, LIST_TOP, ITEM_GAP);
  const slotOf = (key: string) => slots.find((s) => s.key === key)?.offset;

  const onItemLayout = useCallback((key: string, h: number) => {
    if (heightsRef.current[key] === h) return;
    heightsRef.current = { ...heightsRef.current, [key]: h };
    setHeights(heightsRef.current);
  }, []);

  // ── Drag state machine (ReorderState) ──
  const contentDelta = () => (drag.current ? drag.current.finger + (scrollY.current - drag.current.startScroll) : 0);
  const currentSlots = () => computeSlots(workingRef.current ?? [], heightsRef.current, LIST_TOP, ITEM_GAP);
  const offsetOf = (key: string) => {
    const d = drag.current;
    if (!d || d.key !== key) return 0;
    const slot = currentSlots().find((s) => s.key === key);
    return slot ? d.initialOffset + contentDelta() - slot.offset : 0;
  };

  const checkSwap = () => {
    const d = drag.current;
    const order = workingRef.current;
    if (!d || !order) return;
    const next = swapIfNeeded(order, currentSlots(), d.key, d.initialOffset, contentDelta(), d.moved);
    if (next) {
      workingRef.current = next;
      setWorking(next);
    }
  };

  const end = (commit: boolean) => {
    const d = drag.current;
    if (!d) return;
    const order = workingRef.current;
    const changed = !!order && (order.length !== d.initialKeys.length || order.some((id, i) => id !== d.initialKeys[i]));
    // The residual is measured from the slot the item keeps; a cancelled move returns it to its old slot instead.
    const residual = commit || !changed ? offsetOf(d.key) : 0;
    drag.current = null;
    workingRef.current = null;
    setWorking(null);
    setDraggingKey(null);
    if (commit && changed && order) onReorderRef.current(order);
    if (residual !== 0) setSettle({ key: d.key, from: residual, id: ++settleId.current });
    document.body.style.userSelect = '';
  };

  // ── Pointer wiring ──
  const startPress = (key: string, e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (drag.current) return;
    const startY = e.clientY;
    const startX = e.clientX;
    const pointerId = e.pointerId;
    let active = false;

    const cleanup = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onCancel, true);
      document.removeEventListener('touchmove', stopTouch, true);
      clearTimeout(timer);
    };
    const stopTouch = (ev: TouchEvent) => active && ev.cancelable && ev.preventDefault();
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (!active) {
        // Moved past the touch slop before the timeout: it is a scroll or a drag of a child, not a long press.
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > TOUCH_SLOP) cleanup();
        return;
      }
      ev.preventDefault();
      const d = drag.current;
      if (!d) return;
      d.finger = ev.clientY - d.startY;
      if (isMoved(d.finger)) d.moved = true;
      checkSwap();
      tick();
    };
    const finish = (commit: boolean) => {
      const wasActive = active;
      cleanup();
      if (wasActive) {
        end(commit);
        // The release must not click whatever is under the pointer (e.g. open the habit).
        const swallow = (ev: Event) => {
          ev.stopPropagation();
          ev.preventDefault();
        };
        window.addEventListener('click', swallow, true);
        setTimeout(() => window.removeEventListener('click', swallow, true), 0);
      }
    };
    const onUp = (ev: PointerEvent) => ev.pointerId === pointerId && finish(true);
    const onCancel = (ev: PointerEvent) => ev.pointerId === pointerId && finish(false);

    const timer = setTimeout(() => {
      const ids = habitsRef.current.map((h) => h.id);
      const first = computeSlots(ids, heightsRef.current, LIST_TOP, ITEM_GAP).find((s) => s.key === key);
      if (!first || !ids.includes(key)) {
        cleanup();
        return;
      }
      active = true;
      workingRef.current = ids;
      drag.current = { key, pointerId, startY, startScroll: scrollY.current, initialOffset: first.offset, initialKeys: ids, finger: 0, moved: false };
      setWorking(ids);
      setDraggingKey(key);
      document.body.style.userSelect = 'none';
      navigator.vibrate?.(10); // haptic feedback on supported devices (Kotlin: LongPress haptic)
      document.addEventListener('touchmove', stopTouch, { capture: true, passive: false });
    }, LONG_PRESS_MS);

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onCancel, true);
  };

  // Auto-scroll while the dragged item sits near an edge (runs every frame while dragging).
  useEffect(() => {
    if (!draggingKey) return;
    let raf = 0;
    const step = () => {
      const d = drag.current;
      if (d) {
        const size = heightsRef.current[d.key] ?? 0;
        const amount = autoScrollAmount(d.initialOffset, contentDelta(), size, scrollY.current, scrollY.current + viewportH.current, d.moved);
        if (amount !== 0) {
          scrollY.current += amount;
          scrollRef.current?.scrollTo({ y: scrollY.current, animated: false });
        }
        checkSwap(); // catches up after scrolling or a fast fling across several items
        tick();
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingKey]);

  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingHorizontal: LIST_PADDING, paddingTop: LIST_TOP, paddingBottom: 16, gap: ITEM_GAP }}
      showsVerticalScrollIndicator={false}
      scrollEventThrottle={16}
      onScroll={(e) => {
        scrollY.current = e.nativeEvent.contentOffset.y;
      }}
      onLayout={(e: LayoutChangeEvent) => {
        viewportH.current = e.nativeEvent.layout.height;
      }}
    >
      {shown.map((habit, i) => (
        <ReorderItem
          key={habit.id}
          itemKey={habit.id}
          // Earlier cards sit above later ones, so a card's overflow menu is never painted over by the card below it.
          z={shown.length - i}
          topZ={shown.length + 2}
          y={heights[habit.id] === undefined ? undefined : slotOf(habit.id)}
          dragging={draggingKey === habit.id}
          dragOffset={draggingKey === habit.id ? offsetOf(habit.id) : 0}
          settle={settle?.key === habit.id ? settle : null}
          onSettled={() => setSettle((s) => (s && s.key === habit.id ? null : s))}
          onLayoutHeight={onItemLayout}
          onPress={startPress}
        >
          {renderCard(habit)}
        </ReorderItem>
      ))}
      {footer}
    </ScrollView>
  );
}

type ItemProps = {
  itemKey: string;
  /** Stacking order of this card, and the order used while it is lifted or settling. */
  z: number;
  topZ: number;
  /** The card's slot offset in the list as currently rendered (for the slide animation). */
  y: number | undefined;
  dragging: boolean;
  dragOffset: number;
  settle: { from: number; id: number } | null;
  onSettled: () => void;
  onLayoutHeight: (key: string, h: number) => void;
  onPress: (key: string, e: PointerEvent) => void;
  children: ReactNode;
};

/** One card: follows the pointer while dragged, slides into a new slot (spring), and glides home after release. */
function ReorderItem({ itemKey, z, topZ, y, dragging, dragOffset, settle, onSettled, onLayoutHeight, onPress, children }: ItemProps) {
  const ref = useRef<ComponentRef<typeof View>>(null);
  const slide = useValue(0);
  const lift = useValue(0);
  const cur = useRef(0);
  const prevY = useRef<number | undefined>(y);
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  useEffect(() => {
    const id = slide.addListener(({ value }) => (cur.current = value));
    return () => slide.removeListener(id);
  }, [slide]);

  // Other cards slide into place (Compose `animateItem` placement spring) instead of jumping.
  useLayoutEffect(() => {
    if (y === undefined) return;
    if (prevY.current !== undefined && prevY.current !== y && !dragging) {
      slide.setValue(cur.current + prevY.current - y);
      spring(slide, 0, 1, 400).start();
    }
    prevY.current = y;
  }, [y, dragging, slide]);

  // After release the card glides from where the pointer left it into its slot.
  useEffect(() => {
    if (!settle) return;
    slide.setValue(settle.from);
    spring(slide, 0, 1, 400).start(() => onSettled());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settle?.id]);

  // Lift: scale 1.02 with a shadow while dragged (tween 150 ms).
  useEffect(() => {
    timing(lift, dragging ? 1 : 0, 150).start();
  }, [dragging, lift]);

  useEffect(() => {
    const el = ref.current as unknown as HTMLElement | null;
    if (!el?.addEventListener) return;
    const down = (e: Event) => onPressRef.current(itemKey, e as PointerEvent);
    el.addEventListener('pointerdown', down);
    return () => el.removeEventListener('pointerdown', down);
  }, [itemKey]);

  return (
    <View
      ref={ref}
      onLayout={(e: LayoutChangeEvent) => onLayoutHeight(itemKey, e.nativeEvent.layout.height)}
      style={{ zIndex: dragging || settle ? topZ : z, userSelect: 'none', WebkitTouchCallout: 'none' } as object}
    >
      <Animated.View
        style={{
          transform: [{ translateY: slide }, { translateY: dragOffset }, { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] }) }],
          borderRadius: 18,
          boxShadow: dragging ? '0 10px 24px rgba(0,0,0,0.45)' : 'none',
        }}
      >
        {children}
      </Animated.View>
    </View>
  );
}
