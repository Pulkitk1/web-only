/**
 * The month grid card, the legend and the best-streaks rows (android HabitCalendarScreen.kt `MonthGridCard`, `DayCell`,
 * `Legend`, `StreakRow`). Every cell takes taps; a second tap within 300 ms on the same day counts as a double tap (the web
 * equivalent of Compose's `combinedClickable`).
 */
import { useEffect, useRef } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { monthGrid, streakBarWidth, type BestStreak, type DayState } from '@/domain/calendar';
import { useTheme } from '@/hooks/useTheme';
import { Brand } from '@/theme';
import { withAlpha } from '@/utils/color';
import type { DateKey, MonthKey } from '@/utils/date';
import { FREEZE_ICE, StatusBadge, type CalendarColors } from './shared';

const DOUBLE_TAP_MS = 300;
const WEEK_HEADINGS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function DayCell({ day, state, selected, rest, note, editMode, colors, onTap, onDoubleTap }: { day: DateKey; state: DayState; selected: boolean; rest: boolean; note: boolean; editMode: boolean; colors: CalendarColors; onTap: () => void; onDoubleTap: () => void }) {
  const { t, isDark } = useTheme();
  const faint = state === 'Outside' || state === 'Future' || state === 'Inactive';
  const bg = state === 'Done' ? withAlpha(colors.accent, isDark ? 0.24 : 0.18) : state === 'Frozen' ? withAlpha(Brand.Blue, 0.16) : faint ? withAlpha(colors.cell, 0.45) : colors.cell;
  const showSel = selected && state !== 'Outside';
  const border = showSel ? colors.accent : state === 'Frozen' ? withAlpha(Brand.Blue, 0.7) : state === 'Done' ? withAlpha(colors.accent, 0.45) : editMode && (state === 'Missed' || state === 'Today') ? withAlpha(t.text, 0.18) : 'transparent';
  const numColor = state === 'Outside' ? withAlpha(t.muted, 0.35) : state === 'Future' || state === 'Inactive' ? withAlpha(t.muted, 0.7) : t.text;
  const dayNum = Number(day.slice(8, 10));

  const taps = useRef<{ timer: ReturnType<typeof setTimeout> | null }>({ timer: null });
  useEffect(() => () => void (taps.current.timer && clearTimeout(taps.current.timer)), []);
  const press = () => {
    if (taps.current.timer) {
      clearTimeout(taps.current.timer);
      taps.current.timer = null;
      onDoubleTap();
    } else {
      taps.current.timer = setTimeout(() => {
        taps.current.timer = null;
        onTap();
      }, DOUBLE_TAP_MS);
    }
  };

  const label = `${day} ${state}${rest ? ' rest day' : ''}${note ? ' with note' : ''}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={`day-${day}`}
      onPress={press}
      style={{ flex: 1, aspectRatio: 0.86, borderRadius: 10, backgroundColor: bg, borderWidth: showSel ? 2 : 1, borderColor: border, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ alignItems: 'center' }}>
        <Text style={{ color: numColor, fontSize: 14, lineHeight: 16, fontWeight: state === 'Outside' ? '400' : '600' }}>{dayNum}</Text>
        <View style={{ height: 18, alignItems: 'center', justifyContent: 'center' }}>
          {state === 'Done' ? (
            <Icon name="check" size={16} color={colors.accent} />
          ) : state === 'Rest' ? (
            <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: colors.onAccent, fontSize: 9, lineHeight: 9, fontWeight: '700' }}>R</Text>
            </View>
          ) : state === 'Frozen' ? (
            <Text style={{ color: FREEZE_ICE, fontSize: 13, lineHeight: 14 }}>❄</Text>
          ) : state === 'Missed' ? (
            <Icon name="close" size={14} color={t.muted} />
          ) : null}
        </View>
      </View>
      {/* A completed rest day was bonus effort: keep a small "R" so it still reads as a rest day. */}
      {state === 'Done' && rest && <Text style={{ position: 'absolute', top: 2, left: 4, color: colors.accent, fontSize: 8, fontWeight: '800' }}>R</Text>}
      {note && (state === 'Missed' || state === 'Frozen' || state === 'Done') && (
        <View style={{ position: 'absolute', top: 3, right: 3 }}>
          <Icon name="note-alt" size={10} color={Brand.CalendarYellow} />
        </View>
      )}
    </Pressable>
  );
}

export function MonthGridCard({ month, selected, colors, stateOf, isRest, hasNote, editMode, onTap, onDoubleTap }: { month: MonthKey; selected: DateKey | null; colors: CalendarColors; stateOf: (d: DateKey) => DayState; isRest: (d: DateKey) => boolean; hasNote: (d: DateKey) => boolean; editMode: boolean; onTap: (d: DateKey) => void; onDoubleTap: (d: DateKey) => void }) {
  const { t } = useTheme();
  return (
    <View style={{ marginTop: 12, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 10, paddingVertical: 12, gap: 6 }}>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        {WEEK_HEADINGS.map((w) => (
          <Text key={w} style={{ flex: 1, color: t.muted, fontSize: 12, fontWeight: '500', textAlign: 'center', paddingBottom: 4 }}>
            {w}
          </Text>
        ))}
      </View>
      {monthGrid(month).map((week) => (
        <View key={week[0]} style={{ flexDirection: 'row', gap: 6 }}>
          {week.map((day) => (
            <DayCell key={day} day={day} state={stateOf(day)} selected={day === selected} rest={isRest(day)} note={hasNote(day)} editMode={editMode} colors={colors} onTap={() => onTap(day)} onDoubleTap={() => onDoubleTap(day)} />
          ))}
        </View>
      ))}
    </View>
  );
}

function LegendItem({ label, children }: { label: string; children: React.ReactNode }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {children}
      <Text style={{ color: t.text, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

export function Legend({ colors }: { colors: CalendarColors }) {
  return (
    <View style={{ marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', columnGap: 14, rowGap: 10, borderRadius: 20, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 12 }}>
      <LegendItem label="Completed">
        <StatusBadge state="Done" colors={colors} size={18} />
      </LegendItem>
      <LegendItem label="Missed">
        <StatusBadge state="Missed" colors={colors} size={18} />
      </LegendItem>
      <LegendItem label="Rest day">
        <StatusBadge state="Rest" colors={colors} size={18} />
      </LegendItem>
      <LegendItem label="Freeze used">
        <StatusBadge state="Frozen" colors={colors} size={18} />
      </LegendItem>
      <LegendItem label="Note">
        <Icon name="note-alt" size={18} color={Brand.CalendarYellow} />
      </LegendItem>
    </View>
  );
}

export function StreakRow({ row, maxDays, colors }: { row: BestStreak; maxDays: number; colors: CalendarColors }) {
  const { t } = useTheme();
  // Personal best in the solid habit colour, other runs as a tint of it.
  const [bg, fg] =
    row.style === 'bright' ? [colors.accent, colors.onAccent] : row.style === 'yellow' ? [withAlpha(colors.accent, 0.8), colors.onAccent] : row.style === 'muted' ? [withAlpha(colors.accent, 0.35), t.text] : [colors.cell, t.muted];
  return (
    <View testID="best-streak-row" style={{ flexDirection: 'row', alignItems: 'center', height: 40 }}>
      <Text style={{ width: 80, color: t.muted, fontSize: 11, fontWeight: '500' }}>{row.start}</Text>
      <View style={{ flex: 1, paddingHorizontal: 6 }}>
        <View style={{ width: streakBarWidth(row.days, maxDays), maxWidth: '100%', height: 26, borderRadius: 10, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ color: fg, fontSize: 12, fontWeight: '700' }}>{row.days}</Text>
        </View>
      </View>
      <Text style={{ width: 80, color: t.muted, fontSize: 11, fontWeight: '500', textAlign: 'right' }}>{row.end}</Text>
    </View>
  );
}
