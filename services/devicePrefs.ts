/**
 * Device-level preferences: the web equivalent of Android's `DevicePrefs` and the notification DataStore
 * (android/.../notifications/NotificationPrefs.kt). Stored in the browser's localStorage on this device only.
 * This is NOT a database or backend: it holds a few small flags, exactly what Android keeps in DataStore.
 *
 * Keys mirror Kotlin: `theme_is_dark`, `asked_notification_permission`, `{uid}_rest_day_celebrated`, and the pending
 * milestone set (`{uid}` scoped). Storage is injectable so the logic is unit-tested without a browser.
 */
import { restDayQualifies, type MilestoneEvent } from '@/domain/celebrations';
import { addDays, parseKey, type DateKey } from '@/utils/date';

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** In-memory storage: the fallback when localStorage is unavailable (private mode, SSR) and the test double. */
export class MemoryStorage implements KeyValueStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
}

/** localStorage when usable, else memory. Never throws. */
export function defaultStorage(): KeyValueStorage {
  try {
    const ls = (globalThis as { localStorage?: Storage }).localStorage;
    if (ls) {
      const probe = '__consisto_probe__';
      ls.setItem(probe, '1');
      ls.removeItem(probe);
      return ls;
    }
  } catch {
    /* fall through */
  }
  return new MemoryStorage();
}

const KEEP_DAYS = 60;

export function createDevicePrefs(storage: KeyValueStorage = defaultStorage()) {
  const readSet = (key: string): string[] => {
    try {
      const v = JSON.parse(storage.getItem(key) ?? '[]');
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };
  const writeSet = (key: string, values: Iterable<string>) => storage.setItem(key, JSON.stringify([...new Set(values)]));

  return {
    /** Saved theme, or null if the user never chose one (DevicePrefs.isDark). */
    getDark(): boolean | null {
      const v = storage.getItem('theme_is_dark');
      return v === 'true' ? true : v === 'false' ? false : null;
    },
    setDark(dark: boolean) {
      storage.setItem('theme_is_dark', String(dark));
    },

    /** "Continue as Guest" was chosen on this device (Android `DevicePrefs.isGuestMode`). Does not hold any guest data. */
    isGuestMode: (): boolean => storage.getItem('guest_mode') === 'true',
    setGuestMode: (on: boolean) => storage.setItem('guest_mode', String(on)),

    /** Notification switches (NotificationPrefs `habit_reminders` / `streak_alerts`), scoped by account id; both default to on. */
    habitReminders: (uid: string): boolean => storage.getItem(`${uid}_habit_reminders`) !== 'false',
    setHabitReminders: (uid: string, on: boolean) => storage.setItem(`${uid}_habit_reminders`, String(on)),
    streakAlerts: (uid: string): boolean => storage.getItem(`${uid}_streak_alerts`) !== 'false',
    setStreakAlerts: (uid: string, on: boolean) => storage.setItem(`${uid}_streak_alerts`, String(on)),

    /** Whether the notification permission was already asked on this device (asked only once). */
    askedPermission: () => storage.getItem('asked_notification_permission') === 'true',
    markAskedPermission: () => storage.setItem('asked_notification_permission', 'true'),
    /** `shouldAskNotificationPermission*`: true only the first time (and marks it asked). */
    shouldAskPermissionOnce(): boolean {
      const asked = storage.getItem('asked_notification_permission') === 'true';
      storage.setItem('asked_notification_permission', 'true');
      return !asked;
    },

    /**
     * Records the rest-day celebration for (habit, date); true only the first time (`RestDayCelebrations.claim`).
     * Entries older than 60 days are dropped. Scoped by account id.
     */
    claimRestDayCelebration(uid: string, habitId: string, date: DateKey, today: DateKey = date): boolean {
      const key = `${uid}_rest_day_celebrated`;
      const entry = `${habitId}|${date}`;
      const cutoff = addDays(today, -KEEP_DAYS);
      const kept = readSet(key).filter((e) => {
        const d = e.slice(e.lastIndexOf('|') + 1);
        return parseKey(d) !== null && d >= cutoff;
      });
      const claimed = !kept.includes(entry);
      writeSet(key, [...kept, entry]);
      return claimed;
    },
    /** `qualifies` + `claim` in one call, as AppViewModel.maybeCelebrateRestDay. */
    celebrateRestDay(uid: string, habitId: string, date: DateKey, today: DateKey, isRest: boolean): boolean {
      return restDayQualifies(date, today, isRest) && this.claimRestDayCelebration(uid, habitId, date, today);
    },

    /** Milestones granted but not yet celebrated; saved so a restart can't lose or repeat them. */
    pendingMilestones(uid: string): MilestoneEvent[] {
      return readSet(`${uid}_pending_milestones`)
        .map((s) => s.split('|'))
        .filter((p) => p.length === 3 && !Number.isNaN(Number(p[1])) && !Number.isNaN(Number(p[2])))
        .map((p) => ({ habitId: p[0], milestone: Number(p[1]), coins: Number(p[2]) }))
        .sort((a, b) => a.milestone - b.milestone);
    },
    addPendingMilestone(uid: string, e: MilestoneEvent) {
      const key = `${uid}_pending_milestones`;
      writeSet(key, [...readSet(key), `${e.habitId}|${e.milestone}|${e.coins}`]);
    },
    removePendingMilestone(uid: string, e: MilestoneEvent) {
      const key = `${uid}_pending_milestones`;
      writeSet(key, readSet(key).filter((s) => s !== `${e.habitId}|${e.milestone}|${e.coins}`));
    },
    /** Removes this account's preferences from the device (used when an account is deleted). */
    clearAccount(uid: string) {
      storage.removeItem(`${uid}_rest_day_celebrated`);
      storage.removeItem(`${uid}_pending_milestones`);
      storage.removeItem(`${uid}_habit_reminders`);
      storage.removeItem(`${uid}_streak_alerts`);
    },
  };
}

export type DevicePrefs = ReturnType<typeof createDevicePrefs>;

/** The app-wide instance, bound to localStorage. */
export const devicePrefs: DevicePrefs = createDevicePrefs();
