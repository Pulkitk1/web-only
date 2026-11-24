/**
 * Login, Forgot Password and the signed-in holding screen (android LoginScreen.kt: `LoginContent`,
 * `ForgotPasswordContent`). Same layout, wording and validation as Kotlin. Kotlin's login is always dark with a coral
 * accent; here dark uses those exact colours and light uses the app's light tokens with the same coral accent.
 */
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Logo } from '@/components/Logo';
import { Icon } from '@/components/ui/Icon';
import { canSubmitCredentials, isValidEmail } from '@/domain/auth';
import { useTheme } from '@/hooks/useTheme';
import { useSession } from '@/store/SessionStore';
import { Coral } from '@/theme';

const ERROR = '#FF6B6B';

/** Colours: Kotlin's login palette in dark; the shared light tokens in light. */
function usePalette() {
  const { t, isDark } = useTheme();
  return isDark
    ? { bg: '#0B0D12', field: '#14171E', border: '#2A2F3A', muted: '#9CA3AF', text: '#FFFFFF' }
    : { bg: t.bg, field: '#FFFFFF', border: '#D9D9D9', muted: t.muted, text: t.text };
}

function Shell({ children }: { children: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ width: '100%', maxWidth: 420, alignItems: 'center' }}>{children}</View>
      </ScrollView>
    </View>
  );
}

function Field(props: { value: string; onChange: (v: string) => void; placeholder: string; label: string; icon: 'email' | 'lock'; secure?: boolean; trailing?: ReactNode; onSubmit?: () => void; inputMode?: 'email' | 'text' }) {
  const p = usePalette();
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ width: '100%', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: p.field, borderRadius: 14, borderWidth: 1.5, borderColor: focused ? Coral : p.border, paddingHorizontal: 14 }}>
      <Icon name={props.icon} size={18} color={p.muted} />
      <TextInput
        value={props.value}
        onChangeText={props.onChange}
        placeholder={props.placeholder}
        placeholderTextColor={p.muted}
        accessibilityLabel={props.label}
        secureTextEntry={props.secure}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete={props.secure ? 'current-password' : 'email'}
        inputMode={props.inputMode}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={props.onSubmit}
        style={{ flex: 1, minWidth: 0, color: p.text, fontSize: 15, paddingVertical: 14, outlineStyle: 'none' } as object}
        cursorColor={Coral}
      />
      {props.trailing}
    </View>
  );
}

function PrimaryButton({ label, loading, enabled, onPress }: { label: string; loading: boolean; enabled: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled || loading, busy: loading }}
      disabled={!enabled || loading}
      onPress={onPress}
      style={{ width: '100%', borderRadius: 14, backgroundColor: Coral, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', opacity: enabled || loading ? 1 : 0.55 }}
    >
      {loading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '600' }}>{label}</Text>}
    </Pressable>
  );
}

function SectionLabel({ children }: { children: string }) {
  return <Text style={{ alignSelf: 'stretch', color: Coral, fontSize: 12, fontWeight: '700', letterSpacing: 0.6, marginBottom: 10 }}>{children}</Text>;
}

function Link({ label, onPress, disabled, style }: { label: string; onPress: () => void; disabled?: boolean; style?: object }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={onPress} style={style}>
      <Text style={{ color: Coral, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

// ─── Login ───────────────────────────────────────────────────────────────────

export function LoginScreen({ onForgotPassword }: { onForgotPassword: (email: string) => void }) {
  const p = usePalette();
  const { busy, error, controller, notice } = useSession();
  const [createAccount, setCreateAccount] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const canSubmit = canSubmitCredentials(email, password, busy);
  const submit = () => canSubmit && void controller.authenticate(email.trim(), password, createAccount);

  return (
    <Shell>
      <Logo size={96} style={{ marginTop: 8 }} />
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 30, fontWeight: '700', marginTop: 12 }}>
        Habit Tracker
      </Text>
      <Text style={{ color: p.muted, fontSize: 14, textAlign: 'center', marginTop: 6, marginBottom: notice ? 16 : 28 }}>Build better habits, one day at a time.</Text>

      {notice && (
        // e.g. "Your account and all of its data were deleted." after a successful deletion
        <View accessibilityRole="alert" style={{ alignSelf: 'stretch', flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderRadius: 12, borderWidth: 1, borderColor: notice.kind === 'success' ? '#34D39955' : ERROR + '55', backgroundColor: notice.kind === 'success' ? '#34D3991A' : ERROR + '1A', paddingHorizontal: 14, paddingVertical: 10, marginBottom: 20 }}>
          <Text style={{ flex: 1, color: p.text, fontSize: 13, lineHeight: 18 }}>{notice.message}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss message" onPress={() => controller.dismissNotice()}>
            <Icon name="close" size={16} color={p.muted} />
          </Pressable>
        </View>
      )}

      <SectionLabel>{createAccount ? 'CREATE ACCOUNT' : 'SIGN IN'}</SectionLabel>
      <Field value={email} onChange={(v) => { setEmail(v); controller.clearError(); }} placeholder="you@example.com" label="Email" icon="email" inputMode="email" onSubmit={submit} />
      <View style={{ height: 12 }} />
      <Field
        value={password}
        onChange={(v) => { setPassword(v); controller.clearError(); }}
        placeholder="Password (at least 6 characters)"
        label="Password"
        icon="lock"
        secure={!showPassword}
        onSubmit={submit}
        trailing={
          <Pressable accessibilityRole="button" accessibilityLabel={showPassword ? 'Hide password' : 'Show password'} onPress={() => setShowPassword((s) => !s)}>
            <Icon name={showPassword ? 'visibility-off' : 'visibility'} size={20} color={p.muted} />
          </Pressable>
        }
      />
      {!createAccount && <Link label="Forgot Password?" disabled={busy} onPress={() => { controller.clearError(); onForgotPassword(email.trim()); }} style={{ alignSelf: 'flex-end', marginTop: 10, paddingHorizontal: 4, paddingVertical: 2 }} />}
      {error && (
        <Text accessibilityRole="alert" style={{ alignSelf: 'stretch', color: ERROR, fontSize: 12, marginTop: 10 }}>
          {error}
        </Text>
      )}

      <View style={{ height: 20 }} />
      <PrimaryButton label={createAccount ? 'Create account' : 'Sign in'} loading={busy} enabled={canSubmit} onPress={submit} />

      <View style={{ flexDirection: 'row', marginTop: 18, alignItems: 'center' }}>
        <Text style={{ color: p.muted, fontSize: 13 }}>{createAccount ? 'Already have an account? ' : 'New here? '}</Text>
        <Link label={createAccount ? 'Sign in' : 'Create account'} onPress={() => { setCreateAccount((c) => !c); controller.clearError(); }} />
      </View>

      <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'stretch', marginVertical: 22 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: p.border }} />
        <Text style={{ color: p.muted, fontSize: 12, marginHorizontal: 14 }}>OR</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: p.border }} />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Continue as Guest"
        disabled={busy}
        onPress={() => controller.continueAsGuest()}
        style={{ width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, borderRadius: 14, borderWidth: 1.5, borderColor: Coral, paddingVertical: 14 }}
      >
        <Icon name="person-outline" size={20} color={p.text} />
        <Text style={{ color: p.text, fontSize: 15, fontWeight: '600' }}>Continue as Guest</Text>
      </Pressable>
    </Shell>
  );
}

// ─── Forgot password ─────────────────────────────────────────────────────────

export function ForgotPasswordScreen({ initialEmail, onBack }: { initialEmail: string; onBack: () => void }) {
  const p = usePalette();
  const { controller } = useSession();
  const [email, setEmail] = useState(initialEmail);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const trimmed = email.trim();
  const canSend = trimmed.length > 0 && !loading;

  const send = async () => {
    if (!canSend) return;
    if (!isValidEmail(trimmed)) return setError('Please enter a valid email address.');
    setError(null);
    setLoading(true);
    const result = await controller.sendPasswordReset(trimmed);
    setLoading(false);
    if (result === null) setSentTo(trimmed);
    else setError(result);
  };

  return (
    <Shell>
      <View style={{ width: 72, height: 72, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(242,107,78,0.15)', borderWidth: 1.5, borderColor: 'rgba(242,107,78,0.4)' }}>
        <Icon name={sentTo ? 'mark-email-read' : 'lock'} size={32} color={Coral} />
      </View>
      <Text accessibilityRole="header" style={{ color: p.text, fontSize: 26, fontWeight: '700', marginTop: 16 }}>
        {sentTo ? 'Check your email' : 'Forgot Password?'}
      </Text>

      {sentTo ? (
        <>
          <Text style={{ color: p.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8, marginBottom: 28 }}>
            {`If an account exists for ${sentTo}, you'll receive an email with a link to reset your password. Open the link, choose a new password, then sign in with it here.\n\nDidn't get it? Check your spam folder or try again in a few minutes.`}
          </Text>
          <PrimaryButton label="Back to Login" loading={false} enabled onPress={onBack} />
          <Link label="Resend email" onPress={() => { setSentTo(null); setError(null); }} style={{ marginTop: 18, paddingHorizontal: 8, paddingVertical: 4 }} />
        </>
      ) : (
        <>
          <Text style={{ color: p.muted, fontSize: 14, lineHeight: 20, textAlign: 'center', marginTop: 8, marginBottom: 28 }}>Enter the email you use to sign in and we&apos;ll send you a link to reset your password.</Text>
          <SectionLabel>EMAIL</SectionLabel>
          <Field value={email} onChange={(v) => { setEmail(v); setError(null); }} placeholder="you@example.com" label="Email" icon="email" inputMode="email" onSubmit={send} />
          {error && (
            <Text accessibilityRole="alert" style={{ alignSelf: 'stretch', color: ERROR, fontSize: 12, marginTop: 10 }}>
              {error}
            </Text>
          )}
          <View style={{ height: 20 }} />
          <PrimaryButton label="Send reset link" loading={loading} enabled={canSend} onPress={send} />
          <Pressable accessibilityRole="button" accessibilityLabel="Back to Login" disabled={loading} onPress={onBack} style={{ marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
            <Icon name="arrow-back" size={16} color={Coral} />
            <Text style={{ color: Coral, fontSize: 13, fontWeight: '600' }}>Back to Login</Text>
          </Pressable>
        </>
      )}
    </Shell>
  );
}

