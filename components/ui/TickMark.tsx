import Svg, { Path } from 'react-native-svg';

/** Small tick drawn as a path (Components.kt `TickMark`: points at 17%/50% -> 40%/73% -> 85%/27%). */
export function TickMark({ size, color = '#000', strokeWidth = 2 }: { size: number; color?: string; strokeWidth?: number }) {
  const w = size;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${w} ${w}`}>
      <Path
        d={`M ${w * 0.17} ${w * 0.5} L ${w * 0.4} ${w * 0.73} L ${w * 0.85} ${w * 0.27}`}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </Svg>
  );
}
