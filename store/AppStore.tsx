import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { dayProgress as calcDayProgress, daysCompletion, monthBreakdown, overview as calcOverview, percent, type HabitOverview, type MonthBreakdown } from '@/domain/analytics';
import { checkFreeze, type FreezeEligibility, FREEZE_ELIGIBILITY_MESSAGE, FREEZE_PRICE_COINS, latestEligibleMiss, MAX_FREEZE_APPLICATIONS_PER_MONTH } from '@/domain/freeze';
import {
  applyFreeze as ledgerApplyFreeze,
  buyFreeze as ledgerBuyFreeze,
  canBuyFreeze as ledgerCanBuy,
  freezesLeft as ledgerFreezesLeft,
  freezeCount,
  freezeDatesFor as ledgerFreezeDates,
  REJECT_MESSAGE,
  reconcileRewards,
  type LedgerState,
} from '@/domain/ledger';
import { enqueueMilestone, type MilestoneEvent } from '@/domain/celebrations';
import { HABIT_LIMITS } from '@/domain/habitLimits';
import { editHabit as editHabitRule, slugOf, updateGoal as updateGoalRule, updateReminder as updateReminderRule, updateSchedule as updateScheduleRule } from '@/domain/habitRules';
import { normalizeGoal } from '@/domain/reminder';
import { withArchived } from '@/domain/archive';
import { applyReorder } from '@/domain/reorder';
import { rewardWindowStart } from '@/domain/rewards';
import { isRest, scheduleOf, streakOf, trackedFrom, type HabitSchedule } from '@/domain/schedule';
import { appStorage } from '@/services/appStorage';
import type { CloudData } from '@/domain/cloudMapping';
import { habitArchiveFields, habitEditFields, habitGoalFields, habitReminderFields, habitScheduleFields } from '@/domain/cloudWrite';
import { createCloudLedger, type LedgerRunner } from '@/services/cloudLedger';
import { createRewardReconciler } from '@/services/cloudRewards';
import { newRequestId, NO_WALLET_YET, outcomeResult, settleConfirmed, walletErrorMessage, type WalletResult } from '@/domain/walletOps';
import type { HabitWriter } from '@/services/habitWriter';
import { loadInitialState } from './initialState';
import { useToday } from '@/hooks/useToday';
import { devicePrefs } from '@/services/devicePrefs';
import { habitSlug, type Habit, type PeriodStats, type StreakRun } from '@/types/habit';
import { canHaveNote as noteAllowed, deleteNote as deleteNoteRule, notesWithoutHabit, saveNote as saveNoteRule, type NoteOp, type NotesByHabit } from '@/domain/notes';
import { isBefore, monthOf, todayKey, type DateKey } from '@/utils/date';

/** Id used for the on-device guest in place of an account uid (Kotlin `GUEST_UID`). */
const GUEST_UID = 'guest';

/** A signed-in account's data (read once at sign-in) and the writer for its habits. Absent for the guest session. */
export type CloudSource = { uid: string; initial: CloudData; writer: HabitWriter; ledgerRunner: LedgerRunner };

/** The latest data from the live listeners. `fromCache` is true while the habits are not confirmed by the server (offline / reconnecting). */
export type CloudFeed = { data: CloudData; fromCache: boolean };

/** Shown for actions whose cloud sync is not enabled yet (notes, reordering). */
export const NOT_SYNCED_YET = "This isn't available for your account on the web yet. You can do it in the Android app.";

function writeErrorMessage(e: unknown): string {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
  if (code === 'permission-denied' || code === 'unauthenticated') return "Couldn't save: your account isn't allowed to change this data.";
  if (code === 'unavailable' || code === 'deadline-exceeded') return "Couldn't save: you appear to be offline. Your change was undone.";
  if (code === 'not-found') return "Couldn't save: this habit no longer exists on your account.";
  return "Couldn't save your changes. They were undone. Please try again.";
}

/** A habit plus the values the streak engine derives from its history (never stored). */
export type HabitView = Habit & { streak: number; bestStreak: number; slug: string; /** Streak runs from the engine (the Calendar's Best streaks). */ streakRuns: StreakRun[] };

type Data = { habits: Habit[]; ledger: LedgerState; notes: NotesByHabit };

export type RewardEvent = { coins: number };

/** "Bonus Effort!" celebration for a voluntary rest-day completion (Kotlin `RestDayCelebration`). */
export type RestDayCelebrationEvent = { habitId: string; habitName: string; date: DateKey; streak: number };

export type NewHabitInput = {
  name: string;
  color: string;
  daysPerWeek: number;
  restDays: string[];
  goal?: string | null;
  reminderEnabled?: boolean;
  /** "HH:mm" */
  reminderTime?: string | null;
};

export type AppStore = {
  today: DateKey;
  habits: HabitView[];
  coins: number;
  freezesOwned: number;
  freezesUsedThisMonth: number;
  /** Coins the user has already spent from a reward that was later reversed; later earnings pay this off first (`pendingAdjustment`). */
  pendingAdjustment: number;
  /** Freezes that can still be bought this month: the allowance minus applied and already-owned ones (`freezesLeft`). */
  freezesLeft: number;
  /** `canBuyFreeze`: enough coins and at least one freeze still buyable this month. */
  canBuyFreeze: boolean;
  /**
   * Buys one freeze into inventory (`buyFreeze`). Returns whether it worked and the user-facing message. For an account this is
   * ONE Firestore transaction, reported only after the server confirms it (nothing is shown as bought before that); the guest's
   * is immediate.
   */
  buyFreeze: () => Promise<WalletResult>;
  /** True while an account's wallet transaction is running (Kotlin `walletBusy`): further wallet operations are ignored until it ends. */
  walletBusy: boolean;
  /** Phase 2 has no accounts; Kotlin's `guestBonusClaimed` is hard-wired to true, so the Guest Bonus popup says "already claimed". */
  guestBonusClaimed: boolean;
  rewardEvent: RewardEvent | null;
  consumeRewardEvent: () => void;
  walletNotice: string | null;
  consumeWalletNotice: () => void;
  /** Milestone celebrations still to show, oldest first; the UI shows the first one and calls `dismissMilestone`. */
  milestoneQueue: MilestoneEvent[];
  dismissMilestone: () => void;
  restDayCelebration: RestDayCelebrationEvent | null;
  consumeRestDayCelebration: () => void;
  /** True for a signed-in account (data in Firestore), false for the guest (data in this browser). */
  isCloud: boolean;
  /** A message about a change that was not saved or is not available yet; shown once, then dismissed. */
  syncNotice: string | null;
  dismissSyncNotice: () => void;
  toggleHabitDate: (habitId: string, date: DateKey) => void;
  addHabit: (input: NewHabitInput) => void;
  /** Applies a drag-and-drop order (`reorderHabits`): only the order changes; habits not listed keep their relative order at the end. */
  reorderHabits: (orderedIds: string[]) => void;
  /** Changes name and/or colour (`editHabit`). Returns an error message, or null on success. Nothing else on the habit changes. */
  editHabit: (habitId: string, name: string, color: string) => string | null;
  /** Rest days / weekly target from tomorrow on (`updateSchedule`); past days keep their schedule. */
  updateSchedule: (habitId: string, daysPerWeek: number, restDays: string[]) => void;
  updateGoal: (habitId: string, goal: string | null) => void;
  /** Reminder switch and "HH:mm" time (`updateHabitReminder`); the time is kept while off. */
  updateHabitReminder: (habitId: string, enabled: boolean, time: string) => void;
  habitBySlug: (slug: string) => HabitView | undefined;
  /** Monthly/yearly completion analytics for a habit (`habitOverview`), derived from its history. */
  habitOverview: (habit: Habit) => HabitOverview;
  /** Completed / missed / rest / frozen counts for one month (Calendar summary). */
  habitMonth: (habit: Habit, month: string) => MonthBreakdown;
  /** Whether a Streak Freeze could protect a date for the habit, with the reason if not. Wallet limits are checked separately. */
  freezeEligibility: (habit: Habit, date: DateKey) => FreezeEligibility;
  /** Freezes applied to dates in the month (yyyy-MM), across all habits; at most 3. */
  freezesUsedIn: (month: string) => number;
  /** Day notes: one per habit per date; reflection only (never read by streaks, rewards, freezes or analytics). */
  dayNotes: NotesByHabit;
  noteFor: (habitId: string, date: DateKey) => string | null;
  /** Notes are offered on completed days and on past active days that weren't completed. */
  canHaveNote: (habit: Habit, date: DateKey) => boolean;
  saveNote: (habitId: string, date: DateKey, text: string) => NoteOp;
  deleteNote: (habitId: string, date: DateKey) => NoteOp;
  deleteHabit: (id: string) => void;
  setArchived: (id: string, archived: boolean) => void;
  isFreezeDate: (habitId: string, date: DateKey) => boolean;
  isRestDay: (habit: Habit, date: DateKey) => boolean;
  dayProgress: (habits: readonly Habit[], date: DateKey) => PeriodStats;
  habitDaysPercent: (habit: Habit, days: readonly DateKey[]) => number;
  latestMissedDay: () => { habit: Habit; date: DateKey } | null;
  /** Uses one OWNED freeze on a missed day (never spends coins). For an account: one Firestore transaction, confirmed before it is shown. */
  applyFreeze: (habitId: string, date: DateKey) => Promise<WalletResult>;
};

export type { WalletResult };

const Ctx = createContext<AppStore | null>(null);

export function AppStoreProvider({ children, cloud, feed }: { children: ReactNode; cloud?: CloudSource; feed?: CloudFeed }) {
  const today = useToday();
  const UID = cloud?.uid ?? GUEST_UID;
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  /** Legacy `users/{uid}.freezeDates`: dates frozen for every habit. */
  const legacyFreeze = useRef<DateKey[]>(cloud?.initial.profile?.legacyFreezeDates ?? []);
  const freezeDatesFor = useCallback((l: LedgerState, habitId: string): DateKey[] => [...ledgerFreezeDates(l, habitId), ...legacyFreeze.current], []);
  /** Names being created right now, so a double submit can't create the habit twice. */
  const creating = useRef(new Set<string>());
  /** One reward reconciler per signed-in user: its in-flight/known bookkeeping keeps repeated reconciles from paying twice. */
  const cloudLedger = useMemo(() => (cloud ? createCloudLedger(cloud.ledgerRunner, cloud.uid) : null), [cloud]);
  const reconciler = useMemo(() => (cloudLedger ? createRewardReconciler(cloudLedger) : null), [cloudLedger]);
  /** Kotlin `walletBusy`: one wallet operation at a time. The ref is the synchronous guard (state lags a tap), the state drives the buttons. */
  const walletBusyRef = useRef(false);
  const [walletBusy, setWalletBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false; // a reconcile that finishes after sign-out / account switch reports nothing
    };
  }, []);
  // Saved data wins over the mock data; the mock data only seeds a brand-new (or unreadable) installation, once.
  const [boot] = useState(() =>
    cloud
      ? { data: { habits: cloud.initial.habits, ledger: cloud.initial.ledger, notes: cloud.initial.notes }, nextId: 1, source: 'saved' as const }
      : loadInitialState(appStorage, todayKey()),
  );
  const [data, setData] = useState<Data>(boot.data);
  const dataRef = useRef(data);
  const [rewardEvent, setRewardEvent] = useState<RewardEvent | null>(null);
  const [walletNotice, setWalletNotice] = useState<string | null>(null);
  const [milestoneQueue, setMilestoneQueue] = useState<MilestoneEvent[]>(() =>
    cloud ? [] : devicePrefs.pendingMilestones(UID).reduce<MilestoneEvent[]>((q, e) => enqueueMilestone(q, e), []),
  );
  const milestoneRef = useRef(milestoneQueue);
  const [restDayCelebration, setRestDayCelebration] = useState<RestDayCelebrationEvent | null>(null);
  const nextId = useRef(boot.nextId);

  const setQueue = useCallback((q: MilestoneEvent[]) => {
    milestoneRef.current = q;
    setMilestoneQueue(q);
  }, []);

  const commit = useCallback((next: Data) => {
    dataRef.current = next;
    setData(next);
    // Every change is saved as it happens (the id counter included, so ids are never reused after a refresh).
    // The guest's data is saved in this browser; an account's data is never written to the guest storage.
    if (!cloud) appStorage.save({ ...next, nextId: nextId.current });
  }, [cloud]);

  const schedulesOf = (d: Data): HabitSchedule[] => d.habits.map((h) => scheduleOf(h, freezeDatesFor(d.ledger, h.id)));

  /** Android `reconcileRewards()`: grants/reverses rewards for the current history and raises the coin popup. */
  const reconcile = useCallback(
    (d: Data, edited: { habitId: string; date: DateKey }[] = []): Data => {
      const out = reconcileRewards(d.ledger, schedulesOf(d), todayKey(), edited);
      if (out.dailyCoins > 0) setRewardEvent({ coins: out.dailyCoins });
      if (out.notice) setWalletNotice(out.notice);
      // Only a milestone grant the ledger just confirmed is celebrated (never a restore or duplicate). It is saved so a
      // restart can't lose or repeat it, and queued oldest-first for the UI.
      [...out.celebrations]
        .sort((a, b) => a.milestone - b.milestone)
        .forEach((e) => {
          devicePrefs.addPendingMilestone(UID, e);
          setQueue(enqueueMilestone(milestoneRef.current, e));
        });
      return { ...d, ledger: out.state };
    },
    [setQueue],
  );

  /** Runs a Firestore write; if it fails the change is undone (`undo`) and the user is told. */
  const send = useCallback((op: Promise<void>, undo: () => void) => {
    op.catch((e: unknown) => {
      undo();
      setSyncNotice(writeErrorMessage(e));
    });
  }, []);

  /** Applies `fn` to one habit of the current state (used to undo a rejected write). */
  const patchHabit = useCallback(
    (habitId: string, fn: (h: Habit) => Habit) => {
      const d = dataRef.current;
      if (d.habits.some((h) => h.id === habitId)) commit({ ...d, habits: d.habits.map((h) => (h.id === habitId ? fn(h) : h)) });
    },
    [commit],
  );

  const feedRef = useRef<CloudFeed | undefined>(feed);
  /**
   * Android `reconcileRewards()` for an account: the shared plan, executed as Firestore transactions (one per reward), then
   * the popup / milestone / notice from the shared summary. Safe to call any number of times: rewards have fixed ids, the
   * ledger skips ones it already recorded, and the reconciler never runs one reward twice at once. It does nothing for an
   * account that has no profile document yet (no wallet to credit; Android creates it at login).
   */
  const reconcileCloud = useCallback(
    (edited: { habitId: string; date: DateKey }[] = []) => {
      if (!cloud || !reconciler) return;
      const d = dataRef.current;
      if (!(feedRef.current?.data.profileExists ?? cloud.initial.profileExists)) return;
      if (feedRef.current?.data.profile?.deletionRequested) return; // being deleted: no reward is granted or reversed on an account that is going away
      const known = new Set([...Object.keys(d.ledger.rewards), ...d.ledger.txIds]);
      void reconciler
        .reconcile({
          active: d.ledger.rewards,
          schedules: schedulesOf(d),
          today: todayKey(),
          editedOldDates: edited,
          hasLedgerEntry: (id) => known.has(id),
          isCurrent: () => alive.current,
        })
        .then((report) => {
          if (!report || !alive.current) return;
          if (report.dailyCoins > 0) setRewardEvent({ coins: report.dailyCoins });
          [...report.celebrations]
            .sort((a, b) => a.milestone - b.milestone)
            .forEach((e) => {
              devicePrefs.addPendingMilestone(UID, e);
              setQueue(enqueueMilestone(milestoneRef.current, e));
            });
          if (report.notice) setWalletNotice(report.notice);
          if (report.failedGrants > 0 && !feedRef.current?.fromCache) setSyncNotice("Couldn't add coins yet, will retry.");
        });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cloud, reconciler, setQueue, UID],
  );

  /**
   * Kotlin `loadUser`: an account created on Android carries `welcomeFreezePending` until its one free freeze is recorded. If
   * that could not be written then (offline), it is finished here. The fixed ledger id makes it happen once however many devices
   * try; the marker is cleared afterwards. Accounts without the marker never reach this.
   */
  const welcomeInFlight = useRef(false);
  const ensureWelcomeFreeze = useCallback(() => {
    if (!cloudLedger || welcomeInFlight.current) return;
    welcomeInFlight.current = true;
    void (async () => {
      try {
        await cloudLedger.grantWelcomeFreeze(); // Done, or Duplicate when it was already recorded: either way it exists
        await cloudLedger.clearWelcomeFreezeMarker();
      } catch {
        /* offline or rejected: the marker stays and this is retried on the next server-confirmed snapshot */
      } finally {
        welcomeInFlight.current = false;
      }
    })();
  }, [cloudLedger]);

  /** Applies the latest listener data: the account's data replaces the state, and server-confirmed data triggers a reconcile. */
  const appliedFeed = useRef<CloudFeed | undefined>(undefined);
  useEffect(() => {
    if (!cloud || !feed || appliedFeed.current === feed) return;
    appliedFeed.current = feed;
    feedRef.current = feed;
    legacyFreeze.current = feed.data.profile?.legacyFreezeDates ?? [];
    const next: Data = { habits: feed.data.habits, ledger: feed.data.ledger, notes: feed.data.notes };
    dataRef.current = next;
    setData(next);
    reconciler?.noteActive(Object.values(next.ledger.rewards));
    if (!feed.fromCache) {
      if (feed.data.profile?.welcomeFreezePending) ensureWelcomeFreeze();
      reconcileCloud();
    }
  }, [cloud, feed, reconciler, reconcileCloud, ensureWelcomeFreeze]);

  const dismissMilestone = useCallback(() => {
    const [first, ...rest] = milestoneRef.current;
    if (!first) return;
    setQueue(rest);
    devicePrefs.removePendingMilestone(UID, first);
  }, [setQueue]);

  const toggleHabitDate = useCallback(
    (habitId: string, date: DateKey) => {
      const d = dataRef.current;
      const habit = d.habits.find((h) => h.id === habitId);
      if (!habit) return;
      const has = habit.completedDates.includes(date);
      if (cloud) {
        // Account: the same local change as the guest (shown at once), then Android's `setCompletion` batch, then the reward reconcile.
        const completedDates = has ? habit.completedDates.filter((k) => k !== date) : [...habit.completedDates, date];
        const habits = d.habits.map((h) => (h.id === habitId ? { ...h, completedDates } : h));
        const updated = habits.find((h) => h.id === habitId)!;
        const edited = has && isBefore(date, rewardWindowStart(todayKey())) ? [{ habitId, date }] : [];
        commit({ ...d, habits });
        const st = streakOf(scheduleOf(updated, freezeDatesFor(d.ledger, habitId)), todayKey());
        send(cloud.writer.setCompletion(habitId, date, !has, { current: st.current, best: st.best }), () =>
          patchHabit(habitId, (h) => (h.completedDates.includes(date) === !has ? { ...h, completedDates: has ? [...h.completedDates, date] : h.completedDates.filter((k) => k !== date) } : h)),
        );
        // "Bonus Effort!": only from the user's own check, once per habit and date, only for today's planned rest day.
        if (!has) {
          const s = scheduleOf(updated, freezeDatesFor(d.ledger, habitId));
          if (devicePrefs.celebrateRestDay(UID, habitId, date, todayKey(), isRest(s, date))) {
            setRestDayCelebration({ habitId, habitName: updated.name, date, streak: streakOf(s, todayKey()).current });
          }
        }
        reconcileCloud(edited);
        return;
      }
      const completedDates = has ? habit.completedDates.filter((k) => k !== date) : [...habit.completedDates, date];
      const habits = d.habits.map((h) => (h.id === habitId ? { ...h, completedDates } : h));
      // Completions removed from days before this month: only their already-issued rewards are re-checked.
      const edited = has && isBefore(date, rewardWindowStart(todayKey())) ? [{ habitId, date }] : [];
      const next = reconcile({ ...d, habits }, edited);
      commit(next);
      // "Bonus Effort!": only from the user's own check, once per habit and date, only for today's planned rest day.
      if (!has) {
        const updated = next.habits.find((h) => h.id === habitId)!;
        const s = scheduleOf(updated, freezeDatesFor(next.ledger, habitId));
        if (devicePrefs.celebrateRestDay(UID, habitId, date, todayKey(), isRest(s, date))) {
          setRestDayCelebration({ habitId, habitName: updated.name, date, streak: streakOf(s, todayKey()).current });
        }
      }
    },
    [commit, reconcile, cloud, freezeDatesFor, send, patchHabit, reconcileCloud, UID],
  );

  const reorderHabits = useCallback(
    (orderedIds: string[]) => {
      if (cloud) return setSyncNotice(NOT_SYNCED_YET); // reordering is synced in a later stage
      const d = dataRef.current;
      const ids = applyReorder(d.habits.map((h) => h.id), orderedIds);
      if (!ids) return;
      const byId = new Map(d.habits.map((h) => [h.id, h]));
      commit({ ...d, habits: ids.map((id) => byId.get(id)!) });
    },
    [commit, cloud],
  );

  const addHabit = useCallback<AppStore['addHabit']>(
    ({ name, color, daysPerWeek, restDays, goal, reminderEnabled, reminderTime }) => {
      const d = dataRef.current;
      const t = todayKey();
      // A limit on how many habits one account holds (the Web only: Android has none), so a script or a corrupt copy cannot create documents without end.
      if (d.habits.length >= HABIT_LIMITS.HABITS_PER_ACCOUNT_MAX) return setSyncNotice(`You can have up to ${HABIT_LIMITS.HABITS_PER_ACCOUNT_MAX} habits. Delete one to add another.`);
      // The reminder is only recorded when it is on and has a time (Kotlin `addHabit`: `remind`).
      const remind = !!reminderEnabled && !!reminderTime;
      const key = slugOf(name);
      if (cloud && creating.current.has(key)) return; // a second tap while the first create is still being saved
      const habit: Habit = {
        id: cloud ? cloud.writer.newHabitId() : `local-${nextId.current++}`,
        name,
        color,
        daysPerWeek,
        restDays,
        createdDate: t,
        scheduleHistory: [{ from: t, restDays, daysPerWeek }],
        completedDates: [],
        archived: false,
        goal: normalizeGoal(goal),
        reminderEnabled: remind,
        reminderTime: remind ? reminderTime! : null,
      };
      commit({ ...d, habits: [...d.habits, habit] }); // new habits appear at the bottom
      if (cloud) {
        creating.current.add(key);
        const write = cloud.writer.create(habit.id, habit);
        write.then(() => creating.current.delete(key), () => creating.current.delete(key));
        send(write, () => {
          const cur = dataRef.current;
          commit({ ...cur, habits: cur.habits.filter((h) => h.id !== habit.id) });
        });
      }
    },
    [commit, cloud, send],
  );

  const editHabit = useCallback<AppStore['editHabit']>(
    (habitId, name, color) => {
      const d = dataRef.current;
      const r = editHabitRule(d.habits, habitId, name, color);
      if (r.error) return r.error;
      commit({ ...d, habits: r.habits });
      if (cloud) {
        const before = d.habits.find((h) => h.id === habitId)!;
        const after = r.habits.find((h) => h.id === habitId)!;
        // Only the changed fields are written; nothing is written when nothing changed.
        send(cloud.writer.update(habitId, habitEditFields(before, after)), () =>
          patchHabit(habitId, (h) => ({ ...h, name: h.name === after.name ? before.name : h.name, color: h.color === after.color ? before.color : h.color })),
        );
      }
      return null;
    },
    [commit, cloud, send, patchHabit],
  );

  /** Applies a habit rule, then (for an account) writes the fields it changed, undoing the change if the write fails. */
  const changeHabit = useCallback(
    (habitId: string, rule: (h: Habit) => Habit, fields: (updated: Habit, ledger: LedgerState) => Record<string, unknown>, undo: (current: Habit, before: Habit, updated: Habit) => Habit) => {
      const d = dataRef.current;
      const before = d.habits.find((h) => h.id === habitId);
      if (!before) return;
      const updated = rule(before);
      commit({ ...d, habits: d.habits.map((h) => (h.id === habitId ? updated : h)) });
      if (cloud) send(cloud.writer.update(habitId, fields(updated, d.ledger)), () => patchHabit(habitId, (cur) => undo(cur, before, updated)));
    },
    [commit, cloud, send, patchHabit],
  );
  const updateSchedule = useCallback<AppStore['updateSchedule']>(
    (habitId, daysPerWeek, restDays) =>
      changeHabit(
        habitId,
        (h) => updateScheduleRule(h, daysPerWeek, restDays, todayKey()),
        (u, ledger) => {
          const st = streakOf(scheduleOf(u, freezeDatesFor(ledger, u.id)), todayKey());
          return habitScheduleFields(u, { current: st.current, best: st.best });
        },
        (cur, before, u) => (cur.scheduleHistory === u.scheduleHistory ? { ...cur, daysPerWeek: before.daysPerWeek, restDays: before.restDays, scheduleHistory: before.scheduleHistory } : cur),
      ),
    [changeHabit, freezeDatesFor],
  );
  const updateGoal = useCallback<AppStore['updateGoal']>(
    (habitId, goal) =>
      changeHabit(habitId, (h) => updateGoalRule(h, goal), (u) => habitGoalFields(u.goal), (cur, before, u) => (cur.goal === u.goal ? { ...cur, goal: before.goal } : cur)),
    [changeHabit],
  );
  const updateHabitReminder = useCallback<AppStore['updateHabitReminder']>(
    (habitId, enabled, time) =>
      changeHabit(
        habitId,
        (h) => updateReminderRule(h, enabled, time),
        (u) => habitReminderFields(u.reminderEnabled, u.reminderTime),
        (cur, before, u) => (cur.reminderEnabled === u.reminderEnabled && cur.reminderTime === u.reminderTime ? { ...cur, reminderEnabled: before.reminderEnabled, reminderTime: before.reminderTime } : cur),
      ),
    [changeHabit],
  );

  const saveNote = useCallback<AppStore['saveNote']>(
    (habitId, date, text) => {
      if (cloud) return { ok: false, message: NOT_SYNCED_YET }; // notes are synced in a later stage
      const d = dataRef.current;
      const habit = d.habits.find((h) => h.id === habitId);
      if (!habit) return { ok: false, message: 'Habit not found' };
      const s = scheduleOf(habit, freezeDatesFor(d.ledger, habitId));
      const allowed = noteAllowed(date, todayKey(), isRest(s, date), s.completed.has(date), trackedFrom(s));
      const r = saveNoteRule(d.notes, habitId, date, text, allowed);
      if (r.ok) commit({ ...d, notes: r.notes }); // only the note is written
      return r;
    },
    [commit, cloud, freezeDatesFor],
  );
  const deleteNote = useCallback<AppStore['deleteNote']>(
    (habitId, date) => {
      if (cloud) return { ok: false, message: NOT_SYNCED_YET };
      const d = dataRef.current;
      const r = deleteNoteRule(d.notes, habitId, date);
      if (r.ok) commit({ ...d, notes: r.notes });
      return r;
    },
    [commit, cloud],
  );

  const deleteHabit = useCallback(
    (id: string) => {
      const d = dataRef.current;
      const index = d.habits.findIndex((h) => h.id === id);
      const removed = d.habits[index];
      // Deleting a habit removes its completions and its day notes (Kotlin `deleteHabit`).
      commit({ ...d, habits: d.habits.filter((h) => h.id !== id), notes: notesWithoutHabit(d.notes, id) });
      if (cloud && removed) {
        // If the deletion is rejected the habit (and its notes) come back where they were.
        send(cloud.writer.remove(id), () => {
          const cur = dataRef.current;
          if (cur.habits.some((h) => h.id === id)) return;
          const habits = [...cur.habits];
          habits.splice(Math.min(index, habits.length), 0, removed);
          commit({ ...cur, habits, notes: d.notes[id] ? { ...cur.notes, [id]: d.notes[id] } : cur.notes });
        });
      }
    },
    [commit, cloud, send],
  );

  const setArchived = useCallback(
    (id: string, archived: boolean) => {
      const d = dataRef.current;
      const before = d.habits.find((h) => h.id === id);
      if (!before || before.archived === archived) return; // nothing to change, nothing to write (Kotlin `setArchived`)
      commit({ ...d, habits: withArchived(d.habits, id, archived) });
      if (cloud) send(cloud.writer.update(id, habitArchiveFields(archived)), () => patchHabit(id, (h) => (h.archived === archived ? { ...h, archived: before.archived } : h)));
    },
    [commit, cloud, send, patchHabit],
  );

  /**
   * Kotlin `runWalletOp`: ONE wallet transaction at a time for an account. A second tap while one runs is ignored (empty message,
   * nothing shown), so a double tap can never start two purchases; the operation's own idempotent id covers retries. A failure
   * (offline, rejected, permission) is reported and leaves the displayed wallet exactly as it was: nothing was shown in advance.
   */
  const runWalletOp = useCallback(async (op: () => Promise<WalletResult>): Promise<WalletResult> => {
    if (walletBusyRef.current) return { ok: false, message: '' };
    // An account whose deletion has started (from the Android app) takes no wallet changes: the rules would refuse them anyway.
    if (feedRef.current?.data.profile?.deletionRequested) return { ok: false, message: 'This account is being deleted, so the wallet can no longer be changed.' };
    walletBusyRef.current = true;
    setWalletBusy(true);
    try {
      return await op();
    } catch (e) {
      return { ok: false, message: walletErrorMessage(e) };
    } finally {
      walletBusyRef.current = false;
      if (alive.current) setWalletBusy(false);
    }
  }, []);

  const hasProfile = () => feedRef.current?.data.profileExists ?? cloud?.initial.profileExists ?? false;

  const applyFreeze = useCallback<AppStore['applyFreeze']>(
    async (habitId, date) => {
      const d = dataRef.current;
      const habit = d.habits.find((h) => h.id === habitId);
      if (!habit) return { ok: false, message: 'Habit not found' };
      const eligibility = checkFreeze(scheduleOf(habit, freezeDatesFor(d.ledger, habitId)), date, todayKey());
      if (eligibility !== 'Eligible') return { ok: false, message: FREEZE_ELIGIBILITY_MESSAGE[eligibility] };
      if (cloud && cloudLedger) {
        if (!hasProfile()) return { ok: false, message: NO_WALLET_YET };
        return runWalletOp(async () => {
          const r = await cloudLedger.applyFreeze(habitId, date);
          // Only now, with the server's answer, is the blue day and the new wallet shown (the listener confirms the same state).
          if (r.kind === 'done' && alive.current) {
            const cur = dataRef.current;
            commit({ ...cur, ledger: settleConfirmed(cur.ledger, r.tx, r.wallet, { habitId, date }) });
          }
          return outcomeResult(r, 'Streak protected successfully!');
        });
      }
      const r = ledgerApplyFreeze(d.ledger, habitId, date);
      if (r.kind === 'rejected') return { ok: false, message: REJECT_MESSAGE[r.reason] };
      commit({ ...d, ledger: r.state });
      return { ok: true, message: 'Streak protected successfully!' };
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [commit, cloud, cloudLedger, freezeDatesFor, runWalletOp],
  );

  const buyFreeze = useCallback<AppStore['buyFreeze']>(async () => {
    if (cloud && cloudLedger) {
      if (!hasProfile()) return { ok: false, message: NO_WALLET_YET };
      return runWalletOp(async () => {
        // A fresh id per tap: the ledger buys once per id, so a retried transaction (lost response) is a Duplicate, never a second purchase.
        const r = await cloudLedger.buyFreeze(newRequestId(), todayKey());
        if (r.kind === 'done' && alive.current) {
          const cur = dataRef.current;
          commit({ ...cur, ledger: settleConfirmed(cur.ledger, r.tx, r.wallet) });
        }
        return outcomeResult(r, '❄️ Freeze purchased!');
      });
    }
    const d = dataRef.current;
    const r = ledgerBuyFreeze(d.ledger, `buy-${nextId.current++}`, todayKey());
    if (r.kind === 'rejected') return { ok: false, message: REJECT_MESSAGE[r.reason] };
    if (r.kind === 'duplicate') return { ok: false, message: 'Already purchased' };
    commit({ ...d, ledger: r.state });
    return { ok: true, message: '❄️ Freeze purchased!' };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commit, cloud, cloudLedger, runWalletOp]);

  const value = useMemo<AppStore>(() => {
    const t = today;
    const views: HabitView[] = data.habits.map((h) => {
      const s = streakOf(scheduleOf(h, freezeDatesFor(data.ledger, h.id)), t);
      return { ...h, streak: s.current, bestStreak: s.best, slug: habitSlug(h), streakRuns: s.runs };
    });
    const sched = (h: Habit) => scheduleOf(h, freezeDatesFor(data.ledger, h.id));
    return {
      today: t,
      habits: views,
      coins: data.ledger.wallet.coins,
      freezesOwned: data.ledger.wallet.freezesOwned,
      freezesUsedThisMonth: freezeCount(data.ledger, monthOf(t)),
      pendingAdjustment: data.ledger.wallet.pending,
      freezesLeft: ledgerFreezesLeft(data.ledger, t),
      canBuyFreeze: ledgerCanBuy(data.ledger, t),
      buyFreeze,
      walletBusy,
      guestBonusClaimed: true,
      rewardEvent,
      consumeRewardEvent: () => setRewardEvent(null),
      walletNotice,
      consumeWalletNotice: () => setWalletNotice(null),
      milestoneQueue,
      dismissMilestone,
      restDayCelebration,
      consumeRestDayCelebration: () => setRestDayCelebration(null),
      isCloud: !!cloud,
      syncNotice,
      dismissSyncNotice: () => setSyncNotice(null),
      toggleHabitDate,
      addHabit,
      reorderHabits,
      editHabit,
      updateSchedule,
      updateGoal,
      updateHabitReminder,
      habitBySlug: (slug) => views.find((h) => h.slug === slug),
      habitOverview: (habit) => calcOverview(sched(habit), todayKey()),
      habitMonth: (habit, month) => monthBreakdown(sched(habit), month, todayKey()),
      freezeEligibility: (habit, date) => checkFreeze(sched(habit), date, todayKey()),
      freezesUsedIn: (month) => freezeCount(data.ledger, month),
      dayNotes: data.notes,
      noteFor: (habitId, date) => data.notes[habitId]?.[date] ?? null,
      canHaveNote: (habit, date) => {
        const s = sched(habit);
        return noteAllowed(date, todayKey(), isRest(s, date), s.completed.has(date), trackedFrom(s));
      },
      saveNote,
      deleteNote,
      deleteHabit,
      setArchived,
      isFreezeDate: (habitId, date) => data.ledger.freezes.some((f) => f.habitId === habitId && f.date === date),
      isRestDay: (habit, date) => isRest(sched(habit), date),
      dayProgress: (habits, date) => calcDayProgress(habits.map(sched), date),
      habitDaysPercent: (habit, days) => percent(daysCompletion(sched(habit), days, todayKey())),
      latestMissedDay: () => {
        const hit = latestEligibleMiss(data.habits.map(sched), todayKey());
        const habit = hit && data.habits.find((h) => h.id === hit.habit.id);
        return hit && habit ? { habit, date: hit.date } : null;
      },
      applyFreeze,
    };
  }, [cloud, syncNotice, freezeDatesFor, data, today, rewardEvent, walletNotice, milestoneQueue, restDayCelebration, dismissMilestone, toggleHabitDate, addHabit, reorderHabits, editHabit, saveNote, deleteNote, buyFreeze, walletBusy, updateSchedule, updateGoal, updateHabitReminder, deleteHabit, setArchived, applyFreeze]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppStore(): AppStore {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppStore must be used inside <AppStoreProvider>');
  return ctx;
}

export { MAX_FREEZE_APPLICATIONS_PER_MONTH };
