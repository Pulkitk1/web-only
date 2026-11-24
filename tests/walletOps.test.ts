import { describe, expect, it } from 'vitest';

import { emptyLedger, applyFreeze, buyFreeze, freezeCount, type LedgerState, type Tx } from '@/domain/ledger';
import { newRequestId, NO_WALLET_YET, outcomeResult, settleConfirmed, walletErrorMessage } from '@/domain/walletOps';
import { isValidRequestId } from '@/services/cloudLedger';

const tx = (id: string, over: Partial<Tx> = {}): Tx => ({ id, type: 'freeze_purchase', coinDelta: -20, freezeDelta: 1, balanceAfter: 30, pendingDelta: 0, ...over });
const base = (): LedgerState => ({ ...emptyLedger(), wallet: { coins: 50, freezesOwned: 0, pending: 0 } });

describe('outcomeResult (Kotlin runWalletOp)', () => {
  it('Done is success and carries the confirmed inventory count', () => {
    expect(outcomeResult({ kind: 'done', wallet: { coins: 30, freezesOwned: 2, pending: 0 } }, '❄️ Freeze purchased!')).toEqual({ ok: true, message: '❄️ Freeze purchased!', owned: 2 });
  });
  it('Duplicate is success too (this exact operation was already recorded)', () => {
    expect(outcomeResult({ kind: 'duplicate' }, 'ok')).toEqual({ ok: true, message: 'ok' });
  });
  it('Rejected carries the ledger reason text exactly as Kotlin words it', () => {
    expect(outcomeResult({ kind: 'rejected', reason: 'InsufficientCoins' }, 'x')).toEqual({ ok: false, message: 'Not enough coins' });
    expect(outcomeResult({ kind: 'rejected', reason: 'MonthlyLimit' }, 'x').message).toBe('Monthly freeze limit reached (3/month)');
    expect(outcomeResult({ kind: 'rejected', reason: 'HoldLimit' }, 'x').message).toBe('You already own all the freezes you can use this month');
    expect(outcomeResult({ kind: 'rejected', reason: 'NoFreezes' }, 'x').message).toBe('No Streak Freezes Available');
    expect(outcomeResult({ kind: 'rejected', reason: 'AlreadyFrozen' }, 'x').message).toBe('This day is already protected by a freeze');
  });
});

describe('walletErrorMessage', () => {
  const e = (code: string) => Object.assign(new Error(code), { code });
  it("offline uses Kotlin's wording", () => {
    expect(walletErrorMessage(e('unavailable'))).toBe("You're offline. Connect to the internet and try again.");
    expect(walletErrorMessage(e('deadline-exceeded'))).toBe("You're offline. Connect to the internet and try again.");
  });
  it('permission denied says nothing was changed', () => {
    expect(walletErrorMessage(e('permission-denied'))).toMatch(/isn't allowed.*Nothing was changed/);
    expect(walletErrorMessage(e('unauthenticated'))).toMatch(/Nothing was changed/);
  });
  it('a missing profile explains how to set the wallet up', () => expect(walletErrorMessage(e('not-found'))).toBe(NO_WALLET_YET));
  it('contention that ran out of retries, and anything unknown, both say nothing was changed', () => {
    expect(walletErrorMessage(e('aborted'))).toMatch(/Nothing was changed/);
    expect(walletErrorMessage(new Error('boom'))).toMatch(/Nothing was changed/);
    expect(walletErrorMessage(undefined)).toMatch(/Nothing was changed/);
  });
  it('never leaks a raw error message to the user', () => {
    expect(walletErrorMessage(Object.assign(new Error('PERMISSION_DENIED at users/abc123'), { code: 'permission-denied' }))).not.toMatch(/abc123|PERMISSION_DENIED/);
  });
});

describe('settleConfirmed: folding a CONFIRMED transaction into the local ledger', () => {
  it('a purchase updates the wallet and records the entry (newest first)', () => {
    const next = settleConfirmed(base(), tx('freeze_buy_abc'), { coins: 30, freezesOwned: 1, pending: 0 });
    expect(next.wallet).toEqual({ coins: 30, freezesOwned: 1, pending: 0 });
    expect(next.txIds).toEqual(['freeze_buy_abc']);
    expect(next.transactions[0].id).toBe('freeze_buy_abc');
    expect(next.freezes).toEqual([]);
  });
  it('an application also adds the protected day at once (the blue day), as paid with inventory', () => {
    const owned: LedgerState = { ...base(), wallet: { coins: 50, freezesOwned: 1, pending: 0 } };
    const next = settleConfirmed(owned, tx('freeze_apply_h1_2026-11-19', { type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 50 }), { coins: 50, freezesOwned: 0, pending: 0 }, { habitId: 'h1', date: '2026-11-19' });
    expect(next.freezes).toEqual([{ habitId: 'h1', date: '2026-11-19', paidWith: 'inventory' }]);
    expect(freezeCount(next, '2026-11')).toBe(1);
    expect(next.wallet.freezesOwned).toBe(0);
  });
  it('when the live listener already delivered that entry the ledger is returned unchanged (a newer snapshot is never overwritten by an older result)', () => {
    const newer: LedgerState = { ...base(), wallet: { coins: 10, freezesOwned: 2, pending: 0 }, txIds: ['freeze_buy_abc'] };
    expect(settleConfirmed(newer, tx('freeze_buy_abc'), { coins: 30, freezesOwned: 1, pending: 0 })).toBe(newer);
  });
  it('it does not mutate the previous ledger', () => {
    const before = base();
    const snapshot = JSON.stringify(before);
    settleConfirmed(before, tx('freeze_buy_abc'), { coins: 30, freezesOwned: 1, pending: 0 });
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('newRequestId', () => {
  it('is unique per call and always a valid ledger id token', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newRequestId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(isValidRequestId(id)).toBe(true);
  });
  it('still works without crypto.randomUUID', () => {
    const c = (globalThis as { crypto?: unknown }).crypto;
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    try {
      const a = newRequestId();
      const b = newRequestId();
      expect(a).not.toBe(b);
      expect(isValidRequestId(a)).toBe(true);
    } finally {
      Object.defineProperty(globalThis, 'crypto', { value: c, configurable: true });
    }
  });
});

describe('domain ledger: the month counter a Firestore transaction reads (freezeMonths) can drive the same rules', () => {
  it('buyFreeze uses the supplied monthly count instead of counting freezes', () => {
    const s = base();
    expect(buyFreeze(s, 'r1', '2026-11-21', 20, 3)).toMatchObject({ kind: 'rejected', reason: 'MonthlyLimit' });
    expect(buyFreeze(s, 'r1', '2026-11-21', 20, 2)).toMatchObject({ kind: 'done' });
    expect(buyFreeze({ ...s, wallet: { ...s.wallet, freezesOwned: 1 } }, 'r1', '2026-11-21', 20, 2)).toMatchObject({ kind: 'rejected', reason: 'HoldLimit' });
  });
  it('applyFreeze uses the supplied monthly count', () => {
    const s: LedgerState = { ...base(), wallet: { coins: 0, freezesOwned: 3, pending: 0 } };
    expect(applyFreeze(s, 'h1', '2026-11-19', 3)).toMatchObject({ kind: 'rejected', reason: 'MonthlyLimit' });
    expect(applyFreeze(s, 'h1', '2026-11-19', 2)).toMatchObject({ kind: 'done' });
  });
  it('without a supplied count the guest behaviour is exactly as before', () => {
    const s = base();
    const bought = buyFreeze(s, 'r1', '2026-11-21');
    expect(bought.kind).toBe('done');
    const applied = applyFreeze(bought.state, 'h1', '2026-11-19');
    expect(applied.kind).toBe('done');
    expect(freezeCount(applied.state, '2026-11')).toBe(1);
  });
});
