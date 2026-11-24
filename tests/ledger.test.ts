/**
 * Coin earning, spending and undo, ported from android WalletTest.kt (WalletLedgerTest, RewardReversalTest) plus the
 * reward reconciliation that AppViewModel.reconcileRewards performs on every check/uncheck.
 */
import { describe, expect, it } from 'vitest';

import { FREEZE_PRICE_COINS, MAX_FREEZE_APPLICATIONS_PER_MONTH, WELCOME_FREEZE_ID } from '@/domain/freeze';
import {
  applyFreeze,
  buyFreeze,
  emptyLedger,
  grantReward,
  grantWelcomeFreeze,
  reconcileRewards,
  revokeReward,
  type LedgerResult,
  type LedgerState,
} from '@/domain/ledger';
import { DAILY_REWARD, MILESTONE_BONUSES, milestoneBonus, TxType } from '@/domain/rewards';
import { addDays } from '@/utils/date';
import { range, sched } from './helpers';

const today = '2024-06-10';
const start = (coins = 0, freezesOwned = 0, pending = 0): LedgerState => ({ ...emptyLedger(), wallet: { coins, freezesOwned, pending } });
const state = (r: LedgerResult) => r.state;
const kinds = (r: LedgerResult) => r.kind;
const rejected = (r: LedgerResult) => (r.kind === 'rejected' ? r.reason : null);

/** Balance and pending are fully explained by the ledger, and never negative (Kotlin `assertConsistent`). */
function assertConsistent(s: LedgerState, startCoins: number) {
  expect(s.wallet.coins).toBe(startCoins + s.transactions.reduce((n, t) => n + t.coinDelta, 0));
  expect(s.wallet.pending).toBe(s.transactions.reduce((n, t) => n + t.pendingDelta, 0));
  expect(s.wallet.coins).toBeGreaterThanOrEqual(0);
  expect(s.wallet.pending).toBeGreaterThanOrEqual(0);
  expect(s.wallet.pending === 0 || s.wallet.coins === 0).toBe(true);
}

describe('earning', () => {
  it('a reward is granted once', () => {
    let s = start();
    const first = grantReward(s, { id: 'daily_2024-06-10', type: TxType.DAILY, amount: 1, date: today });
    expect(kinds(first)).toBe('done');
    s = state(first);
    expect(kinds(grantReward(s, { id: 'daily_2024-06-10', type: TxType.DAILY, amount: 1, date: today }))).toBe('duplicate');
    expect(s.wallet.coins).toBe(1);
    expect(s.transactions).toHaveLength(1);
  });

  it('a milestone is not duplicated', () => {
    let s = start();
    for (let i = 0; i < 3; i++) s = state(grantReward(s, { id: 'milestone_a_15_2024-06-01', type: TxType.MILESTONE, amount: 5, date: today, habitId: 'a', milestone: 15 }));
    expect(s.wallet.coins).toBe(5);
  });

  it('every milestone pays its bonus once through the ledger', () => {
    let s = start();
    for (const [day, bonus] of Object.entries(MILESTONE_BONUSES)) {
      const g = { id: `milestone_a_${day}_2024-01-01`, type: TxType.MILESTONE, amount: bonus, date: today, habitId: 'a', milestone: Number(day) };
      const r = grantReward(s, g);
      expect(kinds(r)).toBe('done');
      s = state(r);
      expect(kinds(grantReward(s, g))).toBe('duplicate'); // restart or sync
    }
    expect(s.wallet.coins).toBe(5 + 5 + 5 + 5 + 10 + 20);
    expect(s.transactions).toHaveLength(6);
  });

  it('a non-positive amount is rejected as "nothing to reward"', () => {
    expect(rejected(grantReward(start(), { id: 'x', type: TxType.DAILY, amount: 0, date: today }))).toBe('NoReward');
  });
});

describe('spending: buying a Streak Freeze', () => {
  const P = FREEZE_PRICE_COINS;

  it('costs 20 coins', () => expect(P).toBe(20));

  it('insufficient coins is rejected and changes nothing', () => {
    const r = buyFreeze(start(P - 1), 'req1', today);
    expect(rejected(r)).toBe('InsufficientCoins');
    expect(r.state.wallet).toEqual({ coins: P - 1, freezesOwned: 0, pending: 0 });
    expect(r.state.transactions).toEqual([]);
  });

  it('exactly the price succeeds', () => {
    const r = buyFreeze(start(P), 'req1', today);
    expect(kinds(r)).toBe('done');
    expect(r.state.wallet).toEqual({ coins: 0, freezesOwned: 1, pending: 0 });
  });

  it('a successful purchase', () => {
    const r = buyFreeze(start(45), 'req1', today);
    expect(r.state.wallet).toEqual({ coins: 25, freezesOwned: 1, pending: 0 });
    expect(r.state.transactions.find((t) => t.id === 'freeze_buy_req1')?.coinDelta).toBe(-20);
  });

  it('an older purchase keeps its recorded price', () => {
    // A purchase made at the old 10-coin price is not charged 20 now.
    const r = buyFreeze(start(10), 'old', today, 10);
    expect(r.state.wallet).toEqual({ coins: 0, freezesOwned: 1, pending: 0 });
    expect(r.state.transactions.find((t) => t.id === 'freeze_buy_old')?.coinDelta).toBe(-10);
  });

  it('a repeated purchase request buys once', () => {
    let s = start(50);
    for (let i = 0; i < 20; i++) s = state(buyFreeze(s, 'same-tap', today));
    expect(s.wallet).toEqual({ coins: 30, freezesOwned: 1, pending: 0 });
  });

  it('distinct purchases never overspend', () => {
    let s = start(45);
    const results: LedgerResult[] = [];
    for (let i = 1; i <= 10; i++) {
      const r = buyFreeze(s, `req${i}`, today);
      results.push(r);
      s = r.state;
    }
    expect(results.filter((r) => r.kind === 'done')).toHaveLength(2);
    expect(s.wallet).toEqual({ coins: 5, freezesOwned: 2, pending: 0 });
  });

  it('cannot hold more than the monthly allowance', () => {
    let s = start(100);
    for (let i = 0; i < MAX_FREEZE_APPLICATIONS_PER_MONTH; i++) s = state(buyFreeze(s, `r${i}`, today));
    expect(rejected(buyFreeze(s, 'r4', today))).toBe('HoldLimit');
    expect(s.wallet).toEqual({ coins: 40, freezesOwned: 3, pending: 0 });
  });
});

describe('welcome freeze', () => {
  it('is given once, with no coins and no monthly use', () => {
    const s0 = start(20);
    const r = grantWelcomeFreeze(s0);
    expect(kinds(r)).toBe('done');
    expect(r.state.wallet).toEqual({ coins: 20, freezesOwned: 1, pending: 0 });
    expect(r.state.transactions.find((t) => t.id === WELCOME_FREEZE_ID)?.coinDelta).toBe(0);
    expect(r.state.freezes).toEqual([]); // not a use of a freeze
    expect(kinds(grantWelcomeFreeze(r.state))).toBe('duplicate'); // restart, retry, sync, backup
  });

  it('keeps existing balances when it arrives', () => {
    expect(grantWelcomeFreeze(start(37, 2)).state.wallet).toEqual({ coins: 37, freezesOwned: 3, pending: 0 });
  });

  it('can be used and counts toward the month only then', () => {
    const s = state(grantWelcomeFreeze(start(20)));
    const r = applyFreeze(s, 'a', '2024-06-09');
    expect(kinds(r)).toBe('done');
    expect(r.state.wallet).toEqual({ coins: 20, freezesOwned: 0, pending: 0 });
    expect(r.state.freezes).toHaveLength(1);
  });
});

describe('applying a freeze', () => {
  it('uses exactly one owned freeze and no coins', () => {
    const r = applyFreeze(start(20, 2), 'a', '2024-06-09');
    expect(r.state.wallet).toEqual({ coins: 20, freezesOwned: 1, pending: 0 });
    expect(r.state.freezes[0]).toEqual({ habitId: 'a', date: '2024-06-09', paidWith: 'inventory' });
    const tx = r.state.transactions.find((t) => t.id === 'freeze_apply_a_2024-06-09')!;
    expect([tx.coinDelta, tx.freezeDelta]).toEqual([0, -1]);
  });

  it('with no owned freeze it is rejected even with coins', () => {
    const r = applyFreeze(start(100), 'a', '2024-06-09');
    expect(rejected(r)).toBe('NoFreezes');
    expect(r.state.freezes).toEqual([]);
    expect(r.state.wallet).toEqual({ coins: 100, freezesOwned: 0, pending: 0 });
  });

  it('the monthly application limit is 3, and a new month has its own', () => {
    let s = start(0, 5);
    for (const d of ['2024-06-03', '2024-06-04', '2024-06-05']) {
      const r = applyFreeze(s, 'a', d);
      expect(kinds(r)).toBe('done');
      s = r.state;
    }
    const over = applyFreeze(s, 'b', '2024-06-06');
    expect(rejected(over)).toBe('MonthlyLimit');
    expect(over.state.wallet.freezesOwned).toBe(2); // the rejected attempt used nothing
    expect(kinds(applyFreeze(s, 'a', '2024-07-01'))).toBe('done');
  });

  it("the limit follows the protected date's month", () => {
    let s = start(0, 4);
    for (const d of ['2024-05-29', '2024-05-30', '2024-05-31']) s = state(applyFreeze(s, 'a', d));
    const r = applyFreeze(s, 'a', '2024-06-01');
    expect(kinds(r)).toBe('done');
    expect(r.state.freezes.map((f) => f.date.slice(0, 7))).toEqual(['2024-05', '2024-05', '2024-05', '2024-06']);
  });

  it('a duplicate application is refused and repeated taps are safe', () => {
    let s = start(0, 3);
    const results: LedgerResult[] = [];
    for (let i = 0; i < 10; i++) {
      const r = applyFreeze(s, 'a', '2024-06-09');
      results.push(r);
      s = r.state;
    }
    expect(results.filter((r) => r.kind === 'done')).toHaveLength(1);
    expect(results.filter((r) => r.kind !== 'done').every((r) => rejected(r) === 'AlreadyFrozen')).toBe(true);
    expect(s.wallet.freezesOwned).toBe(2);
  });

  it('applications never spend more than owned', () => {
    let s = start(0, 1);
    const done: LedgerResult[] = [];
    for (const h of ['a', 'b', 'c']) {
      const r = applyFreeze(s, h, '2024-06-09');
      done.push(r);
      s = r.state;
    }
    expect(done.filter((r) => r.kind === 'done')).toHaveLength(1);
    expect(s.wallet.freezesOwned).toBe(0);
  });

  it('charges one freeze per day, no coins, no duplicates, and keeps the monthly limit', () => {
    let s = start(40, 3);
    for (const d of ['2024-06-10', '2024-06-11', '2024-06-12']) s = state(applyFreeze(s, 'a', d));
    expect(rejected(applyFreeze(s, 'a', '2024-06-11'))).toBe('AlreadyFrozen');
    expect(s.wallet).toEqual({ coins: 40, freezesOwned: 0, pending: 0 });
    expect(s.transactions).toHaveLength(3);
    expect(s.transactions.every((t) => t.coinDelta === 0 && t.freezeDelta === -1)).toBe(true);
    // A fourth June day is refused even with a freeze in stock.
    const stocked: LedgerState = { ...s, wallet: { ...s.wallet, freezesOwned: 1 } };
    expect(rejected(applyFreeze(stocked, 'b', '2024-06-12'))).toBe('MonthlyLimit');
  });

  it('the ledger replays to the same balance', () => {
    let s = start(20);
    s = state(grantReward(s, { id: 'daily_2024-06-09', type: TxType.DAILY, amount: 1, date: today }));
    s = state(buyFreeze(s, 'r1', today));
    s = state(applyFreeze(s, 'a', '2024-06-09'));
    expect(s.wallet.coins).toBe(20 + s.transactions.reduce((n, t) => n + t.coinDelta, 0));
    expect(s.wallet.freezesOwned).toBe(s.transactions.reduce((n, t) => n + t.freezeDelta, 0));
  });
});

describe('undo: reward reversal and pending adjustments', () => {
  const R = DAILY_REWARD;
  const M = milestoneBonus(15);
  const day = '2026-11-05';
  const day2 = '2026-11-04';
  const daily = (s: LedgerState, date: string) => grantReward(s, { id: `daily_${date}`, type: TxType.DAILY, amount: R, date });

  it('complete, uncheck, re-complete never duplicates', () => {
    let s = start(20);
    s = state(daily(s, day));
    expect(s.wallet.coins).toBe(20 + R);
    expect(kinds(revokeReward(s, `daily_${day}`))).toBe('done');
    s = state(revokeReward(s, `daily_${day}`));
    expect(s.wallet.coins).toBe(20);
    s = state(daily(s, day));
    expect(s.wallet.coins).toBe(20 + R);
    for (let i = 0; i < 5; i++) {
      s = state(revokeReward(s, `daily_${day}`));
      s = state(revokeReward(s, `daily_${day}`));
      s = state(daily(s, day));
      s = state(daily(s, day));
    }
    expect(s.wallet.coins).toBe(20 + R);
    expect(s.wallet.pending).toBe(0);
    expect(s.transactions.slice(0, 3).map((t) => t.id)).toEqual([`daily_${day}`, `daily_${day}_rev1`, `daily_${day}_grant2`]);
    expect(s.transactions[1].type).toBe(TxType.REVERSAL);
    expect(s.transactions[2].type).toBe(TxType.RESTORED);
    assertConsistent(s, 20);
  });

  it('a reversal with zero coins becomes pending and keeps freezes', () => {
    let s = start(FREEZE_PRICE_COINS - R);
    s = state(daily(s, day));
    expect(kinds(buyFreeze(s, 'r1', day))).toBe('done');
    s = state(buyFreeze(s, 'r1', day));
    expect(s.wallet).toEqual({ coins: 0, freezesOwned: 1, pending: 0 });
    s = state(revokeReward(s, `daily_${day}`));
    expect(s.wallet).toEqual({ coins: 0, freezesOwned: 1, pending: R });
    expect(s.transactions.find((t) => t.id === `daily_${day}_rev1`)?.coinDelta).toBe(0);
    assertConsistent(s, FREEZE_PRICE_COINS - R);
  });

  it('a reversal with some coins takes what is available', () => {
    let s = start(2);
    s = state(grantReward(s, { id: 'milestone_a_15_x', type: TxType.MILESTONE, amount: M, date: day, habitId: 'a', milestone: 15 }));
    s = { ...s, wallet: { ...s.wallet, coins: 2 } }; // the rest was spent
    s = state(revokeReward(s, 'milestone_a_15_x'));
    expect(s.wallet.coins).toBe(0);
    expect(s.wallet.pending).toBe(M - 2);
    const tx = s.transactions.find((t) => t.id === 'milestone_a_15_x_rev1')!;
    expect([tx.coinDelta, tx.pendingDelta]).toEqual([-2, M - 2]);
  });

  it('earnings pay pending first, then the balance grows', () => {
    let s = start();
    s = state(daily(s, day));
    s = { ...s, wallet: { ...s.wallet, coins: 0 } };
    s = state(revokeReward(s, `daily_${day}`));
    s = state(daily(s, day2));
    expect(s.wallet).toEqual({ coins: 0, freezesOwned: 0, pending: 0 });
    const applied = s.transactions.find((t) => t.id === `daily_${day2}`)!;
    expect([applied.coinDelta, applied.pendingDelta]).toEqual([0, -R]);
    s = state(grantReward(s, { id: 'daily_2026-11-03', type: TxType.DAILY, amount: R, date: '2026-11-03' }));
    expect(s.wallet.coins).toBe(R);
  });

  it('re-completing while an adjustment is pending cancels it', () => {
    let s = start();
    s = state(daily(s, day));
    s = { ...s, wallet: { ...s.wallet, coins: 0 } };
    s = state(revokeReward(s, `daily_${day}`));
    s = state(daily(s, day));
    expect(s.wallet).toEqual({ coins: 0, freezesOwned: 0, pending: 0 });
  });

  it('re-completing after the adjustment was settled credits normally', () => {
    let s = start();
    s = state(daily(s, day));
    s = { ...s, wallet: { ...s.wallet, coins: 0 } };
    s = state(revokeReward(s, `daily_${day}`));
    s = state(daily(s, day2));
    s = state(daily(s, day));
    expect(s.wallet).toEqual({ coins: R, freezesOwned: 0, pending: 0 });
  });

  it('multiple reversals across dates accumulate and settle', () => {
    let s = start();
    s = state(daily(s, day));
    s = state(daily(s, day2));
    s = { ...s, wallet: { ...s.wallet, coins: 0 } };
    s = state(revokeReward(s, `daily_${day}`));
    s = state(revokeReward(s, `daily_${day2}`));
    expect(s.wallet.pending).toBe(2 * R);
    s = state(daily(s, day2));
    expect(s.wallet).toEqual({ coins: 0, freezesOwned: 0, pending: R });
    s = state(daily(s, day));
    expect(s.wallet).toEqual({ coins: 0, freezesOwned: 0, pending: 0 });
  });

  it('revoking something never granted is a no-op', () => {
    expect(kinds(revokeReward(start(5), 'daily_never_granted'))).toBe('duplicate');
  });

  it('purchases and applied freezes are never reversed', () => {
    let s = start(FREEZE_PRICE_COINS);
    s = state(daily(s, day));
    s = state(buyFreeze(s, 'r1', day));
    s = state(applyFreeze(s, 'h', day2));
    s = state(revokeReward(s, `daily_${day}`));
    expect(s.wallet.freezesOwned).toBe(0);
    expect(s.freezes).toHaveLength(1);
    expect(s.txIds.includes('freeze_buy_r1') && s.txIds.includes(`freeze_apply_h_${day2}`)).toBe(true);
    assertConsistent(s, FREEZE_PRICE_COINS);
  });
});

describe('reward reconciliation (what happens when a habit is checked or unchecked)', () => {
  const month = '2024-06-10'; // Monday
  const both = (done: string[]) => [sched('a', done), sched('b', done)];

  it('completing every habit earns exactly one daily coin; repeating it earns nothing more', () => {
    const first = reconcileRewards(start(20), both([month]), month);
    expect(first.dailyCoins).toBe(1);
    expect(first.state.wallet.coins).toBe(21);
    expect(first.notice).toBeNull();
    const again = reconcileRewards(first.state, both([month]), month);
    expect(again.dailyCoins).toBe(0);
    expect(again.state.wallet.coins).toBe(21);
  });

  it('partial completion earns nothing', () => {
    const out = reconcileRewards(start(20), [sched('a', [month]), sched('b', [])], month);
    expect(out.dailyCoins).toBe(0);
    expect(out.state.wallet.coins).toBe(20);
  });

  it('unchecking reverses the coin with a notice; re-checking restores it', () => {
    let s = reconcileRewards(start(20), both([month]), month).state;
    const undone = reconcileRewards(s, [sched('a', [month]), sched('b', [])], month);
    expect(undone.state.wallet.coins).toBe(20);
    expect(undone.notice).toBe('Daily reward adjusted.');
    s = undone.state;
    const redone = reconcileRewards(s, both([month]), month);
    expect(redone.state.wallet.coins).toBe(21);
    expect(redone.dailyCoins).toBe(1);
    assertConsistent(redone.state, 20);
  });

  it('an undo of coins already spent becomes pending, with the wallet notice', () => {
    let s = reconcileRewards(start(FREEZE_PRICE_COINS - 1), both([month]), month).state;
    s = state(buyFreeze(s, 'r', month)); // spends everything
    expect(s.wallet.coins).toBe(0);
    const undone = reconcileRewards(s, [sched('a', [month]), sched('b', [])], month);
    expect(undone.state.wallet).toEqual({ coins: 0, freezesOwned: 1, pending: 1 });
    expect(undone.notice).toBe('Coin reward adjusted. Tap ⓘ in your wallet for details.');
  });

  it('only the current month earns new coins; an old-month day is only ever corrected', () => {
    // 2024-05-31 recorded while it is June: no reward is issued.
    const out = reconcileRewards(start(), [sched('a', ['2024-05-31'])], '2024-06-02');
    expect(out.dailyCoins).toBe(0);
    expect(out.state.wallet.coins).toBe(0);
  });

  it('a Day-15 milestone pays +5, is celebrated once, and is not celebrated again when restored', () => {
    const habit15 = sched('a', range('2024-06-01', 15));
    const day15 = addDays('2024-06-01', 14);
    // One habit completed on June 1..15: 15 daily coins (one per all-done day) plus the +5 Day-15 bonus.
    const first = reconcileRewards(start(), [habit15], day15);
    expect(first.state.wallet.coins).toBe(15 + 5);
    expect(first.celebrations).toEqual([{ habitId: 'a', milestone: 15, coins: 5 }]);
    // The coin popup amount excludes milestone coins (they have their own screen).
    expect(first.dailyCoins).toBe(15);
    // Un-check day 15 -> its daily coin and the milestone are reversed ...
    const broken = reconcileRewards(first.state, [sched('a', range('2024-06-01', 14))], day15);
    expect(broken.state.wallet.coins).toBe(14);
    // ... and re-checking restores them without celebrating the milestone a second time.
    const restored = reconcileRewards(broken.state, [habit15], day15);
    expect(restored.state.wallet.coins).toBe(first.state.wallet.coins);
    expect(restored.celebrations).toEqual([]);
    assertConsistent(restored.state, 0);
  });
});
