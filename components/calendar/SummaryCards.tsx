/** "Monthly Completion" and "Habit Health" cards (android HabitCalendarScreen.kt `MonthlyCompletionCard`, `HabitHealthCard`). */
import type { ReactNode } from 'react';
import { Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { FlameColorIcon } from '@/components/ui/FlameIcon';
import { Icon } from '@/components/ui/Icon';
import type { MonthBreakdown } from '@/domain/analytics';
import { consistencyLabel, healthFraction, monthlyPercent } from '@/domain/calendar';
import { rateOf } from '@/domain/analytics';
import { useTheme } from '@/hooks/useTheme';
import type { PeriodStats } from '@/types/habit';
import { monthShortLabel, StatusBadge, type CalendarColors } from './shared';

function SummaryCard({ icon, title, subtitle, colors, style, children }: { icon: 'bar-chart' | 'monitor-heart'; title: string; subtitle: string; colors: CalendarColors; style?: StyleProp<ViewStyle>; children: ReactNode }) {
  const { t } = useTheme();
  return (
    <View style={[{ borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, padding: 12 }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 6 }}>
        <View style={{ marginTop: 1 }}>
          <Icon name={icon} size={18} color={colors.accent} />
        </View>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={2} style={{ color: t.text, fontSize: 14, fontWeight: '700', lineHeight: 17 }}>
            {title}
          </Text>
          <Text numberOfLines={2} style={{ color: t.muted, fontSize: 11, lineHeight: 14 }}>
            {subtitle}
          </Text>
        </View>
      </View>
      <View style={{ height: 10 }} />
      {children}
    </View>
  );
}

function StatLine({ value, label, badge }: { value: number; label: string; badge: ReactNode }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {badge}
      <Text numberOfLines={1} style={{ width: 22, color: t.text, fontSize: 13, fontWeight: '700', textAlign: 'center' }}>
        {value}
      </Text>
      <Text numberOfLines={1} style={{ flexShrink: 1, color: t.muted, fontSize: 12 }}>
        {label}
      </Text>
    </View>
  );
}

export function MonthlyCompletionCard({ month, b, colors, style }: { month: string; b: MonthBreakdown; colors: CalendarColors; style?: StyleProp<ViewStyle> }) {
  const { t } = useTheme();
  const s = b.stats;
  const percent = monthlyPercent(s.completed, s.eligible);
  const size = 96;
  const stroke = 7;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <SummaryCard icon="bar-chart" title="Monthly Completion" subtitle={monthShortLabel(month)} colors={colors} style={style}>
      <View style={{ alignSelf: 'center', width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
        <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ position: 'absolute' }}>
          <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.cell} strokeWidth={stroke} fill="none" />
          {(percent ?? 0) > 0 && (
            <Circle cx={size / 2} cy={size / 2} r={r} stroke={colors.accent} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${(c * percent!) / 100} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
          )}
        </Svg>
        <View style={{ alignItems: 'center' }}>
          <Text style={{ color: t.text, fontSize: 20, fontWeight: '700', lineHeight: 22 }}>{s.completed}</Text>
          <Text style={{ color: t.muted, fontSize: 10, lineHeight: 12 }}>{`of ${s.eligible} days`}</Text>
          <Text style={{ color: colors.accent, fontSize: 13, fontWeight: '700', lineHeight: 16 }}>{percent !== null ? `${percent}%` : '–'}</Text>
        </View>
      </View>
      <View style={{ height: 10 }} />
      <View style={{ gap: 5 }}>
        <StatLine value={s.completed} label="Completed" badge={<StatusBadge state="Done" colors={colors} size={17} />} />
        <StatLine value={b.missed} label="Missed" badge={<StatusBadge state="Missed" colors={colors} size={17} />} />
        <StatLine value={b.restDays} label="Rest days" badge={<StatusBadge state="Rest" colors={colors} size={17} />} />
        <StatLine value={b.frozen} label="Freeze used" badge={<StatusBadge state="Frozen" colors={colors} size={17} />} />
      </View>
    </SummaryCard>
  );
}

/**
 * Current streak (from the shared streak engine) on a gauge filled relative to the personal best, plus a consistency
 * label from the month's completion rate when there are enough days to judge.
 */
export function HabitHealthCard({ streak, best, monthStats, colors, style }: { streak: number; best: number; monthStats: PeriodStats; colors: CalendarColors; style?: StyleProp<ViewStyle> }) {
  const { t } = useTheme();
  const W = 150;
  const H = W / 1.3;
  const stroke = 8;
  const r = (W - stroke) / 2;
  const c = 2 * Math.PI * r;
  const sweep = (c * 240) / 360;
  const fraction = healthFraction(streak, best);
  const label = consistencyLabel(rateOf(monthStats));
  return (
    <SummaryCard icon="monitor-heart" title="Habit Health" subtitle="Current streak & consistency" colors={colors} style={style}>
      {/* Gauge: a 240-degree arc filled by current streak / personal best; the flame and streak sit inside it. */}
      <View style={{ alignSelf: 'center', width: '100%', maxWidth: W, aspectRatio: 1.3, alignItems: 'center', justifyContent: 'flex-end' }}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} style={{ position: 'absolute' }}>
          <Circle cx={W / 2} cy={W / 2} r={r} stroke={colors.cell} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${sweep} ${c}`} transform={`rotate(150 ${W / 2} ${W / 2})`} />
          {fraction > 0 && (
            <Circle cx={W / 2} cy={W / 2} r={r} stroke={colors.accent} strokeWidth={stroke} fill="none" strokeLinecap="round" strokeDasharray={`${sweep * fraction} ${c}`} transform={`rotate(150 ${W / 2} ${W / 2})`} />
          )}
        </Svg>
        <View style={{ paddingBottom: 8, alignItems: 'center' }}>
          {/* The flame is always orange with a yellow centre, whatever the habit's colour; the gauge keeps the accent. */}
          <View style={{ marginBottom: 2 }}>
            <FlameColorIcon size={26} />
          </View>
          <Text numberOfLines={1} style={{ color: t.text, fontSize: 18, fontWeight: '700', lineHeight: 20 }}>
            {streak === 1 ? '1 day' : `${streak} days`}
          </Text>
        </View>
      </View>
      <Text style={{ alignSelf: 'center', marginTop: 2, color: t.muted, fontSize: 11, lineHeight: 14, textAlign: 'center' }}>{`Current streak · best ${best}`}</Text>
      <View style={{ flex: 1, minHeight: 8 }} />
      {label && (
        <Text style={{ color: colors.accent, fontSize: 11, lineHeight: 14, fontWeight: '600', textAlign: 'center', borderRadius: 14, backgroundColor: `${colors.accent}24`, paddingHorizontal: 8, paddingVertical: 6, overflow: 'hidden' }}>{label}</Text>
      )}
    </SummaryCard>
  );
}
