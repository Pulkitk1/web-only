/**
 * Edit Habit dialog (android EditHabitDialog.kt): the habit's name and colour. The colours are the same ones offered when
 * creating a habit. Everything is a draft until "Save Changes", which is enabled only for a valid, changed name and/or
 * colour; `onSave` returns an error to show here, or null when the change was accepted. Cancel, Escape and tapping outside
 * discard the draft.
 */
import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';

import { FieldLabel, GhostButton, GradientButton } from '@/components/ui/Buttons';
import { CenterModal } from '@/components/ui/overlays';
import { canSaveName, isValidName, normalizeName, NAME_MAX_LENGTH } from '@/domain/habitRules';
import { useTheme } from '@/hooks/useTheme';
import { Brand } from '@/theme';
import { luminance, withAlpha } from '@/utils/color';
import { HabitColorGrid } from './HabitColorGrid';

type Props = {
  visible: boolean;
  currentName: string;
  currentColor: string;
  onDismiss: () => void;
  /** Returns an error message to show in the dialog, or null when accepted. */
  onSave: (name: string, color: string) => string | null;
};

export function EditHabitDialog({ visible, currentName, currentColor, onDismiss, onSave }: Props) {
  const { t } = useTheme();
  const [name, setName] = useState(currentName);
  const [color, setColor] = useState(currentColor);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // A fresh draft every time the dialog opens (a discarded draft never comes back).
  useEffect(() => {
    if (!visible) return;
    setName(currentName);
    setColor(currentColor);
    setError(null);
    setSaving(false);
  }, [visible, currentName, currentColor]);

  const trimmed = normalizeName(name);
  const changed = trimmed !== currentName || color.toLowerCase() !== currentColor.toLowerCase();
  const canSave = !saving && isValidName(name, currentName) && changed;
  const save = () => {
    if (!canSave) return;
    setSaving(true);
    const e = onSave(trimmed, color);
    setError(e);
    if (e) setSaving(false);
  };

  return (
    <CenterModal visible={visible} onDismiss={onDismiss}>
      <Text style={{ color: t.text, fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 18 }}>Edit Habit</Text>

      <View style={{ width: '100%' }}>
        <FieldLabel>HABIT NAME</FieldLabel>
        <TextInput
          autoFocus
          value={name}
          onChangeText={(v) => {
            if (v.length <= Math.max(NAME_MAX_LENGTH, currentName.length)) {
              setName(v);
              setError(null);
            }
          }}
          onSubmitEditing={save}
          placeholder="Habit name"
          placeholderTextColor={`${t.muted}99`}
          returnKeyType="done"
          accessibilityLabel="Habit name"
          style={{
            backgroundColor: t.field,
            color: t.text,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: error ? Brand.Red : withAlpha(color, 0.6),
            paddingHorizontal: 16,
            paddingVertical: 13,
            fontSize: 15,
            fontWeight: '500',
            outlineStyle: 'none',
            caretColor: color,
          } as object}
        />
        {error ? <Text style={{ color: Brand.Red, fontSize: 12, marginTop: 8 }}>{error}</Text> : null}

        <FieldLabel style={{ marginTop: 16 }}>HABIT COLOR</FieldLabel>
        <HabitColorGrid
          selected={color}
          onSelect={(c) => {
            setColor(c.color);
            setError(null);
          }}
        />

        <FieldLabel style={{ marginTop: 16 }}>PREVIEW</FieldLabel>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            borderRadius: 16,
            backgroundColor: withAlpha(color, 0.12),
            borderWidth: 1,
            borderColor: withAlpha(color, 0.3),
            paddingHorizontal: 16,
            paddingVertical: 12,
          }}
        >
          <View style={{ width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: color }} />
          <Text numberOfLines={1} style={{ flexShrink: 1, color, fontSize: 15, fontWeight: '700' }}>
            {trimmed || 'Habit name'}
          </Text>
        </View>

        <View style={{ flexDirection: 'row', gap: 10, marginTop: 20 }}>
          <GhostButton text="Cancel" onPress={onDismiss} style={{ flex: 1, width: 'auto' }} />
          <GradientButton
            text="Save Changes"
            onPress={save}
            colors={[color, `${color}CC`]}
            contentColor={luminance(color) > 0.4 ? '#111111' : '#FFFFFF'}
            enabled={canSave}
            style={{ flex: 1, width: 'auto' }}
          />
        </View>
      </View>
    </CenterModal>
  );
}

export { canSaveName };
