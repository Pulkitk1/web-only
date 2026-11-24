/** Colours and small pieces shared by the Calendar screen (android HabitCalendarScreen.kt `CalendarColors`, `StatusBadge`). */
import { Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import type { DayState } from '@/domain/calendar';
import { useTheme } from '@/hooks/useTheme';
import { Brand } from '@/theme';
import { luminance, readableOn, withAlpha } from '@/utils/color';

export const FREEZE_ICE = '#7EC8FF';

/** Colours derived from the open habit's saved colour, shared by every habit-specific accent on this screen. */
export type CalendarColors = { accent: string; onAccent: string; cell: string; card: string; border: string };

export function useCalendarColors(habitColor: string): CalendarColors {
  const { t, isDark } = useTheme();
  const accent = readableOn(habitColor, isDark);
  return {
    accent,
    onAccent: luminance(accent) > 0.4 ? '#111111' : '#FFFFFF',
    cell: isDark ? '#262626' : '#E9E9E9',
    card: t.card,
    border: t.border,
  };
}

const FULL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** "Nov 2026" (pattern MMM yyyy). */
export const monthShortLabel = (m: string) => `${SHORT_MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
/** "November 2026" (pattern MMMM yyyy). */
export const monthFullLabel = (m: string) => `${FULL_MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`;
export const monthName = (m: string) => FULL_MONTHS[Number(m.slice(5, 7)) - 1];
/** "Sat, Nov 21, 2026" (pattern EEE, MMM d, yyyy). */
export function formatLongDate(key: string): string {
  const d = new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)), 12);
  return `${WEEKDAYS[d.getDay()]}, ${SHORT_MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

/** Round status symbol used by the stats list and the legend, matching the calendar cells. */
export function StatusBadge({ state, colors, size }: { state: DayState; colors: CalendarColors; size: number }) {
  const { t } = useTheme();
  const filled = state === 'Done' || state === 'Rest';
  const frozen = state === 'Frozen';
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: filled ? colors.accent : frozen ? withAlpha(Brand.Blue, 0.2) : colors.cell,
        borderWidth: 1,
        borderColor: frozen ? withAlpha(Brand.Blue, 0.75) : 'transparent',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {state === 'Done' ? (
        <Icon name="check" size={size * 0.65} color={colors.onAccent} />
      ) : state === 'Rest' ? (
        <Text style={{ color: colors.onAccent, fontSize: size * 0.5, lineHeight: size * 0.5, fontWeight: '700' }}>R</Text>
      ) : frozen ? (
        <Text style={{ color: FREEZE_ICE, fontSize: size * 0.5, lineHeight: size * 0.5 }}>❄</Text>
      ) : (
        <Icon name="close" size={size * 0.55} color={t.muted} />
      )}
    </View>
  );
}
