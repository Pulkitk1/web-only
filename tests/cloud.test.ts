import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  buildCloudData,
  completedDateKeys,
  composeColorToHex,
  DEFAULT_HABIT_COLOR,
  hexToComposeColor,
  mapFreeze,
  mapFreezeMonth,
  mapHabit,
  mapNotes,
  mapReward,
  mapScheduleHistory,
  mapTransaction,
  mapWallet,
  sortHabits,
  type RawDoc,
} from '@/domain/cloudMapping';
import { classifyLoadError, loadCloudData, scopedReader, type DocReader } from '@/services/cloudRepository';
import { HABIT_PALETTE } from '@/theme';

const doc = (id: string, data: Record<string, unknown>): RawDoc => ({ id, data });
const ts = (ms: number) => ({ toMillis: () => ms });
/** Android: `Color(0xAARRGGBB).value.toLong()`. */
const compose = (argb: bigint) => Number(BigInt.asIntN(64, argb << 32n));

describe('habit colour (Compose Color.value.toLong())', () => {
  it('decodes known Compose values', () => {
    // Color.Black.value = 0xFF00000000000000UL, Color.Red.value = 0xFFFF000000000000UL (as signed Longs).
    expect(composeColorToHex(-72057594037927936)).toBe('#000000');
    expect(composeColorToHex(-281474976710656)).toBe('#FF0000');
    expect(composeColorToHex(compose(0xff4ade80n))).toBe('#4ADE80');
  });
  it('round-trips all 18 palette colours exactly (both directions)', () => {
    expect(HABIT_PALETTE).toHaveLength(18);
    for (const c of HABIT_PALETTE) {
      const stored = hexToComposeColor(c.color)!;
      expect(stored).toBe(compose(0xff000000n | BigInt(parseInt(c.color.slice(1), 16))));
      expect(stored).toBeLessThan(0); // opaque colours are negative Longs
      expect(composeColorToHex(stored)).toBe(c.color.toUpperCase());
    }
  });
  it('accepts a bigint and ignores alpha', () => {
    expect(composeColorToHex(BigInt.asIntN(64, 0x804ade80n << 32n))).toBe('#4ADE80');
  });
  it('does not guess: values that are not a plain sRGB packing are rejected', () => {
    expect(composeColorToHex(1)).toBeNull(); // e.g. the Room test row `color = 1`
    expect(composeColorToHex(compose(0xff4ade80n) + 5)).toBeNull();
    expect(composeColorToHex('red')).toBeNull();
    expect(composeColorToHex(NaN)).toBeNull();
    expect(composeColorToHex(1.5)).toBeNull();
    expect(hexToComposeColor('red')).toBeNull();
  });
});

describe('habit document', () => {
  const full = doc('h1', {
    name: 'Read', color: compose(0xff60a5fan), daysPerWeek: 5, restDays: ['Sat', 'Sun'], createdDate: '2026-01-02', archived: true, goal: 'Finish 12 books',
    reminderEnabled: true, reminderTime: '07:30', sortOrder: 4, createdAt: ts(1000), streak: 99, bestStreak: 99,
    scheduleHistory: [{ from: '2026-01-02', restDays: ['Sat', 'Sun'], daysPerWeek: 5 }],
    completedDates: ['2026-02-01'],
  });
  it('maps every field with Kotlin names and types', () => {
    const m = mapHabit(full, { '2026-02-02': true })!;
    expect(m.habit).toEqual({
      id: 'h1', name: 'Read', color: '#60A5FA', completedDates: ['2026-02-01', '2026-02-02'], daysPerWeek: 5, restDays: ['Sat', 'Sun'], createdDate: '2026-01-02',
      scheduleHistory: [{ from: '2026-01-02', restDays: ['Sat', 'Sun'], daysPerWeek: 5 }], archived: true, goal: 'Finish 12 books', reminderEnabled: true, reminderTime: '07:30',
    });
    expect(m.sortOrder).toBe(4);
    expect(m.createdAtMs).toBe(1000);
    expect(m.colorIssue).toBe(false);
  });
  it('the stored streak and bestStreak are ignored (derived from history, as in Kotlin)', () => {
    expect(JSON.stringify(mapHabit(full, {})!.habit)).not.toContain('99');
  });
  it('a document without a name is skipped', () => {
    expect(mapHabit(doc('x', { color: 1 }), {})).toBeNull();
  });
  it('older documents fall back to Kotlin defaults', () => {
    const m = mapHabit(doc('old', { name: 'Old' }), {})!;
    expect(m.habit).toEqual({ id: 'old', name: 'Old', color: DEFAULT_HABIT_COLOR, completedDates: [], daysPerWeek: 7, restDays: [], createdDate: '', scheduleHistory: [], archived: false, goal: null, reminderEnabled: false, reminderTime: null });
    expect(m.sortOrder).toBeNull();
    expect(m.colorIssue).toBe(false);
  });
  it('an undecodable colour uses the default and is flagged', () => {
    const m = mapHabit(doc('c', { name: 'C', color: 1 }), {})!;
    expect(m.habit.color).toBe(DEFAULT_HABIT_COLOR);
    expect(m.colorIssue).toBe(true);
  });
  it('goal: blank ("" = cleared) and missing both mean no goal', () => {
    expect(mapHabit(doc('g', { name: 'G', goal: '' }), {})!.habit.goal).toBeNull();
    expect(mapHabit(doc('g', { name: 'G', goal: '   ' }), {})!.habit.goal).toBeNull();
    expect(mapHabit(doc('g', { name: 'G', goal: 'Run' }), {})!.habit.goal).toBe('Run');
  });
  it('reminder time must be HH:mm; reminderEnabled must be exactly true; archived must be exactly true', () => {
    expect(mapHabit(doc('r', { name: 'R', reminderTime: '7:30', reminderEnabled: 'yes', archived: 1 }), {})!.habit).toMatchObject({ reminderTime: null, reminderEnabled: false, archived: false });
    expect(mapHabit(doc('r', { name: 'R', reminderTime: '23:59' }), {})!.habit.reminderTime).toBe('23:59');
    expect(mapHabit(doc('r', { name: 'R', reminderTime: '24:00' }), {})!.habit.reminderTime).toBeNull();
  });
  it('a numeric type mismatch falls back (daysPerWeek as a string)', () => {
    expect(mapHabit(doc('d', { name: 'D', daysPerWeek: '3' }), {})!.habit.daysPerWeek).toBe(7);
    expect(mapHabit(doc('d', { name: 'D', daysPerWeek: 3.0 }), {})!.habit.daysPerWeek).toBe(3);
  });
});

describe('schedule history', () => {
  it('keeps valid periods in stored order, drops invalid ones, defaults daysPerWeek to 7 minus rest days', () => {
    expect(
      mapScheduleHistory([
        { from: '2026-03-01', restDays: ['Sun'], daysPerWeek: 6 },
        { from: 'not-a-date', restDays: [] },
        'junk',
        { from: '2026-01-01', restDays: ['Sat', 'Sun'] },
        { restDays: [] },
      ]),
    ).toEqual([
      { from: '2026-03-01', restDays: ['Sun'], daysPerWeek: 6 },
      { from: '2026-01-01', restDays: ['Sat', 'Sun'], daysPerWeek: 5 },
    ]);
    expect(mapScheduleHistory(undefined)).toEqual([]);
    expect(mapScheduleHistory('x')).toEqual([]);
  });
});

describe('completions (source of truth + legacy array)', () => {
  it('union of the legacy array and completed documents, minus dates a document explicitly unchecked', () => {
    const keys = completedDateKeys({ completedDates: ['2026-01-01', '2026-01-02', '2026-01-03'] }, { '2026-01-02': false, '2026-01-04': true, '2026-01-05': false });
    expect(keys).toEqual(['2026-01-01', '2026-01-03', '2026-01-04']);
  });
  it('a completion document without `completed` counts as unchecked; invalid date ids are ignored', () => {
    const doc1 = mapHabit(doc('h', { name: 'H', completedDates: ['2026-01-01'] }), { '2026-01-01': false, 'bad': true })!;
    expect(doc1.habit.completedDates).toEqual([]);
  });
});

describe('ordering (observeHabits)', () => {
  it('habits without sortOrder come first, then by sortOrder, then createdAt (nulls first); stable otherwise', () => {
    const items = [
      { n: 'a', sortOrder: 5, createdAtMs: 1 },
      { n: 'b', sortOrder: null, createdAtMs: 9 },
      { n: 'c', sortOrder: 2, createdAtMs: 5 },
      { n: 'd', sortOrder: null, createdAtMs: 3 },
      { n: 'e', sortOrder: 2, createdAtMs: null },
      { n: 'f', sortOrder: null, createdAtMs: null },
    ];
    expect(sortHabits(items).map((x) => x.n)).toEqual(['f', 'd', 'b', 'e', 'c', 'a']);
  });
});

describe('wallet, rewards, freezes, notes, transactions', () => {
  it('wallet counters default to 0 and read pendingAdjustment', () => {
    expect(mapWallet({})).toEqual({ coins: 0, freezesOwned: 0, pending: 0 });
    expect(mapWallet({ coins: 35, freezesOwned: 2, pendingAdjustment: 3, lastTransactionId: 'x' })).toEqual({ coins: 35, freezesOwned: 2, pending: 3 });
  });
  it('reward defaults match Kotlin (cycle 1, amount 0, inactive, type from the id)', () => {
    expect(mapReward(doc('daily_2026-01-01', {}))).toEqual({ id: 'daily_2026-01-01', active: false, cycle: 1, amount: 0, type: 'daily_completion' });
    expect(mapReward(doc('milestone_h1_15', { active: true, cycle: 2, amount: 5, type: 'streak_milestone', date: '2026-01-15', habitId: 'h1', milestone: 15 }))).toEqual({
      id: 'milestone_h1_15', active: true, cycle: 2, amount: 5, type: 'streak_milestone', date: '2026-01-15', habitId: 'h1', milestone: 15,
    });
    expect(mapReward(doc('milestone_h1_30', {})).type).toBe('streak_milestone');
  });
  it('freeze: needs habitId and a valid date; paidWith defaults to coins', () => {
    expect(mapFreeze(doc('h1_2026-01-05', { habitId: 'h1', date: '2026-01-05', month: '2026-01', paidWith: 'inventory', transactionId: 't1' }))).toEqual({ habitId: 'h1', date: '2026-01-05', paidWith: 'inventory', transactionId: 't1' });
    expect(mapFreeze(doc('x', { habitId: 'h1', date: '2026-01-05' }))!.paidWith).toBe('coins');
    expect(mapFreeze(doc('x', { date: '2026-01-05' }))).toBeNull();
    expect(mapFreeze(doc('x', { habitId: 'h1', date: '2026-13-45' }))).toBeNull();
  });
  it('freezeMonths: yyyy-MM ids only', () => {
    expect(mapFreezeMonth(doc('2026-01', { count: 3 }))).toEqual({ month: '2026-01', count: 3 });
    expect(mapFreezeMonth(doc('junk', { count: 3 }))).toBeNull();
  });
  it('notes: grouped by habit and date; blank text, bad dates and missing habit dropped', () => {
    expect(
      mapNotes([
        doc('h1_2026-01-01', { habitId: 'h1', date: '2026-01-01', text: 'Good run' }),
        doc('h1_2026-01-02', { habitId: 'h1', date: '2026-01-02', text: '   ' }),
        doc('h2_2026-01-01', { habitId: 'h2', date: 'bad', text: 'x' }),
        doc('z', { date: '2026-01-01', text: 'x' }),
        doc('h2_2026-01-03', { habitId: 'h2', date: '2026-01-03', text: 'Slept badly' }),
      ]),
    ).toEqual({ h1: { '2026-01-01': 'Good run' }, h2: { '2026-01-03': 'Slept badly' } });
  });
  it('transaction: every field the ledger writes; optional deltas default to 0', () => {
    expect(mapTransaction(doc('daily_2026-01-01', { type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21, date: '2026-01-01', createdAt: ts(7) }))).toEqual({
      id: 'daily_2026-01-01', type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21, pendingDelta: 0, date: '2026-01-01', habitId: null, milestone: null, rewardId: null, createdAtMs: 7,
    });
    expect(mapTransaction(doc('t', { type: 'reward_reversal', coinDelta: -1, balanceAfter: 0, pendingDelta: 2, rewardId: 'daily_x' }))).toMatchObject({ pendingDelta: 2, rewardId: 'daily_x', freezeDelta: 0 });
  });
});

describe('whole account', () => {
  const input = {
    uid: 'u1',
    user: doc('u1', { email: 'a@b.co', coins: 35, freezesOwned: 1, pendingAdjustment: 0, welcomeFreezePending: false, freezeDates: ['2026-01-09', 'bad'], isDark: false }),
    habits: [
      { doc: doc('h2', { name: 'Second', color: compose(0xfff87171n), sortOrder: 1 }), completions: [doc('2026-01-02', { completed: true })] },
      { doc: doc('h1', { name: 'First', color: compose(0xff4ade80n), sortOrder: 0, completedDates: ['2026-01-01'] }), completions: [] },
      { doc: doc('nameless', {}), completions: [] },
    ],
    transactions: [doc('b', { type: 'daily_completion', coinDelta: 1, createdAt: ts(2) }), doc('a', { type: 'welcome_freeze', freezeDelta: 1, createdAt: ts(1) })],
    rewards: [doc('daily_2026-01-01', { active: true, amount: 1 })],
    freezes: [doc('h1_2026-01-05', { habitId: 'h1', date: '2026-01-05' })],
    freezeMonths: [doc('2025-12', { count: 1 }), doc('2026-01', { count: 2 })],
    notes: [doc('h1_2026-01-01', { habitId: 'h1', date: '2026-01-01', text: 'n' })],
  };
  const data = buildCloudData(input);
  it('puts everything in the web models, habits in Android order', () => {
    expect(data.profileExists).toBe(true);
    expect(data.habits.map((h) => h.name)).toEqual(['First', 'Second']);
    expect(data.habits[0].completedDates).toEqual(['2026-01-01']);
    expect(data.habits[1].completedDates).toEqual(['2026-01-02']);
    expect(data.ledger.wallet).toEqual({ coins: 35, freezesOwned: 1, pending: 0 });
    expect(data.ledger.rewards['daily_2026-01-01']).toMatchObject({ active: true, amount: 1 });
    expect(data.ledger.freezes).toEqual([{ habitId: 'h1', date: '2026-01-05', paidWith: 'coins' }]);
    expect(data.ledger.txIds).toEqual(['b', 'a']); // newest first
    expect(data.freezeMonths).toEqual([{ month: '2026-01', count: 2 }, { month: '2025-12', count: 1 }]);
    expect(data.notes).toEqual({ h1: { '2026-01-01': 'n' } });
    expect(data.profile).toMatchObject({ email: 'a@b.co', isDark: false, legacyFreezeDates: ['2026-01-09'] });
  });
});

/** A fake Firestore: documents by path, recording every read. */
function fakeReader(docs: Record<string, Record<string, unknown>>) {
  const reads: string[] = [];
  const reader: DocReader = {
    async getDoc(path) {
      reads.push(path);
      return path in docs ? { id: path.split('/').pop()!, data: docs[path] } : null;
    },
    async listDocs(path) {
      reads.push(path);
      return Object.keys(docs).filter((p) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/')).map((p) => ({ id: p.split('/').pop()!, data: docs[p] }));
    },
  };
  return { reader, reads };
}

describe('cloud repository (read-only, per user)', () => {
  const docs = {
    'users/u1': { email: 'a@b.co', coins: 10, freezesOwned: 0 },
    'users/u1/habits/h1': { name: 'Read', color: compose(0xff4ade80n), createdDate: '2026-01-01' },
    'users/u1/habits/h1/completions/2026-01-03': { completed: true, date: '2026-01-03' },
    'users/u1/dayNotes/h1_2026-01-03': { habitId: 'h1', date: '2026-01-03', text: 'ok' },
    'users/u1/walletTransactions/t1': { type: 'daily_completion', coinDelta: 1 },
    'users/u1/rewards/daily_2026-01-03': { active: true, amount: 1 },
    'users/u1/freezes/h1_2026-01-02': { habitId: 'h1', date: '2026-01-02', paidWith: 'inventory' },
    'users/u1/freezeMonths/2026-01': { count: 1 },
    'users/u2': { email: 'other@b.co', coins: 999 },
    'users/u2/habits/secret': { name: 'Other user habit' },
  };

  it('reads exactly the documented paths of the signed-in user, nothing else', async () => {
    const { reader, reads } = fakeReader(docs);
    const data = await loadCloudData(reader, 'u1');
    expect(new Set(reads)).toEqual(new Set(['users/u1', 'users/u1/habits', 'users/u1/walletTransactions', 'users/u1/rewards', 'users/u1/freezes', 'users/u1/freezeMonths', 'users/u1/dayNotes', 'users/u1/habits/h1/completions']));
    expect(data.habits.map((h) => [h.name, h.completedDates])).toEqual([['Read', ['2026-01-03']]]);
    expect(data.ledger.wallet.coins).toBe(10);
    expect(data.ledger.freezes).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain('Other user');
  });

  it("never exposes another user's data, even when loads overlap", async () => {
    const { reader } = fakeReader(docs);
    const [a, b] = await Promise.all([loadCloudData(reader, 'u1'), loadCloudData(reader, 'u2')]);
    expect(a.uid).toBe('u1');
    expect(b.uid).toBe('u2');
    expect(a.ledger.wallet.coins).toBe(10);
    expect(b.ledger.wallet.coins).toBe(999);
    expect(b.habits.map((h) => h.name)).toEqual(['Other user habit']);
    expect(a.habits.map((h) => h.name)).toEqual(['Read']);
  });

  it('the scoped reader refuses paths outside users/{uid} and bad uids', async () => {
    const { reader, reads } = fakeReader(docs);
    const r = scopedReader(reader, 'u1');
    expect(() => r.getDoc('users/u2')).toThrow();
    expect(() => r.listDocs('users/u1x/habits')).toThrow();
    expect(() => r.listDocs('feedback')).toThrow();
    expect(() => scopedReader(reader, '')).toThrow();
    expect(() => scopedReader(reader, 'a/b')).toThrow();
    expect(reads).toEqual([]);
  });

  it('empty account: no user document and no collections reads as empty, and reading creates nothing', async () => {
    const { reader, reads } = fakeReader({});
    const data = await loadCloudData(reader, 'fresh');
    expect(data.profileExists).toBe(false);
    expect(data.profile).toBeNull();
    expect(data.habits).toEqual([]);
    expect(data.ledger.wallet).toEqual({ coins: 0, freezesOwned: 0, pending: 0 });
    expect(data.transactions).toEqual([]);
    expect(reads.length).toBe(7);
  });

  it('a user document with no subcollections is a valid, empty account', async () => {
    const data = await loadCloudData(fakeReader({ 'users/n': { email: 'n@b.co', coins: 20, freezesOwned: 0 } }).reader, 'n');
    expect(data.profileExists).toBe(true);
    expect(data.habits).toEqual([]);
    expect(data.ledger.wallet.coins).toBe(20);
  });

  it('permission-denied is passed through and classified; offline and other errors too', async () => {
    const denied = { async getDoc() { throw Object.assign(new Error('x'), { code: 'permission-denied' }); }, async listDocs() { return []; } } as DocReader;
    const err = await loadCloudData(denied, 'u1').catch((e) => e);
    expect(classifyLoadError(err).kind).toBe('permission-denied');
    expect(classifyLoadError(err).message).toContain('security rules');
    expect(classifyLoadError({ code: 'unavailable' }).kind).toBe('offline');
    expect(classifyLoadError({ code: 'unauthenticated' }).kind).toBe('permission-denied');
    expect(classifyLoadError(new Error('boom')).kind).toBe('error');
  });
});

describe('read path stays read-only (writes live only in habitWriter / firestoreWriter, see cloudWrite.test.ts)', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  const forbidden = /\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction|arrayUnion|arrayRemove|increment|serverTimestamp|deleteField|terminate|clearIndexedDbPersistence)\b/;
  for (const file of ['services/cloudRepository.ts', 'services/firestoreReader.ts', 'store/CloudData.tsx', 'domain/cloudMapping.ts', 'components/auth/CloudGate.tsx']) {
    it(`${file} uses no Firestore write API`, () => {
      expect(read(file)).not.toMatch(forbidden);
    });
  }
  it('the only Firestore imports are the read functions', () => {
    const imports = [...read('services/firestoreReader.ts').matchAll(/import \{([^}]*)\} from 'firebase\/firestore'/g)].flatMap((m) => m[1].split(',').map((s) => s.trim().replace(/^type /, '')));
    expect(imports.sort()).toEqual(['DocumentData', 'collection', 'doc', 'getDoc', 'getDocs']);
  });
  it('no other source file imports firestore except the reader and services/firebase.ts', () => {
    for (const file of ['services/auth.ts', 'services/sessionController.ts', 'store/AppStore.tsx', 'store/SessionStore.tsx', 'services/appStorage.ts', 'domain/cloudWrite.ts']) {
      expect(read(file)).not.toMatch(/firebase\/firestore|services\/firestoreReader/);
    }
  });
});
