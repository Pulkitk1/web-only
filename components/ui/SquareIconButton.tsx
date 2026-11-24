import type { ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/useTheme';

type Props = {
  onPress: () => void;
  size?: number;
  background?: string;
  borderColor?: string;
  label: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
};

/** Rounded square icon button used in every top bar (Components.kt `SquareIconButton`). */
export function SquareIconButton({ onPress, size = 34, background, borderColor, label, children, style }: Props) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: 12,
          backgroundColor: background ?? t.chip,
          borderWidth: 1,
          borderColor: borderColor ?? t.border,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.7 : 1,
        },
        style,
      ]}
    >
      {children}
    </Pressable>
  );
}
