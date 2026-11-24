import { useRef } from 'react';
import { Text, View } from 'react-native';

import { GhostButton, GradientButton } from '@/components/ui/Buttons';
import { CloseButton } from '@/components/ui/CloseButton';
import { BottomSheet } from '@/components/ui/overlays';
import { useTheme } from '@/hooks/useTheme';
import type { HabitView } from '@/store/AppStore';
import { Brand } from '@/theme';

/** Confirmation before archiving a habit (ArchivedHabits.kt `ArchiveHabitSheet`); hidden while `habit` is null. */
export function ArchiveHabitSheet({ habit, onConfirm, onDismiss }: { habit: HabitView | null; onConfirm: (h: HabitView) => void; onDismiss: () => void }) {
  const { t } = useTheme();
  const last = useRef<HabitView | null>(null);
  if (habit) last.current = habit;
  const h = last.current;
  return (
    <BottomSheet visible={habit !== null} onDismiss={onDismiss}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 4 }}>
        <Text style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 }}>{`Archive "${h?.name ?? ''}"?`}</Text>
        <CloseButton onPress={onDismiss} />
      </View>
      <Text style={{ color: t.muted, fontSize: 13, lineHeight: 19, marginBottom: 20 }}>
        The habit will be hidden from Home, but it keeps running: your schedule, rest days, streak, reminders and rewards continue as usual, and missed
        days still count. You can open it, track it or unarchive it anytime in Settings → Archived Habits.
      </Text>
      <GradientButton text="Archive Habit" onPress={() => h && onConfirm(h)} colors={[Brand.Green, `${Brand.Green}CC`]} contentColor="#000000" />
      <GhostButton text="Cancel" onPress={onDismiss} style={{ marginTop: 8, marginBottom: 8 }} />
    </BottomSheet>
  );
}
