import { describe, expect, it } from 'vitest';

import { MILESTONE_BONUSES } from '@/domain/rewards';
import { scheduleOf } from '@/domain/schedule';
import { createCloudLedger } from '@/services/cloudLedger';
import { createRewardReconciler } from '@/services/cloudRewards';
import type { Habit } from '@/types/habit';
import { createFakeFirestore, type Doc, type FakeFirestore } from './fakeFirestore';

/**
 * Reward and milestone synchronisation under the conditions the phase names: two devices completing the same habit, repeated
 * listener events, a browser refresh, reconnecting after being offline, the same operation submitted twice. Every transaction here
 * runs on the concurrent, rules-checking fake (tests/fakeFirestore.ts), so a block that is not safe to re-run, or a write the
 * production rules would refuse, fails the test.
 */
const U = 'u1';
const root = `users/${U}`;
const user = (coins: number, owned = 0, pending = 0): Doc => ({ email: 'a@b.co', coins, freezesOwned: owned, pendingAdjustment: pending, lastTransactionId: 'seed' });
const world = (u: Doc, extra: Record<string, Doc> = {}) => createFakeFirestore(U, { [root]: u, ...extra });
const coins = (fs: FakeFirestore) => fs.docs[root].coins as number;
const pending = (fs: FakeFirestore) => fs.docs[root].pendingAdjustment as number;
const TODAY = '2026-11-21';
const daily = (date: string) => ({ id: `daily_${date}`, type: 'daily_completion', amount: 1, date });
const entries = (fs: FakeFirestore) => Object.keys(fs.docs).filter((p) => p.includes('/walletTransactions/')).length;

const habit = (id: string, over: Partial<Habit> = {}): Habit => ({ id, name: id, color: '#4ADE80', completedDates: [], daysPerWeek: 7, restDays: [], createdDate: '2026-11-01', scheduleHistory: [], archived: false, goal: null, reminderEnabled: false, reminderTime: null, ...over });

function device(fs: FakeFirestore) {
  const reconciler = createRewardReconciler(createCloudLedger(fs.runner, U));
  const active = () =>
    Object.fromEntries(
      Object.entries(fs.docs)
        .filter(([p, d]) => p.startsWith(`${root}/rewards/`) && d.active === true)
        .map(([p, d]) => [p.split('/').pop()!, { id: p.split('/').pop()!, active: true, cycle: d.cycle as number, amount: d.amount as number, type: d.type as string, date: d.date as string | undefined, habitId: d.habitId as string | undefined, milestone: d.milestone as number | undefined }]),
    );
  const ids = () => new Set(Object.keys(fs.docs).filter((p) => p.includes('/rewards/') || p.includes('/walletTransactions/')).map((p) => p.split('/').pop()!));
  return {
    reconciler,
    async sync(habits: Habit[], edited: { habitId: string; date: string }[] = []) {
      reconciler.noteActive(Object.values(active()));
      const known = ids();
      return reconciler.reconcile({ active: active(), schedules: habits.map((h) => scheduleOf(h, [])), today: TODAY, editedOldDates: edited, hasLedgerEntry: (id) => known.has(id) });
    },
  };
}

describe('coin balance and daily rewards', () => {
  it('each qualifying day pays 1 coin once, in its own ledger entry', async () => {
    const fs = world(user(20));
    const l = createCloudLedger(fs.runner, U);
    for (const d of ['2026-11-19', '2026-11-20', '2026-11-21']) expect((await l.grantReward(daily(d))).kind).toBe('done');
    expect(coins(fs)).toBe(23);
    expect(entries(fs)).toBe(3);
    expect(fs.docs[root].lastTransactionId).toBe('daily_2026-11-21');
  });
  it('the balance read from the document is the balance the next operation starts from (another device moved it)', async () => {
    const fs = world(user(20));
    fs.patch(root, { coins: 35 }); // Android earned meanwhile
    await createCloudLedger(fs.runner, U).grantReward(daily(TODAY));
    expect(coins(fs)).toBe(36);
  });
});

describe('milestones: every bonus amount is accepted by the rules and paid once', () => {
  for (const [day, bonus] of Object.entries(MILESTONE_BONUSES)) {
    it(`day ${day} pays +${bonus} with habitId and milestone on the entry and the record`, async () => {
      const fs = world(user(0));
      const g = { id: `milestone_h1_${day}_2026-11-01`, type: 'streak_milestone', amount: bonus, date: '2026-11-15', habitId: 'h1', milestone: Number(day) };
      const l = createCloudLedger(fs.runner, U);
      expect((await l.grantReward(g)).kind).toBe('done');
      expect((await l.grantReward(g)).kind).toBe('duplicate');
      expect(coins(fs)).toBe(bonus);
      expect(fs.docs[`${root}/walletTransactions/${g.id}`]).toMatchObject({ type: 'streak_milestone', coinDelta: bonus, habitId: 'h1', milestone: Number(day), rewardId: g.id });
      expect(fs.docs[`${root}/rewards/${g.id}`]).toMatchObject({ active: true, cycle: 1, amount: bonus, habitId: 'h1', milestone: Number(day) });
    });
  }
  it('the bonuses are the verified ones', () => expect(MILESTONE_BONUSES).toEqual({ 15: 5, 30: 5, 45: 5, 60: 5, 75: 10, 100: 20 }));
});

describe('reversal, pending adjustments and recovery from future earnings (rules-checked)', () => {
  it('uncovered reversal: coins never go below zero, the rest is pending; two later earnings pay it off first, then the balance grows', async () => {
    const fs = world(user(0, 1), { [`${root}/rewards/milestone_h1_75_2026-11-01`]: { active: true, cycle: 1, amount: 10, type: 'streak_milestone', date: '2026-11-10', habitId: 'h1', milestone: 75 } });
    const l = createCloudLedger(fs.runner, U);
    const rev = await l.revokeReward('milestone_h1_75_2026-11-01');
    expect(rev).toMatchObject({ kind: 'done', tx: { coinDelta: 0, pendingDelta: 10, balanceAfter: 0 } });
    expect(fs.docs[root]).toMatchObject({ coins: 0, pendingAdjustment: 10, freezesOwned: 1 });
    // 10 coins of earnings: all of them go to the pending amount, one entry each
    for (let d = 11; d <= 20; d++) await l.grantReward(daily(`2026-11-${d}`));
    expect(fs.docs[root]).toMatchObject({ coins: 0, pendingAdjustment: 0 });
    await l.grantReward(daily(TODAY));
    expect(fs.docs[root]).toMatchObject({ coins: 1, pendingAdjustment: 0 });
  });
  it('a grant that is only partly absorbed by the pending amount records both parts (coinDelta and pendingDelta)', async () => {
    const fs = world(user(0, 0, 3));
    const r = await createCloudLedger(fs.runner, U).grantReward({ id: 'milestone_h1_15_2026-11-01', type: 'streak_milestone', amount: 5, date: '2026-11-15', habitId: 'h1', milestone: 15 });
    expect(r).toMatchObject({ kind: 'done', tx: { coinDelta: 2, pendingDelta: -3, balanceAfter: 2 } });
    expect(fs.docs[root]).toMatchObject({ coins: 2, pendingAdjustment: 0 });
  });
  it('several reversals on different dates accumulate into one pending amount, which later earnings settle completely (Kotlin multipleReversalsAcrossDatesAccumulateAndSettle)', async () => {
    const rewards: Record<string, Doc> = {};
    for (const d of ['2026-11-10', '2026-11-11', '2026-11-12']) rewards[`${root}/rewards/daily_${d}`] = { active: true, cycle: 1, amount: 1, type: 'daily_completion', date: d };
    const fs = world(user(0, 1), rewards);
    const l = createCloudLedger(fs.runner, U);
    for (const d of ['2026-11-10', '2026-11-11', '2026-11-12']) expect((await l.revokeReward(`daily_${d}`)).kind).toBe('done');
    expect(fs.docs[root]).toMatchObject({ coins: 0, pendingAdjustment: 3, freezesOwned: 1 });
    for (const d of ['2026-11-13', '2026-11-14', '2026-11-15']) await l.grantReward(daily(d));
    expect(fs.docs[root]).toMatchObject({ coins: 0, pendingAdjustment: 0 });
    await l.grantReward(daily('2026-11-16'));
    expect(coins(fs)).toBe(1);
  });
  it('the welcome freeze keeps every existing balance (coins, pending, owned freezes)', async () => {
    const fs = world({ ...user(37, 2, 0), welcomeFreezePending: true });
    await createCloudLedger(fs.runner, U).grantWelcomeFreeze();
    expect(fs.docs[root]).toMatchObject({ coins: 37, freezesOwned: 3, pendingAdjustment: 0 });
  });
  it('recompleting a day while its reversal is still pending cancels it: the restore pays the pending coin first, the balance is unchanged', async () => {
    const fs = world(user(0, 0));
    const l = createCloudLedger(fs.runner, U);
    await l.grantReward(daily(TODAY)); // +1
    fs.patch(root, { coins: 0 }); // spent elsewhere
    await l.revokeReward(`daily_${TODAY}`);
    expect(fs.docs[root]).toMatchObject({ coins: 0, pendingAdjustment: 1 });
    await l.grantReward(daily(TODAY)); // recompleted
    expect(fs.docs[root]).toMatchObject({ coins: 0, pendingAdjustment: 0 });
  });
  it('purchases and freezes are never taken back by a reward reversal', async () => {
    const fs = world(user(20, 1), { [`${root}/rewards/daily_2026-11-10`]: { active: true, cycle: 1, amount: 1, type: 'daily_completion', date: '2026-11-10' } });
    const l = createCloudLedger(fs.runner, U);
    await l.buyFreeze('purchase-attempt-1', TODAY);
    await l.revokeReward('daily_2026-11-10');
    expect(fs.docs[root]).toMatchObject({ coins: 0, freezesOwned: 2, pendingAdjustment: 1 });
  });
  it('restoring a reversed reward (cycle 2) is rules-valid and pays once', async () => {
    const fs = world(user(20));
    const l = createCloudLedger(fs.runner, U);
    await l.grantReward(daily(TODAY));
    await l.revokeReward(`daily_${TODAY}`);
    await l.grantReward(daily(TODAY));
    await l.grantReward(daily(TODAY));
    expect(coins(fs)).toBe(21);
    expect(Object.keys(fs.docs).filter((p) => p.includes(`daily_${TODAY}`)).sort()).toEqual([
      `${root}/rewards/daily_${TODAY}`,
      `${root}/walletTransactions/daily_${TODAY}`,
      `${root}/walletTransactions/daily_${TODAY}_grant2`,
      `${root}/walletTransactions/daily_${TODAY}_rev1`,
    ]);
  });
  it('legacy rewards (a transaction but no reward record) are recognised and reversed using the transaction amount', async () => {
    const fs = world(user(30), { [`${root}/walletTransactions/daily_2026-11-20`]: { type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 30, date: '2026-11-20' } });
    const l = createCloudLedger(fs.runner, U);
    expect((await l.grantReward(daily('2026-11-20'))).kind).toBe('duplicate');
    expect((await l.revokeReward('daily_2026-11-20')).kind).toBe('done');
    expect(coins(fs)).toBe(29);
  });
});

describe('no duplicate rewards: two devices, replays, refresh, reconnect, the same operation twice', () => {
  const done = (...dates: string[]) => [habit('h1', { completedDates: dates })];

  it('both devices complete the same habit and reconcile at the same moment: exactly one coin, one entry', async () => {
    const fs = world(user(20));
    const web = device(fs);
    const android = device(fs);
    await Promise.all([web.sync(done(TODAY)), android.sync(done(TODAY))]);
    expect(coins(fs)).toBe(21);
    expect(entries(fs)).toBe(1);
    expect(fs.stats.conflicts).toBeGreaterThan(0); // they really raced
  });
  it('the same milestone found by both devices at once pays once', async () => {
    const fs = world(user(20));
    const days = Array.from({ length: 15 }, (_, i) => `2026-11-${String(7 + i).padStart(2, '0')}`);
    const habits = [habit('h1', { createdDate: '2026-11-07', completedDates: days })];
    await Promise.all([device(fs).sync(habits), device(fs).sync(habits)]);
    const milestones = Object.keys(fs.docs).filter((p) => /rewards\/milestone_h1_15/.test(p));
    expect(milestones).toHaveLength(1);
    // the balance is exactly the start plus what the ledger recorded: the 5-coin bonus is in it once
    const recorded = Object.entries(fs.docs).filter(([p]) => p.includes('/walletTransactions/')).reduce((n, [, d]) => n + (d.coinDelta as number), 0);
    expect(coins(fs)).toBe(20 + recorded);
    expect(Object.entries(fs.docs).filter(([p, d]) => p.includes('/walletTransactions/') && d.type === 'streak_milestone')).toHaveLength(1);
  });
  it('a burst of identical listener events never reaches Firestore more than once per reward', async () => {
    const fs = world(user(20));
    const web = device(fs);
    await web.sync(done(TODAY));
    const runs = fs.stats.runs;
    for (let i = 0; i < 25; i++) await web.sync(done(TODAY));
    expect(fs.stats.runs).toBe(runs);
    expect(coins(fs)).toBe(21);
  });
  it('overlapping reconciles started before the first finishes start one operation per reward', async () => {
    const fs = world(user(20));
    const web = device(fs);
    await Promise.all([1, 2, 3, 4, 5].map(() => web.sync(done(TODAY))));
    expect(fs.stats.runs).toBe(1);
    expect(coins(fs)).toBe(21);
  });
  it('a browser refresh (a new reconciler with the same server state) pays nothing', async () => {
    const fs = world(user(20));
    await device(fs).sync(done(TODAY));
    await device(fs).sync(done(TODAY));
    await device(fs).sync(done(TODAY));
    expect(coins(fs)).toBe(21);
    expect(entries(fs)).toBe(1);
  });
  it('a device that reconnects after being offline pays once; failed grants are retried, never doubled', async () => {
    const fs = world(user(20));
    const web = device(fs);
    fs.failNext(Object.assign(new Error('offline'), { code: 'unavailable' }));
    expect((await web.sync(done(TODAY)))?.failedGrants).toBe(1);
    expect(coins(fs)).toBe(20);
    await Promise.all([web.sync(done(TODAY)), device(fs).sync(done(TODAY))]); // reconnect: this device and Android both notice
    expect(coins(fs)).toBe(21);
    expect(entries(fs)).toBe(1);
  });
  it('a commit whose response was lost is not paid again when the next reconcile runs', async () => {
    const fs = world(user(20));
    const web = device(fs);
    fs.loseAckNext();
    await web.sync(done(TODAY)); // the server has it; this device saw an error
    expect(coins(fs)).toBe(21);
    await web.sync(done(TODAY));
    expect(coins(fs)).toBe(21);
    expect(entries(fs)).toBe(1);
  });
  it('undo on one device while the other re-checks: the final state is consistent (one active cycle, coins match the entries)', async () => {
    const fs = world(user(20));
    await device(fs).sync(done(TODAY));
    await Promise.all([device(fs).sync(done()), device(fs).sync(done(TODAY))]);
    const sum = Object.entries(fs.docs).filter(([p]) => p.includes('/walletTransactions/')).reduce((n, [, d]) => n + (d.coinDelta as number), 0);
    expect(coins(fs)).toBe(20 + sum);
    expect(pending(fs)).toBe(0);
    expect(coins(fs)).toBeGreaterThanOrEqual(20);
    expect(coins(fs)).toBeLessThanOrEqual(21);
  });
  it('every balance equals the starting balance plus the sum of all ledger entries (the audit trail explains the wallet)', async () => {
    const fs = world(user(20));
    const l = createCloudLedger(fs.runner, U);
    await l.grantReward(daily('2026-11-19'));
    await l.grantReward(daily('2026-11-20'));
    await l.revokeReward('daily_2026-11-19');
    await l.buyFreeze('purchase-attempt-1', TODAY);
    await l.applyFreeze('h1', '2026-11-18');
    await l.grantReward(daily(TODAY));
    const sum = Object.entries(fs.docs).filter(([p]) => p.includes('/walletTransactions/')).reduce((n, [, d]) => n + (d.coinDelta as number), 0);
    expect(coins(fs)).toBe(20 + sum);
    const frz = Object.entries(fs.docs).filter(([p]) => p.includes('/walletTransactions/')).reduce((n, [, d]) => n + (d.freezeDelta as number), 0);
    expect(fs.docs[root].freezesOwned).toBe(frz);
  });
});
