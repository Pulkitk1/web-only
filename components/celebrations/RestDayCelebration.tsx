/**
 * "Bonus Effort!" for completing a habit on a planned rest day (android Popups.kt `RestDayCelebration`): confetti in
 * green/gold/purple and a small card that pops in with a bounce, then closes itself after ~2.6 s. Tap to close early.
 * With reduced motion the card simply appears, without confetti or bounce.
 */
import { useEffect, useRef } from 'react';
import { Animated, Pressable, Text } from 'react-native';

import { spring, useReduceMotion, useValue } from '@/hooks/useAnim';
import { Brand } from '@/theme';
import { Confetti } from './Confetti';

export function RestDayCelebration({ habitName, onClose }: { habitName: string; onClose: () => void }) {
  const still = useReduceMotion();
  const pop = useValue(still ? 1 : 0.6);
  // The timer starts once (Kotlin `LaunchedEffect(Unit)`), however often the parent re-renders.
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    if (!still) spring(pop, 1, 0.45, 380).start();
  }, [still, pop]);
  useEffect(() => {
    const id = setTimeout(() => close.current(), 2600);
    return () => clearTimeout(id);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <Pressable
      accessibilityRole="alert"
      accessibilityLabel={`Bonus Effort! You showed up even on your rest day. ${habitName}`}
      onPress={onClose}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 70, alignItems: 'center', justifyContent: 'center' }}
    >
      {!still && <Confetti />}
      <Animated.View
        style={{
          marginHorizontal: 40,
          transform: [{ scale: pop }],
          backgroundColor: 'rgba(23,23,31,0.96)',
          borderRadius: 24,
          borderWidth: 1.5,
          borderColor: 'rgba(192,132,252,0.45)',
          paddingHorizontal: 28,
          paddingVertical: 24,
          alignItems: 'center',
          boxShadow: '0 12px 40px rgba(0,0,0,0.5)',
        }}
      >
        <Text style={{ color: '#FFFFFF', fontSize: 22, fontWeight: '700' }}>Bonus Effort! 🎉</Text>
        <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 14, textAlign: 'center', marginTop: 6, marginBottom: 14 }}>You showed up even on your rest day!</Text>
        <Text
          style={{
            color: Brand.Gold,
            fontSize: 14,
            fontWeight: '700',
            borderRadius: 12,
            backgroundColor: 'rgba(242,211,107,0.12)',
            borderWidth: 1,
            borderColor: 'rgba(242,211,107,0.35)',
            paddingHorizontal: 14,
            paddingVertical: 6,
            overflow: 'hidden',
          }}
        >
          🔥 Streak +1 day
        </Text>
        <Text style={{ color: Brand.Green, fontSize: 12, fontWeight: '600', marginTop: 12 }}>{habitName}</Text>
      </Animated.View>
    </Pressable>
  );
}
