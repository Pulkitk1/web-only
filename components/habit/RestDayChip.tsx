import { Pressable, Text, View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { Brand } from '@/theme';
import { withAlpha } from '@/utils/color';

/** Weekday chip (CreateHabitSheet.kt `RestDayChip`): blue outline + "R" when it is a rest day, a green dot below when active. */
export function RestDayChip({ day, isRest, showActiveDot = true, onPress }: { day: string; isRest: boolean; showActiveDot?: boolean; onPress: () => void }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: isRest }}
      accessibilityLabel={`${day}${isRest ? ', rest day' : ''}`}
      onPress={onPress}
      style={{
        borderRadius: 14,
        backgroundColor: isRest ? withAlpha(Brand.Blue, 0.1) : t.option,
        borderWidth: isRest ? 2 : 1.5,
        borderColor: isRest ? Brand.Blue : t.border,
        paddingHorizontal: isRest ? 15 : 16,
        paddingVertical: isRest ? 9 : 10,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: isRest ? Brand.Blue : t.text, fontSize: 14, fontWeight: '600' }}>{day}</Text>
      {isRest ? (
        <Text style={{ position: 'absolute', top: -8, right: -12, color: Brand.Blue, fontSize: 8, fontWeight: '800' }}>R</Text>
      ) : showActiveDot ? (
        <View style={{ position: 'absolute', bottom: -12, width: 4, height: 4, borderRadius: 2, backgroundColor: Brand.Green }} />
      ) : null}
    </Pressable>
  );
}
