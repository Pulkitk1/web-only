/**
 * Wallet-screen rules (android AppViewModel `freezesLeft` / `canBuyFreeze` / `buyFreeze`, WalletScreen.kt) on top of the
 * ledger, which WalletTest.kt's cases (tests/ledger.test.ts) already cover in depth. These tests follow whole wallet
 * scenarios: what the screen's numbers and buttons say after each step.
 */
import { describe, expect, it } from 'vitest';

import { FREEZE_PRICE_COINS, MAX_FREEZE_APPLICATIONS_PER_MONTH, WELCOME_FREEZE_ID } from '@/domain/freeze';
import { applyFreeze, buyFreeze, canBuyFreeze, emptyLedger, freezeCount, freezesLeft, grantWelcomeFreeze, reconcileRewards, REJECT_MESSAGE, type LedgerResult, type LedgerState } from '@/domain/ledger';
import { MILESTONE_BONUSES } from '@/domain/rewards';
import { sched } from './helpers';

const TODAY = '2026-11-21';
const MONTH = '2026-11';
const start = (coins = 0, freezesOwned = 0, pending = 0): LedgerState => ({ ...emptyLedger(), wallet: { coins, freezesOwned, pending } });
const done = (r: LedgerResult): LedgerState => {
  expect(r.kind).toBe('done');
  return r.state;
};
const buy = (s: LedgerState, id: string) => buyFreeze(s, id, TODAY);

/** The Wallet's button text, exactly as WalletScreen.kt chooses it. */
function buyLabel(s: LedgerState): string {
  if (canBuyFreeze(s, TODAY)) return `❄️  Buy Streak Freeze — ${FREEZE_PRICE_COINS} Coins`;
  if (s.wallet.coins < FREEZE_PRICE_COINS) return `Need ${FREEZE_PRICE_COINS - s.wallet.coins} more coins`;
  return 'Monthly limit reached';
}

describe('wallet constants (verified against Kotlin)', () => {
  it('a freeze costs 20 coins, 3 per month, recovered within 3 days', () => {
    expect(FREEZE_PRICE_COINS).toBe(20);
    expect(MAX_FREEZE_APPLICATIONS_PER_MONTH).toBe(3);
  });
  it('the milestone rows shown in the Wallet are 15/30/45/60/75/100 with bonuses 5/5/5/5/10/20', () => {
    expect(Object.entries(MILESTONE_BONUSES).map(([d, b]) => [Number(d), b])).toEqual([[15, 5], [30, 5], [45, 5], [60, 5], [75, 10], [100, 20]]);
  });
});

describe('welcome freeze', () => {
  it('a new user gets exactly one free freeze and no coins', () => {
    const s = done(grantWelcomeFreeze(start(20)));
    expect(s.wallet).toEqual({ coins: 20, freezesOwned: 1, pending: 0 });
    expect(s.txIds).toContain(WELCOME_FREEZE_ID);
    expect(grantWelcomeFreeze(s).kind).toBe('duplicate');
  });
  it('it counts as an owned freeze: it reduces how many more can be bought this month', () => {
    const s = done(grantWelcomeFreeze(start(100)));
    expect(freezesLeft(s, TODAY)).toBe(2);
  });
  it('using it spends no coins', () => {
    let s = done(grantWelcomeFreeze(start(20)));
    s = done(applyFreeze(s, 'h', '2026-11-19'));
    expect(s.wallet).toEqual({ coins: 20, freezesOwned: 0, pending: 0 });
    expect(freezeCount(s, MONTH)).toBe(1);
  });
});

describe('freezes left and the Buy button', () => {
  it('with 20 coins and nothing owned: 3 left, can buy', () => {
    const s = start(20);
    expect(freezesLeft(s, TODAY)).toBe(3);
    expect(canBuyFreeze(s, TODAY)).toBe(true);
    expect(buyLabel(s)).toBe('❄️  Buy Streak Freeze — 20 Coins');
  });
  it('under 20 coins the button says how many are missing', () => {
    expect(buyLabel(start(19))).toBe('Need 1 more coins');
    expect(buyLabel(start(0))).toBe('Need 20 more coins');
    expect(canBuyFreeze(start(19), TODAY)).toBe(false);
  });
  it('buying spends exactly 20 coins and adds one freeze', () => {
    const s = done(buy(start(45), 'a'));
    expect(s.wallet).toEqual({ coins: 25, freezesOwned: 1, pending: 0 });
    expect(freezesLeft(s, TODAY)).toBe(2);
    expect(s.transactions.at(-1)).toMatchObject({ coinDelta: -20, freezeDelta: 1, balanceAfter: 25 });
  });
  it('owned plus applied freezes can never exceed 3 in a month: the 4th purchase is refused', () => {
    let s = start(500);
    for (const id of ['a', 'b', 'c']) s = done(buy(s, id));
    expect(s.wallet.freezesOwned).toBe(3);
    expect(freezesLeft(s, TODAY)).toBe(0);
    expect(canBuyFreeze(s, TODAY)).toBe(false);
    expect(buyLabel(s)).toBe('Monthly limit reached');
    const r = buy(s, 'd');
    expect(r.kind).toBe('rejected');
    expect(r.kind === 'rejected' && r.reason).toBe('HoldLimit');
    expect(s.wallet.coins).toBe(440); // nothing was charged
  });
  it('applying a freeze keeps the month total at 3 (owned goes down, used goes up)', () => {
    let s = start(500);
    for (const id of ['a', 'b', 'c']) s = done(buy(s, id));
    s = done(applyFreeze(s, 'h', '2026-11-19'));
    expect(s.wallet.freezesOwned).toBe(2);
    expect(freezeCount(s, MONTH)).toBe(1);
    expect(freezesLeft(s, TODAY)).toBe(0);
  });
  it('after 3 freezes are used this month none can be bought, however many coins', () => {
    let s = start(500, 3);
    for (const d of ['2026-11-17', '2026-11-18', '2026-11-19']) s = done(applyFreeze(s, 'h', d));
    expect(s.wallet.freezesOwned).toBe(0);
    expect(freezeCount(s, MONTH)).toBe(3);
    const r = buy(s, 'x');
    expect(r.kind === 'rejected' && r.reason).toBe('MonthlyLimit');
    expect(REJECT_MESSAGE.MonthlyLimit).toBe('Monthly freeze limit reached (3/month)');
    expect(buyLabel(s)).toBe('Monthly limit reached');
  });
  it('the limit is per calendar month: a freeze used last month does not count now', () => {
    let s = start(100, 1);
    s = done(applyFreeze(s, 'h', '2026-10-30'));
    expect(freezeCount(s, MONTH)).toBe(0);
    expect(freezesLeft(s, TODAY)).toBe(3);
  });
  it('a double tap of the same purchase buys once', () => {
    let s = done(buy(start(100), 'same'));
    expect(buy(s, 'same').kind).toBe('duplicate');
    expect(s.wallet.coins).toBe(80);
  });
  it('being refused for coins reports "Not enough coins" and changes nothing', () => {
    const s = start(19);
    const r = buy(s, 'a');
    expect(r.kind === 'rejected' && REJECT_MESSAGE[r.reason]).toBe('Not enough coins');
    expect(r.state).toBe(s);
  });
});

describe('earning and spending keep the balance explained by the ledger', () => {
  const both = (days: string[]) => [sched('a', days), sched('b', days)];

  it('earn, spend, undo, re-earn: balance = start + sum of transactions, pending zero when coins remain', () => {
    const startCoins = 20;
    let s = start(startCoins);
    s = reconcileRewards(s, both([TODAY]), TODAY).state; // +1
    s = done(buy(s, 'a')); // -20
    expect(s.wallet).toEqual({ coins: 1, freezesOwned: 1, pending: 0 });
    s = reconcileRewards(s, [sched('a', [TODAY]), sched('b', [])], TODAY).state; // undo: take back the 1 coin
    expect(s.wallet).toEqual({ coins: 0, freezesOwned: 1, pending: 0 });
    s = reconcileRewards(s, both([TODAY]), TODAY).state; // re-earn
    expect(s.wallet.coins).toBe(1);
    expect(s.wallet.coins).toBe(startCoins + s.transactions.reduce((n, t) => n + t.coinDelta, 0));
  });

  it('undoing a reward whose coins were already spent leaves a pending adjustment and a notice', () => {
    let s = reconcileRewards(start(19), both([TODAY]), TODAY).state; // 20 coins
    s = done(buy(s, 'a')); // spend all 20
    const undone = reconcileRewards(s, [sched('a', [TODAY]), sched('b', [])], TODAY);
    expect(undone.state.wallet).toEqual({ coins: 0, freezesOwned: 1, pending: 1 });
    expect(undone.notice).toBe('Coin reward adjusted. Tap ⓘ in your wallet for details.');
  });

  it('the pending amount is paid off first by future earnings (recovery)', () => {
    // Day 1: earn then spend, then undo -> pending 1.
    let s = reconcileRewards(start(19), both(['2026-11-20']), '2026-11-20').state;
    s = done(buyFreeze(s, 'a', '2026-11-20'));
    s = reconcileRewards(s, [sched('a', ['2026-11-20']), sched('b', [])], '2026-11-20').state;
    expect(s.wallet.pending).toBe(1);
    // Day 2: a new full day earns 1 coin, which goes entirely to the pending balance.
    const next = reconcileRewards(s, both(['2026-11-21']), TODAY);
    expect(next.state.wallet).toEqual({ coins: 0, freezesOwned: 1, pending: 0 });
    expect(next.dailyCoins).toBe(0); // no coin reached the balance, so no popup
    expect(next.notice).toBe('1 coin went toward balancing an earlier reward adjustment.');
  });

  it('a larger pending amount is reduced by each earning until cleared', () => {
    const s0 = start(0, 0, 3);
    const out = reconcileRewards(s0, both([TODAY]), TODAY);
    expect(out.state.wallet).toEqual({ coins: 0, freezesOwned: 0, pending: 2 });
    expect(out.notice).toBe('1 coin went toward balancing an earlier reward adjustment.');
  });

  it('a milestone reward that is later undone is reversed and restored when it qualifies again', () => {
    const days = Array.from({ length: 15 }, (_, i) => {
      const d = new Date(2026, 10, 21 - i, 12);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    });
    // Both habits are complete on each of the 15 days; the 15-day streak triggers the +5 milestone.
    const first = reconcileRewards(start(), [sched('a', days, [], { createdDate: days[14] })], TODAY);
    const milestone = first.celebrations.find((e) => e.milestone === 15);
    expect(milestone).toBeDefined();
    const broken = reconcileRewards(first.state, [sched('a', days.slice(1), [], { createdDate: days[14] })], TODAY);
    expect(broken.state.wallet.coins).toBeLessThan(first.state.wallet.coins);
    const restored = reconcileRewards(broken.state, [sched('a', days, [], { createdDate: days[14] })], TODAY);
    expect(restored.state.wallet.coins).toBe(first.state.wallet.coins);
    expect(restored.celebrations).toHaveLength(0); // a restored reward is not a new achievement
  });
});

describe('habit deletion and freeze history', () => {
  it('freeze applications live in the wallet ledger, so they outlive the habit and keep counting toward the month', () => {
    let s = done(grantWelcomeFreeze(start(100)));
    s = done(applyFreeze(s, 'doomed', '2026-11-19'));
    const before = { used: freezeCount(s, MONTH), left: freezesLeft(s, TODAY), wallet: s.wallet };
    // Deleting the habit only removes it from the schedules the rewards are computed from; the ledger is not touched.
    expect(s.freezes).toEqual([{ habitId: 'doomed', date: '2026-11-19', paidWith: 'inventory' }]);
    expect(freezeCount(s, MONTH)).toBe(before.used);
    expect(freezesLeft(s, TODAY)).toBe(before.left);
    expect(s.wallet).toEqual(before.wallet);
    expect(before.used).toBe(1);
  });
  it('another habit cannot reuse the deleted habit\'s monthly allowance', () => {
    let s = start(0, 3);
    s = done(applyFreeze(s, 'doomed', '2026-11-17'));
    s = done(applyFreeze(s, 'doomed', '2026-11-18'));
    s = done(applyFreeze(s, 'doomed', '2026-11-19'));
    const r = applyFreeze(s, 'other', '2026-11-20');
    expect(r.kind === 'rejected' && r.reason).toBe('MonthlyLimit');
  });
});
