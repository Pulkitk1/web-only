import { Text, TextInput, View } from 'react-native';

import { GOAL_MAX_LENGTH } from '@/domain/reminder';
import { useTheme } from '@/hooks/useTheme';

export const GOAL_LABEL = 'What is your goal for this habit?';
export const GOAL_PLACEHOLDER = 'e.g., Build 3 Python projects';

/** The optional, multiline goal input, capped at 300 characters (GoalWhy.kt `GoalField`). */
export function GoalField({ goal, onGoal }: { goal: string; onGoal: (v: string) => void }) {
  const { t } = useTheme();
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
        <Text style={{ flexShrink: 1, color: t.text, fontSize: 13, fontWeight: '600' }}>{GOAL_LABEL}</Text>
        <Text style={{ color: t.muted, fontSize: 11 }}>{'  Optional'}</Text>
      </View>
      <TextInput
        multiline
        numberOfLines={2}
        value={goal}
        onChangeText={(v) => onGoal(v.slice(0, GOAL_MAX_LENGTH))}
        placeholder={GOAL_PLACEHOLDER}
        placeholderTextColor={t.muted}
        accessibilityLabel={GOAL_LABEL}
        style={{
          minHeight: 64,
          maxHeight: 140,
          backgroundColor: t.field,
          color: t.text,
          borderRadius: 14,
          borderWidth: 1.5,
          borderColor: t.border,
          paddingHorizontal: 16,
          paddingVertical: 12,
          fontSize: 14,
          lineHeight: 20,
          textAlignVertical: 'top',
          outlineStyle: 'none',
        } as object}
      />
    </View>
  );
}
