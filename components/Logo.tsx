import { Image, type ImageStyle, type StyleProp } from 'react-native';

type Props = { size?: number; style?: StyleProp<ImageStyle> };

/** The Consisto logo tile (copied from android/store/play-store-icon-512.png). */
export function Logo({ size = 112, style }: Props) {
  return (
    <Image
      source={require('@/assets/images/logo.png')}
      accessibilityLabel="Consisto logo"
      style={[{ width: size, height: size, borderRadius: size * 0.25 }, style]}
    />
  );
}
