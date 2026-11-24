/**
 * Habit Details (android HabitDetailScreen.kt): top bar with Back / name / pencil / theme, the metadata row (days per
 * week + reminder, each with its "Edit" link), then, in Kotlin's order: streak card, Calendar View, OVERVIEW, the
 * archived banner (while archived), the Goal, the SCORE line chart and the HISTORY bar chart. Local mock data only.
 * The editing actions are unchanged from the editing phase (name/colour dialog, rest days, reminder, goal).
 */
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { StreakCelebration } from '@/components/celebrations/StreakCelebration';
import { BarChart, LineChart, type ChartColors } from '@/components/charts/Charts';
import { Icon } from '@/components/ui/Icon';
import { Toast, useToast } from '@/components/ui/overlays';
import { SquareIconButton } from '@/components/ui/SquareIconButton';
import { rateOf } from '@/domain/analytics';
import { historyMax, historySeries, historyTicks, scoreSeries } from '@/domain/habitDetail';
import { normalizeName, reminderLabel, slugOf } from '@/domain/habitRules';
import { useTheme } from '@/hooks/useTheme';
import { useAppStore } from '@/store/AppStore';
import { Brand } from '@/theme';
import { readableOn } from '@/utils/color';
import { ArchivedBanner, CalendarLink, Card, ChartEmpty, ChartHeader, OverviewCard, StreakCard } from './DetailSections';
import { EditHabitDialog } from './EditHabitDialog';
import { EditReminderSheet } from './EditReminderSheet';
import { EditRestDaysSheet } from './EditRestDaysSheet';
import { EditGoalSheet, GoalSection } from './GoalSection';

// The web app never delivers reminders, so there is no browser permission to be "blocked" on: the bell shows the saved setting (the
// Android app reads it), and the reminder sheet says that the web cannot send reminders yet.

function MetaItem({ icon, label }: { icon: 'calendar-today' | 'notifications-none'; label: string }) {
  const { t } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon name={icon} size={13} color={t.muted} />
      <Text style={{ color: t.muted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

/** Subtle "Edit" link in the habit's colour, shown beside the schedule/reminder label. */
function EditLink({ color, label, onPress }: { color: string; label: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 8, paddingHorizontal: 4, paddingVertical: 2 }}>
      <Icon name="edit" size={12} color={color} />
      <Text style={{ color, fontSize: 12, fontWeight: '600' }}>Edit</Text>
    </Pressable>
  );
}

export function HabitDetailScreen({ slug }: { slug: string }) {
  const { t, isDark, toggle } = useTheme();
  const store = useAppStore();
  const router = useRouter();
  const toast = useToast();

  // The route is the habit's name, so remember which habit it resolved to: after a rename the old slug no longer matches.
  const habitId = useMemo(() => store.habitBySlug(slug)?.id, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  const habit = (habitId ? store.habits.find((h) => h.id === habitId) : undefined) ?? store.habitBySlug(slug);
  const name = habit?.name ?? 'Habit not found';
  // The habit's own colour for the streak card; pale colours are darkened in the light theme for text accents.
  const rawAccent = habit?.color ?? t.muted;
  const accent = readableOn(habit?.color ?? Brand.Green, isDark);
  const streak = habit?.streak ?? 0;
  const overview = habit ? store.habitOverview(habit) : null;

  const scoreData = scoreSeries(overview);
  const historyData = historySeries(overview);
  const histMax = historyMax(historyData);
  const chartColors: ChartColors = {
    grid: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)',
    cursor: isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)',
    label: t.muted,
    tooltipBg: t.card,
    tooltipBorder: t.border,
    tooltipText: t.text,
  };

  const [celebrating, setCelebrating] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [editingRest, setEditingRest] = useState(false);
  const [editingReminder, setEditingReminder] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);

  const back = () => (router.canGoBack() ? router.back() : router.replace('/habits'));

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        {/* Top app bar: both side slots are 72px wide, so the name is centred, even when long. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12 }}>
          <View style={{ width: 72, alignItems: 'flex-start' }}>
            <SquareIconButton onPress={back} size={36} label="Back">
              <Icon name="arrow-back" size={18} color={t.text} />
            </SquareIconButton>
          </View>
          <Text numberOfLines={1} style={{ flex: 1, paddingHorizontal: 8, color: t.text, fontSize: 22, fontWeight: '700', letterSpacing: -0.4, textAlign: 'center' }}>
            {name}
          </Text>
          <View style={{ width: 72, flexDirection: 'row', gap: 8 }}>
            <SquareIconButton onPress={() => habit && setRenaming(true)} size={32} label="Edit habit">
              <Icon name="edit" size={14} color={t.text} />
            </SquareIconButton>
            <SquareIconButton onPress={toggle} size={32} label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
              {isDark ? <Icon name="dark-mode" size={16} color={Brand.Purple} /> : <Icon name="light-mode" size={16} color={Brand.Amber} />}
            </SquareIconButton>
          </View>
        </View>

        {/* Metadata */}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 20, paddingHorizontal: 24, paddingBottom: 12 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MetaItem icon="calendar-today" label={habit && habit.daysPerWeek < 7 ? `${habit.daysPerWeek} days/week` : 'Every day'} />
            {habit && <EditLink color={accent} label="Edit rest days" onPress={() => setEditingRest(true)} />}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <MetaItem icon="notifications-none" label={habit ? reminderLabel(habit, true) : 'Off'} />
            {habit && <EditLink color={accent} label="Edit reminder" onPress={() => setEditingReminder(true)} />}
          </View>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }} showsVerticalScrollIndicator={false}>
          <StreakCard streak={streak} accent={rawAccent} onPress={() => setCelebrating(true)} />

          <View style={{ marginTop: 12, marginBottom: 16 }}>
            <CalendarLink onPress={() => router.push(`/habits/${habit?.slug ?? slug}/calendar`)} />
          </View>

          <View style={{ marginBottom: 16 }}>
            <OverviewCard
              accent={accent}
              values={{
                score: overview ? rateOf(overview.monthToDate) : null,
                monthChange: overview?.monthChange ?? null,
                yearChange: overview?.yearChange ?? null,
                total: overview ? overview.totalCompleted : null,
              }}
            />
          </View>

          {habit?.archived && (
            <View style={{ marginBottom: 16 }}>
              <ArchivedBanner
                onUnarchive={() => {
                  store.setArchived(habit.id, false);
                  toast.show('Habit unarchived · back on Home', 2500);
                }}
              />
            </View>
          )}

          {/* Goal: self-contained, so it can be moved anywhere in this screen. */}
          {habit && (
            <View style={{ marginBottom: 16 }}>
              <GoalSection goal={habit.goal} onEdit={() => setEditingGoal(true)} accent={accent} />
            </View>
          )}

          <ChartHeader title="SCORE" color={accent} />
          <Card style={{ marginTop: 8, marginBottom: 16, paddingLeft: 8, paddingRight: 8, paddingTop: 16, paddingBottom: 8 }}>
            {scoreData.length === 0 ? (
              <ChartEmpty text="Not enough data yet" />
            ) : (
              <LineChart data={scoreData} color={accent} colors={chartColors} yMax={100} yTicks={[20, 40, 60, 80, 100]} yFormat={(n) => `${n}%`} tooltip={(p) => `Score: ${p.value}%`} />
            )}
          </Card>

          <ChartHeader title="HISTORY" color={accent} />
          <Card style={{ marginTop: 8, paddingLeft: 8, paddingRight: 8, paddingTop: 16, paddingBottom: 8 }}>
            {historyData.length === 0 ? (
              <ChartEmpty text="No completions yet" />
            ) : (
              <BarChart data={historyData} color={accent} colors={chartColors} yMax={histMax} yTicks={historyTicks(histMax)} tooltip={(p) => `Completed: ${p.value} days`} />
            )}
          </Card>
        </ScrollView>
      </View>

      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        {habit && (
          <>
            <EditHabitDialog
              visible={renaming}
              currentName={habit.name}
              currentColor={habit.color}
              onDismiss={() => setRenaming(false)}
              onSave={(newName, newColor) => {
                const renamed = normalizeName(newName) !== habit.name;
                const error = store.editHabit(habit.id, newName, newColor);
                if (error === null) {
                  setRenaming(false);
                  // The route is the habit's name: reopen under the new name so a refresh or Back finds it.
                  if (renamed) router.replace(`/habits/${slugOf(normalizeName(newName))}`);
                }
                return error;
              }}
            />
            <EditRestDaysSheet
              visible={editingRest}
              currentRestDays={habit.restDays}
              onDismiss={() => setEditingRest(false)}
              onSave={(rest) => {
                store.updateSchedule(habit.id, 7 - rest.length, rest);
                setEditingRest(false);
                toast.show('Rest days updated from tomorrow', 2500);
              }}
            />
            <EditReminderSheet
              visible={editingReminder}
              enabled={habit.reminderEnabled}
              time={habit.reminderTime}
              accent={accent}
              onDismiss={() => setEditingReminder(false)}
              onSave={(on, time) => {
                store.updateHabitReminder(habit.id, on, time);
                setEditingReminder(false);
                toast.show(on ? 'Reminder saved' : 'Reminder turned off', 2000);
              }}
            />
            <EditGoalSheet
              visible={editingGoal}
              goal={habit.goal}
              onDismiss={() => setEditingGoal(false)}
              onSave={(goal) => {
                store.updateGoal(habit.id, goal);
                setEditingGoal(false);
                toast.show('Goal saved', 2000);
              }}
            />
          </>
        )}
        <Toast message={toast.message} bottomOffset={28} />
        {celebrating && <StreakCelebration habitName={name} streak={streak} onClose={() => setCelebrating(false)} />}
      </View>
    </View>
  );
}
