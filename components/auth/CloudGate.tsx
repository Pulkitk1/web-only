/**
 * Loads the signed-in account's data, then mounts the app with it. Shows a spinner while loading and a clear message if
 * the read is denied or fails (with Try again / Sign out), so the habit screens only ever show an account's own, fully
 * loaded data. Keyed by uid so switching accounts always starts from a clean state.
 */
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';

import { AccountNotice } from '@/components/auth/AccountNotice';
import { Logo } from '@/components/Logo';
import type { CloudData } from '@/domain/cloudMapping';
import { createHabitWriter } from '@/services/habitWriter';
import { AppStoreProvider } from '@/store/AppStore';
import { GuestImportProvider } from '@/components/migration/GuestImportFlow';
import { activeLedgerRunner, activeMigration, activeReader, activeWriter, useCloudData } from '@/store/CloudData';
import { useSession } from '@/store/SessionStore';
import { useEnsureProfile } from '@/store/useEnsureProfile';
import { useTheme } from '@/hooks/useTheme';
import { Coral } from '@/theme';

function Centered({ children }: { children: ReactNode }) {
  const { t } = useTheme();
  return <View style={{ flex: 1, backgroundColor: t.bg, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }}>{children}</View>;
}

function Loaded({ uid, email, data, fromCache, noProfile, children }: { uid: string; email: string; data: CloudData; fromCache: boolean; noProfile: boolean; children: ReactNode }) {
  // The source is fixed for the signed-in user (its first data seeds the store); later listener data arrives as the feed.
  const first = useRef(data).current;
  const cloud = useMemo(() => ({ uid, initial: first, writer: createHabitWriter(activeWriter(), activeReader(), uid), ledgerRunner: activeLedgerRunner() }), [uid, first]);
  const feed = useMemo(() => ({ data, fromCache }), [data, fromCache]);
  const migration = useMemo(() => activeMigration(), []);
  // A new account has no profile (so no wallet) until this creates it; the welcome freeze is then recorded by the store.
  useEnsureProfile({ uid, email, profileExists: data.profileExists || noProfile, fromCache, backend: migration });
  return (
    <AppStoreProvider cloud={cloud} feed={feed}>
      <GuestImportProvider uid={uid} email={email} backend={migration}>
        {children}
      </GuestImportProvider>
    </AppStoreProvider>
  );
}

/**
 * Shown while an account is being deleted. The app tree (and with it every live listener on the account) is unmounted for the duration, so
 * nothing can write to the account or react to its documents disappearing; the page is also protected from being closed by accident.
 */
function DeletingScreen() {
  const { t } = useTheme();
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  return (
    <Centered>
      <Logo size={72} />
      <ActivityIndicator accessibilityLabel="Deleting your account" color={Coral} />
      <Text accessibilityRole="header" style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>Deleting your account…</Text>
      <Text accessibilityRole="alert" style={{ color: t.muted, fontSize: 13, lineHeight: 19, textAlign: 'center', maxWidth: 380 }}>
        Please keep this page open until it finishes. This can take a moment if you have a lot of history.
      </Text>
    </Centered>
  );
}

export function CloudGate({ children }: { children: ReactNode }) {
  const { t } = useTheme();
  const { uid, email, controller, deleting, notice } = useSession();
  // After a deletion that removed the data but not the login, the account is empty on purpose: no new profile (and no welcome rewards) is created
  // until the page is loaded again, so the screen does not contradict "your data was deleted".
  const deletionFailed = useRef<string | null>(null);
  if (!uid) deletionFailed.current = null;
  else if (notice?.kind === 'error') deletionFailed.current = uid;
  // While deleting, no listener is kept on the account (an empty id means "watch nothing", as when signed out).
  const { state, reload } = useCloudData(deleting ? '' : uid ?? '');

  if (deleting) return <DeletingScreen />;

  if (!uid || state.status === 'loading') {
    return (
      <Centered>
        <Logo size={72} />
        <ActivityIndicator accessibilityLabel="Loading your data" color={Coral} />
        <Text style={{ color: t.muted, fontSize: 13 }}>{email ? `Loading ${email}…` : 'Loading…'}</Text>
      </Centered>
    );
  }
  if (state.status === 'failed') {
    return (
      <Centered>
        <Text accessibilityRole="header" style={{ color: t.text, fontSize: 20, fontWeight: '700' }}>
          {state.failure.kind === 'permission-denied' ? 'Access denied' : "Couldn't load your data"}
        </Text>
        <Text accessibilityRole="alert" style={{ color: t.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', maxWidth: 420 }}>
          {state.failure.message}
        </Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Try again" onPress={reload} style={{ borderRadius: 14, backgroundColor: Coral, paddingVertical: 12, paddingHorizontal: 28 }}>
          <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>Try again</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Sign out" onPress={() => void controller.signOut()}>
          <Text style={{ color: Coral, fontSize: 14, fontWeight: '600' }}>Sign out</Text>
        </Pressable>
      </Centered>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {/* after a failed deletion the app comes back on Home, so the reason is shown above whatever screen the user is on */}
      <AccountNotice />
      <View style={{ flex: 1 }}>
        <Loaded key={uid} uid={uid} email={email ?? ''} data={state.data} fromCache={state.fromCache} noProfile={deletionFailed.current === uid}>
          {children}
        </Loaded>
      </View>
    </View>
  );
}
