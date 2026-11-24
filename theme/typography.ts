/**
 * Typography. The Android app sets no custom FontFamily or Material Typography (verified by searching the Kotlin
 * sources), so it uses the platform default font and sets sizes/weights per Text. Presets below capture sizes that
 * actually appear in SplashScreen.kt and LoginScreen.kt; add more as screens are migrated.
 */
import type { TextStyle } from 'react-native';

export const typography = {
  /** SplashScreen.kt title: 34sp ExtraBold, letterSpacing -0.6 */
  splashTitle: { fontSize: 34, fontWeight: '800', letterSpacing: -0.6 },
  /** SplashScreen.kt subtitle: 17sp Medium, lineHeight 24 */
  splashSubtitle: { fontSize: 17, fontWeight: '500', lineHeight: 24 },
  /** LoginScreen.kt title: 30sp Bold */
  title: { fontSize: 30, fontWeight: '700' },
  /** LoginScreen.kt tagline: 14sp */
  body: { fontSize: 14, fontWeight: '400' },
  /** LoginScreen.kt button label: 15sp SemiBold */
  button: { fontSize: 15, fontWeight: '600' },
  /** LoginScreen.kt caption/divider: 12-13sp */
  caption: { fontSize: 12, fontWeight: '400' },
} satisfies Record<string, TextStyle>;
