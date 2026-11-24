/**
 * A habit's saved Goal (android GoalWhy.kt `GoalSection`) and the sheet to add, change or clear it (`EditGoalSheet`).
 * Without a goal it collapses to a small "Add your goal" prompt, so a skipped goal can be added later.
 * A legacy "why" saved by older Android versions stays in storage untouched but is no longer shown or asked for.
 */
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { GoalField } from '@/components/dashboard/GoalField';
import { GhostButton, GradientButton } from '@/components/ui/Buttons';
import { CloseButton } from '@/components/ui/CloseButton';
import { Icon } from '@/components/ui/Icon';
import { BottomSheet } from '@/components/ui/overlays';
import { normalizeGoal } from '@/domain/reminder';
import { useTheme } from '@/hooks/useTheme';
import { Brand } from '@/theme';
import { withAlpha } from '@/utils/color';

const GOAL_COLOR = Brand.Amber;

export function GoalSection({ goal, onEdit, accent = Brand.Green }: { goal: string | null; onEdit: () => void; accent?: string }) {
  const { t } = useTheme();
  if (goal === null) {
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add your goal"
        onPress={onEdit}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, borderWidth: 1, borderColor: t.border, paddingHorizontal: 16, paddingVertical: 12 }}
      >
        <Icon name="add" size={16} color={GOAL_COLOR} />
        <Text style={{ flex: 1, color: t.text, fontSize: 13, fontWeight: '600' }}>Add your goal</Text>
        <Text style={{ color: t.muted, fontSize: 11 }}>Optional</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ gap: 12, borderRadius: 16, backgroundColor: t.card, borderWidth: 1, borderColor: t.border, padding: 16 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: t.muted, fontSize: 11, fontWeight: '700', letterSpacing: 0.9 }}>GOAL</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Edit goal" onPress={onEdit} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 8, paddingHorizontal: 4, paddingVertical: 2 }}>
          <Icon name="edit" size={12} color={accent} />
          <Text style={{ color: accent, fontSize: 12, fontWeight: '600' }}>Edit</Text>
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: withAlpha(GOAL_COLOR, 0.12), alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="flag" size={15} color={GOAL_COLOR} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: GOAL_COLOR, fontSize: 11, fontWeight: '700' }}>Goal</Text>
          <Text style={{ color: t.text, fontSize: 14, lineHeight: 20, marginTop: 2 }}>{goal}</Text>
        </View>
      </View>
    </View>
  );
}

/** Add, change or clear the Goal; clearing the field and saving removes it. Save is enabled once it differs. */
export function EditGoalSheet({ visible, goal, onDismiss, onSave }: { visible: boolean; goal: string | null; onDismiss: () => void; onSave: (goal: string | null) => void }) {
  const { t } = useTheme();
  const [text, setText] = useState(goal ?? '');
  useEffect(() => {
    if (visible) setText(goal ?? '');
  }, [visible, goal]);
  const newGoal = normalizeGoal(text);
  const changed = newGoal !== goal;

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 4 }}>
        <Text style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 }}>Goal</Text>
        <CloseButton onPress={onDismiss} />
      </View>
      <Text style={{ color: t.muted, fontSize: 13, marginBottom: 20 }}>Optional. Clear the field to remove it.</Text>
      <View style={{ marginBottom: 24 }}>
        <GoalField goal={text} onGoal={setText} />
      </View>
      <GradientButton text="Save Changes" onPress={() => changed && onSave(newGoal)} colors={[Brand.Green, `${Brand.Green}CC`]} contentColor="#000000" enabled={changed} />
      <GhostButton text="Cancel" onPress={onDismiss} style={{ marginTop: 8, marginBottom: 8 }} />
    </BottomSheet>
  );
}
