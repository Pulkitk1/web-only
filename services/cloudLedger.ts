/**
 * The Firestore wallet ledger (Stages 3 and 9D.5). Reproduces Kotlin's `WalletLedger` running on `FirestoreLedgerRunner`:
 * ONE Firestore transaction per operation that reads the wallet and the ledger documents it needs, then atomically writes
 *
 *   users/{uid}                             coins, freezesOwned, pendingAdjustment, lastTransactionId, updatedAt
 *   users/{uid}/walletTransactions/{txId}   type, coinDelta, freezeDelta, balanceAfter, createdAt, [date, habitId, milestone, pendingDelta, rewardId]
 *   users/{uid}/rewards/{rewardId}          active, cycle, amount, type, lastTransactionId, updatedAt, [date, habitId, milestone]      (reward operations)
 *   users/{uid}/freezes/{habitId}_{date}    habitId, date, month, paidWith, transactionId, createdAt                                (freeze application)
 *   users/{uid}/freezeMonths/{yyyy-MM}      count, updatedAt                                                                         (freeze application)
 *
 * The rules (`firestore.rules`) accept the wallet change only together with that ledger entry in the same transaction.
 * The arithmetic is NOT written here: it is the existing domain `grantReward` / `revokeReward` / `buyFreeze` / `applyFreeze` /
 * `grantWelcomeFreeze`, applied to a ledger state built from what the transaction read. Every operation is idempotent through
 * a deterministic transaction id (a reward's first grant uses its own id, later grants `{id}_grant{n}`, reversals
 * `{id}_rev{cycle}`, purchases `freeze_buy_{requestId}`, applications `freeze_apply_{habitId}_{date}`, the free freeze
 * `welcome_freeze`), so repeated calls, retries, other devices and listener replays never pay twice. A transaction may be
 * retried by Firestore, so the block is pure over its reads.
 *
 * Operations:
 *   rewards   grantReward, revokeReward
 *   freezes   buyFreeze (spends coins, +1 owned), applyFreeze (uses one owned freeze, never spends coins), grantWelcomeFreeze
 *
 * The wallet is client-trusted: the rules check the ledger entry matches the wallet change, not that the change is legitimate
 * (see "Known limitations" in BACKEND_MIGRATION_PLAN.md). Nothing here weakens or works around that.
 */
import { mapFreezeMonth, mapReward, mapTransaction, mapWallet, type RawDoc } from '@/domain/cloudMapping';
import { FREEZE_PRICE_COINS, WELCOME_FREEZE_ID } from '@/domain/freeze';
import {
  applyFreeze as domainApplyFreeze,
  buyFreeze as domainBuyFreeze,
  grantReward as domainGrant,
  grantWelcomeFreeze as domainWelcome,
  revokeReward as domainRevoke,
  type LedgerState,
  type RejectReason,
  type Tx,
  type WalletState,
} from '@/domain/ledger';
import type { RewardGrant, RewardRecord } from '@/domain/rewards';
import type { FieldMap } from '@/domain/cloudWrite';
import { monthOf, parseKey, type DateKey } from '@/utils/date';
import { SERVER_TIMESTAMP } from './habitWriter';

export interface LedgerTransaction {
  get(path: string): Promise<RawDoc | null>;
  update(path: string, fields: FieldMap): void;
  set(path: string, fields: FieldMap): void;
}
export interface LedgerRunner {
  /** Runs the block in a Firestore transaction (it may be retried). */
  run<T>(block: (t: LedgerTransaction) => Promise<T>): Promise<T>;
}

export type LedgerOutcome =
  | { kind: 'done'; tx: Tx; wallet: WalletState }
  | { kind: 'duplicate' }
  | { kind: 'rejected'; reason: RejectReason };

/** The wallet fields of the user document, plus the welcome-freeze marker (cleared once the free freeze is recorded). */
const USER_FIELDS = new Set(['coins', 'freezesOwned', 'pendingAdjustment', 'lastTransactionId', 'updatedAt', 'welcomeFreezePending']);

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Allows reads of the user's wallet documents and writes of exactly the documents a wallet operation changes: the wallet
 * fields of the user document, and ledger entries, reward records, freeze applications and monthly counters under it.
 */
export function scopedLedgerTransaction(t: LedgerTransaction, uid: string): LedgerTransaction {
  if (!uid || uid.includes('/')) throw new Error('Invalid user id');
  const root = `users/${uid}`;
  const base = escapeRegExp(root);
  const readable = new RegExp(`^${base}(/(walletTransactions|rewards|freezes)/[^/]+|/freezeMonths/\\d{4}-\\d{2})?$`);
  const writable = new RegExp(`^${base}/((walletTransactions|rewards|freezes)/[^/]+|freezeMonths/\\d{4}-\\d{2})$`);
  const refuse = (what: string, path: string): never => {
    throw new Error(`Refusing to ${what} ${path}`);
  };
  return {
    get: (p) => (readable.test(p) ? t.get(p) : refuse('read', p)),
    update(p, f) {
      if (p !== root) refuse('update', p);
      const bad = Object.keys(f).find((k) => !USER_FIELDS.has(k));
      if (bad) refuse(`update field ${bad} of`, p);
      t.update(p, f);
    },
    set: (p, f) => (writable.test(p) ? t.set(p, f) : refuse('write', p)),
  };
}

const withoutUndefined = (o: Record<string, unknown>): FieldMap => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/** What one ledger operation records besides the wallet change and its transaction entry (Kotlin `commit`'s optional arguments). */
type CommitExtras = {
  date?: string;
  habitId?: string;
  milestone?: number;
  reward?: RewardRecord;
  freeze?: { habitId: string; date: DateKey; paidWith: string };
  monthCount?: { month: string; count: number };
};

const notFound = () => Object.assign(new Error('The account has no profile document yet'), { code: 'not-found' });

/** A purchase request id becomes part of a document id, so it must be a plain token (a UUID in practice). */
export const isValidRequestId = (id: string) => /^[A-Za-z0-9_-]{8,100}$/.test(id);

export type CloudLedger = ReturnType<typeof createCloudLedger>;

export function createCloudLedger(runner: LedgerRunner, uid: string) {
  const root = `users/${uid}`;
  const txPath = (id: string) => `${root}/walletTransactions/${id}`;
  const rewardPath = (id: string) => `${root}/rewards/${id}`;
  const freezePath = (id: string) => `${root}/freezes/${id}`;
  const monthPath = (month: string) => `${root}/freezeMonths/${month}`;

  /** The `commit` of Kotlin's `FirestoreLedgerTxn`: the wallet, the ledger entry and whatever else the operation records, together. */
  function commit(t: LedgerTransaction, next: WalletState, tx: Tx, x: CommitExtras) {
    t.update(root, { coins: next.coins, freezesOwned: next.freezesOwned, pendingAdjustment: next.pending, lastTransactionId: tx.id, updatedAt: SERVER_TIMESTAMP });
    t.set(
      txPath(tx.id),
      withoutUndefined({
        type: tx.type,
        coinDelta: tx.coinDelta,
        freezeDelta: tx.freezeDelta,
        balanceAfter: tx.balanceAfter,
        createdAt: SERVER_TIMESTAMP,
        date: x.date,
        habitId: x.habitId,
        milestone: x.milestone,
        pendingDelta: tx.pendingDelta !== 0 ? tx.pendingDelta : undefined,
        rewardId: x.reward?.id,
      }),
    );
    const r = x.reward;
    if (r) {
      t.set(
        rewardPath(r.id),
        withoutUndefined({ active: r.active, cycle: r.cycle, amount: r.amount, type: r.type, lastTransactionId: tx.id, updatedAt: SERVER_TIMESTAMP, date: r.date, habitId: r.habitId, milestone: r.milestone }),
      );
    }
    const f = x.freeze;
    if (f) t.set(freezePath(`${f.habitId}_${f.date}`), { habitId: f.habitId, date: f.date, month: monthOf(f.date), paidWith: f.paidWith, transactionId: tx.id, createdAt: SERVER_TIMESTAMP });
    if (x.monthCount) t.set(monthPath(x.monthCount.month), { count: x.monthCount.count, updatedAt: SERVER_TIMESTAMP });
  }

  /** The user document, which every operation needs: a missing profile fails the transaction (nothing is created here). */
  async function readUser(t: LedgerTransaction): Promise<RawDoc> {
    const user = await t.get(root);
    if (!user) throw notFound();
    return user;
  }

  /** Reads what a reward operation needs, each document at most once (Firestore rejects a repeated read in a transaction). */
  async function readState(t: LedgerTransaction, id: string, extraTxIds: (rec: RewardRecord | undefined) => string[]): Promise<LedgerState> {
    const user = await readUser(t);
    const recDoc = await t.get(rewardPath(id));
    const rec = recDoc ? mapReward(recDoc) : undefined;
    const txDocs: RawDoc[] = [];
    for (const txId of extraTxIds(rec)) {
      const d = await t.get(txPath(txId));
      if (d) txDocs.push(d);
    }
    const transactions = txDocs.map((d) => {
      const m = mapTransaction(d);
      return { id: m.id, type: m.type, coinDelta: m.coinDelta, freezeDelta: m.freezeDelta, balanceAfter: m.balanceAfter, pendingDelta: m.pendingDelta };
    });
    return { wallet: mapWallet(user.data), rewards: rec ? { [id]: rec } : {}, txIds: transactions.map((x) => x.id), transactions, freezes: [] };
  }

  /** `FirestoreLedgerTxn.freezeCount`: the `count` of `freezeMonths/{month}` (0 when there is none). */
  const monthUsed = (doc: RawDoc | null) => (doc ? (mapFreezeMonth(doc)?.count ?? 0) : 0);

  return {
    /** `WalletLedger.grantReward`: grants the reward, or restores it after a reversal. Duplicate while it is in effect. */
    grantReward: (g: RewardGrant): Promise<LedgerOutcome> =>
      runner.run(async (raw): Promise<LedgerOutcome> => {
        const t = scopedLedgerTransaction(raw, uid);
        // Legacy rewards (no reward record) are recognised by their original transaction; a restore checks its own id.
        const s = await readState(t, g.id, (rec) => (!rec ? [g.id] : !rec.active ? [`${g.id}_grant${rec.cycle + 1}`] : []));
        const r = domainGrant(s, g);
        if (r.kind === 'duplicate') return { kind: 'duplicate' };
        if (r.kind === 'rejected') return { kind: 'rejected', reason: r.reason };
        commit(t, r.state.wallet, r.tx, { reward: r.state.rewards[g.id], date: g.date, habitId: g.habitId, milestone: g.milestone });
        return { kind: 'done', tx: r.tx, wallet: r.state.wallet };
      }),

    /** `WalletLedger.revokeReward`: reverses a reward that no longer qualifies; no-op if it is not in effect. */
    revokeReward: (id: string): Promise<LedgerOutcome> =>
      runner.run(async (raw): Promise<LedgerOutcome> => {
        const t = scopedLedgerTransaction(raw, uid);
        const s = await readState(t, id, (rec) => (rec ? (rec.active ? [`${id}_rev${rec.cycle}`] : []) : [id, `${id}_rev1`]));
        const r = domainRevoke(s, id);
        if (r.kind === 'duplicate') return { kind: 'duplicate' };
        if (r.kind === 'rejected') return { kind: 'rejected', reason: r.reason };
        const reversed = r.state.rewards[id];
        commit(t, r.state.wallet, r.tx, { reward: reversed, date: reversed.date, habitId: reversed.habitId, milestone: reversed.milestone });
        return { kind: 'done', tx: r.tx, wallet: r.state.wallet };
      }),

    /**
     * `WalletLedger.buyFreeze`: spends FREEZE_PRICE_COINS for one freeze in the inventory. `requestId` identifies ONE purchase
     * attempt (a new id per tap, never reused for another purchase), so a retry of the same attempt, a re-run of the
     * transaction after a lost response, or two tabs submitting the same attempt buy once. Two different attempts racing for
     * the last coins are serialised by Firestore: the second re-reads the new balance and is rejected.
     */
    buyFreeze: (requestId: string, today: DateKey): Promise<LedgerOutcome> => {
      if (!isValidRequestId(requestId)) return Promise.reject(new Error('Invalid purchase request id'));
      if (!parseKey(today)) return Promise.reject(new Error('Invalid date'));
      return runner.run(async (raw): Promise<LedgerOutcome> => {
        const t = scopedLedgerTransaction(raw, uid);
        const id = `freeze_buy_${requestId}`;
        const txDoc = await t.get(txPath(id));
        const user = await readUser(t);
        const used = monthUsed(await t.get(monthPath(monthOf(today))));
        const s: LedgerState = { wallet: mapWallet(user.data), rewards: {}, txIds: txDoc ? [id] : [], transactions: [], freezes: [] };
        const r = domainBuyFreeze(s, requestId, today, FREEZE_PRICE_COINS, used);
        if (r.kind === 'duplicate') return { kind: 'duplicate' };
        if (r.kind === 'rejected') return { kind: 'rejected', reason: r.reason };
        commit(t, r.state.wallet, r.tx, { date: today });
        return { kind: 'done', tx: r.tx, wallet: r.state.wallet };
      });
    },

    /**
     * `WalletLedger.applyFreeze`: uses one owned freeze to protect `habitId` on `date`; never spends coins. Atomically takes
     * one freeze from the inventory, records the application (`freezes/{habitId}_{date}`, so a day can only be protected once)
     * and raises the month's counter (`freezeMonths`, capped at 3 by the rules). Whether the DAY may be frozen at all
     * (rest day, completed, too old, ...) is the domain `checkFreeze`, which the caller runs first.
     */
    applyFreeze: (habitId: string, date: DateKey): Promise<LedgerOutcome> => {
      if (!habitId || habitId.includes('/')) return Promise.reject(new Error('Invalid habit id'));
      if (!parseKey(date)) return Promise.reject(new Error('Invalid date'));
      return runner.run(async (raw): Promise<LedgerOutcome> => {
        const t = scopedLedgerTransaction(raw, uid);
        const month = monthOf(date);
        const existing = await t.get(freezePath(`${habitId}_${date}`));
        const user = await readUser(t);
        const used = monthUsed(await t.get(monthPath(month)));
        const s: LedgerState = {
          wallet: mapWallet(user.data),
          rewards: {},
          txIds: [],
          transactions: [],
          freezes: existing ? [{ habitId, date, paidWith: typeof existing.data.paidWith === 'string' ? existing.data.paidWith : 'coins' }] : [],
        };
        const r = domainApplyFreeze(s, habitId, date, used);
        if (r.kind === 'duplicate') return { kind: 'duplicate' };
        if (r.kind === 'rejected') return { kind: 'rejected', reason: r.reason };
        commit(t, r.state.wallet, r.tx, { date, habitId, freeze: { habitId, date, paidWith: 'inventory' }, monthCount: { month, count: used + 1 } });
        return { kind: 'done', tx: r.tx, wallet: r.state.wallet };
      });
    },

    /** `WalletLedger.grantWelcomeFreeze`: the one free freeze, under the fixed id `welcome_freeze` so it happens once. */
    grantWelcomeFreeze: (): Promise<LedgerOutcome> =>
      runner.run(async (raw): Promise<LedgerOutcome> => {
        const t = scopedLedgerTransaction(raw, uid);
        const txDoc = await t.get(txPath(WELCOME_FREEZE_ID));
        const user = await readUser(t);
        const s: LedgerState = { wallet: mapWallet(user.data), rewards: {}, txIds: txDoc ? [WELCOME_FREEZE_ID] : [], transactions: [], freezes: [] };
        const r = domainWelcome(s);
        if (r.kind === 'duplicate') return { kind: 'duplicate' };
        if (r.kind === 'rejected') return { kind: 'rejected', reason: r.reason };
        commit(t, r.state.wallet, r.tx, {});
        return { kind: 'done', tx: r.tx, wallet: r.state.wallet };
      }),

    /** Kotlin `ref.update("welcomeFreezePending", false)` after the welcome freeze is recorded. A no-op unless the marker is set. */
    clearWelcomeFreezeMarker: (): Promise<boolean> =>
      runner.run(async (raw) => {
        const t = scopedLedgerTransaction(raw, uid);
        const user = await readUser(t);
        if (user.data.welcomeFreezePending !== true) return false;
        t.update(root, { welcomeFreezePending: false });
        return true;
      }),
  };
}
