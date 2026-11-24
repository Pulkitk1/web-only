/**
 * Settings › Archived Habits (android ArchivedHabits.kt `ArchivedHabitsScreen`): every archived habit, openable as usual,
 * with Unarchive. An archived habit is only hidden from Home; it keeps being tracked exactly as before, and unarchiving
 * only flips the flag, so its completions, streaks, schedule history and place in the list are untouched.
 */
import { useRouter } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { StreakBadge } from '@/components/dashboard/CreateHabitSheet';
import { Icon } from '@/components/ui/Icon';
import { SquareIconButton } from '@/components/ui/SquareIconButton';
import { archivedHabits } from '@/domain/archive';
import { useTheme } from '@/hooks/useTheme';
import { useAppStore, type HabitView } from '@/store/AppStore';
import { Brand } from '@/theme';
import { readableOn, withAlpha } from '@/utils/color';

function ArchivedHabitRow({ habit, onOpen, onUnarchive }: { habit: HabitView; onOpen: () => void; onUnarchive: () => void }) {
  const { isDark } = useTheme();
  const accent = readableOn(habit.color, isDark);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 16, backgroundColor: withAlpha(accent, isDark ? 0.12 : 0.08), borderWidth: 1, borderColor: withAlpha(accent, 0.25), paddingRight: 12 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${habit.name}`} onPress={onOpen} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 16, paddingVertical: 14 }}>
        <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: accent }} />
        <View style={{ flex: 1 }}>
          <Text style={{ color: accent, fontSize: 15, fontWeight: '700' }}>{habit.name}</Text>
          {habit.restDays.length > 0 && <Text style={{ color: Brand.Blue, fontSize: 10, fontWeight: '500' }}>{`Rest: ${habit.restDays.join(', ')}`}</Text>}
        </View>
        <StreakBadge streak={habit.streak} />
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Unarchive ${habit.name}`}
        onPress={onUnarchive}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: 12, backgroundColor: withAlpha(Brand.Green, 0.12), borderWidth: 1, borderColor: withAlpha(Brand.Green, 0.35), paddingHorizontal: 10, paddingVertical: 7 }}
      >
        <Icon name="unarchive" size={14} color={Brand.Green} />
        <Text style={{ color: Brand.Green, fontSize: 12, fontWeight: '600' }}>Unarchive</Text>
      </Pressable>
    </View>
  );
}

function EmptyArchive() {
  const { t } = useTheme();
  return (
    <View style={{ marginTop: 48, alignItems: 'center', gap: 8, borderRadius: 16, backgroundColor: t.card, borderWidth: 1, borderColor: t.border, padding: 28 }}>
      <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: t.faint, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="archive" size={26} color={t.muted} />
      </View>
      <Text style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>No archived habits</Text>
      <Text style={{ color: t.muted, fontSize: 13, textAlign: 'center', lineHeight: 19 }}>Archive a habit from its ⋮ menu on Home to hide it there. It keeps being tracked and shows up here.</Text>
    </View>
  );
}

export function ArchivedHabitsScreen() {
  const { t } = useTheme();
  const store = useAppStore();
  const router = useRouter();
  const archived = archivedHabits(store.habits);
  const back = () => (router.canGoBack() ? router.back() : router.replace('/settings'));
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 8 }}>
          <SquareIconButton onPress={back} size={36} label="Back">
            <Icon name="arrow-back" size={18} color={t.text} />
          </SquareIconButton>
          <Text accessibilityRole="header" style={{ flex: 1, color: t.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.4 }}>
            Archived Habits
          </Text>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 24, gap: 12 }} showsVerticalScrollIndicator={false}>
          {archived.length === 0 ? (
            <EmptyArchive />
          ) : (
            <>
              <Text style={{ color: t.muted, fontSize: 12, paddingLeft: 4, marginBottom: 4 }}>Hidden from Home, still tracked. Streaks, reminders and rewards continue as usual.</Text>
              {archived.map((h) => (
                <ArchivedHabitRow key={h.id} habit={h} onOpen={() => router.push(`/habits/${h.slug}`)} onUnarchive={() => store.setArchived(h.id, false)} />
              ))}
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}
