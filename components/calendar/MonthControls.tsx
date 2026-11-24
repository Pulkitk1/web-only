/**
 * Month navigation: the header ( ‹ [calendar  Nov 2026  ▾] › ) and the "Select Month & Year" sheet with its horizontal month
 * strip (android HabitCalendarScreen.kt `MonthHeader`, `MonthPickerSheet`; ui/components/HorizontalMonthStrip.kt).
 */
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import type { ComponentRef } from 'react';

import { GhostButton, GradientButton } from '@/components/ui/Buttons';
import { CloseButton } from '@/components/ui/CloseButton';
import { Icon } from '@/components/ui/Icon';
import { BottomSheet } from '@/components/ui/overlays';
import { MonthStripRules } from '@/domain/calendar';
import { useTheme } from '@/hooks/useTheme';
import { Coral } from '@/theme';
import { addMonths, type MonthKey } from '@/utils/date';
import { monthShortLabel, type CalendarColors } from './shared';

const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function ArrowButton({ icon, enabled, label, onPress, colors }: { icon: 'chevron-left' | 'chevron-right'; enabled: boolean; label: string; onPress: () => void; colors: CalendarColors }) {
  const { t } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, opacity: enabled ? 1 : 0.4 }}
    >
      <Icon name={icon} size={24} color={t.text} />
    </Pressable>
  );
}

export function MonthHeader({ month, first, last, colors, onChange, onOpenPicker }: { month: MonthKey; first: MonthKey; last: MonthKey; colors: CalendarColors; onChange: (m: MonthKey) => void; onOpenPicker: () => void }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8 }}>
      <ArrowButton icon="chevron-left" label="Previous month" enabled={MonthStripRules.canPreviousMonth(month, first)} onPress={() => onChange(addMonths(month, -1))} colors={colors} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose month and year"
        onPress={onOpenPicker}
        style={{ flex: 1, height: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border }}
      >
        <Icon name="calendar-today" size={16} color={colors.accent} />
        <Text style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>{monthShortLabel(month)}</Text>
        <Icon name="arrow-drop-down" size={22} color={t.muted} />
      </Pressable>
      <ArrowButton icon="chevron-right" label="Next month" enabled={MonthStripRules.canNextMonth(month, last)} onPress={() => onChange(addMonths(month, 1))} colors={colors} />
    </View>
  );
}

const VISIBLE_CHIPS = 5;

/** Every month of the range in one strip, five visible at a time, scrolled so the selected month is centred. */
function HorizontalMonthStrip({ first, last, selected, onSelect }: { first: MonthKey; last: MonthKey; selected: MonthKey; onSelect: (m: MonthKey) => void }) {
  const { t, isDark } = useTheme();
  const ref = useRef<ComponentRef<typeof ScrollView>>(null);
  const [width, setWidth] = useState(0);
  const count = MonthStripRules.indexOf(first, last) + 1;
  const chip = width > 0 ? width / VISIBLE_CHIPS : 60;
  const index = MonthStripRules.indexOf(first, selected);
  useEffect(() => {
    if (width > 0) ref.current?.scrollTo({ x: Math.max(0, (index - 2) * chip), animated: false });
  }, [index, chip, width]);
  return (
    <ScrollView ref={ref} horizontal showsHorizontalScrollIndicator={false} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexGrow: 0 }}>
      {Array.from({ length: count }, (_, i) => {
        const m = addMonths(first, i);
        const sel = i === index;
        return (
          <Pressable
            key={m}
            accessibilityRole="button"
            accessibilityLabel={`${monthShortLabel(m)}`}
            accessibilityState={{ selected: sel }}
            onPress={() => onSelect(m)}
            style={{ width: chip, height: 46, padding: 2 }}
          >
            <View style={{ flex: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: sel ? Coral : isDark ? '#262626' : '#EFEFEF' }}>
              <Text style={{ color: sel ? '#FFFFFF' : t.text, fontSize: 13, fontWeight: '700', lineHeight: 15 }}>{MONTH_ABBR[Number(m.slice(5)) - 1]}</Text>
              <Text style={{ color: sel ? 'rgba(255,255,255,0.85)' : t.muted, fontSize: 10, lineHeight: 12 }}>{m.slice(0, 4)}</Text>
            </View>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Pick any month in range with a draft selection that only applies on "Apply". */
export function MonthPickerSheet({ visible, selected, first, last, onDismiss, onApply }: { visible: boolean; selected: MonthKey; first: MonthKey; last: MonthKey; onDismiss: () => void; onApply: (m: MonthKey) => void }) {
  const { t } = useTheme();
  const [draft, setDraft] = useState(selected);
  useEffect(() => {
    if (visible) setDraft(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const year = draft.slice(0, 4);
  const canPrev = MonthStripRules.canPreviousYear(draft, first);
  const canNext = MonthStripRules.canNextYear(draft, last);
  return (
    <BottomSheet visible={visible} onDismiss={onDismiss}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 16 }}>
        <Text style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 }}>Select Month &amp; Year</Text>
        <CloseButton onPress={onDismiss} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Previous year" disabled={!canPrev} onPress={() => setDraft(MonthStripRules.previousYear(draft, first))} style={{ padding: 8, opacity: canPrev ? 1 : 0.35 }}>
          <Icon name="chevron-left" size={26} color={t.text} />
        </Pressable>
        <Text style={{ width: 110, textAlign: 'center', color: t.text, fontSize: 18, fontWeight: '700' }}>{year}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Next year" disabled={!canNext} onPress={() => setDraft(MonthStripRules.nextYear(draft, last))} style={{ padding: 8, opacity: canNext ? 1 : 0.35 }}>
          <Icon name="chevron-right" size={26} color={t.text} />
        </Pressable>
      </View>
      <View style={{ marginBottom: 24 }}>
        <HorizontalMonthStrip first={first} last={last} selected={draft} onSelect={setDraft} />
      </View>
      <GradientButton text="Apply" onPress={() => onApply(draft)} colors={[Coral, '#FF8A3D']} contentColor="#FFFFFF" />
      <GhostButton text="Cancel" onPress={onDismiss} style={{ marginTop: 8 }} />
    </BottomSheet>
  );
}
