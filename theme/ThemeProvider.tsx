import { createContext, useCallback, useMemo, useState, type ReactNode } from 'react';

import { devicePrefs } from '@/services/devicePrefs';
import type { ThemeMode } from '@/types';
import { tokens, type Tokens } from './colors';

export type ThemeContextValue = {
  mode: ThemeMode;
  isDark: boolean;
  /** Light/dark surface tokens (mirrors Theme.kt `LocalTokens`). */
  t: Tokens;
  toggle: () => void;
  setMode: (mode: ThemeMode) => void;
};

export const ThemeContext = createContext<ThemeContextValue | null>(null);

/** The saved choice, else dark (Android: `AppViewModel.isDark` defaults to true; a saved theme overrides it). */
export const initialThemeMode = (): ThemeMode => (devicePrefs.getDark() === false ? 'light' : 'dark');

/**
 * Light/dark provider. Like Android's `toggleTheme()`, every change is saved on the device (`DevicePrefs.setDark`)
 * and restored on the next visit.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(initialThemeMode);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    devicePrefs.setDark(next === 'dark');
  }, []);

  const toggle = useCallback(() => {
    setModeState((m) => {
      const next: ThemeMode = m === 'dark' ? 'light' : 'dark';
      devicePrefs.setDark(next === 'dark');
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, isDark: mode === 'dark', t: tokens(mode === 'dark'), toggle, setMode }),
    [mode, toggle, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
