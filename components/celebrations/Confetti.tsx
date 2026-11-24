import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import { Brand } from '@/theme';

type Props = { colors?: string[]; pieces?: number; durationMs?: number };

/**
 * One-shot confetti burst (Components.kt `Confetti`): pieces start near the top centre, are launched up, pulled down by
 * gravity, spin, and fade over the last quarter. Drawn on one SVG; progress is driven by requestAnimationFrame.
 */
export function Confetti({ colors = [Brand.Green, Brand.Gold, Brand.Purple], pieces = 70, durationMs = 2400 }: Props) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [t, setT] = useState(0);
  const specs = useMemo(
    () =>
      Array.from({ length: pieces }, () => ({
        spread: Math.random() * 2 - 1,
        speed: 0.55 + Math.random() * 0.6,
        rot: Math.random() * 360,
        spin: (Math.random() - 0.5) * 1440,
        pick: Math.random(),
        scale: 0.6 + Math.random() * 0.8,
      })),
    [pieces],
  );

  useEffect(() => {
    const start = Date.now();
    let raf = 0;
    const step = () => {
      const k = Math.min(1, (Date.now() - start) / durationMs);
      setT(k);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [durationMs]);

  const { w, h } = size;
  const alpha = t > 0.75 ? (1 - t) / 0.25 : 1;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
      {w > 0 && (
        <Svg width={w} height={h}>
          {specs.map((s, i) => {
            const x = w / 2 + s.spread * w * 0.55 * t;
            // Launched up, then pulled down: y(t) = start - v*t + g*t^2
            const y = h * 0.28 - s.speed * h * 0.55 * t + h * 1.25 * t * t;
            const color = colors[Math.min(Math.floor(s.pick * colors.length), colors.length - 1)];
            const pw = 9 * s.scale;
            const ph = 5 * s.scale;
            return <Rect key={i} x={x - pw / 2} y={y - ph / 2} width={pw} height={ph} fill={color} fillOpacity={alpha} transform={`rotate(${s.rot + s.spin * t} ${x} ${y})`} />;
          })}
        </Svg>
      )}
    </View>
  );
}
