import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { DropdownMenu, MenuItem } from '@/components/ui/overlays';
import { ProgressRing } from '@/components/ui/ProgressRing';
import { useTheme } from '@/hooks/useTheme';
import { useAppStore, type HabitView } from '@/store/AppStore';
import { Brand, type HomePalette } from '@/theme';
import { luminance, readableOn } from '@/utils/color';
import type { DateKey } from '@/utils/date';
import { DayIndicator } from './DayIndicator';
import { CARD_END, CARD_START, MENU_WIDTH, RING_GAP, type GridMetrics } from './layout';

type Props = {
  habit: HabitView;
  days: DateKey[];
  today: DateKey;
  metrics: GridMetrics;
  p: HomePalette;
  onOpen: () => void;
  onToggle: (date: DateKey) => void;
  onStreak: () => void;
  onDelete: () => void;
  onArchive: () => void;
  /** The date whose rest-day celebration is playing for this habit, if any (the circle bounces). */
  celebratedDate: DateKey | null;
};

/** One habit row (HabitsScreen.kt `HabitCard`): ring, name + streak, five day circles, overflow menu. */
export function HabitCard({ habit, days, today, metrics, p, onOpen, onToggle, onStreak, onDelete, onArchive, celebratedDate }: Props) {
  const { t, isDark } = useTheme();
  const store = useAppStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const accent = readableOn(habit.color, isDark);
  // Dark mark on bright habit colours, white on deep ones.
  const onAccent = luminance(accent) > 0.35 ? '#0B0F14' : '#FFFFFF';
  const percent = store.habitDaysPercent(habit, days);

  return (
    <View style={{ zIndex: menuOpen ? 30 : 0 }}>
      {/* No button role on the card itself: it contains the day buttons and the menu button (a <button> can't nest). */}
      <Pressable
        accessibilityLabel={`Open ${habit.name}`}
        onPress={onOpen}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: p.card,
          borderWidth: 1,
          borderColor: p.cardBorder,
          borderRadius: 18,
          paddingLeft: CARD_START,
          paddingRight: CARD_END,
          paddingVertical: 10,
        }}
      >
        <ProgressRing percent={percent} color={accent} track={p.track} size={metrics.ring} />
        <View style={{ width: RING_GAP }} />

        <View style={{ flex: 1, minWidth: 0 }}>
          <Text numberOfLines={2} style={{ color: t.text, fontSize: 15, fontWeight: '600', lineHeight: 18 }}>
            {habit.name}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${habit.streak}-day streak. Show streak celebration`}
            onPress={onStreak}
            style={{ marginTop: 2, alignSelf: 'flex-start', maxWidth: '100%', borderRadius: 6 }}
          >
            <Text numberOfLines={1} style={{ color: t.muted, fontSize: 11 }}>
              <Text style={{ fontSize: 10 }}>🔥</Text>
              {` ${habit.streak}-day streak`}
            </Text>
          </Pressable>
        </View>

        {days.map((date) => {
          const done = habit.completedDates.includes(date);
          const frozen = !done && store.isFreezeDate(habit.id, date);
          const rest = !done && !frozen && store.isRestDay(habit, date);
          return (
            <View key={date} style={{ width: metrics.column, alignItems: 'center', justifyContent: 'center' }}>
              <DayIndicator
                habitName={habit.name}
                date={date}
                today={today}
                size={metrics.dot}
                accent={accent}
                onAccent={onAccent}
                p={p}
                done={done}
                frozen={frozen}
                rest={rest}
                celebrated={celebratedDate === date}
                onToggle={() => onToggle(date)}
              />
            </View>
          );
        })}

        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More options"
            onPress={() => setMenuOpen(true)}
            style={{ width: MENU_WIDTH, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="more-vert" size={20} color={`${t.text}D9`} />
          </Pressable>
          <DropdownMenu open={menuOpen} onClose={() => setMenuOpen(false)} align="right">
            <MenuItem
              label="Archive Habit"
              color={t.text}
              icon={<Icon name="archive" size={16} color={t.muted} />}
              onPress={() => {
                setMenuOpen(false);
                onArchive();
              }}
            />
            <MenuItem
              label="Delete Habit"
              color={Brand.Red}
              icon={<Icon name="delete" size={16} color={Brand.Red} />}
              onPress={() => {
                setMenuOpen(false);
                onDelete();
              }}
            />
          </DropdownMenu>
        </View>
      </Pressable>
    </View>
  );
}
