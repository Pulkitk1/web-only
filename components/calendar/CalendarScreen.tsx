/**
 * Calendar View (android HabitCalendarScreen.kt): app bar, month header, schedule pill, Monthly Completion + Habit Health
 * cards, the month grid, legend, rest-days banner, EDIT/DONE, and "Best streaks". Every interaction is Kotlin's: single tap,
 * double tap (mark done / not done), edit mode, the freeze and completed-day sheets (with notes), the month picker and the
 * schedule editor. All state lives in the shared AppStore, so the dashboard and Habit Details stay consistent.
 */
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { RestDayCelebration } from '@/components/celebrations/RestDayCelebration';
import { GhostButton } from '@/components/ui/Buttons';
import { Icon } from '@/components/ui/Icon';
import { CenterModal, Toast, useToast } from '@/components/ui/overlays';
import { SquareIconButton } from '@/components/ui/SquareIconButton';
import {
  bestStreakRows,
  calendarRange,
  coerceMonth,
  DEMO_BEST_STREAKS,
  DEMO_MAX_STREAK_DAYS,
  dayStateOf,
  firstMonth,
  inRange,
  lastMonth,
  tileDoubleTap,
  tileTap,
  type DayContext,
  type TapAction,
} from '@/domain/calendar';
import { useTheme } from '@/hooks/useTheme';
import { useAppStore } from '@/store/AppStore';
import { Brand } from '@/theme';
import { withAlpha } from '@/utils/color';
import { monthKeyOf, parseKey, type DateKey, type MonthKey } from '@/utils/date';
import { Legend, MonthGridCard, StreakRow } from './MonthGrid';
import { MonthHeader, MonthPickerSheet } from './MonthControls';
import { CompletedDaySheet, FreezeSheet, ScheduleSheet } from './Sheets';
import { useCalendarColors } from './shared';
import { HabitHealthCard, MonthlyCompletionCard } from './SummaryCards';

const SHORT_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const shortName = (d: DateKey) => SHORT_DAYS[parseKey(d)!.getDay()];
/** Weekday order for the "Rest:" line, Monday first like the rest of the app. */
const WEEK_ORDER = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function Dot({ color, size }: { color: string; size: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />;
}

export function CalendarScreen({ slug }: { slug: string }) {
  const { t, isDark, toggle } = useTheme();
  const store = useAppStore();
  const router = useRouter();
  const toast = useToast();
  const today = store.today;

  // The route is the habit's name: remember which habit it resolved to so a rename keeps this screen on it.
  const habitId = useMemo(() => store.habitBySlug(slug)?.id, [slug]); // eslint-disable-line react-hooks/exhaustive-deps
  const habit = (habitId ? store.habits.find((h) => h.id === habitId) : undefined) ?? store.habitBySlug(slug);
  const habitName = habit?.name ?? (slug.split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') || 'SQL Practice');
  const colors = useCalendarColors(habit?.color ?? Brand.CalendarYellow);

  const [editMode, setEditMode] = useState(false);
  const [showSchedule, setShowSchedule] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [freezeDay, setFreezeDay] = useState<DateKey | null>(null);
  const [noteDay, setNoteDay] = useState<DateKey | null>(null);
  const [deleteDay, setDeleteDay] = useState<DateKey | null>(null);
  const [selected, setSelected] = useState<DateKey>(today);
  const [monthState, setMonthState] = useState<MonthKey>(monthKeyOf(today));
  const [width, setWidth] = useState(0);
  // The demo schedule only applies when no habit matches the route.
  const [demo, setDemo] = useState({ days: 5, rest: ['Sat', 'Sun'] });
  const restDayNames = habit ? habit.restDays : demo.rest;
  const daysPerWeek = habit ? habit.daysPerWeek : demo.days;

  const firstActivity = habit ? [habit.createdDate, ...habit.completedDates].reduce((a, b) => (a < b ? a : b)) : null;
  const range = useMemo(() => calendarRange(firstActivity, today), [firstActivity, today]);
  const first = firstMonth(range);
  const last = lastMonth(range);
  const month = coerceMonth(monthState, first, last);
  const showMonth = (m: MonthKey) => setMonthState(coerceMonth(m, first, last));

  const doneSet = useMemo(() => new Set(habit?.completedDates ?? []), [habit?.completedDates]);
  const ctx: DayContext = {
    month,
    today,
    range,
    isRest: (d) => inRange(range, d) && (habit ? store.isRestDay(habit, d) : restDayNames.includes(shortName(d))),
    isDone: (d) => doneSet.has(d),
    isFrozen: (d) => (habit ? store.isFreezeDate(habit.id, d) : false),
    createdOn: habit?.createdDate ?? null,
  };
  /** Note marker: only on completed, missed or frozen days that can hold a note. */
  const hasNote = (d: DateKey) => (habit ? store.noteFor(habit.id, d) !== null && store.canHaveNote(habit, d) : false);

  const run = (a: TapAction, d: DateKey) => {
    switch (a.kind) {
      case 'toast':
        toast.show(a.message);
        break;
      case 'toggle':
        if (habit) store.toggleHabitDate(habit.id, d);
        if (a.message) toast.show(a.message);
        break;
      case 'note':
        setNoteDay(d);
        break;
      case 'freeze':
        setFreezeDay(d);
        break;
    }
  };
  const onTap = (d: DateKey) => {
    if (monthKeyOf(d) !== month) {
      showMonth(monthKeyOf(d));
      setSelected(d);
      return;
    }
    setSelected(d);
    run(tileTap({ c: ctx, d, hasHabit: !!habit, editMode, canNote: habit ? store.canHaveNote(habit, d) : false }), d);
  };
  const onDoubleTap = (d: DateKey) => {
    if (monthKeyOf(d) !== month) return;
    setSelected(d);
    run(tileDoubleTap({ c: ctx, d, hasHabit: !!habit }), d);
  };

  const back = () => (router.canGoBack() ? router.back() : router.replace(`/habits/${habit?.slug ?? slug}`));
  const noteHooks = (d: DateKey | null) =>
    habit && d
      ? {
          noteFor: store.noteFor(habit.id, d),
          onSave: (text: string) => {
            const r = store.saveNote(habit.id, d, text);
            toast.show(r.message, r.ok ? 2000 : 2800);
            return r.ok;
          },
          onRequestDelete: () => setDeleteDay(d),
        }
      : { noteFor: null, onSave: () => false, onRequestDelete: () => {} };

  const breakdown = habit ? store.habitMonth(habit, month) : { stats: { completed: 0, eligible: 0 }, missed: 0, restDays: 0, frozen: 0 };
  const sideBySide = width >= 330;
  const rows = habit ? bestStreakRows(habit.streakRuns) : DEMO_BEST_STREAKS;
  const maxDays = rows.reduce((m, r) => Math.max(m, r.days), 0) || DEMO_MAX_STREAK_DAYS;

  // Wallet notices (e.g. a reward) raised while this screen is open.
  const { walletNotice, consumeWalletNotice, restDayCelebration, consumeRestDayCelebration } = store;
  useEffect(() => {
    if (!walletNotice) return;
    toast.show(walletNotice, 3000);
    consumeWalletNotice();
  }, [walletNotice, consumeWalletNotice, toast.show]);

  const completedSheetHabit = habit;
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }}>
          <SquareIconButton onPress={back} size={36} label="Back">
            <Icon name="arrow-back" size={18} color={t.text} />
          </SquareIconButton>
          <Text accessibilityRole="header" style={{ flex: 1, color: t.text, fontSize: 24, fontWeight: '700', letterSpacing: -0.5 }}>
            Calendar
          </Text>
          <SquareIconButton onPress={toggle} size={36} label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}>
            {isDark ? <Icon name="dark-mode" size={16} color={Brand.Purple} /> : <Icon name="light-mode" size={16} color={Brand.Amber} />}
          </SquareIconButton>
          <SquareIconButton onPress={() => {}} size={36} label="More">
            <Icon name="more-vert" size={16} color={t.muted} />
          </SquareIconButton>
        </View>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }} showsVerticalScrollIndicator={false}>
          {/* Applied month: the arrows act at once; the label opens the picker, which only changes it on Apply. */}
          <MonthHeader month={month} first={first} last={last} colors={colors} onChange={showMonth} onOpenPicker={() => setShowPicker(true)} />

          {/* Schedule pill (opens the schedule editor) */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 4, paddingBottom: 12 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit schedule"
              onPress={() => setShowSchedule(true)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 20, backgroundColor: withAlpha(colors.accent, 0.1), borderWidth: 1, borderColor: withAlpha(colors.accent, 0.35), paddingHorizontal: 12, paddingVertical: 6, marginTop: 8 }}
            >
              <Dot color={colors.accent} size={7} />
              <Text style={{ color: colors.accent, fontSize: 12, fontWeight: '600' }}>{`Schedule: ${daysPerWeek} days/week`}</Text>
            </Pressable>
            {restDayNames.length > 0 && <Text style={{ color: t.muted, fontSize: 11, marginTop: 8 }}>{`Rest: ${WEEK_ORDER.filter((d) => restDayNames.includes(d)).join(', ')}`}</Text>}
          </View>

          {/* Summary cards side by side; stacked when the screen is too narrow. */}
          <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={{ flexDirection: sideBySide ? 'row' : 'column', gap: sideBySide ? 8 : 10, alignItems: 'stretch' }}>
            <MonthlyCompletionCard month={month} b={breakdown} colors={colors} style={sideBySide ? { flex: 1 } : undefined} />
            <HabitHealthCard streak={habit?.streak ?? 0} best={habit?.bestStreak ?? 0} monthStats={breakdown.stats} colors={colors} style={sideBySide ? { flex: 1 } : undefined} />
          </View>

          <MonthGridCard month={month} selected={selected} colors={colors} stateOf={(d) => dayStateOf(ctx, d)} isRest={ctx.isRest} hasNote={hasNote} editMode={editMode} onTap={onTap} onDoubleTap={onDoubleTap} />
          <Legend colors={colors} />
          {restDayNames.length > 0 && (
            <View style={{ marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, backgroundColor: withAlpha(colors.accent, 0.08), borderWidth: 1, borderColor: withAlpha(colors.accent, 0.2), paddingHorizontal: 12, paddingVertical: 8 }}>
              <Dot color={colors.accent} size={5} />
              <Text style={{ flex: 1, color: t.muted, fontSize: 11 }}>Rest days don&apos;t break your streak. Only missing an active day breaks streak.</Text>
            </View>
          )}

          {/* Edit / Done */}
          <Pressable accessibilityRole="button" accessibilityLabel={editMode ? 'Done editing' : 'Edit days'} onPress={() => setEditMode((v) => !v)} style={{ alignSelf: 'center', marginTop: 8, borderRadius: 8, paddingHorizontal: 16, paddingVertical: 6 }}>
            <Text style={{ color: editMode ? colors.accent : t.muted, fontSize: 12, fontWeight: '700', letterSpacing: 1.5 }}>{editMode ? 'DONE' : 'EDIT'}</Text>
          </Pressable>
          {editMode && <Text style={{ alignSelf: 'center', color: withAlpha(colors.accent, 0.6), fontSize: 11, marginBottom: 16 }}>Tap active days to mark</Text>}

          {/* Best streaks */}
          <View style={{ paddingVertical: 4 }}>
            <View style={{ height: 1, backgroundColor: t.border, marginBottom: 20 }} />
            <Text style={{ color: t.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 }}>Best streaks</Text>
            <Text style={{ color: t.muted, fontSize: 12, marginTop: 4, marginBottom: 16 }}>{habitName}</Text>
            <View style={{ borderRadius: 18, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 14, paddingVertical: 4 }}>
              {rows.map((row, i) => (
                <View key={`${row.start}-${row.end}`}>
                  <StreakRow row={row} maxDays={maxDays} colors={colors} />
                  {i < rows.length - 1 && <View style={{ height: 1, backgroundColor: t.border }} />}
                </View>
              ))}
            </View>
          </View>
        </ScrollView>
      </View>

      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}>
        <MonthPickerSheet
          visible={showPicker}
          selected={month}
          first={first}
          last={last}
          onApply={(m) => {
            showMonth(m);
            setShowPicker(false);
          }}
          onDismiss={() => setShowPicker(false)}
        />
        {habit && (
          <FreezeSheet
            habit={habit}
            date={freezeDay}
            note={noteHooks(freezeDay)}
            onDismiss={() => setFreezeDay(null)}
            onUse={async (d) => {
              const r = await store.applyFreeze(habit.id, d);
              if (!r.message) return; // a second tap while a freeze was already being applied
              if (r.ok) setFreezeDay(null);
              toast.show(r.ok ? `❄️ ${r.message}` : r.message, 2500);
            }}
            onWallet={() => {
              setFreezeDay(null);
              router.push('/wallet');
            }}
          />
        )}
        {completedSheetHabit && <CompletedDaySheet habit={completedSheetHabit} date={noteDay} rest={noteDay ? ctx.isRest(noteDay) : false} note={noteHooks(noteDay)} onDismiss={() => setNoteDay(null)} />}
        <CenterModal visible={deleteDay !== null} onDismiss={() => setDeleteDay(null)}>
          <Text style={{ alignSelf: 'flex-start', color: t.text, fontSize: 20, fontWeight: '700', marginBottom: 12 }}>Delete note?</Text>
          <Text style={{ alignSelf: 'flex-start', color: t.muted, fontSize: 14, lineHeight: 20, marginBottom: 20 }}>This removes only the note. The day&apos;s freeze and your streak stay the same.</Text>
          <View style={{ alignSelf: 'stretch', flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
            <View style={{ width: 110 }}>
              <GhostButton text="Cancel" onPress={() => setDeleteDay(null)} />
            </View>
            <View style={{ width: 110 }}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  if (habit && deleteDay) {
                    const r = store.deleteNote(habit.id, deleteDay);
                    toast.show(r.message, r.ok ? 2000 : 2800);
                  }
                  setDeleteDay(null);
                }}
                style={{ borderRadius: 14, paddingVertical: 12, alignItems: 'center', borderWidth: 1, borderColor: withAlpha(Brand.Error, 0.5) }}
              >
                <Text style={{ color: Brand.Error, fontSize: 14, fontWeight: '600' }}>Delete</Text>
              </Pressable>
            </View>
          </View>
        </CenterModal>
        <ScheduleSheet
          visible={showSchedule}
          currentDays={daysPerWeek}
          currentRest={restDayNames}
          onDismiss={() => setShowSchedule(false)}
          onSave={(dpw, rest) => {
            if (habit) store.updateSchedule(habit.id, dpw, rest);
            else setDemo({ days: dpw, rest });
            setShowSchedule(false);
            toast.show('Schedule updated from tomorrow. Past days keep their old schedule.', 2800);
          }}
        />
        <Toast message={toast.message} bottomOffset={28} />
        {restDayCelebration && <RestDayCelebration key={`${restDayCelebration.habitId}-${restDayCelebration.date}`} habitName={restDayCelebration.habitName} onClose={consumeRestDayCelebration} />}
      </View>
    </View>
  );
}
