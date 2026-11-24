/**
 * Colour tokens ported from the Android app (source of truth):
 *   android/app/src/main/java/com/habittracker/app/ui/theme/Theme.kt   -> Brand, Tokens
 *   android/app/src/main/res/values/ic_launcher_background.xml          -> Coral (#F26B4E)
 *   android/app/src/main/res/values/themes.xml                          -> SplashCream
 *   ui/screens/LoginScreen.kt (Accent) and ui/screens/SplashScreen.kt   -> Coral, Charcoal, Peach...
 * Hex values are copied as-is; nothing here is new design.
 */

/** Fixed accent colours shared by every screen (Theme.kt `Brand`). */
export const Brand = {
  Gold: '#F2D36B',
  GoldInk: '#7A5900',
  Green: '#5FE3A1',
  GreenAlt: '#4ADE80',
  OnGreen: '#0F1F14',
  Blue: '#4DA3FF',
  BlueAlt: '#60A5FA',
  Red: '#FF5A5A',
  Error: '#F87171',
  Yellow: '#FBBF24',
  CalendarYellow: '#F2E58A',
  Orange: '#FF9500',
  Indigo: '#6366F1',
  IndigoLight: '#818CF8',
  Purple: '#C084FC',
  Amber: '#F59E0B',
} as const;

/**
 * The Consisto orange/coral: launcher icon background, the logo tile, and the login accent.
 * (Distinct from `Brand.Orange`, which Theme.kt defines for streak/flame accents.)
 */
export const Coral = '#F26B4E';

/** Splash-screen palette from SplashScreen.kt / themes.xml. */
export const Splash = {
  Cream: '#FFF8F1',
  Charcoal: '#2B2320',
  Gray: '#7A6F69',
  PeachLight: '#FFE3D4',
  Peach: '#FFC9B0',
  DotPeach: '#FFC9B3',
} as const;

/** Light/dark dependent surface colours (Theme.kt `Tokens`). Alpha colours are rgba() strings. */
export type Tokens = {
  isDark: boolean;
  bg: string;
  text: string;
  muted: string;
  border: string;
  card: string;
  sheet: string;
  field: string;
  option: string;
  chip: string;
  closeBg: string;
  menu: string;
  nav: string;
  disabled: string;
  track: string;
  faint: string;
};

export const darkTokens: Tokens = {
  isDark: true,
  bg: '#121212',
  text: '#FFFFFF',
  muted: '#9E9E9E',
  border: 'rgba(255,255,255,0.07)',
  card: '#1E1E1E',
  sheet: '#1A1A24',
  field: '#0F0F18',
  option: '#1E1E1E',
  chip: '#2A2A2A',
  closeBg: '#2A2A3A',
  menu: '#252535',
  nav: '#1A1A1A',
  disabled: '#2A2A2A',
  track: '#2A2A2A',
  faint: 'rgba(255,255,255,0.08)',
};

export const lightTokens: Tokens = {
  isDark: false,
  bg: '#F5F5F5',
  text: '#111111',
  muted: '#888888',
  border: 'rgba(0,0,0,0.08)',
  card: '#FFFFFF',
  sheet: '#FFFFFF',
  field: '#F5F5F5',
  option: '#F5F5F5',
  chip: '#E8E8E8',
  closeBg: '#F0F0F0',
  menu: '#FFFFFF',
  nav: '#FFFFFF',
  disabled: '#E0E0E0',
  track: '#E5E5E5',
  faint: 'rgba(0,0,0,0.07)',
};

export const tokens = (isDark: boolean): Tokens => (isDark ? darkTokens : lightTokens);
