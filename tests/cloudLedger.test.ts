import { describe, expect, it } from 'vitest';

import type { RawDoc } from '@/domain/cloudMapping';
import { createCloudLedger, scopedLedgerTransaction, type LedgerRunner, type LedgerTransaction } from '@/services/cloudLedger';
import { createRewardReconciler } from '@/services/cloudRewards';
import { SERVER_TIMESTAMP } from '@/services/habitWriter';
import { scheduleOf } from '@/domain/schedule';
import type { Habit } from '@/types/habit';

const U = 'u1';
const user = (coins: number, owned = 0, pending = 0) => ({ email: 'a@b.co', coins, freezesOwned: owned, pendingAdjustment: pending, lastTransactionId: 'seed' });

/**
 * An in-memory Firestore with transaction semantics: transactions run one at a time (like contended Firestore
 * transactions that retry), reads see committed data, writes apply together when the block finishes.
 */
function fakeFirestore(initial: Record<string, Record<string, unknown>>) {
  const docs: Record<string, Record<string, unknown>> = JSON.parse(JSON.stringify(initial));
  const commits: { path: string; kind: 'update' | 'set'; fields: Record<string, unknown> }[][] = [];
  let queue: Promise<unknown> = Promise.resolve();
  let failNext: unknown = null;
  const runner: LedgerRunner = {
    run<T>(block: (t: LedgerTransaction) => Promise<T>): Promise<T> {
      const job = queue.then(async () => {
        if (failNext) {
          const e = failNext;
          failNext = null;
          throw e;
        }
        const writes: { path: string; kind: 'update' | 'set'; fields: Record<string, unknown> }[] = [];
        const read = new Set<string>();
        const result = await block({
          async get(path) {
            if (read.has(path)) throw new Error('Firestore: document read twice in one transaction: ' + path);
            if (writes.length) throw new Error('Firestore: read after write');
            read.add(path);
            return path in docs ? { id: path.split('/').pop()!, data: JSON.parse(JSON.stringify(docs[path])) } : null;
          },
          update: (path, fields) => writes.push({ path, kind: 'update', fields: { ...fields } }),
          set: (path, fields) => writes.push({ path, kind: 'set', fields: { ...fields } }),
        });
        for (const w of writes) {
          const f = Object.fromEntries(Object.entries(w.fields).map(([k, v]) => [k, v === SERVER_TIMESTAMP ? 'TS' : v]));
          if (w.kind === 'update') {
            if (!(w.path in docs)) throw new Error('NOT_FOUND ' + w.path);
            docs[w.path] = { ...docs[w.path], ...f };
          } else docs[w.path] = f;
        }
        if (writes.length) commits.push(writes);
        return result;
      });
      queue = job.catch(() => undefined);
      return job as Promise<T>;
    },
  };
  return { runner, docs, commits, failNext: (e: unknown) => (failNext = e) };
}

const grant = (date: string) => ({ id: `daily_${date}`, type: 'daily_completion', amount: 1, date });

describe('reward grant: the Android transaction protocol', () => {
  it('writes the wallet, the ledger entry and the reward record together, with Kotlin\'s fields', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(20, 1) });
    const r = await createCloudLedger(fs.runner, U).grantReward(grant('2026-11-21'));
    expect(r).toMatchObject({ kind: 'done', tx: { id: 'daily_2026-11-21', type: 'daily_completion', coinDelta: 1, balanceAfter: 21 } });
    expect(r.kind === 'done' && r.tx.pendingDelta === 0).toBe(true);
    expect(fs.commits).toHaveLength(1); // one transaction, three documents
    expect(fs.commits[0].map((w) => `${w.kind}:${w.path}`)).toEqual([`update:users/${U}`, `set:users/${U}/walletTransactions/daily_2026-11-21`, `set:users/${U}/rewards/daily_2026-11-21`]);
    expect(fs.docs[`users/${U}`]).toMatchObject({ coins: 21, freezesOwned: 1, pendingAdjustment: 0, lastTransactionId: 'daily_2026-11-21', updatedAt: 'TS' });
    expect(fs.docs[`users/${U}/walletTransactions/daily_2026-11-21`]).toEqual({ type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21, createdAt: 'TS', date: '2026-11-21', rewardId: 'daily_2026-11-21' });
    expect(fs.docs[`users/${U}/rewards/daily_2026-11-21`]).toEqual({ active: true, cycle: 1, amount: 1, type: 'daily_completion', lastTransactionId: 'daily_2026-11-21', updatedAt: 'TS', date: '2026-11-21' });
    expect('pendingDelta' in fs.docs[`users/${U}/walletTransactions/daily_2026-11-21`]).toBe(false); // only written when non-zero
  });
  it('a milestone carries habitId and milestone on the entry and the record', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(0) });
    await createCloudLedger(fs.runner, U).grantReward({ id: 'milestone_h1_15_2026-11-15', type: 'streak_milestone', amount: 5, date: '2026-11-15', habitId: 'h1', milestone: 15 });
    expect(fs.docs[`users/${U}/walletTransactions/milestone_h1_15_2026-11-15`]).toMatchObject({ type: 'streak_milestone', coinDelta: 5, habitId: 'h1', milestone: 15 });
    expect(fs.docs[`users/${U}/rewards/milestone_h1_15_2026-11-15`]).toMatchObject({ active: true, habitId: 'h1', milestone: 15, amount: 5 });
  });
  it('granting twice (retry, repeated taps, another device) pays once: the second call is a Duplicate and writes nothing', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(20) });
    const l = createCloudLedger(fs.runner, U);
    expect((await l.grantReward(grant('2026-11-21'))).kind).toBe('done');
    expect((await l.grantReward(grant('2026-11-21'))).kind).toBe('duplicate');
    expect(fs.docs[`users/${U}`].coins).toBe(21);
    expect(fs.commits).toHaveLength(1);
  });
  it('concurrent grants of one reward (two tabs / devices) pay exactly once', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(20) });
    const a = createCloudLedger(fs.runner, U);
    const b = createCloudLedger(fs.runner, U);
    const results = await Promise.all([a.grantReward(grant('2026-11-21')), b.grantReward(grant('2026-11-21')), a.grantReward(grant('2026-11-21'))]);
    expect(results.map((r) => r.kind).sort()).toEqual(['done', 'duplicate', 'duplicate']);
    expect(fs.docs[`users/${U}`].coins).toBe(21);
  });
  it('a reward granted before reward records existed (legacy: only its transaction) is recognised and not paid again', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(30), [`users/${U}/walletTransactions/daily_2026-11-20`]: { type: 'daily_completion', coinDelta: 1, balanceAfter: 30 } });
    expect((await createCloudLedger(fs.runner, U).grantReward(grant('2026-11-20'))).kind).toBe('duplicate');
    expect(fs.docs[`users/${U}`].coins).toBe(30);
  });
  it('pending adjustments are paid off first: the coins go to the pending amount, only the rest to the balance', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(0, 0, 3) });
    const r = await createCloudLedger(fs.runner, U).grantReward({ id: 'milestone_h1_15_2026-11-15', type: 'streak_milestone', amount: 5, date: '2026-11-15', habitId: 'h1', milestone: 15 });
    expect(r).toMatchObject({ kind: 'done', tx: { coinDelta: 2, pendingDelta: -3, balanceAfter: 2 } });
    expect(fs.docs[`users/${U}`]).toMatchObject({ coins: 2, pendingAdjustment: 0 });
    expect(fs.docs[`users/${U}/walletTransactions/milestone_h1_15_2026-11-15`]).toMatchObject({ coinDelta: 2, pendingDelta: -3 });
  });
  it('a missing profile document fails the transaction (nothing is created) so the grant is retried later', async () => {
    const fs = fakeFirestore({});
    await expect(createCloudLedger(fs.runner, U).grantReward(grant('2026-11-21'))).rejects.toMatchObject({ code: 'not-found' });
    expect(Object.keys(fs.docs)).toEqual([]);
  });
});

describe('reward reversal and restore (undo)', () => {
  const granted = () => fakeFirestore({ [`users/${U}`]: user(20) });
  it('undo reverses the reward: coins taken back, entry {id}_rev{cycle}, the record becomes inactive', async () => {
    const fs = granted();
    const l = createCloudLedger(fs.runner, U);
    await l.grantReward(grant('2026-11-21'));
    const r = await l.revokeReward('daily_2026-11-21');
    expect(r).toMatchObject({ kind: 'done', tx: { id: 'daily_2026-11-21_rev1', type: 'reward_reversal', coinDelta: -1, pendingDelta: 0, balanceAfter: 20 } });
    expect(fs.docs[`users/${U}`]).toMatchObject({ coins: 20, lastTransactionId: 'daily_2026-11-21_rev1' });
    expect(fs.docs[`users/${U}/rewards/daily_2026-11-21`]).toMatchObject({ active: false, cycle: 1, lastTransactionId: 'daily_2026-11-21_rev1' });
    expect(fs.docs[`users/${U}/walletTransactions/daily_2026-11-21_rev1`]).toMatchObject({ coinDelta: -1, date: '2026-11-21', rewardId: 'daily_2026-11-21' });
  });
  it('reversing twice is a no-op; reversing something never granted is a no-op', async () => {
    const fs = granted();
    const l = createCloudLedger(fs.runner, U);
    await l.grantReward(grant('2026-11-21'));
    expect((await l.revokeReward('daily_2026-11-21')).kind).toBe('done');
    expect((await l.revokeReward('daily_2026-11-21')).kind).toBe('duplicate');
    expect((await l.revokeReward('daily_2030-01-01')).kind).toBe('duplicate');
    expect(fs.docs[`users/${U}`].coins).toBe(20);
  });
  it('checking again after an undo restores the reward as cycle 2 ({id}_grant2, type reward_restored)', async () => {
    const fs = granted();
    const l = createCloudLedger(fs.runner, U);
    await l.grantReward(grant('2026-11-21'));
    await l.revokeReward('daily_2026-11-21');
    const r = await l.grantReward(grant('2026-11-21'));
    expect(r).toMatchObject({ kind: 'done', tx: { id: 'daily_2026-11-21_grant2', type: 'reward_restored', coinDelta: 1 } });
    expect(fs.docs[`users/${U}/rewards/daily_2026-11-21`]).toMatchObject({ active: true, cycle: 2 });
    expect((await l.grantReward(grant('2026-11-21'))).kind).toBe('duplicate');
    expect(fs.docs[`users/${U}`].coins).toBe(21);
  });
  it('coins already spent: the balance never goes below zero, the rest becomes a pending adjustment, later earnings pay it off', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(0, 1), [`users/${U}/rewards/milestone_h1_15_2026-11-15`]: { active: true, cycle: 1, amount: 5, type: 'streak_milestone', date: '2026-11-15', habitId: 'h1', milestone: 15 } });
    const l = createCloudLedger(fs.runner, U);
    const r = await l.revokeReward('milestone_h1_15_2026-11-15');
    expect(r).toMatchObject({ kind: 'done', tx: { coinDelta: 0, pendingDelta: 5, balanceAfter: 0 } });
    expect(fs.docs[`users/${U}`]).toMatchObject({ coins: 0, freezesOwned: 1, pendingAdjustment: 5 }); // freezes untouched
    // 3 coins earned later go entirely to the pending amount
    await l.grantReward(grant('2026-11-21'));
    expect(fs.docs[`users/${U}`]).toMatchObject({ coins: 0, pendingAdjustment: 4 });
    expect(fs.docs[`users/${U}/walletTransactions/daily_2026-11-21`]).toMatchObject({ coinDelta: 0, pendingDelta: -1 });
  });
  it('partial cover: some coins taken, the rest pending', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(2), [`users/${U}/rewards/daily_2026-11-10`]: { active: true, cycle: 1, amount: 5, type: 'daily_completion', date: '2026-11-10' } });
    const r = await createCloudLedger(fs.runner, U).revokeReward('daily_2026-11-10');
    expect(r).toMatchObject({ kind: 'done', tx: { coinDelta: -2, pendingDelta: 3, balanceAfter: 0 } });
    expect(fs.docs[`users/${U}`]).toMatchObject({ coins: 0, pendingAdjustment: 3 });
  });
  it('a legacy reward (transaction only, no record) is reversed using its transaction amount and date', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(30), [`users/${U}/walletTransactions/daily_2026-11-20`]: { type: 'daily_completion', coinDelta: 1, balanceAfter: 30 } });
    const r = await createCloudLedger(fs.runner, U).revokeReward('daily_2026-11-20');
    expect(r).toMatchObject({ kind: 'done', tx: { id: 'daily_2026-11-20_rev1', coinDelta: -1 } });
    expect(fs.docs[`users/${U}/rewards/daily_2026-11-20`]).toMatchObject({ active: false, cycle: 1, amount: 1, date: '2026-11-20', type: 'daily_completion' });
  });
});

describe('ledger transaction scope', () => {
  it('refuses reads and writes outside the three reward documents of this user, and any non-wallet field of the user document', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(1) });
    await fs.runner.run(async (raw) => {
      const t = scopedLedgerTransaction(raw, U);
      await expect(t.get('users/u2')).rejects.toThrow(/Refusing/).catch(() => undefined);
    }).catch(() => undefined);
    const probe = async (fn: (t: LedgerTransaction) => unknown) => fs.runner.run(async (raw) => fn(scopedLedgerTransaction(raw, U)));
    await expect(probe((t) => t.get('users/u2'))).rejects.toThrow(/Refusing/);
    await expect(probe((t) => t.get(`users/${U}/habits/h1`))).rejects.toThrow(/Refusing/);
    await expect(probe((t) => t.update('users/u2', { coins: 1 }))).rejects.toThrow(/Refusing/);
    await expect(probe((t) => t.update(`users/${U}`, { displayName: 'x' }))).rejects.toThrow(/Refusing/);
    await expect(probe((t) => t.update(`users/${U}`, { deletionRequested: false }))).rejects.toThrow(/Refusing/);
    await expect(probe((t) => t.set(`users/${U}/freezeMonths/november`, {}))).rejects.toThrow(/Refusing/); // only yyyy-MM counters
    await expect(probe((t) => t.set(`users/${U}/freezes/a/b`, {}))).rejects.toThrow(/Refusing/);
    await expect(probe((t) => t.set(`users/${U}/habits/h1`, {}))).rejects.toThrow(/Refusing/);
    await expect(probe((t) => t.set(`users/${U}/habits/h1/completions/2026-11-05`, {}))).rejects.toThrow(/Refusing/);
    await expect(probe((t) => t.set(`users/${U}/dayNotes/h1_2026-11-05`, {}))).rejects.toThrow(/Refusing/);
    await expect(probe((t) => t.set(`users/${U}`, {}))).rejects.toThrow(/Refusing/); // the user document is only ever updated
    await expect(probe((t) => t.set(`users/u2/rewards/x`, {}))).rejects.toThrow(/Refusing/);
    await expect(probe((t) => t.set(`users/u2/freezes/h1_2026-11-05`, {}))).rejects.toThrow(/Refusing/);
    expect(fs.commits).toHaveLength(0);
  });
  it('wallet operations may touch exactly the ledger documents of this user: entries, rewards, freezes and monthly counters', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(1) });
    const ok = async (fn: (t: LedgerTransaction) => unknown) => fs.runner.run(async (raw) => fn(scopedLedgerTransaction(raw, U)));
    await expect(ok((t) => t.get(`users/${U}/freezes/h1_2026-11-05`))).resolves.toBeNull();
    await expect(ok((t) => t.get(`users/${U}/freezeMonths/2026-11`))).resolves.toBeNull();
    await expect(ok(async (t) => { t.set(`users/${U}/freezes/h1_2026-11-05`, { a: 1 }); t.set(`users/${U}/freezeMonths/2026-11`, { count: 1 }); })).resolves.toBeUndefined();
    await expect(ok((t) => t.update(`users/${U}`, { welcomeFreezePending: false }))).resolves.toBeUndefined();
  });
  it('the ledger exposes exactly the operations of Kotlin\'s WalletLedger that the Web performs, and nothing that edits coins directly', () => {
    expect(Object.keys(createCloudLedger(fakeFirestore({}).runner, U)).sort()).toEqual(['applyFreeze', 'buyFreeze', 'clearWelcomeFreezeMarker', 'grantReward', 'grantWelcomeFreeze', 'revokeReward']);
  });
});

// ─── reconciler: the whole completion → reward loop against the fake Firestore ───

const habit = (id: string, over: Partial<Habit> = {}): Habit => ({ id, name: id, color: '#4ADE80', completedDates: [], daysPerWeek: 7, restDays: [], createdDate: '2026-11-01', scheduleHistory: [], archived: false, goal: null, reminderEnabled: false, reminderTime: null, ...over });
const TODAY = '2026-11-21';

/** One "device": the web store's view (habits + the active rewards it was told about) reconciling through its own reconciler. */
function device(fs: ReturnType<typeof fakeFirestore>) {
  const reconciler = createRewardReconciler(createCloudLedger(fs.runner, U));
  const activeRewards = () => Object.fromEntries(Object.entries(fs.docs).filter(([p, d]) => p.startsWith(`users/${U}/rewards/`) && d.active === true).map(([p, d]) => [p.split('/').pop()!, { id: p.split('/').pop()!, active: true, cycle: d.cycle as number, amount: d.amount as number, type: d.type as string, date: d.date as string | undefined, habitId: d.habitId as string | undefined, milestone: d.milestone as number | undefined }]));
  const ids = () => new Set(Object.keys(fs.docs).filter((p) => p.includes('/rewards/') || p.includes('/walletTransactions/')).map((p) => p.split('/').pop()!));
  return {
    reconciler,
    /** What the app does after the listener reports new data (or a tap): note active rewards, then reconcile. */
    async sync(habits: Habit[], edited: { habitId: string; date: string }[] = []) {
      reconciler.noteActive(Object.values(activeRewards()));
      const known = ids();
      return reconciler.reconcile({ active: activeRewards(), schedules: habits.map((h) => scheduleOf(h, [])), today: TODAY, editedOldDates: edited, hasLedgerEntry: (id) => known.has(id) });
    },
  };
}
const coins = (fs: ReturnType<typeof fakeFirestore>) => fs.docs[`users/${U}`].coins as number;

describe('reconciler (Android reconcileRewards) against the fake Firestore', () => {
  it("completing today's only habit earns the daily coin once; repeated reconciles, listener replays and a second device never pay again", async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(20) });
    const web = device(fs);
    const android = device(fs);
    const done = [habit('h1', { completedDates: [TODAY] })];
    const first = await web.sync(done);
    expect(first?.dailyCoins).toBe(1);
    expect(coins(fs)).toBe(21);
    for (let i = 0; i < 5; i++) await web.sync(done); // duplicate listener events / refreshes
    await android.sync(done); // the other device reconciles the same history
    await Promise.all([web.sync(done), android.sync(done)]);
    expect(coins(fs)).toBe(21);
    expect(Object.keys(fs.docs).filter((p) => p.includes('/walletTransactions/'))).toEqual([`users/${U}/walletTransactions/daily_${TODAY}`]);
  });
  it('a browser refresh (a brand new reconciler with the same server state) does not pay again', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(20) });
    await device(fs).sync([habit('h1', { completedDates: [TODAY] })]);
    await device(fs).sync([habit('h1', { completedDates: [TODAY] })]); // new page load
    expect(coins(fs)).toBe(21);
  });
  it('repeated taps while the grant is still running start only one operation per reward', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(20) });
    const web = device(fs);
    const done = [habit('h1', { completedDates: [TODAY] })];
    const runs = [web.sync(done), web.sync(done), web.sync(done)];
    expect(web.reconciler.inFlightCount()).toBeGreaterThan(0);
    await Promise.all(runs);
    expect(coins(fs)).toBe(21);
    expect(fs.commits).toHaveLength(1);
  });
  it('undo reverses it with a notice; checking again restores it; each step is paid/taken once', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(20) });
    const web = device(fs);
    await web.sync([habit('h1', { completedDates: [TODAY] })]);
    expect(coins(fs)).toBe(21);
    const undone = await web.sync([habit('h1', { completedDates: [] })]);
    expect(undone?.notice).toBe('Daily reward adjusted.');
    expect(coins(fs)).toBe(20);
    await web.sync([habit('h1', { completedDates: [] })]); // replay: nothing more happens
    expect(coins(fs)).toBe(20);
    const again = await web.sync([habit('h1', { completedDates: [TODAY] })]);
    expect(again?.dailyCoins).toBe(1); // like Android, a restored daily reward shows the coin popup again
    expect(coins(fs)).toBe(21);
    expect(fs.docs[`users/${U}/rewards/daily_${TODAY}`]).toMatchObject({ active: true, cycle: 2 });
  });
  it('two habits: the daily coin needs both; unchecking one reverses it, and an extra completion never pays twice', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(20) });
    const web = device(fs);
    expect(await web.sync([habit('h1', { completedDates: [TODAY] }), habit('h2')])).toBeNull(); // incomplete day: nothing
    await web.sync([habit('h1', { completedDates: [TODAY] }), habit('h2', { completedDates: [TODAY] })]);
    expect(coins(fs)).toBe(21);
    await web.sync([habit('h1', { completedDates: [TODAY] }), habit('h2')]);
    expect(coins(fs)).toBe(20);
  });
  it('a 15-day streak pays the milestone once, is celebrated once, and a replay does nothing', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(20) });
    const web = device(fs);
    const days = Array.from({ length: 15 }, (_, i) => `2026-11-${String(7 + i).padStart(2, '0')}`); // 11-07 .. 11-21
    const habits = [habit('h1', { createdDate: '2026-11-07', completedDates: days })];
    const r = await web.sync(habits);
    expect(r?.celebrations).toEqual([{ habitId: 'h1', milestone: 15, coins: 5 }]);
    const afterFirst = coins(fs);
    const replay = await web.sync(habits);
    expect(replay).toBeNull();
    await device(fs).sync(habits);
    expect(coins(fs)).toBe(afterFirst);
    expect(Object.keys(fs.docs).filter((p) => /rewards\/milestone_h1_15/.test(p))).toHaveLength(1);
    // undoing a day of the streak reverses the milestone; the lost coins are covered or recorded as pending
    const broken = await web.sync([habit('h1', { createdDate: '2026-11-07', completedDates: days.filter((d) => d !== '2026-11-14') })]);
    expect(broken?.notice).toMatch(/adjusted/);
    expect(Object.values(fs.docs).filter((d) => d.active === true && d.type === 'streak_milestone')).toHaveLength(0);
  });
  it('pending adjustment: spent coins make a reversal pending, and the next earnings pay it off (with the Kotlin notice)', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(0, 1), [`users/${U}/rewards/daily_2026-11-10`]: { active: true, cycle: 1, amount: 1, type: 'daily_completion', date: '2026-11-10' } });
    const web = device(fs);
    const r1 = await web.sync([habit('h1', { completedDates: [] })]); // 11-10 no longer qualifies
    expect(r1?.notice).toBe('Coin reward adjusted. Tap ⓘ in your wallet for details.');
    expect(fs.docs[`users/${U}`]).toMatchObject({ coins: 0, pendingAdjustment: 1, freezesOwned: 1 });
    const r2 = await web.sync([habit('h1', { completedDates: [TODAY] })]);
    expect(r2?.notice).toBe('1 coin went toward balancing an earlier reward adjustment.');
    expect(fs.docs[`users/${U}`]).toMatchObject({ coins: 0, pendingAdjustment: 0 });
  });
  it('offline / rejected grants are not lost: they fail quietly and are retried on the next reconcile, paying once', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(20) });
    const web = device(fs);
    const done = [habit('h1', { completedDates: [TODAY] })];
    fs.failNext(Object.assign(new Error('offline'), { code: 'unavailable' }));
    const failed = await web.sync(done);
    expect(failed?.failedGrants).toBe(1);
    expect(coins(fs)).toBe(20);
    const retried = await web.sync(done);
    expect(retried?.dailyCoins).toBe(1);
    expect(coins(fs)).toBe(21);
    await web.sync(done);
    expect(coins(fs)).toBe(21);
  });
  it("earlier months never earn: backfilling a day of a previous month pays nothing, but undoing an already-paid old day corrects it", async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(20), [`users/${U}/rewards/daily_2026-10-20`]: { active: true, cycle: 1, amount: 1, type: 'daily_completion', date: '2026-10-20' } });
    const web = device(fs);
    expect(await web.sync([habit('h1', { createdDate: '2026-10-01', completedDates: ['2026-10-05'] })])).toBeNull(); // old month: no new reward
    expect(coins(fs)).toBe(20);
    const edited = await web.sync([habit('h1', { createdDate: '2026-10-01', completedDates: [] })], [{ habitId: 'h1', date: '2026-10-20' }]);
    expect(edited?.notice).toBe('Daily reward adjusted.');
    expect(coins(fs)).toBe(19);
  });
  it('the wallet fields other than coins/pending (freezes) and every freeze record are never modified', async () => {
    const fs = fakeFirestore({
      [`users/${U}`]: user(20, 2),
      [`users/${U}/freezes/h1_2026-11-16`]: { habitId: 'h1', date: '2026-11-16', paidWith: 'inventory' },
      [`users/${U}/freezeMonths/2026-11`]: { count: 1 },
    });
    const web = device(fs);
    await web.sync([habit('h1', { completedDates: [TODAY] })]);
    await web.sync([habit('h1')]);
    expect(fs.docs[`users/${U}`].freezesOwned).toBe(2);
    expect(fs.docs[`users/${U}/freezes/h1_2026-11-16`]).toEqual({ habitId: 'h1', date: '2026-11-16', paidWith: 'inventory' });
    expect(fs.docs[`users/${U}/freezeMonths/2026-11`]).toEqual({ count: 1 });
  });
  it('a result that arrives after the user signed out is dropped (isCurrent false)', async () => {
    const fs = fakeFirestore({ [`users/${U}`]: user(20) });
    const reconciler = createRewardReconciler(createCloudLedger(fs.runner, U));
    const r = await reconciler.reconcile({ active: {}, schedules: [scheduleOf(habit('h1', { completedDates: [TODAY] }), [])], today: TODAY, isCurrent: () => false });
    expect(r).toBeNull();
  });
});

export type { RawDoc };
