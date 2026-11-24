import { Pressable, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { HABIT_PALETTE, type PaletteColor } from '@/theme';

/**
 * The habit colour picker: every colour of the shared palette in rows of six, the selected one marked with a check and a
 * white border (CreateHabitSheet.kt `HabitColorGrid`). Shared by creating a habit and editing one, so both always offer
 * the same 18 colours.
 */
export function HabitColorGrid({ selected, onSelect }: { selected: string; onSelect: (c: PaletteColor) => void }) {
  return (
    <View style={{ gap: 10 }}>
      {[0, 6, 12].map((start) => (
        <View key={start} style={{ flexDirection: 'row', gap: 10 }}>
          {HABIT_PALETTE.slice(start, start + 6).map((c) => {
            const sel = c.color.toLowerCase() === selected.toLowerCase();
            return (
              <Pressable
                key={c.color}
                accessibilityRole="radio"
                accessibilityLabel={sel ? `${c.name}, selected` : c.name}
                accessibilityState={{ selected: sel }}
                onPress={() => onSelect(c)}
                style={{
                  flex: 1,
                  aspectRatio: 1,
                  borderRadius: 12,
                  backgroundColor: c.color,
                  borderWidth: sel ? 2.5 : 0,
                  borderColor: sel ? '#FFFFFF' : 'transparent',
                  transform: [{ scale: sel ? 1.12 : 1 }],
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {sel && <Icon name="check" size={15} color={c.light ? '#1A1A1A' : '#FFFFFF'} />}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}
