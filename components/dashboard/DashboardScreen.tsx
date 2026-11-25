/**
 * Home dashboard (android/.../ui/screens/HabitsScreen.kt `HabitsScreen`). Local mock data only.
 * Layout is phone-first like Android; below 768 px the content is a centred column (max 560) on the full-width background.
 * Tablet (768-1023): same five-day list in a wider column. Desktop (>= 1024): seven days, with Today's Progress in a side panel.
 */
import { useRouter } from 'expo-router';
import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from 'react-native';

import { MilestoneCelebrationScreen } from '@/components/celebrations/MilestoneCelebrationScreen';
import { homeHabits } from '@/domain/archive';
import { RestDayCelebration } from '@/components/celebrations/RestDayCelebration';
import { StreakCelebration } from '@/components/celebrations/StreakCelebration';
import { Icon } from '@/components/ui/Icon';
import { Toast, useToast } from '@/components/ui/overlays';
import { MAX_FREEZE_APPLICATIONS_PER_MONTH } from '@/domain/freeze';
import { DESKTOP_WINDOW_DAYS, windowDays } from '@/domain/week';
import { useTheme } from '@/hooks/useTheme';
import { useAppStore, type HabitView } from '@/store/AppStore';
import { Brand, homePalette } from '@/theme';
import { formatWeekdayMonthDay, type DateKey } from '@/utils/date';
import { ArchiveHabitSheet } from './ArchiveHabitSheet';
import { CreateHabitSheet } from './CreateHabitSheet';
import { DayHeader } from './DayHeader';
import { EmptyHabits } from './EmptyHabits';
import { HabitCard } from './HabitCard';
import { HabitList } from './HabitList';
import { breakpointFor, DESKTOP_MAX_WIDTH, gridMetrics, MAX_COLUMN_DESKTOP, SIDE_PANEL_WIDTH, TABLET_MAX_WIDTH } from './layout';
import { CoinEarnPopup, GuestBonusPopup, GUEST_BONUS, MissedDayFreezeModal } from './popups';
import { ProgressCard } from './ProgressCard';
import { TopBar } from './TopBar';
import { WeekSelector } from './WeekSelector';

export function DashboardScreen() {
  const { t } = useTheme();
  const p = homePalette(t);
  const store = useAppStore();
  const router = useRouter();
  const toast = useToast();
  const { today } = store;

  const [weekOffset, setWeekOffset] = useState(0);
  // The day Today's Progress reports on (tap a day label); back to today when the date changes.
  const [selected, setSelected] = useState<DateKey>(today);
  useEffect(() => setSelected(today), [today]);
  const { width: windowWidth } = useWindowDimensions();
  const bp = breakpointFor(windowWidth);
  const desktop = bp === 'desktop';
  const days = windowDays(today, weekOffset, desktop ? DESKTOP_WINDOW_DAYS : undefined);

  // Width of the column holding the habit list (the whole content column on phones/tablets, the left column on desktop).
  const [width, setWidth] = useState(390);
  const metrics = desktop ? gridMetrics(width, DESKTOP_WINDOW_DAYS, MAX_COLUMN_DESKTOP) : gridMetrics(width);

  const [celebrating, setCelebrating] = useState<{ name: string; streak: number } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCoinPopup, setShowCoinPopup] = useState(false);
  const [rewardCoins, setRewardCoins] = useState(1);
  const [showGuestBonus, setShowGuestBonus] = useState(false);
  const [missed, setMissed] = useState<{ habit: HabitView; date: DateKey } | null>(null);
  const [showMissedDay, setShowMissedDay] = useState(false);
  const [archiving, setArchiving] = useState<HabitView | null>(null);

  const { rewardEvent, consumeRewardEvent, walletNotice, consumeWalletNotice, milestoneQueue, dismissMilestone, restDayCelebration, consumeRestDayCelebration } = store;
  useEffect(() => {
    if (!rewardEvent) return;
    setRewardCoins(rewardEvent.coins);
    setShowCoinPopup(true);
    consumeRewardEvent();
  }, [rewardEvent, consumeRewardEvent]);
  useEffect(() => {
    if (!walletNotice) return;
    toast.show(walletNotice, 3000);
    consumeWalletNotice();
  }, [walletNotice, consumeWalletNotice, toast.show]);

  // Milestone celebrations, one at a time and never over the daily coin popup. A habit that no longer exists is skipped.
  const milestone = milestoneQueue[0] ?? null;
  const milestoneHabit = milestone ? store.habits.find((h) => h.id === milestone.habitId) ?? null : null;
  useEffect(() => {
    if (milestone && !milestoneHabit) dismissMilestone();
  }, [milestone, milestoneHabit, dismissMilestone]);

  // Archived habits are only hidden from Home; they are still tracked everywhere else.
  const home = homeHabits(store.habits);
  const progress = store.dayProgress(home, selected);
  const goWallet = () => router.push('/wallet');

  const onMissedDay = () => {
    const m = store.latestMissedDay();
    const habit = m && store.habits.find((h) => h.id === m.habit.id);
    if (!m || !habit) {
      toast.show('No missed days to protect 🎉');
      return;
    }
    setMissed({ habit, date: m.date });
    setShowMissedDay(true);
  };

  const topBar = (
    <TopBar title="Habits" coins={store.coins} p={p} brand={desktop} onWallet={goWallet} onSettings={() => router.push('/settings')} onAdd={() => setShowCreate(true)} />
  );
  const list = (footer: ReactNode) => (
    <HabitList
      habits={home}
      onReorder={store.reorderHabits}
      renderCard={(habit) => (
        <HabitCard
          habit={habit}
          days={days}
          today={today}
          metrics={metrics}
          p={p}
          celebratedDate={restDayCelebration?.habitId === habit.id ? restDayCelebration.date : null}
          onOpen={() => router.push(`/habits/${habit.slug}`)}
          onToggle={(date) => store.toggleHabitDate(habit.id, date)}
          onStreak={() => setCelebrating({ name: habit.name, streak: habit.streak })}
          onDelete={() => store.deleteHabit(habit.id)}
          onArchive={() => setArchiving(habit)}
        />
      )}
      footer={footer}
    />
  );
  const progressCard = (
    <ProgressCard
      day={selected}
      today={today}
      done={progress.completed}
      total={progress.eligible}
      p={p}
      onGuestBonus={() => setShowGuestBonus(true)}
      onMissedDay={onMissedDay}
    />
  );
  const onColumnLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      {home.length === 0 ? (
        // No habits at all: just the header and the empty screen (no week selector, day grid, list or Today's Progress).
        <View style={{ flex: 1, width: '100%', maxWidth: desktop ? DESKTOP_MAX_WIDTH : bp === 'tablet' ? TABLET_MAX_WIDTH : 560, alignSelf: 'center', paddingHorizontal: desktop ? 24 : 0 }}>
          {topBar}
          <EmptyHabits p={p} onCreate={() => setShowCreate(true)} />
        </View>
      ) : desktop ? (
        <View style={{ flex: 1, width: '100%', maxWidth: DESKTOP_MAX_WIDTH, alignSelf: 'center', paddingHorizontal: 24 }}>
          {topBar}
          <View style={{ flexDirection: 'row', alignItems: 'center', paddingLeft: 12, paddingTop: 18, paddingBottom: 2 }}>
            <Icon name="bar-chart" size={26} color={Brand.Purple} />
            <Text accessibilityRole="header" numberOfLines={1} style={{ marginLeft: 6, color: t.text, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 }}>
              Habits
            </Text>
          </View>
          <View style={{ flex: 1, flexDirection: 'row', gap: 24 }}>
            <View style={{ flex: 1, minWidth: 0 }} onLayout={onColumnLayout}>
              <WeekSelector offset={weekOffset} days={days} p={p} part="title" onOffset={(o) => setWeekOffset(Math.min(0, o))} />
              <DayHeader days={days} today={today} selected={selected} metrics={metrics} onSelect={setSelected} />
              {list(null)}
            </View>
            <View style={{ width: SIDE_PANEL_WIDTH, flexShrink: 0, paddingRight: 8 }}>
              <WeekSelector offset={weekOffset} days={days} p={p} part="range" onOffset={(o) => setWeekOffset(Math.min(0, o))} />
              <View style={{ marginTop: 14 }}>{progressCard}</View>
            </View>
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, width: '100%', maxWidth: bp === 'tablet' ? TABLET_MAX_WIDTH : 560, alignSelf: 'center' }} onLayout={onColumnLayout}>
          {topBar}
          <WeekSelector offset={weekOffset} days={days} p={p} onOffset={(o) => setWeekOffset(Math.min(0, o))} />
          <DayHeader days={days} today={today} selected={selected} metrics={metrics} onSelect={setSelected} />
          {list(progressCard)}
        </View>
      )}

      {/* ── Overlays (drawn over the whole screen) ── */}
      <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
        <CreateHabitSheet
          visible={showCreate}
          onDismiss={() => setShowCreate(false)}
          onCreate={(v) => {
            store.addHabit(v);
            setShowCreate(false);
          }}
        />
        <CoinEarnPopup visible={showCoinPopup} coinsEarned={rewardCoins} milestone={null} onClose={() => setShowCoinPopup(false)} onGoToWallet={goWallet} />
        {milestone && milestoneHabit && !showCoinPopup && (
          <MilestoneCelebrationScreen
            key={`${milestone.habitId}-${milestone.milestone}`}
            habitName={milestoneHabit.name}
            milestone={milestone.milestone}
            coins={milestone.coins}
            onDismiss={dismissMilestone}
          />
        )}
        <GuestBonusPopup
          visible={showGuestBonus}
          alreadyClaimed={store.guestBonusClaimed}
          onClaim={() => toast.show(`🪙 +${GUEST_BONUS} coins added to your Wallet`, 2000)}
          onClose={() => setShowGuestBonus(false)}
        />
        <MissedDayFreezeModal
          visible={showMissedDay && missed !== null}
          habitName={missed?.habit.name ?? ''}
          dateLabel={missed ? formatWeekdayMonthDay(missed.date) : ''}
          freezesLeft={Math.max(0, MAX_FREEZE_APPLICATIONS_PER_MONTH - store.freezesUsedThisMonth)}
          ownedFreezes={store.freezesOwned}
          onUseFreeze={async () => {
            if (!missed) return;
            const r = await store.applyFreeze(missed.habit.id, missed.date);
            if (!r.message) return; // a second tap while a freeze was already being applied
            if (r.ok) setShowMissedDay(false);
            toast.show(r.message, 2500);
          }}
          onBreakStreak={() => setShowMissedDay(false)}
          onClose={() => setShowMissedDay(false)}
          onGoToWallet={goWallet}
        />
        <ArchiveHabitSheet
          habit={archiving}
          onConfirm={(h) => {
            store.setArchived(h.id, true);
            setArchiving(null);
            toast.show('Habit archived successfully. You can access it anytime in Settings → Archived Habits.', 3500);
          }}
          onDismiss={() => setArchiving(null)}
        />
        <Toast message={toast.message} bottomOffset={82} borderColor="rgba(77,163,255,0.3)" />
        {celebrating && <StreakCelebration habitName={celebrating.name} streak={celebrating.streak} onClose={() => setCelebrating(null)} />}
        {/* "Bonus Effort!" when a planned rest day is completed (first time per habit and date only). */}
        {restDayCelebration && (
          <RestDayCelebration key={`${restDayCelebration.habitId}-${restDayCelebration.date}`} habitName={restDayCelebration.habitName} onClose={consumeRestDayCelebration} />
        )}
      </View>
    </View>
  );
}
