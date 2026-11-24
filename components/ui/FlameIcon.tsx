import Svg, { Path } from 'react-native-svg';

/** The flame outline + flame-shaped cutout (24x24), identical to android FlameIcon.kt `outerFlame`/`innerFlame`. */
export const FLAME_PATH =
  'M12 22.5C7.6 22.5 4.5 19.4 4.5 15.3C4.5 12.1 6.3 9.9 7.9 8.2C8.1 10.1 9 11.3 10.3 11.9C9.9 7.6 11.6 4 14.2 1.5C14.6 5 16.6 7.2 18 9.4C19 11 19.5 13 19.5 15.3C19.5 19.4 16.4 22.5 12 22.5Z' +
  'M12 20.4C13.8 20.4 15.1 19.1 15.1 17.5C15.1 15.6 13.2 14.5 12.4 12.6C10.6 14.4 8.9 15.7 8.9 17.5C8.9 19.1 10.2 20.4 12 20.4Z';

/** Solid flame with a flame-shaped cutout, single colour: tint it with `color`. */
export function FlameIcon({ size = 24, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={FLAME_PATH} fill={color} fillRule="evenodd" />
    </Svg>
  );
}

const INNER_ONLY =
  'M12 20.4C13.8 20.4 15.1 19.1 15.1 17.5C15.1 15.6 13.2 14.5 12.4 12.6C10.6 14.4 8.9 15.7 8.9 17.5C8.9 19.1 10.2 20.4 12 20.4Z';

/** Orange flame with a yellow centre, whatever the habit's colour (FlameIcon.kt `FlameColorIcon`: #FF6B00 / #FFCA28). */
export function FlameColorIcon({ size = 24 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={FLAME_PATH} fill="#FF6B00" fillRule="evenodd" />
      <Path d={INNER_ONLY} fill="#FFCA28" />
    </Svg>
  );
}
