/**
 * Local persistence: the storage service (versioning, migration, corruption), first-run seeding, and round trips of
 * every kind of user data through "save, then restart" (a fresh load over the same storage), including the guarantee that
 * hydration never awards, deducts or reapplies anything.
 */
import { describe, expect, it } from 'vitest';

import { withArchived } from '@/domain/archive';
import { updateSchedule } from '@/domain/habitRules';
import { applyFreeze, buyFreeze, freezeCount, freezesLeft, reconcileRewards, revokeReward, type LedgerState } from '@/domain/ledger';
import { saveNote } from '@/domain/notes';
import { scheduleOf, streakOf } from '@/domain/schedule';
import { MILESTONE_BONUSES } from '@/domain/rewards';
import { BACKUP_KEY, createAppStorage, MIGRATIONS, STORAGE_KEY, STORAGE_VERSION, validateData, type PersistedData } from '@/services/appStorage';
import { createDevicePrefs, MemoryStorage, type KeyValueStorage } from '@/services/devicePrefs';
import { buildFreshState, loadInitialState } from '@/store/initialState';
import { freezeDatesFor } from '@/domain/ledger';

const TODAY = '2026-11-21';
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

/** One "app run": load (or seed) and hand back what the store would start with. */
const boot = (storage: KeyValueStorage) => loadInitialState(createAppStorage(storage), TODAY);
const toPersisted = (s: ReturnType<typeof boot>): PersistedData => ({ ...s.data, nextId: s.nextId });
const schedules = (d: PersistedData) => d.habits.map((h) => scheduleOf(h, freezeDatesFor(d.ledger, h.id)));
const raw = (storage: KeyValueStorage) => JSON.parse(storage.getItem(STORAGE_KEY)!);

describe('first run', () => {
  it('seeds the mock data once and saves it', () => {
    const storage = new MemoryStorage();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    const s = boot(storage);
    expect(s.source).toBe('fresh');
    expect(s.data.habits.map((h) => h.name)).toEqual(['SQL Practice', 'Morning Run', 'Read Books', 'Meditate', 'Drink Water — 8 glasses a day, every day, no excuses']);
    expect(raw(storage).version).toBe(STORAGE_VERSION);
    expect(raw(storage).data.habits).toHaveLength(5);
  });
  it('the seeded wallet is 20 coins + the 15 the history earned, with the welcome freeze and one frozen day', () => {
    const f = buildFreshState(TODAY);
    expect(f.ledger.wallet).toEqual({ coins: 35, freezesOwned: 1, pending: 0 });
    expect(f.ledger.freezes).toHaveLength(1);
    expect(f.nextId).toBe(1);
  });
  it('a second start restores the saved state instead of seeding again', () => {
    const storage = new MemoryStorage();
    const first = boot(storage);
    expect(first.source).toBe('fresh');
    const second = boot(storage);
    expect(second.source).toBe('saved');
    expect(JSON.parse(JSON.stringify(second.data))).toEqual(JSON.parse(JSON.stringify(first.data)));
  });
  it('saved user data takes priority over the mock defaults (even on a different day)', () => {
    const storage = new MemoryStorage();
    const s = toPersisted(boot(storage));
    s.habits = s.habits.slice(1);
    s.ledger = { ...s.ledger, wallet: { ...s.ledger.wallet, coins: 7 } };
    createAppStorage(storage).save(s);
    const next = loadInitialState(createAppStorage(storage), '2026-12-25');
    expect(next.source).toBe('saved');
    expect(next.data.habits).toHaveLength(4);
    expect(next.data.ledger.wallet.coins).toBe(7);
  });
});

describe('round trips', () => {
  it('completing and undoing a habit survives reloads, with the coins in step', () => {
    const storage = new MemoryStorage();
    const app = createAppStorage(storage);
    let d = toPersisted(boot(storage));
    // Complete today for every habit: the daily coin and Meditate's Day-15 milestone are earned.
    const before = d.ledger.wallet.coins;
    d = { ...d, habits: d.habits.map((h) => ({ ...h, completedDates: [...new Set([...h.completedDates, '2026-11-21'])] })) };
    d = { ...d, ledger: reconcileRewards(d.ledger, schedules(d), TODAY).state };
    expect(d.ledger.wallet.coins).toBeGreaterThan(before);
    app.save(d);
    const reloaded = toPersisted(boot(storage));
    expect(reloaded.habits.every((h) => h.completedDates.includes('2026-11-21'))).toBe(true);
    expect(reloaded.ledger.wallet).toEqual(d.ledger.wallet);
    // Undo after the reload takes exactly that reward back.
    let u = { ...reloaded, habits: reloaded.habits.map((h) => (h.id === 'h4' ? { ...h, completedDates: h.completedDates.filter((x) => x !== '2026-11-21') } : h)) };
    u = { ...u, ledger: reconcileRewards(u.ledger, schedules(u), TODAY).state };
    expect(u.ledger.wallet.coins).toBe(before);
    app.save(u);
    const again = toPersisted(boot(storage));
    expect(again.ledger.wallet.coins).toBe(before);
    expect(again.habits.find((h) => h.id === 'h4')!.completedDates).not.toContain('2026-11-21');
  });

  it('hydration never awards, deducts or reapplies anything: reconciling the loaded state changes nothing', () => {
    const storage = new MemoryStorage();
    boot(storage);
    const loaded = toPersisted(boot(storage));
    const out = reconcileRewards(loaded.ledger, schedules(loaded), TODAY);
    expect(out.state).toEqual(loaded.ledger);
    expect(out.dailyCoins).toBe(0);
    expect(out.celebrations).toEqual([]);
    expect(out.notice).toBeNull();
    // And many reloads in a row leave the stored ledger byte-for-byte alike.
    const a = storage.getItem(STORAGE_KEY);
    for (let i = 0; i < 5; i++) boot(storage);
    expect(storage.getItem(STORAGE_KEY)).toBe(a);
  });

  it('streaks come out identical after a reload', () => {
    const storage = new MemoryStorage();
    const first = toPersisted(boot(storage));
    const second = toPersisted(boot(storage));
    for (let i = 0; i < first.habits.length; i++) {
      const a = streakOf(scheduleOf(first.habits[i], freezeDatesFor(first.ledger, first.habits[i].id)), TODAY);
      const b = streakOf(scheduleOf(second.habits[i], freezeDatesFor(second.ledger, second.habits[i].id)), TODAY);
      expect(b).toEqual(a);
    }
  });

  it('coin balance, freeze inventory, freeze history and the monthly count persist', () => {
    const storage = new MemoryStorage();
    const app = createAppStorage(storage);
    let d = toPersisted(boot(storage));
    let l: LedgerState = d.ledger;
    l = (buyFreeze(l, 'a', TODAY) as { state: LedgerState }).state; // 35 -> 15 coins, owned 2
    l = (applyFreeze(l, 'h2', '2026-11-19') as { state: LedgerState }).state; // owned 1
    d = { ...d, ledger: l };
    app.save(d);
    const r = toPersisted(boot(storage)).ledger;
    expect(r.wallet).toEqual({ coins: 15, freezesOwned: 1, pending: 0 });
    expect(r.freezes.map((f) => `${f.habitId}_${f.date}`).sort()).toEqual(['h2_2026-11-19', 'h3_2026-11-16']);
    expect(freezeCount(r, '2026-11')).toBe(2);
    expect(freezesLeft(r, TODAY)).toBe(0);
    expect(r.transactions.map((t) => t.id)).toContain('freeze_buy_a');
    // The same purchase request can't be replayed against the restored ledger.
    expect(buyFreeze(r, 'a', TODAY).kind).toBe('duplicate');
  });

  it('a pending coin adjustment persists and is paid off by the next earning after a reload', () => {
    const storage = new MemoryStorage();
    const app = createAppStorage(storage);
    let d = toPersisted(boot(storage));
    d = { ...d, ledger: { ...d.ledger, wallet: { coins: 0, freezesOwned: 1, pending: 2 } } };
    app.save(d);
    const r = toPersisted(boot(storage));
    expect(r.ledger.wallet.pending).toBe(2);
    // The seeded daily reward for 20 Nov being reversed now, with no coins, adds to pending.
    const rev = revokeReward(r.ledger, 'daily_2026-11-20');
    expect(rev.kind).toBe('done');
    expect(rev.state.wallet).toEqual({ coins: 0, freezesOwned: 1, pending: 3 });
  });

  it('notes persist per habit and day', () => {
    const storage = new MemoryStorage();
    const app = createAppStorage(storage);
    let d = toPersisted(boot(storage));
    const a = saveNote(d.notes, 'h2', '2026-11-19', 'Rainy morning', true);
    if (!a.ok) throw new Error('save failed');
    d = { ...d, notes: a.notes };
    app.save(d);
    expect(toPersisted(boot(storage)).notes).toEqual({ h2: { '2026-11-19': 'Rainy morning' } });
  });

  it('schedule history (a change made today, effective tomorrow) persists with past periods intact', () => {
    const storage = new MemoryStorage();
    const app = createAppStorage(storage);
    let d = toPersisted(boot(storage));
    const before = d.habits[0].scheduleHistory.length;
    d = { ...d, habits: d.habits.map((h) => (h.id === 'h1' ? updateSchedule(h, 6, ['Sun'], TODAY) : h)) };
    app.save(d);
    const h = toPersisted(boot(storage)).habits.find((x) => x.id === 'h1')!;
    expect(h.daysPerWeek).toBe(6);
    expect(h.restDays).toEqual(['Sun']);
    expect(h.scheduleHistory.length).toBeGreaterThan(before);
    expect(h.scheduleHistory[0]).toEqual(d.habits[0].scheduleHistory[0]);
  });

  it('archived flag, name, colour, goal and reminder persist', () => {
    const storage = new MemoryStorage();
    const app = createAppStorage(storage);
    let d = toPersisted(boot(storage));
    d = { ...d, habits: withArchived(d.habits, 'h3', true).map((h) => (h.id === 'h4' ? { ...h, name: 'Breathe', color: '#123456', goal: 'Calm', reminderEnabled: true, reminderTime: '07:30' } : h)) };
    app.save(d);
    const r = toPersisted(boot(storage));
    expect(r.habits.find((h) => h.id === 'h3')!.archived).toBe(true);
    expect(r.habits.find((h) => h.id === 'h4')).toMatchObject({ name: 'Breathe', color: '#123456', goal: 'Calm', reminderEnabled: true, reminderTime: '07:30' });
    expect(r.habits.map((h) => h.id)).toEqual(['h1', 'h2', 'h3', 'h4', 'h5']); // order kept
  });

  it('milestone progress (reward records and their grant cycle) persists, so none is granted twice', () => {
    const storage = new MemoryStorage();
    const app = createAppStorage(storage);
    const d = toPersisted(boot(storage));
    const days = Array.from({ length: 15 }, (_, i) => `2026-11-${String(21 - i).padStart(2, '0')}`);
    const habits = [{ ...d.habits[3], createdDate: days[14], completedDates: days }];
    const out = reconcileRewards(d.ledger, habits.map((h) => scheduleOf(h, [])), TODAY);
    expect(out.celebrations.some((e) => e.milestone === 15)).toBe(true);
    app.save({ ...d, habits, ledger: out.state });
    const r = toPersisted(boot(storage));
    expect(r.ledger.rewards[Object.keys(r.ledger.rewards).find((k) => k.includes('15'))!]).toBeDefined();
    const again = reconcileRewards(r.ledger, r.habits.map((h) => scheduleOf(h, [])), TODAY);
    expect(again.celebrations).toEqual([]); // already granted: not celebrated or paid again
    expect(again.state.wallet).toEqual(r.ledger.wallet);
    expect(MILESTONE_BONUSES[15]).toBe(5);
  });

  it('the id counter persists, so a new habit can never reuse a deleted habit\'s id (and its freeze history)', () => {
    const storage = new MemoryStorage();
    const app = createAppStorage(storage);
    const d = toPersisted(boot(storage));
    app.save({ ...d, nextId: 4 });
    expect(boot(storage).nextId).toBe(4);
  });
});

describe('theme and notification preferences', () => {
  it('are untouched by saving, loading or clearing app data (their own keys)', () => {
    const storage = new MemoryStorage();
    const prefs = createDevicePrefs(storage);
    prefs.setDark(false);
    prefs.setHabitReminders('guest', false);
    prefs.setStreakAlerts('guest', false);
    const app = createAppStorage(storage);
    boot(storage);
    app.clear();
    boot(storage);
    expect(storage.getItem('theme_is_dark')).toBe('false');
    expect(createDevicePrefs(storage).getDark()).toBe(false);
    expect(createDevicePrefs(storage).habitReminders('guest')).toBe(false);
    expect(createDevicePrefs(storage).streakAlerts('guest')).toBe(false);
  });
});

describe('corrupted or unexpected stored data', () => {
  const corruptCases: [string, string][] = [
    ['invalid JSON', '{not json'],
    ['a bare string', '"hello"'],
    ['no envelope', JSON.stringify({ habits: [] })],
    ['a bad version', JSON.stringify({ version: 'one', data: {} })],
    ['missing habits', JSON.stringify({ version: 1, data: { ledger: {}, nextId: 1 } })],
  ];
  it.each(corruptCases)('%s: starts fresh, keeps the unreadable text as a backup and then saves good data', (_, text) => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, text);
    const s = boot(storage);
    expect(s.source).toBe('recovered');
    expect(s.data.habits).toHaveLength(5);
    expect(storage.getItem(BACKUP_KEY)).toBe(text);
    expect(boot(storage).source).toBe('saved');
  });

  it('never overwrites an existing backup with a second bad copy', () => {
    const storage = new MemoryStorage();
    storage.setItem(STORAGE_KEY, 'first bad');
    boot(storage);
    storage.setItem(STORAGE_KEY, 'second bad');
    boot(storage);
    expect(storage.getItem(BACKUP_KEY)).toBe('first bad');
  });

  it('rejects semantically broken data: bad dates, negative coins, duplicate ids, wrong types', () => {
    const good = clone(toPersisted(boot(new MemoryStorage())));
    const bad = (mutate: (d: PersistedData) => void) => {
      const d = clone(good);
      mutate(d);
      return validateData(d).ok;
    };
    expect(validateData(good).ok).toBe(true);
    expect(bad((d) => (d.habits[0].completedDates = ['yesterday']))).toBe(false);
    expect(bad((d) => (d.ledger.wallet.coins = -1))).toBe(false);
    expect(bad((d) => (d.ledger.wallet.pending = 1.5))).toBe(false);
    expect(bad((d) => (d.habits[1].id = d.habits[0].id))).toBe(false);
    expect(bad((d) => ((d.habits[0] as { name: unknown }).name = 42))).toBe(false);
    expect(bad((d) => (d.habits[0].daysPerWeek = 9))).toBe(false);
    expect(bad((d) => ((d.notes as Record<string, unknown>).h1 = 'x'))).toBe(false);
    expect(bad((d) => (d.nextId = 0))).toBe(false);
  });

  it('fills optional habit fields with Kotlin defaults and drops duplicate completion dates', () => {
    const d = clone(good());
    delete (d.habits[0] as Partial<typeof d.habits[0]>).goal;
    delete (d.habits[0] as Partial<typeof d.habits[0]>).archived;
    d.habits[0].completedDates = ['2026-11-01', '2026-11-01'];
    const r = validateData(d);
    expect(r.ok && r.value.habits[0]).toMatchObject({ goal: null, archived: false, reminderEnabled: false, reminderTime: null, completedDates: ['2026-11-01'] });
    function good() {
      return toPersisted(boot(new MemoryStorage()));
    }
  });

  it('a save that fails (quota, private mode) reports false and never throws', () => {
    const throwing: KeyValueStorage = { getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {} };
    const app = createAppStorage(throwing);
    expect(app.save(toPersisted(boot(new MemoryStorage())))).toBe(false);
    expect(loadInitialState(app, TODAY).source).toBe('fresh'); // still starts, in memory
  });
});

describe('versioning and migration', () => {
  it('stores the current version in the envelope', () => {
    const storage = new MemoryStorage();
    boot(storage);
    expect(raw(storage).version).toBe(STORAGE_VERSION);
    expect(Object.keys(MIGRATIONS).every((k) => Number(k) < STORAGE_VERSION)).toBe(true);
  });

  it('upgrades older data one step at a time, then validates it', () => {
    const storage = new MemoryStorage();
    const data = clone(toPersisted(boot(new MemoryStorage())));
    // A pretend version 1 where notes were called "dayNotes", read by a pretend version-2 build.
    const v1 = { ...data, dayNotes: { h1: { '2026-11-18': 'old' } } } as Record<string, unknown>;
    delete v1.notes;
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, savedAt: 0, data: v1 }));
    const app = createAppStorage(storage, { 1: (d) => { const { dayNotes, ...rest } = d as Record<string, unknown>; return { ...rest, notes: dayNotes }; } }, 2);
    const r = app.load();
    expect(r.status).toBe('ok');
    expect(r.status === 'ok' && r.data.notes).toEqual({ h1: { '2026-11-18': 'old' } });
    // The next save writes the new version.
    if (r.status === 'ok') app.save(r.data);
    expect(raw(storage).version).toBe(2);
  });

  it('a missing or throwing migration is treated as unreadable (backup kept), not as data loss', () => {
    const storage = new MemoryStorage();
    const text = JSON.stringify({ version: 1, savedAt: 0, data: {} });
    storage.setItem(STORAGE_KEY, text);
    expect(createAppStorage(storage, {}, 2).load().status).toBe('corrupt');
    expect(storage.getItem(BACKUP_KEY)).toBe(text);
    const s2 = new MemoryStorage();
    s2.setItem(STORAGE_KEY, text);
    expect(createAppStorage(s2, { 1: () => { throw new Error('boom'); } }, 2).load().status).toBe('corrupt');
  });

  it('data from a newer build is never overwritten: the session runs in memory and saves are refused', () => {
    const storage = new MemoryStorage();
    const text = JSON.stringify({ version: STORAGE_VERSION + 1, savedAt: 0, data: { anything: true } });
    storage.setItem(STORAGE_KEY, text);
    const app = createAppStorage(storage);
    const s = loadInitialState(app, TODAY);
    expect(s.source).toBe('locked');
    expect(app.save({ ...s.data, nextId: s.nextId })).toBe(false);
    expect(storage.getItem(STORAGE_KEY)).toBe(text);
  });
});

describe('reset (development)', () => {
  it('clear() returns the next start to the mock data and removes the corrupt-data backup, leaving preferences', () => {
    const storage = new MemoryStorage();
    createDevicePrefs(storage).setDark(false);
    const app = createAppStorage(storage);
    const d = toPersisted(boot(storage));
    app.save({ ...d, habits: [] });
    storage.setItem(BACKUP_KEY, 'old');
    app.clear();
    expect(storage.getItem(STORAGE_KEY)).toBeNull();
    expect(storage.getItem(BACKUP_KEY)).toBeNull();
    expect(boot(storage).data.habits).toHaveLength(5);
    expect(storage.getItem('theme_is_dark')).toBe('false');
  });
});
