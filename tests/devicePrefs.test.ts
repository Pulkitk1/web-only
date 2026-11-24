/**
 * Device preferences: theme persistence, once-per-habit-and-date rest-day celebrations (RestDayCelebrationsTest),
 * the saved milestone queue (MilestoneCelebrationTest.savedQueue...), and the once-only permission flag.
 * Storage is an in-memory double; "a restart" is a fresh createDevicePrefs() over the same storage.
 */
import { describe, expect, it } from 'vitest';

import { createDevicePrefs, defaultStorage, MemoryStorage, type KeyValueStorage } from '@/services/devicePrefs';
import { initialThemeMode } from '@/theme/ThemeProvider';

describe('theme persistence (DevicePrefs.isDark / setDark)', () => {
  it('is null until the user chooses', () => expect(createDevicePrefs(new MemoryStorage()).getDark()).toBeNull());

  it('saves dark and light, and reads them back', () => {
    const p = createDevicePrefs(new MemoryStorage());
    p.setDark(false);
    expect(p.getDark()).toBe(false);
    p.setDark(true);
    expect(p.getDark()).toBe(true);
  });

  it('survives a restart (a new instance over the same storage)', () => {
    const storage = new MemoryStorage();
    createDevicePrefs(storage).setDark(false);
    expect(createDevicePrefs(storage).getDark()).toBe(false);
    createDevicePrefs(storage).setDark(true);
    expect(createDevicePrefs(storage).getDark()).toBe(true);
  });

  it('uses the same key as Android (theme_is_dark)', () => {
    const storage = new MemoryStorage();
    createDevicePrefs(storage).setDark(false);
    expect(storage.getItem('theme_is_dark')).toBe('false');
  });

  it('ignores a corrupt stored value', () => {
    const storage = new MemoryStorage();
    storage.setItem('theme_is_dark', 'banana');
    expect(createDevicePrefs(storage).getDark()).toBeNull();
  });

  it('the provider starts dark when nothing is saved (Android default isDark = true)', () => {
    // The shared instance is backed by memory in Node; nothing saved yet.
    expect(initialThemeMode()).toBe('dark');
  });

  it('falls back to memory when localStorage is unavailable (never throws)', () => {
    const s = defaultStorage();
    s.setItem('k', 'v');
    expect(s.getItem('k')).toBe('v');
  });

  it('survives a storage that throws on write', () => {
    const broken: KeyValueStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    // The caller (ThemeProvider) never passes a throwing storage because defaultStorage() probes first; the prefs
    // object itself just propagates, so assert that contract explicitly.
    expect(() => createDevicePrefs(broken).setDark(true)).toThrow();
  });
});

describe('rest-day celebration (RestDayCelebrations)', () => {
  const day = '2024-06-08';

  it('celebrates once per habit and date, across instances', () => {
    const storage = new MemoryStorage();
    expect(createDevicePrefs(storage).claimRestDayCelebration('u', 'a', day, day)).toBe(true);
    expect(createDevicePrefs(storage).claimRestDayCelebration('u', 'a', day, day)).toBe(false); // recheck / after restart
    expect(createDevicePrefs(storage).claimRestDayCelebration('u', 'b', day, day)).toBe(true); // another habit
    expect(createDevicePrefs(storage).claimRestDayCelebration('u', 'a', '2024-06-09', day)).toBe(true); // another date
    expect(createDevicePrefs(storage).claimRestDayCelebration('other-u', 'a', day, day)).toBe(true); // another account
  });

  it("only today's planned rest day qualifies", () => {
    const p = createDevicePrefs(new MemoryStorage());
    expect(p.celebrateRestDay('u', 'a', day, day, true)).toBe(true);
    const q = createDevicePrefs(new MemoryStorage());
    expect(q.celebrateRestDay('u', 'a', day, '2024-06-11', true)).toBe(false); // back-filled
    expect(q.celebrateRestDay('u', 'a', day, day, false)).toBe(false); // ordinary day
  });

  it('a non-qualifying check does not use up the celebration', () => {
    const p = createDevicePrefs(new MemoryStorage());
    expect(p.celebrateRestDay('u', 'a', day, '2024-06-11', true)).toBe(false);
    expect(p.celebrateRestDay('u', 'a', day, day, true)).toBe(true);
  });

  it('entries older than 60 days are dropped', () => {
    const storage = new MemoryStorage();
    const p = createDevicePrefs(storage);
    p.claimRestDayCelebration('u', 'a', '2024-01-01', '2024-01-01');
    p.claimRestDayCelebration('u', 'a', '2024-06-08', '2024-06-08'); // 159 days later: the old entry is pruned
    expect(JSON.parse(storage.getItem('u_rest_day_celebrated')!)).toEqual(['a|2024-06-08']);
    // ... so the old date could celebrate again (it can't qualify anyway: only today's rest day does).
    expect(p.claimRestDayCelebration('u', 'a', '2024-01-01', '2024-06-08')).toBe(true);
  });
});

describe('saved milestone queue (NotificationPrefs pending milestones)', () => {
  const reading = { habitId: 'reading', milestone: 30, coins: 5 };
  const workout = { habitId: 'workout', milestone: 30, coins: 5 };

  it('keeps each milestone once and survives a restart', () => {
    const storage = new MemoryStorage();
    const p = createDevicePrefs(storage);
    p.addPendingMilestone('u', reading);
    p.addPendingMilestone('u', workout);
    p.addPendingMilestone('u', reading);
    const fresh = createDevicePrefs(storage);
    expect(new Set(fresh.pendingMilestones('u').map((e) => e.habitId))).toEqual(new Set(['reading', 'workout']));
    expect(fresh.pendingMilestones('u')).toHaveLength(2);
  });

  it('removes one, is scoped per account, and clears with the account', () => {
    const p = createDevicePrefs(new MemoryStorage());
    p.addPendingMilestone('u', reading);
    p.addPendingMilestone('u', workout);
    p.removePendingMilestone('u', reading);
    expect(p.pendingMilestones('u')).toEqual([workout]);
    expect(p.pendingMilestones('someone-else')).toEqual([]);
    p.clearAccount('u');
    expect(p.pendingMilestones('u')).toEqual([]);
  });

  it('lists oldest milestone first', () => {
    const p = createDevicePrefs(new MemoryStorage());
    p.addPendingMilestone('u', { habitId: 'a', milestone: 45, coins: 5 });
    p.addPendingMilestone('u', { habitId: 'a', milestone: 15, coins: 5 });
    expect(p.pendingMilestones('u').map((e) => e.milestone)).toEqual([15, 45]);
  });

  it('ignores malformed saved entries', () => {
    const storage = new MemoryStorage();
    storage.setItem('u_pending_milestones', JSON.stringify(['garbage', 'a|x|y', 'a|15|5']));
    expect(createDevicePrefs(storage).pendingMilestones('u')).toEqual([{ habitId: 'a', milestone: 15, coins: 5 }]);
  });
});

describe('notification permission is asked only once', () => {
  it('shouldAskPermissionOnce is true the first time, then false', () => {
    const storage = new MemoryStorage();
    const p = createDevicePrefs(storage);
    expect(p.askedPermission()).toBe(false);
    expect(p.shouldAskPermissionOnce()).toBe(true);
    expect(p.shouldAskPermissionOnce()).toBe(false);
    expect(createDevicePrefs(storage).askedPermission()).toBe(true);
  });
});
