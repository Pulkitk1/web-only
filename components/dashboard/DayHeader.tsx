import { Pressable, Text, View } from 'react-native';

import { useTheme } from '@/hooks/useTheme';
import { dayName, dayOfMonth, isAfter, type DateKey } from '@/utils/date';
import { CARD_END, CARD_START, LIST_PADDING, MENU_WIDTH, type GridMetrics } from './layout';

type Props = { days: DateKey[]; today: DateKey; selected: DateKey; metrics: GridMetrics; onSelect: (d: DateKey) => void };

/** "Habits" plus the visible day labels on the same columns as the habit rows; tapping a day picks it for Today's Progress. */
export function DayHeader({ days, today, selected, metrics, onSelect }: Props) {
  const { t } = useTheme();
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingLeft: LIST_PADDING + CARD_START,
        paddingRight: LIST_PADDING + MENU_WIDTH + CARD_END,
        paddingTop: 10,
        paddingBottom: 4,
      }}
    >
      <Text numberOfLines={1} style={{ flex: 1, color: t.muted, fontSize: 14, fontWeight: '500' }}>
        Habits
      </Text>
      {days.map((d) => {
        const future = isAfter(d, today);
        const sel = d === selected;
        const color = sel ? t.text : t.muted;
        const weight = sel ? '700' : '500';
        return (
          <Pressable
            key={d}
            accessibilityRole="button"
            accessibilityLabel={`Show progress for ${dayName(d)} ${dayOfMonth(d)}`}
            accessibilityState={{ selected: sel, disabled: future }}
            disabled={future}
            onPress={() => onSelect(d)}
            style={{ width: metrics.column, alignItems: 'center', borderRadius: 8, paddingVertical: 2 }}
          >
            <Text numberOfLines={1} style={{ color, fontSize: 11, fontWeight: weight }}>
              {dayName(d)}
            </Text>
            <Text numberOfLines={1} style={{ color, fontSize: 13, fontWeight: weight }}>
              {dayOfMonth(d)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
