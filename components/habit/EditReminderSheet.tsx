/** Habit Details: change a habit's reminder after it was created (android ReminderSection.kt `EditReminderSheet`). Nothing is saved until "Save Changes". */
import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';

import { ReminderSection } from '@/components/dashboard/ReminderSection';
import { FieldLabel, GhostButton, GradientButton } from '@/components/ui/Buttons';
import { CloseButton } from '@/components/ui/CloseButton';
import { BottomSheet } from '@/components/ui/overlays';
import { DEFAULT_REMINDER_TIME, parseTime } from '@/domain/reminder';
import { useTheme } from '@/hooks/useTheme';
import { Brand } from '@/theme';

type Props = {
  visible: boolean;
  enabled: boolean;
  /** "HH:mm", or null when never set. */
  time: string | null;
  onDismiss: () => void;
  onSave: (enabled: boolean, time: string) => void;
  accent?: string;
};

export function EditReminderSheet({ visible, enabled, time, onDismiss, onSave, accent = Brand.Green }: Props) {
  const { t } = useTheme();
  const saved = parseTime(time) ? time! : DEFAULT_REMINDER_TIME;
  const [on, setOn] = useState(enabled);
  const [picked, setPicked] = useState(saved);
  useEffect(() => {
    if (!visible) return;
    setOn(enabled);
    setPicked(saved);
  }, [visible, enabled, saved]);
  const changed = on !== enabled || picked !== saved;

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 4 }}>
        <Text style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 }}>Reminder</Text>
        <CloseButton onPress={onDismiss} />
      </View>
      <Text style={{ color: t.muted, fontSize: 13, marginBottom: 20 }}>Changes apply right away. The notification may arrive a little after the chosen time.</Text>
      <FieldLabel>NOTIFICATION</FieldLabel>
      <ReminderSection enabled={on} time={picked} onEnabled={setOn} onTime={setPicked} accent={accent} />
      <GradientButton text="Save Changes" onPress={() => changed && onSave(on, picked)} colors={[accent, `${accent}CC`]} contentColor="#000000" enabled={changed} style={{ marginTop: 24 }} />
      <GhostButton text="Cancel" onPress={onDismiss} style={{ marginTop: 8, marginBottom: 8 }} />
    </BottomSheet>
  );
}
