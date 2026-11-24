import Svg, { Circle, Rect } from 'react-native-svg';

import { progressIconGeometry } from '@/domain/progressIcon';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { Coral } from '@/theme';

export { progressIconGeometry, progressOf } from '@/domain/progressIcon';

/** The app logo drawn as a progress meter: the bar fills with `progress` (0-1); changes animate over 500 ms. */
export function ProgressIcon({ progress, size = 40 }: { progress: number; size?: number }) {
  const animated = useAnimatedNumber(Math.min(1, Math.max(0, progress)), 500);
  const g = progressIconGeometry(animated);
  const percent = Math.round(Math.min(1, Math.max(0, progress)) * 100);
  return (
    <Svg width={size} height={size} viewBox="0 0 120 120" accessibilityLabel={`${percent}% of today's habits done`}>
      <Rect x={0} y={0} width={120} height={120} rx={30} fill={Coral} />
      <Rect x={18} y={54} width={84} height={12} rx={6} fill="#FFFFFF" fillOpacity={0.25} />
      {g.fillWidth > 0 && <Rect x={18} y={54} width={g.fillWidth} height={12} rx={6} fill="#FFFFFF" />}
      <Circle cx={g.tipX} cy={60} r={8} fill="#FFFFFF" />
      {g.complete && <Circle cx={g.tipX} cy={60} r={3.5} fill={Coral} />}
      {g.dot1X !== null && <Circle cx={g.dot1X} cy={60} r={4} fill="#FFFFFF" fillOpacity={0.6} />}
      {g.dot2X !== null && <Circle cx={g.dot2X} cy={60} r={3} fill="#FFFFFF" fillOpacity={0.4} />}
    </Svg>
  );
}
