/**
 * Full-screen celebration for a streak milestone (android MilestoneCelebrationScreen.kt): an orange flame, a vertical
 * day counter that rolls up and settles on the milestone (the days either side in gray), sparkles, "Milestone unlocked"
 * and the coin reward. It only displays what already happened: the reward was granted by the wallet before this is
 * shown. Escape and Continue both dismiss. With reduced motion it appears already complete.
 * Timings, easings and shapes follow the Kotlin sequence.
 */
import { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Circle, Ellipse, G, Line, Path } from 'react-native-svg';

import { CoinIcon } from '@/components/ui/CoinIcon';
import { FlameIcon } from '@/components/ui/FlameIcon';
import { milestoneCounterRange, milestoneDayText } from '@/domain/celebrations';
import { Ease, spring, timing, useAnimatedState, useReduceMotion, useValue } from '@/hooks/useAnim';
import { Brand } from '@/theme';

const EMBER = '#FF7A2F';
const EMBER_DEEP = '#E8531A';
const NIGHT = '#0A0A0C';
const MUTED_GRAY = '#7D7D86';
const ITEM_HEIGHT = 58;

const rgba = (hex: string, a: number) => {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
};

/** Small seeded PRNG so a milestone's sparkles are stable (Kotlin `Random(seed)`). */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function MilestoneCelebrationScreen({ habitName, milestone, coins, onDismiss }: { habitName: string; milestone: number; coins: number; onDismiss: () => void }) {
  const reduce = useReduceMotion();
  const special = milestone >= 100;
  const { start, steps } = milestoneCounterRange(milestone);

  const fade = useValue(reduce ? 1 : 0);
  const roll = useValue(reduce ? steps : 0);
  const glow = useValue(reduce ? 0.4 : 0);
  const flame = useValue(1);
  const burst = useValue(reduce ? 1 : 0);
  const label = useValue(reduce ? 1 : 0);
  const laurel = useValue(reduce ? 1 : 0);
  const pill = useValue(reduce ? 1 : 0);
  const hop = useValue(0);
  const message = useValue(reduce ? 1 : 0);
  const button = useValue(reduce ? 1 : 0);
  const [canContinue, setCanContinue] = useState(reduce);

  // The whole sequence lives in this effect, so it is cancelled the moment the screen unmounts.
  useEffect(() => {
    if (reduce) return;
    const seq = (delay: number, ...anims: Animated.CompositeAnimation[]) => Animated.sequence([Animated.delay(delay), ...anims]);
    const all = Animated.parallel([
      timing(fade, 1, 400, Easing.inOut(Easing.cubic)),
      // Roll: starts slowly, ends with a long gentle deceleration.
      seq(400, timing(roll, steps, 800, Ease.milestoneRoll)),
      seq(1200, timing(glow, 1, 160), timing(glow, 0.4, 500)),
      seq(1200, timing(flame, 1.16, 220), spring(flame, 1, 0.75, 200)),
      seq(1200, timing(burst, 1, special ? 1800 : 1500, Ease.linearOutSlowIn)),
      seq(1250, timing(label, 1, 450)),
      seq(1250, spring(laurel, 1, 0.75, 200)),
      seq(1800, timing(pill, 1, 400)),
      seq(1900, timing(hop, 1, 170), spring(hop, 0, 0.5, 1500)),
      seq(2100, timing(message, 1, 350)),
      seq(2400, timing(button, 1, 350)),
    ]);
    all.start();
    const id = setTimeout(() => setCanContinue(true), 2400);
    return () => {
      all.stop();
      clearTimeout(id);
    };
  }, [reduce, milestone, steps, special, fade, roll, glow, flame, burst, label, laurel, pill, hop, message, button]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onDismiss();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  const glowN = useAnimatedState(glow);
  const strength = (special ? 0.2 : 0.14) + glowN * (special ? 0.3 : 0.2);

  return (
    <Animated.View
      accessibilityViewIsModal
      accessibilityLabel={`Milestone unlocked. ${milestone} day streak on ${habitName}. You earned ${coins} coins.`}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        zIndex: 90,
        opacity: fade,
        backgroundColor: NIGHT,
        // Soft orange glow behind everything; it swells briefly when the counter stops.
        backgroundImage: `radial-gradient(circle at 50% 42%, ${rgba(EMBER, strength)} 0%, rgba(0,0,0,0) 85vmin)`,
      } as object}
    >
      <ScrollView contentContainerStyle={{ flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 20 }} showsVerticalScrollIndicator={false}>
        <Text numberOfLines={1} style={{ color: MUTED_GRAY, fontSize: 13, fontWeight: '500', marginBottom: 18, maxWidth: '100%' }}>
          {habitName}
        </Text>
        <Animated.View style={{ transform: [{ scale: flame }] }}>
          <FlameBadge glow={glowN} />
        </Animated.View>
        <View style={{ height: 22 }} />

        {/* Counter with sparkles drawn around it. */}
        <View style={{ width: 320, maxWidth: '100%', height: 300, alignItems: 'center', justifyContent: 'center' }}>
          <Sparkles burst={burst} seed={milestone} special={special} />
          <DayCounter start={start} milestone={milestone} roll={roll} steps={steps} glow={glowN} special={special} />
        </View>
        <View style={{ height: 26 }} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Animated.View style={{ opacity: laurel, transform: [{ scale: laurel }] }}>
            <Laurel mirrored={false} />
          </Animated.View>
          <Animated.Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '600', opacity: label }}>Milestone unlocked</Animated.Text>
          <Animated.View style={{ opacity: laurel, transform: [{ scale: laurel }] }}>
            <Laurel mirrored />
          </Animated.View>
        </View>
        <View style={{ height: 18 }} />

        <RewardPill coins={coins} pill={pill} hop={hop} />
        <View style={{ height: 14 }} />
        <Animated.Text style={{ color: MUTED_GRAY, fontSize: 14, textAlign: 'center', opacity: message }}>Great consistency!</Animated.Text>
        <View style={{ height: 36 }} />

        {/* Appears once the sequence has finished; Escape dismisses at any time. */}
        <Animated.View style={{ opacity: button }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Continue"
            disabled={!canContinue}
            onPress={onDismiss}
            style={{ borderRadius: 50, borderWidth: 1, borderColor: rgba(EMBER, 0.45), backgroundColor: rgba(EMBER, 0.08), paddingHorizontal: 36, paddingVertical: 12 }}
          >
            <Text style={{ color: EMBER, fontSize: 15, fontWeight: '600' }}>Continue</Text>
          </Pressable>
        </Animated.View>
      </ScrollView>
    </Animated.View>
  );
}

/** The flame in a dark, softly glowing circle. */
function FlameBadge({ glow }: { glow: number }) {
  return (
    <View style={{ width: 92, height: 92, alignItems: 'center', justifyContent: 'center' }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', width: 132, height: 132, borderRadius: 66, backgroundImage: `radial-gradient(circle, ${rgba(EMBER, 0.18 + glow * 0.3)} 0%, rgba(0,0,0,0) 70%)` } as object}
      />
      <View style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: '#1B1411', borderWidth: 1, borderColor: rgba(EMBER, 0.35), alignItems: 'center', justifyContent: 'center' }}>
        <FlameIcon size={38} color={EMBER} />
      </View>
    </View>
  );
}

/**
 * A three-row vertical picker: the previous and next day in gray above and below, the current day in white inside a
 * glowing orange outline. `roll` runs 0..steps; at 0 the counter shows `start` in the middle, at `steps` the milestone.
 */
function DayCounter({ start, milestone, roll, steps, glow, special }: { start: number; milestone: number; roll: Animated.Value; steps: number; glow: number; special: boolean }) {
  const first = start - 1;
  const count = milestone + 1 - first + 1;
  const W = 260;
  const outlineAlpha = roll.interpolate({ inputRange: [0.6 * steps, steps], outputRange: [0, 1], extrapolate: 'clamp' });
  const boost = glow * (special ? 1.3 : 1);
  return (
    <View style={{ width: W, height: ITEM_HEIGHT * 3, overflow: 'hidden' }}>
      {/* Outline for the centre row, appearing as the counter slows to a stop. */}
      <Animated.View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, opacity: outlineAlpha }}>
        {[
          [14, 0.05],
          [9, 0.09],
          [5, 0.14],
        ].map(([spread, a]) => (
          <View
            key={spread}
            style={{
              position: 'absolute',
              left: -spread / 2 + 6,
              top: ITEM_HEIGHT - spread / 2,
              width: W - 12 + spread,
              height: ITEM_HEIGHT + spread,
              borderRadius: 18 + spread / 2,
              backgroundColor: rgba(EMBER, Math.min(a * (1 + boost), 0.5)),
            }}
          />
        ))}
        <View style={{ position: 'absolute', left: 6, top: ITEM_HEIGHT + 1, width: W - 12, height: ITEM_HEIGHT - 2, borderRadius: 18, borderWidth: 2, borderColor: EMBER }} />
      </Animated.View>
      {/* Unbounded height: the rows are taller than the three-row window, which only clips them. */}
      <Animated.View style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: [{ translateY: Animated.multiply(roll, -ITEM_HEIGHT) }] }}>
        {Array.from({ length: count }, (_, i) => (
          <DayRow key={i} day={first + i} index={i} roll={roll} />
        ))}
      </Animated.View>
    </View>
  );
}

function DayRow({ day, index, roll }: { day: number; index: number; roll: Animated.Value }) {
  // 1 when this row is in the middle slot, falling to 0 a full row away (Kotlin `nearness`).
  const near = roll.interpolate({ inputRange: [index - 2, index - 1, index], outputRange: [0, 1, 0], extrapolate: 'clamp' });
  const [num, unit] = milestoneDayText(day).split('  ');
  return (
    <View style={{ height: ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center' }} accessible accessibilityLabel={milestoneDayText(day)}>
      <Animated.View style={{ position: 'absolute', opacity: near.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }), transform: [{ scale: near.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] }) }] }}>
        <Text style={{ color: MUTED_GRAY, fontSize: 30, fontWeight: '700' }}>
          {num}
          <Text style={{ color: MUTED_GRAY, fontSize: 16, fontWeight: '600', letterSpacing: 1 }}>{`  ${unit}`}</Text>
        </Text>
      </Animated.View>
      <Animated.View style={{ position: 'absolute', opacity: near, transform: [{ scale: near.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.04] }) }] }}>
        <Text style={{ color: '#FFFFFF', fontSize: 34, fontWeight: '800' }}>
          {num}
          <Text style={{ color: EMBER, fontSize: 16, fontWeight: '600', letterSpacing: 1 }}>{`  ${unit}`}</Text>
        </Text>
      </Animated.View>
    </View>
  );
}

/** Small sparkles and a few short light streaks that drift outward from the counter and fade (one burst, no loop). */
function Sparkles({ burst, seed, special }: { burst: Animated.Value; seed: number; special: boolean }) {
  const p = useAnimatedState(burst);
  const { sparks, streaks } = useMemo(() => {
    const rnd = mulberry32(seed);
    const count = special ? 26 : 16;
    const sparks = Array.from({ length: count }, () => ({
      angle: rnd() * 2 * Math.PI,
      distance: 70 + rnd() * 110,
      size: 2 + rnd() * 3.5,
      gold: rnd() < 0.5,
      star: rnd() < 0.45,
      delay: rnd() * 0.25,
    }));
    const n = special ? 12 : 8;
    const streaks = Array.from({ length: n }, (_, i) => (i * 2 * Math.PI) / n + 0.2);
    return { sparks, streaks };
  }, [seed, special]);

  if (p <= 0 || p >= 1) return null;
  const cx = 160;
  const cy = 150;
  return (
    <Svg pointerEvents="none" width="100%" height={300} viewBox="0 0 320 300" style={{ position: 'absolute', top: 0, left: 0 }}>
      {streaks.map((a, i) => {
        const eased = 1 - (1 - p) * (1 - p);
        const r0 = 96 + eased * 46;
        const len = 14 * (1 - p * 0.5);
        return <Line key={`l${i}`} x1={cx + Math.cos(a) * r0} y1={cy + Math.sin(a) * r0 * 0.75} x2={cx + Math.cos(a) * (r0 + len)} y2={cy + Math.sin(a) * (r0 + len) * 0.75} stroke={EMBER} strokeOpacity={(1 - p) * 0.75} strokeWidth={2} />;
      })}
      {sparks.map((s, i) => {
        const t = Math.min(1, Math.max(0, (p - s.delay) / (1 - s.delay)));
        if (t <= 0) return null;
        const eased = 1 - (1 - t) * (1 - t);
        const x = cx + Math.cos(s.angle) * s.distance * eased;
        const y = cy + Math.sin(s.angle) * s.distance * eased * 0.8;
        const alpha = (1 - t) * (1 - t);
        const color = s.gold ? Brand.Gold : EMBER;
        if (s.star) {
          const r = s.size * 1.8;
          return <Path key={`s${i}`} fill={color} fillOpacity={alpha} d={`M ${x} ${y - r} Q ${x} ${y} ${x + r} ${y} Q ${x} ${y} ${x} ${y + r} Q ${x} ${y} ${x - r} ${y} Q ${x} ${y} ${x} ${y - r} Z`} />;
        }
        return <Circle key={`s${i}`} cx={x} cy={y} r={s.size * (1 - t * 0.4)} fill={color} fillOpacity={alpha} />;
      })}
    </Svg>
  );
}

/** A small laurel branch (five leaves along a curved stem); `mirrored` is the right-hand one. */
function Laurel({ mirrored }: { mirrored: boolean }) {
  const w = 22;
  const h = 34;
  const p0 = { x: w * 0.55, y: h };
  const p1 = { x: 0, y: h * 0.5 };
  const p2 = { x: w * 0.6, y: 0 };
  const at = (t: number) => ({
    x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * p1.x + t * t * p2.x,
    y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * p1.y + t * t * p2.y,
  });
  return (
    <Svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ transform: [{ scaleX: mirrored ? -1 : 1 }] }}>
      <Path d={`M ${p0.x} ${p0.y} Q ${p1.x} ${p1.y} ${p2.x} ${p2.y}`} stroke={EMBER} strokeOpacity={0.85} strokeWidth={1.5} fill="none" />
      {[0, 1, 2, 3, 4].map((k) => {
        const pt = at(0.12 + k * 0.19);
        const angle = -35 - k * 12;
        return (
          <G key={k} transform={`rotate(${angle} ${pt.x} ${pt.y})`}>
            <Ellipse cx={pt.x - 1 + 4} cy={pt.y - 2.2 + 2.2} rx={4} ry={2.2} fill={EMBER} />
          </G>
        );
      })}
    </Svg>
  );
}

/** Dark-orange pill with the coin and "+N coins"; the coin hops once (hop 0..1..0). */
function RewardPill({ coins, pill, hop }: { coins: number; pill: Animated.Value; hop: Animated.Value }) {
  return (
    <Animated.View
      style={[
        {
          opacity: pill,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          borderRadius: 50,
          borderWidth: 1,
          borderColor: rgba(EMBER, 0.55),
          paddingHorizontal: 20,
          paddingVertical: 10,
        },
        { backgroundImage: `linear-gradient(90deg, ${rgba(EMBER_DEEP, 0.22)}, ${rgba(EMBER, 0.14)})` } as object,
      ]}
    >
      <Animated.View style={{ transform: [{ translateY: Animated.multiply(hop, -10) }] }}>
        <CoinIcon size={24} />
      </Animated.View>
      <Text style={{ color: Brand.Gold, fontSize: 20, fontWeight: '700' }}>{`+${coins} ${coins === 1 ? 'coin' : 'coins'}`}</Text>
    </Animated.View>
  );
}
