import { describe, expect, it } from 'vitest';

import { buildCloudData } from '@/domain/cloudMapping';
import { FREEZE_PRICE_COINS } from '@/domain/freeze';
import { createCloudLedger, isValidRequestId } from '@/services/cloudLedger';
import { checkWalletRules, createFakeFirestore, type Doc, type FakeFirestore } from './fakeFirestore';

const U = 'u1';
const root = `users/${U}`;
const user = (coins: number, owned = 0, pending = 0, extra: Doc = {}): Doc => ({ email: 'a@b.co', coins, freezesOwned: owned, pendingAdjustment: pending, lastTransactionId: 'seed', ...extra });
const world = (u: Doc, extra: Record<string, Doc> = {}, opts?: Parameters<typeof createFakeFirestore>[2]) => createFakeFirestore(U, { [root]: u, ...extra }, opts);
const ledger = (fs: FakeFirestore) => createCloudLedger(fs.runner, U);
const uid = (n: number) => `req-${String(n).padStart(8, '0')}-uuid`;
const TODAY = '2026-11-21';
const tx = (fs: FakeFirestore, id: string) => fs.docs[`${root}/walletTransactions/${id}`];
const u = (fs: FakeFirestore) => fs.docs[root];
const txCount = (fs: FakeFirestore) => Object.keys(fs.docs).filter((p) => p.includes('/walletTransactions/')).length;

describe('freeze purchase: the Android transaction protocol (WalletLedger.buyFreeze)', () => {
  it("writes the wallet and ONE ledger entry together, with Kotlin's exact fields (no reward record, no freeze record)", async () => {
    const fs = world(user(50, 1));
    const r = await ledger(fs).buyFreeze(uid(1), TODAY);
    expect(r).toMatchObject({ kind: 'done', tx: { id: `freeze_buy_${uid(1)}`, type: 'freeze_purchase', coinDelta: -20, freezeDelta: 1, balanceAfter: 30, pendingDelta: 0 }, wallet: { coins: 30, freezesOwned: 2, pending: 0 } });
    expect(fs.commits).toHaveLength(1);
    expect(fs.commits[0].map((w) => `${w.kind}:${w.path}`)).toEqual([`update:${root}`, `set:${root}/walletTransactions/freeze_buy_${uid(1)}`]);
    expect(u(fs)).toMatchObject({ coins: 30, freezesOwned: 2, pendingAdjustment: 0, lastTransactionId: `freeze_buy_${uid(1)}`, updatedAt: 'TS' });
    // the entry carries the purchase date and no habit, milestone, reward or pending delta
    expect(tx(fs, `freeze_buy_${uid(1)}`)).toEqual({ type: 'freeze_purchase', coinDelta: -20, freezeDelta: 1, balanceAfter: 30, createdAt: 'TS', date: TODAY });
  });

  it('the price is the verified 20 coins', () => expect(FREEZE_PRICE_COINS).toBe(20));

  it('a second submission of the SAME attempt (retry, double tap, two tabs) is a Duplicate: coins are spent once', async () => {
    const fs = world(user(50));
    const l = ledger(fs);
    expect((await l.buyFreeze(uid(1), TODAY)).kind).toBe('done');
    expect((await l.buyFreeze(uid(1), TODAY)).kind).toBe('duplicate');
    expect(u(fs)).toMatchObject({ coins: 30, freezesOwned: 1 });
    expect(fs.commits).toHaveLength(1);
    expect(txCount(fs)).toBe(1);
  });

  it('separate purchases (different attempt ids) each spend 20, up to what you can still apply this month', async () => {
    const fs = world(user(100));
    const l = ledger(fs);
    for (const n of [1, 2, 3]) expect((await l.buyFreeze(uid(n), TODAY)).kind).toBe('done');
    expect(u(fs)).toMatchObject({ coins: 40, freezesOwned: 3 });
    expect(await l.buyFreeze(uid(4), TODAY)).toEqual({ kind: 'rejected', reason: 'HoldLimit' });
    expect(u(fs)).toMatchObject({ coins: 40, freezesOwned: 3 });
    expect(txCount(fs)).toBe(3);
  });

  it('not enough coins: rejected with the Kotlin reason, nothing is written; exactly 20 coins is enough and leaves 0', async () => {
    const fs = world(user(19));
    expect(await ledger(fs).buyFreeze(uid(1), TODAY)).toEqual({ kind: 'rejected', reason: 'InsufficientCoins' });
    expect(fs.commits).toHaveLength(0);
    expect(u(fs)).toMatchObject({ coins: 19, freezesOwned: 0, lastTransactionId: 'seed' });
    const exact = world(user(20));
    expect((await ledger(exact).buyFreeze(uid(1), TODAY)).kind).toBe('done');
    expect(u(exact)).toMatchObject({ coins: 0, freezesOwned: 1 });
  });

  it('monthly limit: 3 applications this month (freezeMonths/{yyyy-MM}.count) blocks a purchase even with plenty of coins', async () => {
    const fs = world(user(100, 0), { [`${root}/freezeMonths/2026-11`]: { count: 3 } });
    expect(await ledger(fs).buyFreeze(uid(1), TODAY)).toEqual({ kind: 'rejected', reason: 'MonthlyLimit' });
    expect(fs.commits).toHaveLength(0);
  });

  it('you cannot hold more freezes than you can still apply: 2 used + 1 owned this month is the hold limit', async () => {
    const fs = world(user(100, 1), { [`${root}/freezeMonths/2026-11`]: { count: 2 } });
    expect(await ledger(fs).buyFreeze(uid(1), TODAY)).toEqual({ kind: 'rejected', reason: 'HoldLimit' });
    const ok = world(user(100, 0), { [`${root}/freezeMonths/2026-11`]: { count: 2 } });
    expect((await ledger(ok).buyFreeze(uid(1), TODAY)).kind).toBe('done');
  });

  it('the month is the purchase date\'s: a full November does not block a December purchase (it reads freezeMonths/2026-12)', async () => {
    const fs = world(user(100, 0), { [`${root}/freezeMonths/2026-11`]: { count: 3 } });
    expect((await ledger(fs).buyFreeze(uid(1), '2026-12-01')).kind).toBe('done');
    expect(tx(fs, `freeze_buy_${uid(1)}`).date).toBe('2026-12-01');
  });

  it('a pending adjustment is not touched by a purchase', async () => {
    const fs = world(user(25, 0, 3));
    await ledger(fs).buyFreeze(uid(1), TODAY);
    expect(u(fs)).toMatchObject({ coins: 5, pendingAdjustment: 3 });
    expect('pendingDelta' in tx(fs, `freeze_buy_${uid(1)}`)).toBe(false);
  });

  it('a missing profile fails the transaction (nothing is created) so no purchase can happen', async () => {
    const fs = createFakeFirestore(U, {});
    await expect(ledger(fs).buyFreeze(uid(1), TODAY)).rejects.toMatchObject({ code: 'not-found' });
    expect(Object.keys(fs.docs)).toEqual([]);
  });

  it('an unusable attempt id or date is refused before Firestore is touched', async () => {
    const fs = world(user(100));
    for (const bad of ['', 'short', 'has/slash/in/it-123', 'a b c d e f g h', 'x'.repeat(101)]) await expect(ledger(fs).buyFreeze(bad, TODAY), bad).rejects.toThrow(/Invalid/);
    await expect(ledger(fs).buyFreeze(uid(1), '2026-13-45')).rejects.toThrow(/Invalid/);
    expect(fs.stats.attempts).toBe(0);
    expect(isValidRequestId('3f0c9a52-8d77-4f0e-9b1a-0c8e1d2f3a4b')).toBe(true);
  });
});

describe('freeze purchase: double spending and concurrency', () => {
  it('two tabs submitting the same attempt at once buy exactly once (the loser re-runs and sees the entry)', async () => {
    const fs = world(user(50));
    const [a, b] = await Promise.all([ledger(fs).buyFreeze(uid(1), TODAY), ledger(fs).buyFreeze(uid(1), TODAY)]);
    expect([a.kind, b.kind].sort()).toEqual(['done', 'duplicate']);
    expect(u(fs)).toMatchObject({ coins: 30, freezesOwned: 1 });
    expect(txCount(fs)).toBe(1);
    expect(fs.stats.conflicts).toBeGreaterThan(0); // the race really happened and was resolved by a retry
  });

  it('two DIFFERENT purchases racing for the last 20 coins: one succeeds, the other is rejected, the balance never goes negative', async () => {
    const fs = world(user(20));
    const results = await Promise.all([ledger(fs).buyFreeze(uid(1), TODAY), ledger(fs).buyFreeze(uid(2), TODAY)]);
    expect(results.map((r) => r.kind).sort()).toEqual(['done', 'rejected']);
    expect(results.find((r) => r.kind === 'rejected')).toEqual({ kind: 'rejected', reason: 'InsufficientCoins' });
    expect(u(fs)).toMatchObject({ coins: 0, freezesOwned: 1 });
    expect(txCount(fs)).toBe(1);
  });

  it('five parallel purchases with plenty of coins: exactly 3 go through (the monthly hold limit), 2 are rejected, coins 100 -> 40', async () => {
    const fs = world(user(100));
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => ledger(fs).buyFreeze(uid(n), TODAY)));
    expect(results.filter((r) => r.kind === 'done')).toHaveLength(3);
    expect(results.filter((r) => r.kind === 'rejected' && r.reason === 'HoldLimit')).toHaveLength(2);
    expect(u(fs)).toMatchObject({ coins: 40, freezesOwned: 3 });
    expect(txCount(fs)).toBe(3);
  });

  it("two devices (two ledgers) buying with different attempt ids can't both spend the same coins", async () => {
    const fs = world(user(30));
    const web = ledger(fs);
    const android = ledger(fs);
    const [a, b] = await Promise.all([web.buyFreeze(uid(1), TODAY), android.buyFreeze(uid(2), TODAY)]);
    expect([a.kind, b.kind].sort()).toEqual(['done', 'rejected']);
    expect(u(fs)).toMatchObject({ coins: 10, freezesOwned: 1 });
  });
});

describe('freeze purchase: failures leave nothing behind', () => {
  it('an offline / rejected transaction writes nothing and the same attempt can be retried later, buying once', async () => {
    const fs = world(user(50));
    fs.failNext(Object.assign(new Error('offline'), { code: 'unavailable' }));
    await expect(ledger(fs).buyFreeze(uid(1), TODAY)).rejects.toMatchObject({ code: 'unavailable' });
    expect(fs.commits).toHaveLength(0);
    expect(u(fs)).toMatchObject({ coins: 50, freezesOwned: 0, lastTransactionId: 'seed' });
    expect((await ledger(fs).buyFreeze(uid(1), TODAY)).kind).toBe('done');
    expect(u(fs)).toMatchObject({ coins: 30, freezesOwned: 1 });
  });

  it('a transaction that DID commit but whose response was lost: retrying the same attempt is a Duplicate, not a second charge', async () => {
    const fs = world(user(50));
    fs.loseAckNext();
    await expect(ledger(fs).buyFreeze(uid(1), TODAY)).rejects.toMatchObject({ code: 'unavailable' });
    expect(u(fs)).toMatchObject({ coins: 30, freezesOwned: 1 }); // the server has it
    expect((await ledger(fs).buyFreeze(uid(1), TODAY)).kind).toBe('duplicate');
    expect(u(fs)).toMatchObject({ coins: 30, freezesOwned: 1 });
  });

  it('a rules rejection (permission denied) is surfaced and nothing is partially written', async () => {
    const fs = world(user(50), {}, { rules: true });
    fs.failNext(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await expect(ledger(fs).buyFreeze(uid(1), TODAY)).rejects.toMatchObject({ code: 'permission-denied' });
    expect(Object.keys(fs.docs)).toEqual([root]);
  });
});

describe('freeze application: the Android transaction protocol (WalletLedger.applyFreeze)', () => {
  it("takes one OWNED freeze and records the application: wallet, ledger entry, freeze record and month counter, together, with Kotlin's fields", async () => {
    const fs = world(user(50, 2));
    const r = await ledger(fs).applyFreeze('h1', '2026-11-19');
    expect(r).toMatchObject({ kind: 'done', tx: { id: 'freeze_apply_h1_2026-11-19', type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 50 }, wallet: { coins: 50, freezesOwned: 1 } });
    expect(fs.commits).toHaveLength(1);
    expect(fs.commits[0].map((w) => `${w.kind}:${w.path}`)).toEqual([
      `update:${root}`,
      `set:${root}/walletTransactions/freeze_apply_h1_2026-11-19`,
      `set:${root}/freezes/h1_2026-11-19`,
      `set:${root}/freezeMonths/2026-11`,
    ]);
    expect(u(fs)).toMatchObject({ coins: 50, freezesOwned: 1, pendingAdjustment: 0, lastTransactionId: 'freeze_apply_h1_2026-11-19', updatedAt: 'TS' });
    expect(tx(fs, 'freeze_apply_h1_2026-11-19')).toEqual({ type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 50, createdAt: 'TS', date: '2026-11-19', habitId: 'h1' });
    expect(fs.docs[`${root}/freezes/h1_2026-11-19`]).toEqual({ habitId: 'h1', date: '2026-11-19', month: '2026-11', paidWith: 'inventory', transactionId: 'freeze_apply_h1_2026-11-19', createdAt: 'TS' });
    expect(fs.docs[`${root}/freezeMonths/2026-11`]).toEqual({ count: 1, updatedAt: 'TS' });
  });

  it('never spends coins: the balance is identical before and after, even at 0 coins', async () => {
    const fs = world(user(0, 1));
    const r = await ledger(fs).applyFreeze('h1', '2026-11-19');
    expect(r.kind).toBe('done');
    expect(u(fs)).toMatchObject({ coins: 0, freezesOwned: 0 });
    expect(tx(fs, 'freeze_apply_h1_2026-11-19').coinDelta).toBe(0);
  });

  it('buying then applying: 20 coins once in total (the application costs nothing)', async () => {
    const fs = world(user(45));
    const l = ledger(fs);
    await l.buyFreeze(uid(1), TODAY);
    await l.applyFreeze('h1', '2026-11-19');
    expect(u(fs)).toMatchObject({ coins: 25, freezesOwned: 0 });
    expect(Object.keys(fs.docs).filter((p) => p.includes('/walletTransactions/')).map((p) => (fs.docs[p].coinDelta as number))).toEqual([-20, 0]);
  });

  it('no owned freeze: rejected with the Kotlin reason and nothing is written', async () => {
    const fs = world(user(100, 0));
    expect(await ledger(fs).applyFreeze('h1', '2026-11-19')).toEqual({ kind: 'rejected', reason: 'NoFreezes' });
    expect(fs.commits).toHaveLength(0);
    expect(u(fs)).toMatchObject({ coins: 100, freezesOwned: 0 });
  });

  it('a day that is already protected cannot be protected again (also for freezes recorded by older versions)', async () => {
    const fs = world(user(10, 2), { [`${root}/freezes/h1_2026-11-19`]: { habitId: 'h1', date: '2026-11-19', paidWith: 'coins' } });
    expect(await ledger(fs).applyFreeze('h1', '2026-11-19')).toEqual({ kind: 'rejected', reason: 'AlreadyFrozen' });
    expect(u(fs)).toMatchObject({ freezesOwned: 2 });
    const again = world(user(10, 2));
    const l = ledger(again);
    expect((await l.applyFreeze('h1', '2026-11-19')).kind).toBe('done');
    expect(await l.applyFreeze('h1', '2026-11-19')).toEqual({ kind: 'rejected', reason: 'AlreadyFrozen' });
    expect(u(again).freezesOwned).toBe(1);
  });

  it('monthly limit: 3 applications in the PROTECTED day\'s month block a fourth, whatever you own; another month has its own counter', async () => {
    const fs = world(user(10, 3), { [`${root}/freezeMonths/2026-11`]: { count: 3 } });
    expect(await ledger(fs).applyFreeze('h1', '2026-11-19')).toEqual({ kind: 'rejected', reason: 'MonthlyLimit' });
    expect(u(fs).freezesOwned).toBe(3);
    // the 1st of December is protected under December's counter, even though it is applied in November
    const next = await ledger(fs).applyFreeze('h1', '2026-12-01');
    expect(next.kind).toBe('done');
    expect(fs.docs[`${root}/freezeMonths/2026-12`]).toEqual({ count: 1, updatedAt: 'TS' });
    expect(fs.docs[`${root}/freezeMonths/2026-11`]).toEqual({ count: 3 });
  });

  it('the counter goes 0 -> 1 -> 2 -> 3 and the rules stop it there', async () => {
    const fs = world(user(10, 3));
    const l = ledger(fs);
    for (const [i, d] of ['2026-11-17', '2026-11-18', '2026-11-19'].entries()) {
      expect((await l.applyFreeze('h1', d)).kind).toBe('done');
      expect(fs.docs[`${root}/freezeMonths/2026-11`].count).toBe(i + 1);
    }
    expect(await l.applyFreeze('h1', '2026-11-20')).toEqual({ kind: 'rejected', reason: 'MonthlyLimit' });
  });

  it('the same day applied from two devices at once: one application, one freeze used, one counter increment', async () => {
    const fs = world(user(10, 3));
    const [a, b] = await Promise.all([ledger(fs).applyFreeze('h1', '2026-11-19'), ledger(fs).applyFreeze('h1', '2026-11-19')]);
    expect([a.kind, b.kind].sort()).toEqual(['done', 'rejected']);
    expect(u(fs).freezesOwned).toBe(2);
    expect(fs.docs[`${root}/freezeMonths/2026-11`].count).toBe(1);
    expect(Object.keys(fs.docs).filter((p) => p.includes('/freezes/'))).toHaveLength(1);
  });

  it('two different days racing for the only owned freeze: one is protected, the other is told there is no freeze', async () => {
    const fs = world(user(10, 1));
    const results = await Promise.all([ledger(fs).applyFreeze('h1', '2026-11-18'), ledger(fs).applyFreeze('h1', '2026-11-19')]);
    expect(results.map((r) => r.kind).sort()).toEqual(['done', 'rejected']);
    expect(results.find((r) => r.kind === 'rejected')).toEqual({ kind: 'rejected', reason: 'NoFreezes' });
    expect(u(fs).freezesOwned).toBe(0);
  });

  it('a purchase racing with an application on the same wallet keeps both consistent', async () => {
    const fs = world(user(20, 1));
    const [buy, apply] = await Promise.all([ledger(fs).buyFreeze(uid(1), TODAY), ledger(fs).applyFreeze('h1', '2026-11-19')]);
    expect(buy.kind).toBe('done');
    expect(apply.kind).toBe('done');
    expect(u(fs)).toMatchObject({ coins: 0, freezesOwned: 1 });
  });

  it('a failed application (offline) leaves the wallet, the freeze list and the counter untouched; the retry applies once', async () => {
    const fs = world(user(10, 1));
    fs.failNext(Object.assign(new Error('offline'), { code: 'unavailable' }));
    await expect(ledger(fs).applyFreeze('h1', '2026-11-19')).rejects.toMatchObject({ code: 'unavailable' });
    expect(Object.keys(fs.docs)).toEqual([root]);
    expect(u(fs).freezesOwned).toBe(1);
    expect((await ledger(fs).applyFreeze('h1', '2026-11-19')).kind).toBe('done');
    expect(u(fs).freezesOwned).toBe(0);
  });

  it('refuses a malformed habit id or date before Firestore is touched', async () => {
    const fs = world(user(10, 1));
    await expect(ledger(fs).applyFreeze('', '2026-11-19')).rejects.toThrow(/Invalid/);
    await expect(ledger(fs).applyFreeze('a/b', '2026-11-19')).rejects.toThrow(/Invalid/);
    await expect(ledger(fs).applyFreeze('h1', 'tomorrow')).rejects.toThrow(/Invalid/);
    expect(fs.stats.attempts).toBe(0);
  });
});

describe('welcome freeze (WalletLedger.grantWelcomeFreeze)', () => {
  it('+1 freeze, no coins, under the fixed id welcome_freeze; it is not a use, so the monthly counter is untouched', async () => {
    const fs = world(user(20, 0, 0, { welcomeFreezePending: true }));
    const r = await ledger(fs).grantWelcomeFreeze();
    expect(r).toMatchObject({ kind: 'done', tx: { id: 'welcome_freeze', type: 'welcome_freeze', coinDelta: 0, freezeDelta: 1, balanceAfter: 20 }, wallet: { coins: 20, freezesOwned: 1 } });
    expect(u(fs)).toMatchObject({ coins: 20, freezesOwned: 1, lastTransactionId: 'welcome_freeze' });
    expect(tx(fs, 'welcome_freeze')).toEqual({ type: 'welcome_freeze', coinDelta: 0, freezeDelta: 1, balanceAfter: 20, createdAt: 'TS' });
    expect(Object.keys(fs.docs).some((p) => p.includes('freezeMonths'))).toBe(false);
  });

  it('happens once however many devices try (repeat, restart, two tabs, Android)', async () => {
    const fs = world(user(20, 0, 0, { welcomeFreezePending: true }));
    const results = await Promise.all([ledger(fs).grantWelcomeFreeze(), ledger(fs).grantWelcomeFreeze(), ledger(fs).grantWelcomeFreeze()]);
    expect(results.map((r) => r.kind).sort()).toEqual(['done', 'duplicate', 'duplicate']);
    expect((await ledger(fs).grantWelcomeFreeze()).kind).toBe('duplicate');
    expect(u(fs).freezesOwned).toBe(1);
  });

  it('the marker is cleared afterwards, and only when it is set; nothing else of the user document changes', async () => {
    const fs = world(user(20, 1, 0, { welcomeFreezePending: true, displayName: 'a' }));
    expect(await ledger(fs).clearWelcomeFreezeMarker()).toBe(true);
    expect(u(fs)).toMatchObject({ welcomeFreezePending: false, coins: 20, freezesOwned: 1, displayName: 'a', lastTransactionId: 'seed' });
    expect(await ledger(fs).clearWelcomeFreezeMarker()).toBe(false);
    const plain = world(user(20, 1));
    expect(await ledger(plain).clearWelcomeFreezeMarker()).toBe(false);
    expect(plain.commits).toHaveLength(0);
  });
});

describe('cross-device: Android and the Web share one wallet', () => {
  /** What the Kotlin app writes for a purchase (WalletRepository.commit), straight into the shared store. */
  const androidBuys = (fs: FakeFirestore, requestId: string) => {
    const w = fs.docs[root];
    const id = `freeze_buy_${requestId}`;
    fs.put(`${root}/walletTransactions/${id}`, { type: 'freeze_purchase', coinDelta: -20, freezeDelta: 1, balanceAfter: (w.coins as number) - 20, createdAt: 'TS', date: TODAY });
    fs.patch(root, { coins: (w.coins as number) - 20, freezesOwned: (w.freezesOwned as number) + 1, lastTransactionId: id });
  };

  it("a purchase made on Android is seen by the Web ledger: the Web's next purchase starts from Android's balance", async () => {
    const fs = world(user(60));
    androidBuys(fs, 'android-attempt-1');
    expect(u(fs)).toMatchObject({ coins: 40, freezesOwned: 1 });
    await ledger(fs).buyFreeze(uid(1), TODAY);
    expect(u(fs)).toMatchObject({ coins: 20, freezesOwned: 2 });
    expect(txCount(fs)).toBe(2);
  });

  it('both devices have used up the month together: Android applied 2, the Web may apply only 1 more', async () => {
    const fs = world(user(10, 3), { [`${root}/freezeMonths/2026-11`]: { count: 2 } });
    expect((await ledger(fs).applyFreeze('h1', '2026-11-19')).kind).toBe('done');
    expect(await ledger(fs).applyFreeze('h2', '2026-11-19')).toEqual({ kind: 'rejected', reason: 'MonthlyLimit' });
  });

  it("the Web's records read back through the same converters as Android's (history shows both, newest first)", async () => {
    const fs = world(user(60));
    androidBuys(fs, 'android-attempt-1');
    fs.patch(`${root}/walletTransactions/freeze_buy_android-attempt-1`, { createdAt: 1000 });
    await ledger(fs).buyFreeze(uid(1), TODAY);
    fs.patch(`${root}/walletTransactions/freeze_buy_${uid(1)}`, { createdAt: 2000 });
    await ledger(fs).applyFreeze('h1', '2026-11-19');
    fs.patch(`${root}/walletTransactions/freeze_apply_h1_2026-11-19`, { createdAt: 3000 });
    const docsOf = (prefix: string) => Object.entries(fs.docs).filter(([p]) => p.startsWith(`${root}/${prefix}/`)).map(([p, data]) => ({ id: p.split('/').pop()!, data: data as never }));
    const cloud = buildCloudData({ uid: U, user: { id: U, data: fs.docs[root] as never }, habits: [], transactions: docsOf('walletTransactions'), rewards: [], freezes: docsOf('freezes'), freezeMonths: docsOf('freezeMonths'), notes: [] });
    expect(cloud.transactions.map((t) => [t.id, t.type, t.coinDelta, t.freezeDelta, t.balanceAfter, t.date, t.habitId])).toEqual([
      ['freeze_apply_h1_2026-11-19', 'freeze_application', 0, -1, 20, '2026-11-19', 'h1'],
      [`freeze_buy_${uid(1)}`, 'freeze_purchase', -20, 1, 20, TODAY, null],
      ['freeze_buy_android-attempt-1', 'freeze_purchase', -20, 1, 40, TODAY, null],
    ]);
    expect(cloud.ledger.wallet).toEqual({ coins: 20, freezesOwned: 1, pending: 0 });
    expect(cloud.ledger.freezes).toEqual([{ habitId: 'h1', date: '2026-11-19', paidWith: 'inventory' }]);
    expect(cloud.freezeMonths).toEqual([{ month: '2026-11', count: 1 }]);
  });

  it('every wallet document the Web wrote passed the production-rules mirror (the fake would have thrown permission-denied otherwise)', async () => {
    const fs = world(user(100));
    const l = ledger(fs);
    await l.buyFreeze(uid(1), TODAY);
    await l.applyFreeze('h1', '2026-11-19');
    await l.grantReward({ id: 'daily_2026-11-21', type: 'daily_completion', amount: 1, date: TODAY });
    await l.revokeReward('daily_2026-11-21');
    expect(fs.commits.length).toBe(4);
  });
});

describe('the rules mirror itself (so the tests above mean something)', () => {
  it('refuses a wallet change without a matching ledger entry, an overwritten entry, and a counter that jumps', () => {
    const before = { [root]: user(10, 1) };
    const tamper = { path: root, kind: 'update' as const, fields: { coins: 99, lastTransactionId: 'x' } };
    expect(() => checkWalletRules(U, before, [tamper])).toThrow(/PERMISSION_DENIED/);
    const entry = { path: `${root}/walletTransactions/x`, kind: 'set' as const, fields: { type: 't', coinDelta: 89, freezeDelta: 0, balanceAfter: 99 } };
    expect(() => checkWalletRules(U, before, [tamper, entry])).toThrow(/PERMISSION_DENIED/); // +89 is outside the ledger's -20..20
    const good = { path: `${root}/walletTransactions/x`, kind: 'set' as const, fields: { type: 't', coinDelta: 5, freezeDelta: 0, balanceAfter: 15 } };
    expect(() => checkWalletRules(U, before, [{ ...tamper, fields: { coins: 15, freezesOwned: 1, pendingAdjustment: 0, lastTransactionId: 'x' } }, good])).not.toThrow();
    expect(() => checkWalletRules(U, { ...before, [`${root}/freezeMonths/2026-11`]: { count: 3 } }, [{ path: `${root}/freezeMonths/2026-11`, kind: 'set', fields: { count: 4 } }])).toThrow(/PERMISSION_DENIED/);
    expect(() => checkWalletRules(U, { ...before, [`${root}/walletTransactions/x`]: { coinDelta: 1 } }, [good])).toThrow(/append-only/);
  });
});
