/**
 * Full-screen "N day streak" counter (android Popups.kt `StreakCelebration`). Tap anywhere to close.
 * Sequence (as Kotlin): 80 ms overlay + flame fade in -> 200 ms -> the number counts up (55-180 ms per step, slowing)
 * -> ripple ring -> 320 ms -> label, progress bar (towards a 14-day goal) and the close hint.
 */
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { streakFillPct } from '@/domain/celebrations';
import { Ease, timing, useValue } from '@/hooks/useAnim';
import { Brand } from '@/theme';

const radial = (rgba: string) => ({ backgroundImage: `radial-gradient(circle, ${rgba} 0%, rgba(0,0,0,0) 70%)` }) as object;

function useEscape(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}

/** The big number: fades/slides in (220 ms) whenever the value changes (Compose `AnimatedContent`). */
function CountText({ value, visible }: { value: number; visible: boolean }) {
  const k = useValue(0);
  useEffect(() => {
    k.setValue(0);
    timing(k, 1, 220, Easing.out(Easing.cubic)).start();
  }, [value, k]);
  return (
    <Animated.Text
      style={{
        width: 200,
        color: Brand.Green,
        fontSize: 96,
        fontWeight: '900',
        letterSpacing: -5,
        lineHeight: 96,
        textAlign: 'center',
        opacity: visible ? k : 0,
        transform: [{ translateY: k.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}
    >
      {value}
    </Animated.Text>
  );
}

export function StreakCelebration({ habitName, streak, onClose }: { habitName: string; streak: number; onClose: () => void }) {
  useEscape(onClose);
  const fillPct = streakFillPct(streak);
  const [frame, setFrame] = useState(0);
  const [displayNum, setDisplayNum] = useState(streak <= 1 ? streak : 1);

  const overlay = useValue(0);
  const fire = useValue(0.85);
  const ripple = useValue(0);
  const label = useValue(0);
  const fill = useValue(0);
  const hint = useValue(0);
  const breath = useValue(0);
  const startNum = useRef(displayNum).current;

  // The counting sequence.
  useEffect(() => {
    let cancelled = false;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    (async () => {
      await sleep(80);
      if (cancelled) return;
      setFrame(1);
      await sleep(200);
      if (cancelled) return;
      setFrame(2);
      let current = startNum;
      while (current < streak) {
        const progress = current / streak;
        await sleep(55 + progress * 125);
        if (cancelled) return;
        current += 1;
        setDisplayNum(current);
      }
      setFrame(4);
      ripple.setValue(0);
      timing(ripple, 1, 650, Easing.linear).start();
      await sleep(320);
      if (cancelled) return;
      setFrame(5);
    })();
    return () => {
      cancelled = true;
    };
  }, [streak, startNum, ripple]);

  useEffect(() => {
    timing(overlay, frame >= 1 ? 1 : 0, 300).start();
    timing(fire, frame >= 1 ? 1 : 0.85, 300).start();
  }, [frame >= 1, overlay, fire]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const on = frame >= 5;
    timing(label, on ? 1 : 0, 350).start();
    timing(fill, on ? fillPct / 100 : 0, 750, Ease.fastOutSlowIn, 100).start();
    timing(hint, on ? 0.25 : 0, 500, Easing.inOut(Easing.cubic), 600).start();
  }, [frame >= 5, fillPct, label, fill, hint]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([timing(breath, 1, 1000, Ease.fastOutSlowIn), timing(breath, 0, 1000, Ease.fastOutSlowIn)]));
    loop.start();
    return () => loop.stop();
  }, [breath]);

  const breathing = frame >= 5;
  const breathAlpha = breath.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });
  const breathScale = breath.interpolate({ inputRange: [0, 1], outputRange: [1, 1.15] });

  return (
    <Animated.View
      accessibilityViewIsModal
      accessibilityLabel={`${habitName}: ${streak} day streak. Tap anywhere to close.`}
      style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 80, opacity: overlay, backgroundColor: '#121212', alignItems: 'center', justifyContent: 'center' }}
    >
      <Pressable accessibilityLabel="Close" onPress={onClose} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
      {/* Mint radial glow */}
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', width: 340, height: 340, borderRadius: 170, opacity: breathing ? breathAlpha : 0.9 }, radial('rgba(95,227,161,0.16)')]} />
      {/* Warm amber glow near the bottom */}
      <View pointerEvents="none" style={[{ position: 'absolute', bottom: 80, width: 280, height: 180 }, radial('rgba(255,150,50,0.12)')]} />

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        style={{ position: 'absolute', top: 12, right: 20, width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }}
      >
        <Icon name="close" size={14} color="rgba(255,255,255,0.4)" />
      </Pressable>

      <View pointerEvents="none" style={{ alignItems: 'center' }}>
        <Text style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11, fontWeight: '600', letterSpacing: 2, marginBottom: 36 }}>{habitName.toUpperCase()}</Text>

        <View style={{ marginBottom: 28, alignItems: 'center', justifyContent: 'center', width: 90, height: 90 }}>
          <Animated.View
            style={{
              position: 'absolute',
              width: 80,
              height: 80,
              borderRadius: 40,
              borderWidth: 2,
              borderColor: 'rgba(95,227,161,0.55)',
              opacity: ripple.interpolate({ inputRange: [0, 0.001, 1], outputRange: [0, 0.6, 0] }),
              transform: [{ scale: ripple.interpolate({ inputRange: [0, 1], outputRange: [0.8, 2.2] }) }],
            }}
          />
          <Animated.View style={[{ position: 'absolute', width: 90, height: 90, borderRadius: 45, opacity: breathing ? breathAlpha : frame >= 1 ? 0.55 : 0, transform: [{ scale: breathing ? breathScale : 1 }] }, radial('rgba(95,227,161,0.22)')]} />
          <Animated.Text style={{ fontSize: 52, transform: [{ scale: fire }] }}>🔥</Animated.Text>
        </View>

        <CountText value={displayNum} visible={frame >= 2 || streak <= 1} />

        <Animated.Text
          style={{ marginTop: 8, marginBottom: 36, color: 'rgba(255,255,255,0.45)', fontSize: 16, fontWeight: '500', letterSpacing: 0.5, opacity: label, transform: [{ translateY: label.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }}
        >
          day streak
        </Animated.Text>

        <Animated.View style={{ width: 220, opacity: label }}>
          <View style={{ height: 4, borderRadius: 99, overflow: 'hidden', backgroundColor: 'rgba(255,255,255,0.08)' }}>
            <Animated.View
              style={[{ height: 4, borderRadius: 99, width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }, { backgroundImage: `linear-gradient(90deg, rgba(95,227,161,0.7), ${Brand.Green})` } as object]}
            />
          </View>
          <View style={{ flexDirection: 'row', marginTop: 8 }}>
            <Text style={{ flex: 1, color: 'rgba(255,255,255,0.25)', fontSize: 10, fontWeight: '500' }}>{`${streak} days`}</Text>
            <Text style={{ color: 'rgba(95,227,161,0.5)', fontSize: 10, fontWeight: '600' }}>{`${fillPct}%`}</Text>
          </View>
        </Animated.View>

        <Animated.Text style={{ marginTop: 48, color: 'rgba(255,255,255,0.4)', fontSize: 11, letterSpacing: 0.3, opacity: hint }}>Tap anywhere to close</Animated.Text>
      </View>
    </Animated.View>
  );
}
