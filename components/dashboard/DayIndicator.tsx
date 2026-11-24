import { useEffect } from 'react';
import { Animated, Pressable, Text } from 'react-native';

import { Icon } from '@/components/ui/Icon';
import { TickMark } from '@/components/ui/TickMark';
import { spring, timing, useValue } from '@/hooks/useAnim';
import { useTheme } from '@/hooks/useTheme';
import { Brand, type HomePalette } from '@/theme';
import { withAlpha } from '@/utils/color';
import { formatWeekdayMonthDay, isAfter, type DateKey } from '@/utils/date';

type Props = {
  habitName: string;
  date: DateKey;
  today: DateKey;
  size: number;
  accent: string;
  onAccent: string;
  p: HomePalette;
  done: boolean;
  frozen: boolean;
  rest: boolean;
  /** This circle's rest-day completion is being celebrated: a small bounce. */
  celebrated?: boolean;
  onToggle: () => void;
};

/**
 * One day of a habit (HabitsScreen.kt `DayIndicator`): done (habit colour + tick), frozen (snowflake), planned rest day
 * (habit-coloured "R"), upcoming (empty outline, not tappable) or missed (grey x). Done wins over freeze, and freeze over rest.
 */
export function DayIndicator({ habitName, date, today, size, accent, onAccent, p, done, frozen, rest, celebrated = false, onToggle }: Props) {
  const { t } = useTheme();
  const future = isAfter(date, today);

  // Small bounce on the circle whose rest-day completion is being celebrated (140 ms up to 1.3, then a spring back).
  const bounce = useValue(1);
  useEffect(() => {
    if (!celebrated) return;
    const anim = Animated.sequence([timing(bounce, 1.3, 140), spring(bounce, 1, 0.4, 400)]);
    anim.start();
    return () => anim.stop();
  }, [celebrated, bounce]);

  const bg = done
    ? accent
    : frozen
      ? withAlpha(Brand.Blue, 0.2)
      : rest
        ? future
          ? withAlpha(accent, 0.5)
          : accent
        : future
          ? 'transparent'
          : p.missed;
  const border = frozen ? withAlpha(Brand.Blue, 0.75) : future && !rest ? p.missed : 'transparent';
  const glyph = size * 0.48;
  const state = done ? 'done' : frozen ? 'frozen' : rest ? 'rest day' : future ? 'upcoming' : 'missed';

  return (
    <Animated.View style={{ transform: [{ scale: bounce }] }}>
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={`${habitName}, ${formatWeekdayMonthDay(date)}, ${state}`}
      accessibilityState={{ checked: done, disabled: future }}
      disabled={future}
      onPress={onToggle}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: bg,
        borderWidth: 1.5,
        borderColor: border,
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {done ? (
        <TickMark size={size * 0.46} color={onAccent} strokeWidth={1.8} />
      ) : frozen ? (
        <Text style={{ color: '#7EC8FF', fontSize: glyph, lineHeight: glyph }}>❄</Text>
      ) : rest ? (
        <Text style={{ color: future ? withAlpha(t.text, 0.7) : onAccent, fontSize: glyph, lineHeight: glyph, fontWeight: '700' }}>R</Text>
      ) : future ? null : (
        <Icon name="close" size={glyph} color={p.missedMark} />
      )}
    </Pressable>
    </Animated.View>
  );
}
