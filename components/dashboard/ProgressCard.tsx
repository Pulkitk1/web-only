import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { ProgressIcon, progressOf } from '@/components/ui/ProgressIcon';
import { useAnimatedNumber } from '@/hooks/useAnimatedNumber';
import { useTheme } from '@/hooks/useTheme';
import { Brand, type HomePalette } from '@/theme';
import { withAlpha } from '@/utils/color';
import { formatWeekdayMonthDay, type DateKey } from '@/utils/date';

type Props = { day: DateKey; today: DateKey; done: number; total: number; p: HomePalette; onGuestBonus: () => void; onMissedDay: () => void };

/** "Today's Progress" card with the two demo actions (HabitsScreen.kt `ProgressCard`). */
export function ProgressCard({ day, today, done, total, p, onGuestBonus, onMissedDay }: Props) {
  const { t, isDark } = useTheme();
  const fraction = useAnimatedNumber(total === 0 ? 0 : done / total, 500);
  const gold = isDark ? Brand.Gold : Brand.GoldInk;
  const blue = isDark ? Brand.BlueAlt : '#1D6FD6';
  const title = day === today ? "Today's Progress" : `Progress · ${formatWeekdayMonthDay(day)}`;
  const status = total === 0 ? 'Add a habit to get started' : done === total ? 'All habits done! Great work 🎉' : `${total - done} more to go — keep it up!`;

  return (
    <View
      style={{
        marginTop: 8,
        marginHorizontal: 4,
        backgroundColor: p.card,
        borderWidth: 1,
        borderColor: p.cardBorder,
        borderRadius: 20,
        padding: 18,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingBottom: 14 }}>
        <ProgressIcon progress={progressOf(done, total)} size={36} />
        <Text numberOfLines={1} style={{ flex: 1, marginLeft: 12, color: t.text, fontSize: 18, fontWeight: '700' }}>
          {title}
        </Text>
        <Text style={{ color: Brand.GreenAlt, fontSize: 18, fontWeight: '700' }}>{`${done}/${total}`}</Text>
      </View>
      <View style={{ height: 8, borderRadius: 50, overflow: 'hidden', backgroundColor: p.track }}>
        <View style={{ height: 8, width: `${fraction * 100}%`, borderRadius: 50, backgroundColor: Brand.GreenAlt }} />
      </View>
      <Text style={{ marginTop: 10, color: t.muted, fontSize: 13 }}>{status}</Text>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <ActionButton label="Guest Bonus" content={gold} frame={Brand.Gold} onPress={onGuestBonus} icon={<Icon name="card-giftcard" size={18} color={gold} />} />
        <ActionButton label="Missed Day?" content={blue} frame={Brand.Blue} onPress={onMissedDay} icon={<Icon name="ac-unit" size={18} color={blue} />} />
      </View>
    </View>
  );
}

function ActionButton({ label, content, frame, onPress, icon }: { label: string; content: string; frame: string; onPress: () => void; icon: ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        height: 46,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 8,
        borderRadius: 14,
        backgroundColor: withAlpha(frame, 0.1),
        borderWidth: 1,
        borderColor: withAlpha(frame, 0.6),
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {icon}
      <View style={{ width: 8 }} />
      <Text numberOfLines={1} style={{ color: content, fontSize: 14, fontWeight: '600' }}>
        {label}
      </Text>
    </Pressable>
  );
}
