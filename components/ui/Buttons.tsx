import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { useTheme } from '@/hooks/useTheme';

type GradientProps = {
  text: string;
  onPress: () => void;
  colors: [string, string];
  contentColor: string;
  enabled?: boolean;
  radius?: number;
  verticalPadding?: number;
  fontSize?: number;
  style?: StyleProp<ViewStyle>;
};

/** Full-width call-to-action with gradient fill; greys out when disabled (Components.kt `GradientButton`). */
export function GradientButton({
  text,
  onPress,
  colors,
  contentColor,
  enabled = true,
  radius = 18,
  verticalPadding = 15,
  fontSize = 16,
  style,
}: GradientProps) {
  const { t } = useTheme();
  const fill = enabled
    ? ({ backgroundImage: `linear-gradient(135deg, ${colors[0]}, ${colors[1]})`, boxShadow: `0 4px 14px ${colors[0]}55` } as object)
    : { backgroundColor: t.disabled };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={({ pressed }) => [
        { width: '100%', borderRadius: radius, paddingVertical: verticalPadding, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 },
        fill,
        style,
      ]}
    >
      <Text style={{ color: enabled ? contentColor : t.muted, fontSize, fontWeight: '700', textAlign: 'center' }}>{text}</Text>
    </Pressable>
  );
}

type GhostProps = {
  text: string;
  onPress: () => void;
  bordered?: boolean;
  fontSize?: number;
  verticalPadding?: number;
  style?: StyleProp<ViewStyle>;
};

/** Transparent outlined secondary button (Components.kt `GhostButton`). */
export function GhostButton({ text, onPress, bordered = true, fontSize = 14, verticalPadding = 12, style }: GhostProps) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        { width: '100%', borderRadius: 14, paddingVertical: verticalPadding, alignItems: 'center', borderWidth: bordered ? 1 : 0, borderColor: t.border, opacity: pressed ? 0.7 : 1 },
        style,
      ]}
    >
      <Text style={{ color: t.muted, fontSize, fontWeight: '500' }}>{text}</Text>
    </Pressable>
  );
}

/** Small uppercase field caption (Components.kt `FieldLabel`). */
export function FieldLabel({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) {
  const { t } = useTheme();
  return (
    <View style={[{ marginBottom: 8 }, style]}>
      <Text style={{ color: t.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.9 }}>{children}</Text>
    </View>
  );
}
