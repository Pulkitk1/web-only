/**
 * Lets the user choose rest days for future weeks (android HabitDetailScreen.kt `EditRestDaysSheet`). Changes apply from
 * tomorrow, so today and all past days keep the schedule they had. Save is disabled until something changes, and at
 * least one day must stay active. Days per week follows from the rest days (7 minus rest days).
 */
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { GhostButton, GradientButton } from '@/components/ui/Buttons';
import { CloseButton } from '@/components/ui/CloseButton';
import { BottomSheet } from '@/components/ui/overlays';
import { parseRestDays } from '@/domain/schedule';
import { useTheme } from '@/hooks/useTheme';
import { Brand } from '@/theme';
import { withAlpha } from '@/utils/color';
import { WEEKDAYS } from '@/utils/date';
import { RestDayChip } from './RestDayChip';

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>) => a.size === b.size && [...a].every((x) => b.has(x));

export function EditRestDaysSheet({ visible, currentRestDays, onDismiss, onSave }: { visible: boolean; currentRestDays: string[]; onDismiss: () => void; onSave: (rest: string[]) => void }) {
  const { t } = useTheme();
  const initial = useMemo(() => parseRestDays(currentRestDays), [currentRestDays]);
  const [selected, setSelected] = useState<Set<string>>(new Set(initial));
  useEffect(() => {
    if (visible) setSelected(new Set(initial));
  }, [visible, initial]);

  const activeCount = 7 - selected.size;
  const canSave = !sameSet(selected, initial) && activeCount > 0;
  const toggle = (day: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(day)) n.delete(day);
      else n.add(day);
      return n;
    });

  return (
    <BottomSheet visible={visible} onDismiss={onDismiss}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 16, paddingBottom: 4 }}>
        <Text style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 }}>Edit Rest Days</Text>
        <CloseButton onPress={onDismiss} />
      </View>
      <Text style={{ color: t.muted, fontSize: 13, marginBottom: 20 }}>Select the days you want to take a break.</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, rowGap: 14, marginBottom: 16 }}>
        {WEEKDAYS.map((day) => (
          <RestDayChip key={day} day={day} isRest={selected.has(day)} onPress={() => toggle(day)} />
        ))}
      </View>
      <Text style={{ color: activeCount === 0 ? Brand.Error : t.text, fontSize: 13, fontWeight: '600', marginBottom: 12 }}>
        {activeCount === 0
          ? 'At least one day must stay active.'
          : `${activeCount} active ${activeCount === 1 ? 'day' : 'days'} · ${selected.size} rest ${selected.size === 1 ? 'day' : 'days'}`}
      </Text>
      <Text
        style={{
          color: withAlpha(Brand.Blue, 0.8),
          fontSize: 12,
          marginBottom: 20,
          borderRadius: 12,
          backgroundColor: withAlpha(Brand.Blue, 0.08),
          borderWidth: 1,
          borderColor: withAlpha(Brand.Blue, 0.2),
          paddingHorizontal: 14,
          paddingVertical: 10,
          overflow: 'hidden',
        }}
      >
        Changes will apply from tomorrow. Your past progress and streak history will remain unchanged.
      </Text>
      <GradientButton text="Save Changes" onPress={() => canSave && onSave(WEEKDAYS.filter((d) => selected.has(d)))} colors={[Brand.Green, `${Brand.Green}CC`]} contentColor="#000000" enabled={canSave} />
      <GhostButton text="Cancel" onPress={onDismiss} style={{ marginTop: 8, marginBottom: 8 }} />
    </BottomSheet>
  );
}
