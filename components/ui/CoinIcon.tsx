import { Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Brand } from '@/theme';

/** The gold coin drawn with concentric circles (Components.kt `CoinIcon`). */
export function CoinIcon({ size, rings = true }: { size: number; rings?: boolean }) {
  const small = size < 24;
  const r = size / 2;
  const fontSize = size * (small ? 0.62 : 0.36);
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute' }}>
        {small ? (
          <Circle cx={r} cy={r} r={r} fill={Brand.Gold} />
        ) : rings ? (
          <>
            <Circle cx={r} cy={r} r={r * 0.93} fill={Brand.Gold} fillOpacity={0.18} />
            <Circle cx={r} cy={r} r={r * 0.79} fill={Brand.Gold} fillOpacity={0.35} />
            <Circle cx={r} cy={r} r={r * 0.61} fill={Brand.Gold} />
          </>
        ) : (
          <>
            <Circle cx={r} cy={r} r={r * 0.93} fill={Brand.Gold} fillOpacity={0.25} />
            <Circle cx={r} cy={r} r={r * 0.64} fill={Brand.Gold} />
          </>
        )}
      </Svg>
      <Text style={{ color: Brand.GoldInk, fontSize, fontWeight: '800' }}>₵</Text>
    </View>
  );
}
