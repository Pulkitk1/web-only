import { Stack, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ForgotPasswordScreen, LoginScreen } from '@/components/auth/AuthScreens';
import { CloudGate } from '@/components/auth/CloudGate';
import { Logo } from '@/components/Logo';
import { useTheme } from '@/hooks/useTheme';
import { installDevTools } from '@/services/devTools';
import { Toast, useToast } from '@/components/ui/overlays';
import { AppStoreProvider, useAppStore } from '@/store/AppStore';
import { SessionProvider, useSession } from '@/store/SessionStore';
import { ThemeProvider } from '@/theme';

// Dev-only: honours ?resetData=1 before the store reads the saved data.
installDevTools();

/**
 * What the user sees if a screen throws (Expo Router renders this instead of the broken layout). It is deliberately plain and never shows the
 * error, its message or a stack: those can name internal paths or data, and a visitor cannot act on them. It cannot use the theme (the
 * ThemeProvider is part of the layout that failed), so its colours are fixed.
 */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  return (
    <View style={{ flex: 1, backgroundColor: '#0B0D12', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }}>
      <Text accessibilityRole="header" style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '700' }}>
        Something went wrong
      </Text>
      <Text style={{ color: '#9AA0AA', fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 420 }}>The app hit an unexpected problem. Your data is safe. Try again, or reload the page.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={retry} style={{ borderRadius: 14, backgroundColor: '#FF6B4A', paddingVertical: 12, paddingHorizontal: 28 }}>
        <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>Try again</Text>
      </Pressable>
    </View>
  );
}

/** Login ↔ Forgot Password, shown while nobody is signed in. Unmounts (and forgets its fields) once a session starts. */
function SignedOutFlow() {
  const [forgotEmail, setForgotEmail] = useState<string | null>(null);
  return forgotEmail === null ? <LoginScreen onForgotPassword={setForgotEmail} /> : <ForgotPasswordScreen initialEmail={forgotEmail} onBack={() => setForgotEmail(null)} />;
}

/** Tells the user when a change could not be saved to their account (or is not available for it yet), then clears it. */
function SyncNoticeToast() {
  const { syncNotice, dismissSyncNotice } = useAppStore();
  const toast = useToast();
  useEffect(() => {
    if (syncNotice) {
      toast.show(syncNotice, 4500);
      dismissSyncNotice();
    }
  }, [syncNotice, dismissSyncNotice, toast]);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
      <Toast message={toast.message} />
    </View>
  );
}

function AppShell() {
  const { t } = useTheme();
  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />
      <SyncNoticeToast />
    </>
  );
}

/**
 * Chooses what to show from the session (Kotlin `SessionResolver`: account > remembered guest > login).
 * The app's data store only exists for the guest session, so an account never reads or writes the guest data
 * saved in this browser, and the guest data is never uploaded, merged or cleared by signing in or out.
 */
function SessionGate() {
  const { t, isDark } = useTheme();
  const { kind } = useSession();
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      {kind === 'loading' ? (
        <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center' }}>
          <Logo size={96} />
        </View>
      ) : kind === 'signedOut' ? (
        <SignedOutFlow />
      ) : kind === 'firebase' ? (
        <CloudGate>
          <AppShell />
        </CloudGate>
      ) : (
        <AppStoreProvider>
          <AppShell />
        </AppStoreProvider>
      )}
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <SessionProvider>
        <SessionGate />
      </SessionProvider>
    </ThemeProvider>
  );
}
