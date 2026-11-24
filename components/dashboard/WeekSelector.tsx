import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { DropdownMenu, MenuItem } from '@/components/ui/overlays';
import { weekRangeLabel, weekTitle } from '@/domain/week';
import { useTheme } from '@/hooks/useTheme';
import type { HomePalette } from '@/theme';
import { addDays, type DateKey } from '@/utils/date';

type Props = {
  offset: number;
  days: DateKey[];
  p: HomePalette;
  onOffset: (offset: number) => void;
  /** Desktop splits the row: 'title' is the "This Week" menu only, 'range' the date pill only. Default shows both (phones, tablets). */
  part?: 'both' | 'title' | 'range';
};

/** "This Week v" title with a menu, plus the range pill with previous/next arrows (HabitsScreen.kt `WeekSelector`). */
export function WeekSelector({ offset, days, p, onOffset, part = 'both' }: Props) {
  const { t } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const canNext = offset < 0;
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: part === 'range' ? 'flex-end' : 'flex-start',
        paddingLeft: part === 'both' ? 20 : 12,
        paddingRight: part === 'both' ? 16 : 4,
        paddingTop: 6,
        paddingBottom: 6,
        zIndex: 20,
      }}
    >
      {part !== 'range' && (
      <View style={{ flex: 1, minWidth: 0 }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose week"
          onPress={() => setMenuOpen(true)}
          style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', maxWidth: '100%', borderRadius: 10, paddingVertical: 4 }}
        >
          <Text numberOfLines={1} style={{ flexShrink: 1, color: t.text, fontSize: 19, fontWeight: '600' }}>
            {weekTitle(offset, days.length)}
          </Text>
          <View style={{ marginLeft: 4 }}>
            <Icon name="keyboard-arrow-down" size={22} color={t.text} />
          </View>
        </Pressable>
        <DropdownMenu open={menuOpen} onClose={() => setMenuOpen(false)}>
          {[0, -1, -2, -3].map((o) => (
            <MenuItem
              key={o}
              color={t.text}
              bold={o === offset}
              label={o === 0 ? weekTitle(0) : weekRangeLabel(days.map((d) => addDays(d, (o - offset) * days.length)))}
              onPress={() => {
                setMenuOpen(false);
                onOffset(o);
              }}
            />
          ))}
        </DropdownMenu>
      </View>
      )}

      {part !== 'title' && (
      <View
        style={{
          flexShrink: 0,
          height: 36,
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: 12,
          backgroundColor: p.control,
          borderWidth: 1,
          borderColor: p.controlBorder,
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous week"
          onPress={() => onOffset(offset - 1)}
          style={{ height: '100%', width: 34, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevron-left" size={20} color={t.text} />
        </Pressable>
        <Text numberOfLines={1} style={{ color: t.text, fontSize: 13, fontWeight: '500', paddingHorizontal: 6 }}>
          {weekRangeLabel(days)}
        </Text>
        <View style={{ height: '100%', width: 1, backgroundColor: p.controlBorder }} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next week"
          accessibilityState={{ disabled: !canNext }}
          disabled={!canNext}
          onPress={() => onOffset(offset + 1)}
          style={{ height: '100%', width: 34, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevron-right" size={20} color={canNext ? t.text : `${t.muted}66`} />
        </Pressable>
      </View>
      )}
    </View>
  );
}
