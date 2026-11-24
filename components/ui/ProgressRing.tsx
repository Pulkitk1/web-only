import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { useTheme } from '@/hooks/useTheme';

/** Completion ring on each habit card (HabitsScreen.kt `ProgressRing`): 3.5 stroke, round cap, starts at 12 o'clock. */
export function ProgressRing({ percent, color, track, size }: { percent: number; color: string; track: string; size: number }) {
  const { t } = useTheme();
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        {percent > 0 && (
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${(c * percent) / 100} ${c}`}
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        )}
      </Svg>
      <Text numberOfLines={1} style={{ color: t.text, fontSize: 10, fontWeight: '600' }}>
        {percent}%
      </Text>
    </View>
  );
}
