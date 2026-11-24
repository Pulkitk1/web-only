import { useEffect } from 'react';
import { Animated } from 'react-native';

import { timing, useValue } from '@/hooks/useAnim';
import { useTheme } from '@/hooks/useTheme';
import { Brand } from '@/theme';

/** On/off switch (SettingsScreen.kt `ToggleSwitch`): 44x26 track, 18 knob moving 4 -> 22; green when on. Purely visual: the parent row handles the press. */
export function ToggleSwitch({ value }: { value: boolean }) {
  const { isDark } = useTheme();
  const k = useValue(value ? 1 : 0);
  useEffect(() => {
    timing(k, value ? 1 : 0, 200).start();
  }, [value, k]);
  const off = isDark ? '#333333' : '#D0D0D0';
  return (
    <Animated.View
      style={{
        width: 44,
        height: 26,
        borderRadius: 13,
        backgroundColor: k.interpolate({ inputRange: [0, 1], outputRange: [off, Brand.Green] }),
      }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          top: 4,
          width: 18,
          height: 18,
          borderRadius: 9,
          backgroundColor: '#FFFFFF',
          left: k.interpolate({ inputRange: [0, 1], outputRange: [4, 22] }),
          boxShadow: '0 1px 2px rgba(0,0,0,0.3)',
        }}
      />
    </Animated.View>
  );
}
