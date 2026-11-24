/**
 * Permanent account deletion (android AccountSheets.kt `DeleteAccountSheet`): explains what is removed, then requires the password
 * (Firebase needs a recent login) and typing DELETE. `error` shows the last failure; nothing is reported as deleted until the deletion
 * itself succeeded (see `domain/accountDeletion.ts`). While `deleting` the sheet cannot be dismissed.
 */
import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { GhostButton, GradientButton } from '@/components/ui/Buttons';
import { Icon } from '@/components/ui/Icon';
import { BottomSheet } from '@/components/ui/overlays';
import { useTheme } from '@/hooks/useTheme';
import { Brand } from '@/theme';
import { withAlpha } from '@/utils/color';

export const CONFIRM_WORD = 'DELETE';

type Props = {
  visible: boolean;
  /** The account's email, shown in the explanation. */
  account: string;
  deleting: boolean;
  error: string | null;
  onDelete: (password: string) => void;
  onDismiss: () => void;
};

function Input({ value, onChange, label, placeholder, secure, onSubmit }: { value: string; onChange: (v: string) => void; label: string; placeholder: string; secure?: boolean; onSubmit: () => void }) {
  const { t } = useTheme();
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={t.muted}
      accessibilityLabel={label}
      secureTextEntry={secure}
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete={secure ? 'current-password' : 'off'}
      onSubmitEditing={onSubmit}
      style={{ width: '100%', backgroundColor: t.field, color: t.text, borderRadius: 14, borderWidth: 1.5, borderColor: t.border, paddingHorizontal: 16, paddingVertical: 13, fontSize: 14, outlineStyle: 'none' } as object}
    />
  );
}

export function DeleteAccountSheet({ visible, account, deleting, error, onDelete, onDismiss }: Props) {
  const { t } = useTheme();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  useEffect(() => {
    if (!visible) {
      setPassword('');
      setConfirm('');
    }
  }, [visible]);
  const ready = password.length > 0 && confirm.trim() === CONFIRM_WORD && !deleting;
  const submit = () => ready && onDelete(password);

  return (
    <BottomSheet visible={visible} onDismiss={() => !deleting && onDismiss()}>
      <View style={{ alignItems: 'center', gap: 12, paddingTop: 20, paddingBottom: 16 }}>
        <View style={{ width: 64, height: 64, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(Brand.Red, 0.12), borderWidth: 1.5, borderColor: withAlpha(Brand.Red, 0.25) }}>
          <Icon name="delete" size={28} color={Brand.Red} />
        </View>
        <Text accessibilityRole="header" style={{ color: t.text, fontSize: 19, fontWeight: '700' }}>Delete Account?</Text>
        <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19, textAlign: 'center' }}>
          {`This permanently deletes ${account} and everything stored with it: your habits and completion history, calendar notes, streaks, coins, wallet history and streak freezes. This cannot be undone.`}
        </Text>
        <Text style={{ color: t.muted, fontSize: 12, lineHeight: 17, textAlign: 'center' }}>Habits you made as a guest on this device are not part of your account and are not deleted.</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 10, borderRadius: 12, backgroundColor: withAlpha(Brand.Red, 0.08), borderWidth: 1, borderColor: withAlpha(Brand.Red, 0.25), paddingHorizontal: 16, paddingVertical: 12, marginBottom: 16 }}>
        <View style={{ paddingTop: 1 }}>
          <Icon name="error-outline" size={14} color={Brand.Red} />
        </View>
        <Text style={{ flex: 1, color: Brand.Red, fontSize: 12 }}>{`To confirm, enter your password and type ${CONFIRM_WORD}.`}</Text>
      </View>
      <View style={{ gap: 10, marginBottom: 12 }}>
        <Input value={password} onChange={setPassword} label="Password" placeholder="Password" secure onSubmit={submit} />
        <Input value={confirm} onChange={setConfirm} label={`Type ${CONFIRM_WORD}`} placeholder={`Type ${CONFIRM_WORD}`} onSubmit={submit} />
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={{ color: Brand.Red, fontSize: 12, lineHeight: 17, marginBottom: 12 }}>
          {error}
        </Text>
      ) : null}
      <GradientButton text={deleting ? 'Deleting…' : 'Delete My Account'} onPress={submit} colors={[Brand.Red, withAlpha(Brand.Red, 0.8)]} contentColor="#FFFFFF" enabled={ready} />
      <GhostButton text="Cancel" onPress={() => !deleting && onDismiss()} style={{ marginTop: 8, marginBottom: 8 }} />
    </BottomSheet>
  );
}
