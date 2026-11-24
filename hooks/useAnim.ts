import { useEffect, useRef, useState } from 'react';
import { Animated, Easing } from 'react-native';

/**
 * True when the user turned animations off (OS "reduce motion"). Android reads ANIMATOR_DURATION_SCALE == 0
 * (`rememberReduceMotion`); the web equivalent is the `prefers-reduced-motion` media query.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(() => (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) || false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReduce(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return reduce;
}

/** Compose easing curves used by the celebrations. */
export const Ease = {
  fastOutSlowIn: Easing.bezier(0.4, 0, 0.2, 1),
  linearOutSlowIn: Easing.bezier(0, 0, 0.2, 1),
  milestoneRoll: Easing.bezier(0.15, 0.75, 0.2, 1),
  overshoot: Easing.bezier(0.34, 1.56, 0.64, 1),
};

/** timing helper: `Animated.timing` with the JS driver (web), optional delay. */
export function timing(value: Animated.Value, toValue: number, duration: number, easing: (t: number) => number = Easing.inOut(Easing.cubic), delay = 0) {
  return Animated.timing(value, { toValue, duration, easing, delay, useNativeDriver: false });
}

/**
 * Compose `spring(dampingRatio, stiffness)` as an RN spring: damping = ratio * 2 * sqrt(stiffness) for unit mass.
 * Ratios: LowBouncy 0.75, MediumBouncy 0.5. Stiffness: Low 200, MediumLow 400, Medium 1500.
 */
export function spring(value: Animated.Value, toValue: number, dampingRatio: number, stiffness: number) {
  return Animated.spring(value, { toValue, stiffness, damping: dampingRatio * 2 * Math.sqrt(stiffness), mass: 1, useNativeDriver: false });
}

/** Mirrors an Animated.Value into React state, for drawing that can't take an Animated value (SVG geometry). */
export function useAnimatedState(value: Animated.Value): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const id = value.addListener(({ value: v }) => setN(v));
    return () => value.removeListener(id);
  }, [value]);
  return n;
}

/** A stable Animated.Value that lives as long as the component. */
export function useValue(initial: number): Animated.Value {
  return useRef(new Animated.Value(initial)).current;
}
