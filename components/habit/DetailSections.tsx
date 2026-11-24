/**
 * Sections of the Habit Details screen (android HabitDetailScreen.kt `StreakCard`, Calendar View card, Overview card,
 * `SectionTitle`, `ChartHeader`, `ChartEmpty`; ArchivedHabits.kt `ArchivedBanner`). Sizes, colours and copy follow Kotlin.
 */
import type { ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { Icon } from '@/components/ui/Icon';
import { isTrendUp, signed } from '@/domain/habitDetail';
import { useTheme } from '@/hooks/useTheme';
import { Brand } from '@/theme';
import { withAlpha } from '@/utils/color';

/** Rounded card surface (`Modifier.card()`): radius 16, card colour, 1px border. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const { t } = useTheme();
  return <View style={[{ borderRadius: 16, backgroundColor: t.card, borderWidth: 1, borderColor: t.border, overflow: 'hidden' }, style]}>{children}</View>;
}

export function SectionTitle({ text, color }: { text: string; color: string }) {
  return <Text style={{ color, fontSize: 13, fontWeight: '600', letterSpacing: 0.5 }}>{text}</Text>;
}

/** "Month ▾" is a visual selector only, as in Kotlin (the charts are always monthly). */
export function ChartHeader({ title, color }: { title: string; color: string }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
      <SectionTitle text={title} color={color} />
      <View style={{ flex: 1 }} />
      <Text style={{ color: t.muted, fontSize: 11, fontWeight: '500', borderRadius: 8, backgroundColor: t.chip, borderWidth: 1, borderColor: t.border, paddingHorizontal: 12, paddingVertical: 4, overflow: 'hidden' }}>Month ▾</Text>
    </View>
  );
}

export function ChartEmpty({ text }: { text: string }) {
  const { t } = useTheme();
  return (
    <View style={{ width: '100%', height: 150, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: t.muted, fontSize: 13 }}>{text}</Text>
    </View>
  );
}

/** Streak card: a 270-degree orange ring around a flame, the streak number with the habit colour's glow, "Personal Best". Tap for the celebration. */
export function StreakCard({ streak, accent, onPress }: { streak: number; accent: string; onPress: () => void }) {
  const { t } = useTheme();
  const r = 24;
  const c = 2 * Math.PI * r;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${streak} day streak. Show streak celebration`} onPress={onPress}>
      <Card>
        <View pointerEvents="none" style={[{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }, { backgroundImage: `radial-gradient(circle 600px at 200px 120px, ${withAlpha(accent, 0.09)}, rgba(0,0,0,0))` } as object]} />
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 16 }}>
          <View style={{ width: 56, height: 56, alignItems: 'center', justifyContent: 'center' }}>
            <Svg width={56} height={56} viewBox="0 0 56 56" style={{ position: 'absolute' }}>
              <Circle cx={28} cy={28} r={r} stroke={t.track} strokeWidth={4} fill="none" />
              <Circle cx={28} cy={28} r={r} stroke="#FF6B35" strokeWidth={4} fill="none" strokeLinecap="round" strokeDasharray={`${c * 0.75} ${c * 0.25}`} transform="rotate(-90 28 28)" />
            </Svg>
            <Text style={{ fontSize: 22 }}>🔥</Text>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
              <Text style={[{ color: t.text, fontSize: 30, fontWeight: '800', letterSpacing: -1 }, { textShadow: `0 0 20px ${withAlpha(accent, 0.4)}` } as object]}>{streak}</Text>
              <Text style={{ color: t.muted, fontSize: 15, fontWeight: '500', paddingBottom: 5 }}>Day Streak</Text>
            </View>
            <Text style={{ color: Brand.Green, fontSize: 13 }}>Keep it going!</Text>
          </View>
          <Text
            style={{ color: accent, fontSize: 12, fontWeight: '600', borderRadius: 8, backgroundColor: withAlpha(accent, 0.1), borderWidth: 1, borderColor: withAlpha(accent, 0.25), paddingHorizontal: 10, paddingVertical: 4, overflow: 'hidden' }}
          >
            🏆 Personal Best
          </Text>
        </View>
      </Card>
    </Pressable>
  );
}

/** "Calendar View" row: yellow calendar tile, label, chevron. */
export function CalendarLink({ onPress }: { onPress: () => void }) {
  const { t, isDark } = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Calendar View" onPress={onPress}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 16 }}>
          <View style={{ width: 34, height: 34, borderRadius: 12, backgroundColor: withAlpha(Brand.CalendarYellow, isDark ? 0.12 : 0.25), borderWidth: 1, borderColor: withAlpha(Brand.CalendarYellow, 0.3), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="calendar-today" size={16} color={Brand.CalendarYellow} />
          </View>
          <Text style={{ flex: 1, color: t.text, fontSize: 15, fontWeight: '600' }}>Calendar View</Text>
          <Icon name="keyboard-arrow-right" size={24} color={t.muted} />
        </View>
      </Card>
    </Pressable>
  );
}

function CircularProgress({ value, color, track, size = 80, stroke = 7 }: { value: number; color: string; track: string; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute' }}>
        <Circle cx={size / 2} cy={size / 2} r={r} stroke={track} strokeWidth={stroke} fill="none" />
        {value > 0 && <Circle cx={size / 2} cy={size / 2} r={r} stroke={color} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${(c * value) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </Svg>
      <Text style={{ color, fontSize: 13, fontWeight: '700' }}>{`${value}%`}</Text>
    </View>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  const { t } = useTheme();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: t.muted, fontSize: 11 }}>{label}</Text>
      <Text style={{ color, fontSize: 16, fontWeight: '700' }}>{value}</Text>
    </View>
  );
}

export type OverviewValues = { score: number | null; monthChange: number | null; yearChange: number | null; total: number | null };

/** OVERVIEW card: circular score and the Score / Month / Year / Total stats ("—" when there is not enough data). */
export function OverviewCard({ values, accent }: { values: OverviewValues; accent: string }) {
  const { t } = useTheme();
  const ph = '—';
  const trend = (v: number | null) => ({ text: v === null ? ph : signed(v), color: v === null ? t.muted : isTrendUp(v) ? Brand.Green : Brand.Error });
  const month = trend(values.monthChange);
  const year = trend(values.yearChange);
  return (
    <View testID="overview">
      <SectionTitle text="OVERVIEW" color={accent} />
      <Card style={{ marginTop: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 20, paddingHorizontal: 20, paddingVertical: 16 }}>
          <CircularProgress value={values.score ?? 0} color={accent} track={t.track} />
          <View style={{ flex: 1, gap: 12 }}>
            <View style={{ flexDirection: 'row' }}>
              <Stat label="Score" value={values.score !== null ? `${values.score}%` : ph} color={values.score !== null ? t.text : t.muted} />
              <Stat label="Month" value={month.text} color={month.color} />
            </View>
            <View style={{ flexDirection: 'row' }}>
              <Stat label="Year" value={year.text} color={year.color} />
              <Stat label="Total" value={values.total !== null ? String(values.total) : ph} color={values.total !== null ? t.text : t.muted} />
            </View>
          </View>
        </View>
      </Card>
    </View>
  );
}

/** Shown in a habit's details while it is archived: explains the state and offers Unarchive. */
export function ArchivedBanner({ onUnarchive }: { onUnarchive: () => void }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 12, backgroundColor: t.faint, borderWidth: 1, borderColor: t.border, paddingLeft: 14, paddingRight: 8, paddingVertical: 8 }}>
      <Icon name="archive" size={15} color={t.muted} />
      <Text style={{ flex: 1, color: t.muted, fontSize: 12 }}>Archived · hidden from Home, still tracked</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Unarchive" onPress={onUnarchive} style={{ borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
        <Text style={{ color: Brand.Green, fontSize: 12, fontWeight: '600' }}>Unarchive</Text>
      </Pressable>
    </View>
  );
}
