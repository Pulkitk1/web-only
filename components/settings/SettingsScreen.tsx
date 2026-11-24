/**
 * Settings (android SettingsScreen.kt, signed-out "guest" state): profile card, BACKUP, NOTIFICATIONS, HABITS, APP and
 * ACCOUNT sections, plus the Privacy Policy and "Back Up Your Progress" sheets. Only what exists in Kotlin is shown.
 * Signed-in accounts also get Delete Account (password + typing DELETE, see `domain/accountDeletion.ts`). Web differences from Android: no
 * Feedback row (not ready for the web), and no notification switches (the web app cannot deliver reminders), only an honest note.
 */
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, Text, View } from 'react-native';

import { GhostButton, GradientButton } from '@/components/ui/Buttons';
import { CloseButton } from '@/components/ui/CloseButton';
import { Icon } from '@/components/ui/Icon';
import { BottomSheet, Toast, useToast } from '@/components/ui/overlays';
import { SquareIconButton } from '@/components/ui/SquareIconButton';
import { DeleteAccountSheet } from '@/components/settings/DeleteAccountSheet';
import { APP_VERSION, PRIVACY_POLICY, backupSheetCopy, supportContact } from '@/domain/settingsContent';
import { archivedHabits, archivedRowSubtitle } from '@/domain/archive';
import { useTheme } from '@/hooks/useTheme';
import { useGuestImport } from '@/components/migration/GuestImportFlow';
import { useSession } from '@/store/SessionStore';
import { guestImportEnabled } from '@/services/guestImportFlag';
import { useAppStore } from '@/store/AppStore';
import { Brand } from '@/theme';
import { withAlpha } from '@/utils/color';


type IconName = React.ComponentProps<typeof Icon>['name'];

function Divider() {
  const { t } = useTheme();
  return <View style={{ height: 1, backgroundColor: t.border }} />;
}

function Section({ title, borderColor, children }: { title: string; borderColor?: string; children: ReactNode }) {
  const { t } = useTheme();
  return (
    <View>
      <Text style={{ color: t.muted, fontSize: 11, fontWeight: '600', letterSpacing: 0.7, paddingLeft: 4, marginBottom: 8 }}>{title}</Text>
      <View style={{ borderRadius: 16, backgroundColor: t.card, borderWidth: 1, borderColor: borderColor ?? t.border, overflow: 'hidden' }}>{children}</View>
    </View>
  );
}

function IconTile({ icon, color, danger, size = 15 }: { icon: IconName; color: string; danger?: boolean; size?: number }) {
  const { isDark } = useTheme();
  return (
    <View style={{ width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: danger ? withAlpha(Brand.Red, 0.12) : isDark ? '#2A2A2A' : '#EFEFEF' }}>
      <Icon name={icon} size={size} color={color} />
    </View>
  );
}

function SettingsRow({ icon, iconColor, label, sub, danger, labelAlpha = 1, onPress, trailing }: { icon: IconName; iconColor: string; label: string; sub?: string; danger?: boolean; labelAlpha?: number; onPress?: () => void; trailing?: ReactNode }) {
  const { t } = useTheme();
  const body = (
    <>
      <IconTile icon={icon} color={iconColor} danger={danger} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: danger ? Brand.Red : t.text, fontSize: 14, fontWeight: '500', opacity: labelAlpha }}>{label}</Text>
        {sub ? (
          <Text numberOfLines={1} style={{ color: t.muted, fontSize: 11 }}>
            {sub}
          </Text>
        ) : null}
      </View>
      {trailing !== undefined ? trailing : onPress ? <Icon name="keyboard-arrow-right" size={18} color={danger ? Brand.Red : t.muted} /> : null}
    </>
  );
  const style = { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 } as const;
  return onPress ? (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={style}>
      {body}
    </Pressable>
  ) : (
    <View style={style}>{body}</View>
  );
}

function ProfileCard({ onSignIn, email, onSignOut }: { onSignIn: () => void; email: string | null; onSignOut: () => void }) {
  const { t } = useTheme();
  if (email !== null) return <AccountCard email={email} onSignOut={onSignOut} />;
  const accent = Brand.Indigo;
  return (
    <View style={{ borderRadius: 16, backgroundColor: t.card, borderWidth: 1, borderColor: t.border, overflow: 'hidden' }}>
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundImage: `radial-gradient(circle at 0% 0%, ${withAlpha(accent, 0.1)}, transparent 700px)` } as object} />
      <View style={{ padding: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
          <View style={{ width: 60, height: 60, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(accent, 0.18), borderWidth: 2, borderColor: withAlpha(accent, 0.4) }}>
            <Text style={{ fontSize: 26 }}>👤</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>
              Guest
            </Text>
            <Text numberOfLines={1} style={{ color: t.muted, fontSize: 12 }}>
              Data stored on this device only
            </Text>
            <Text style={{ alignSelf: 'flex-start', marginTop: 6, color: Brand.IndigoLight, fontSize: 10, fontWeight: '700', letterSpacing: 0.3, borderRadius: 6, backgroundColor: withAlpha(accent, 0.15), borderWidth: 1, borderColor: withAlpha(accent, 0.35), paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' }}>GUEST MODE</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Sign In" onPress={onSignIn} style={{ borderRadius: 12, backgroundColor: accent, paddingHorizontal: 14, paddingVertical: 8 }}>
            <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>Sign In</Text>
          </Pressable>
        </View>
        <View style={{ marginTop: 16, flexDirection: 'row', gap: 12, borderRadius: 12, backgroundColor: withAlpha(accent, 0.08), borderWidth: 1, borderColor: withAlpha(accent, 0.3), paddingHorizontal: 16, paddingVertical: 12 }}>
          <Text style={{ fontSize: 18 }}>📱</Text>
          <View style={{ flex: 1 }}>
            <Text style={{ color: t.text, fontSize: 12, fontWeight: '600' }}>Stored only on this device</Text>
            <Text style={{ color: t.muted, fontSize: 11, marginTop: 2 }}>Guest data isn&apos;t backed up. It may be lost if you uninstall the app or clear its storage.</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

/** Signed-in profile (SettingsScreen.kt `ProfileCard`, not guest): avatar with a green tick, name, email, SIGNED IN, log-out button. */
function AccountCard({ email, onSignOut }: { email: string; onSignOut: () => void }) {
  const { t } = useTheme();
  const accent = Brand.Green;
  return (
    <View style={{ borderRadius: 16, backgroundColor: t.card, borderWidth: 1, borderColor: t.border, overflow: 'hidden', padding: 20 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
        <View style={{ width: 60, height: 60, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(accent, 0.13), borderWidth: 2, borderColor: withAlpha(accent, 0.33) }}>
          <Text style={{ fontSize: 26 }}>✉️</Text>
          <View style={{ position: 'absolute', right: -4, bottom: -4, width: 18, height: 18, borderRadius: 9, backgroundColor: Brand.Green, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="check" size={11} color="#000000" />
          </View>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={1} testID="profile-name" style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>
            {email.split('@')[0] || 'User'}
          </Text>
          <Text numberOfLines={1} testID="profile-email" style={{ color: t.muted, fontSize: 12 }}>
            {email}
          </Text>
          <Text style={{ alignSelf: 'flex-start', marginTop: 6, color: Brand.Green, fontSize: 10, fontWeight: '700', letterSpacing: 0.3, borderRadius: 6, backgroundColor: withAlpha(accent, 0.1), borderWidth: 1, borderColor: withAlpha(accent, 0.2), paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' }}>SIGNED IN</Text>
        </View>
        <SquareIconButton onPress={onSignOut} size={36} label="Sign out">
          <Icon name="logout" size={15} color={Brand.Red} />
        </SquareIconButton>
      </View>
    </View>
  );
}

function PolicySection({ title, body }: { title: string; body: string }) {
  const { t } = useTheme();
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>{title}</Text>
      <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19 }}>{body}</Text>
    </View>
  );
}

export function SettingsScreen() {
  const { t, isDark, toggle } = useTheme();
  const store = useAppStore();
  const router = useRouter();
  const toast = useToast();
  const session = useSession();
  const guestImport = useGuestImport();
  const signedIn = session.kind === 'firebase';
  const [showLogout, setShowLogout] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true; // set again on every mount: React's development StrictMode runs the cleanup once before the real mount
    return () => { mounted.current = false; };
  }, []);
  const support = supportContact();
  const backup = backupSheetCopy(guestImportEnabled());

  const back = () => (router.canGoBack() ? router.back() : router.replace('/habits'));
  const archivedCount = archivedHabits(store.habits).length;

  /** The deletion is stopped and reported by the session, which also stops the app listening to the account while it runs. */
  const deleteAccount = async (password: string) => {
    setDeleteError(null);
    const result = await session.controller.deleteAccount(password);
    // On success the app is already on the login screen; after a later failure the notice below shows it. Only a wrong password stays in the sheet.
    if (!mounted.current) return;
    if (!result.ok && result.stage === 'password') setDeleteError(result.message);
    else if (!result.ok) setShowDelete(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 }}>
          <SquareIconButton onPress={back} size={36} label="Back">
            <Icon name="arrow-back" size={18} color={t.text} />
          </SquareIconButton>
          <Text accessibilityRole="header" style={{ flex: 1, color: t.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.4 }}>
            Settings
          </Text>
          <SquareIconButton onPress={toggle} size={36} label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
            {isDark ? <Icon name="dark-mode" size={16} color={Brand.Purple} /> : <Icon name="light-mode" size={16} color={Brand.Amber} />}
          </SquareIconButton>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 20 }} showsVerticalScrollIndicator={false}>
          <ProfileCard onSignIn={() => setShowSignIn(true)} email={signedIn ? session.email ?? '' : null} onSignOut={() => setShowLogout(true)} />

          {!signedIn && (
            <Section title="BACKUP">
              <SettingsRow icon="email" iconColor={Brand.Indigo} label="Sign in to back up your progress" sub="Guest data is only on this device" onPress={() => setShowSignIn(true)} />
            </Section>
          )}

          {signedIn && guestImport?.canImport && (
            <Section title="GUEST DATA">
              <SettingsRow
                icon="email"
                iconColor={Brand.Indigo}
                label={guestImport.pending ? 'Finish importing guest habits' : 'Import guest habits'}
                sub="Habits and history from this device. Coins and rewards aren't imported"
                onPress={guestImport.open}
              />
            </Section>
          )}

          <Section title="NOTIFICATIONS">
            <SettingsRow icon="notifications-none" iconColor={withAlpha(Brand.Amber, 0.6)} label="Reminders & Streak Alerts" sub="Not available on the web yet" />
          </Section>

          <Section title="HABITS">
            <SettingsRow icon="archive" iconColor={Brand.Blue} label="Archived Habits" sub={archivedRowSubtitle(archivedCount)} onPress={() => router.push('/settings/archived')} />
          </Section>

          <Section title="APP">
            <SettingsRow icon="security" iconColor={Brand.Purple} label="Privacy Policy" onPress={() => setShowPrivacy(true)} />
            <Divider />
            <SettingsRow
              icon="help-outline"
              iconColor={Brand.BlueAlt}
              label="Help & Support"
              sub={support.sub}
              onPress={() => (support.href ? void Linking.openURL(support.href) : toast.show(support.message ?? '', 3500))}
            />
            <Divider />
            <SettingsRow icon="person" iconColor={t.muted} label="App Version" sub={`v${APP_VERSION}`} trailing={<Text style={{ color: t.muted, fontSize: 12 }}>{`v${APP_VERSION}`}</Text>} />
          </Section>

          <Section title="ACCOUNT" borderColor={withAlpha(Brand.Red, 0.2)}>
            {signedIn ? (
              <>
                <SettingsRow icon="logout" iconColor={Brand.Red} label="Log Out" sub={`Signed in as ${session.email ?? ''}`} danger onPress={() => setShowLogout(true)} trailing={null} />
                <Divider />
                <SettingsRow icon="delete" iconColor={Brand.Red} label="Delete Account" sub="Permanently remove your account and its data" danger onPress={() => { setDeleteError(null); setShowDelete(true); }} />
              </>
            ) : (
              <SettingsRow icon="logout" iconColor={withAlpha(Brand.Red, 0.45)} label="Log Out" sub="You're browsing as Guest" danger labelAlpha={0.45} trailing={null} />
            )}
          </Section>
        </ScrollView>
      </View>

      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <BottomSheet visible={showPrivacy} onDismiss={() => setShowPrivacy(false)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 12 }}>
            <Text style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '700' }}>Privacy Policy</Text>
            <CloseButton onPress={() => setShowPrivacy(false)} />
          </View>
          <View style={{ gap: 14, paddingBottom: 24 }}>
            {PRIVACY_POLICY.map(([title, body]) => (
              <PolicySection key={title} title={title} body={body} />
            ))}
          </View>
        </BottomSheet>
        <BottomSheet visible={showLogout} onDismiss={() => setShowLogout(false)}>
          <View style={{ alignItems: 'center', gap: 10, paddingTop: 20, paddingBottom: 16 }}>
            <Text accessibilityRole="header" style={{ color: t.text, fontSize: 19, fontWeight: '700' }}>Log Out?</Text>
            <Text style={{ color: t.muted, fontSize: 13, textAlign: 'center' }}>{"You'll be signed out of your account.\nYour local data won't be deleted."}</Text>
          </View>
          <GradientButton
            text="Log Out"
            onPress={() => {
              setShowLogout(false);
              void session.controller.signOut();
            }}
            colors={[Brand.Red, withAlpha(Brand.Red, 0.85)]}
            contentColor="#FFFFFF"
          />
          <GhostButton text="Cancel" onPress={() => setShowLogout(false)} style={{ marginTop: 8, marginBottom: 8 }} />
        </BottomSheet>
        <BottomSheet visible={showSignIn} onDismiss={() => setShowSignIn(false)}>
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 12 }}>
            <Text style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '700' }}>Back Up Your Progress</Text>
            <CloseButton onPress={() => setShowSignIn(false)} />
          </View>
          <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19, marginBottom: 14 }}>{backup.intro}</Text>
          <Text style={{ color: withAlpha(Brand.Blue, 0.8), fontSize: 12, lineHeight: 17, marginBottom: 20 }}>{backup.detail}</Text>
          <GradientButton
            text="Continue"
            onPress={() => {
              // Leaves guest mode for the login screen; the guest's data stays in this browser untouched.
              setShowSignIn(false);
              session.controller.leaveGuest();
            }}
            colors={[Brand.Indigo, withAlpha(Brand.Indigo, 0.8)]}
            contentColor="#FFFFFF"
          />
          <GhostButton text="Not Now" onPress={() => setShowSignIn(false)} style={{ marginTop: 8, marginBottom: 8 }} />
        </BottomSheet>
        <DeleteAccountSheet visible={showDelete} account={session.email ?? 'this account'} deleting={session.busy} error={deleteError} onDelete={deleteAccount} onDismiss={() => setShowDelete(false)} />
        <Toast message={toast.message} />
      </View>
    </View>
  );
}
