/**
 * Pure helpers for wallet operations on a signed-in account (Phase 9D.5): turning a ledger outcome into the user-facing
 * result, turning a failed Firestore transaction into a message, and folding a CONFIRMED transaction into the local ledger.
 *
 * The rule that shapes them (Kotlin `runWalletOp`): nothing is shown as done until Firestore has accepted the transaction.
 * There is no optimistic wallet change to undo: a rejected or failed operation leaves the displayed wallet untouched, and
 * the live listener later delivers the server's state either way.
 */
import { REJECT_MESSAGE, type LedgerState, type RejectReason, type Tx, type WalletState } from './ledger';
import type { DateKey } from '@/utils/date';

export type WalletResult = {
  ok: boolean;
  /** User-facing text. Empty means "say nothing" (a second tap while an operation is already running). */
  message: string;
  /** The inventory count after a confirmed operation, so "You own N." is right even if another device changed it meanwhile. */
  owned?: number;
};

export const NO_WALLET_YET = "Your wallet isn't set up yet. Open the Android app once to finish setting up your account.";

/** The outcome of a cloud ledger operation, as `services/cloudLedger.ts` reports it. */
export type OutcomeLike = { kind: 'done'; wallet: WalletState } | { kind: 'duplicate' } | { kind: 'rejected'; reason: RejectReason };

/**
 * Kotlin `runWalletOp`: Done and Duplicate are both success (a duplicate means this exact operation was already recorded,
 * e.g. a retry whose first attempt actually went through); Rejected carries the ledger's reason.
 */
export function outcomeResult(o: OutcomeLike, success: string): WalletResult {
  if (o.kind === 'done') return { ok: true, message: success, owned: o.wallet.freezesOwned };
  if (o.kind === 'duplicate') return { ok: true, message: success };
  return { ok: false, message: REJECT_MESSAGE[o.reason] };
}

/** Why a wallet transaction failed, for the user. The offline wording is Kotlin's. */
export function walletErrorMessage(e: unknown): string {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
  if (code === 'unavailable' || code === 'deadline-exceeded') return "You're offline. Connect to the internet and try again.";
  if (code === 'permission-denied' || code === 'unauthenticated') return "Couldn't update your wallet: your account isn't allowed to make this change. Nothing was changed.";
  if (code === 'not-found') return NO_WALLET_YET;
  if (code === 'aborted' || code === 'failed-precondition') return 'Your wallet changed while this was running. Nothing was changed. Please try again.';
  return "Couldn't update your wallet. Nothing was changed. Please try again.";
}

/**
 * Folds a transaction Firestore has CONFIRMED into the local ledger (Kotlin sets `coins` / `freezesOwned` from the result
 * and, for an applied freeze, adds the blue day at once). The live listener delivers the same state moments later; when it
 * already has, the local ledger is returned unchanged so a newer snapshot is never overwritten by an older result.
 */
export function settleConfirmed(l: LedgerState, tx: Tx, wallet: WalletState, freeze?: { habitId: string; date: DateKey }): LedgerState {
  if (l.txIds.includes(tx.id)) return l;
  return {
    ...l,
    wallet,
    txIds: [...l.txIds, tx.id],
    transactions: [tx, ...l.transactions],
    freezes: freeze ? [...l.freezes, { habitId: freeze.habitId, date: freeze.date, paidWith: 'inventory' }] : l.freezes,
  };
}

/**
 * One id per purchase ATTEMPT (Kotlin `UUID.randomUUID()`). Never derived from the time or a counter, so two tabs or two
 * devices can never produce the same id for two different purchases.
 */
export function newRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
