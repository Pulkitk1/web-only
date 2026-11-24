import type { LedgerRunner, LedgerTransaction } from '@/services/cloudLedger';
import { SERVER_TIMESTAMP } from '@/services/habitWriter';

export type Doc = Record<string, unknown>;
export type Write = { path: string; kind: 'update' | 'set'; fields: Doc };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const denied = (why: string) => Object.assign(new Error('PERMISSION_DENIED: ' + why), { code: 'permission-denied' });

/**
 * A line-by-line mirror of the wallet part of `android/firestore.rules` (users/{uid}, walletTransactions, rewards, freezes,
 * freezeMonths). It runs at commit time against the documents BEFORE the transaction and the ones AFTER it (`getAfter`), so a
 * test proves the exact writes the web makes would be accepted by the production rules. It never relaxes anything: if the
 * rules would refuse a write, the commit throws `permission-denied`.
 */
export function checkWalletRules(uid: string, before: Record<string, Doc>, writes: Write[]): void {
  const root = `users/${uid}`;
  const after: Record<string, Doc> = { ...before };
  for (const w of writes) after[w.path] = w.kind === 'update' ? { ...(before[w.path] ?? {}), ...w.fields } : { ...w.fields };
  const txPath = (id: string) => `${root}/walletTransactions/${id}`;
  const get = <T>(o: Doc | undefined, k: string, d: T): T => (o && k in o ? (o[k] as T) : d);

  for (const w of writes) {
    const existed = w.path in before;
    const doc = after[w.path];
    if (w.path === root) {
      if (!existed) throw denied('user document create is not part of a wallet operation');
      const res = before[root];
      const walletUnchanged = get(doc, 'coins', 0) === get(res, 'coins', 0) && get(doc, 'freezesOwned', 0) === get(res, 'freezesOwned', 0) && get(doc, 'pendingAdjustment', 0) === get(res, 'pendingAdjustment', 0);
      if (!walletUnchanged) {
        const id = doc.lastTransactionId as string;
        const tx = after[txPath(id)];
        const ok =
          !!tx &&
          get<boolean>(res, 'deletionRequested', false) !== true &&
          id !== get(res, 'lastTransactionId', '') &&
          !(txPath(id) in before) &&
          tx.coinDelta === (doc.coins as number) - get(res, 'coins', 0) &&
          tx.freezeDelta === (doc.freezesOwned as number) - get(res, 'freezesOwned', 0) &&
          tx.balanceAfter === doc.coins &&
          get(tx, 'pendingDelta', 0) === get(doc, 'pendingAdjustment', 0) - get(res, 'pendingAdjustment', 0) &&
          (doc.coins as number) >= 0 &&
          (doc.freezesOwned as number) >= 0 &&
          get(doc, 'pendingAdjustment', 0) >= 0;
        if (!ok) throw denied('wallet change is not backed by a matching new ledger entry');
      }
      if (get<boolean>(res, 'deletionRequested', false) === true && get<boolean>(doc, 'deletionRequested', false) !== true) throw denied('deletionRequested cannot be cleared');
    } else if (w.path.startsWith(`${root}/walletTransactions/`)) {
      const txId = w.path.split('/').pop()!;
      if (existed) throw denied('ledger entries are append-only');
      if (w.kind !== 'set') throw denied('ledger entries are created, never updated');
      const pd = get(doc, 'pendingDelta', 0);
      const ok =
        after[root]?.lastTransactionId === txId &&
        Number.isInteger(doc.coinDelta) &&
        (doc.coinDelta as number) >= -20 &&
        (doc.coinDelta as number) <= 20 &&
        Number.isInteger(pd) &&
        pd >= -20 &&
        pd <= 20 &&
        [0, 1, -1].includes(doc.freezeDelta as number);
      if (!ok) throw denied('ledger entry is not the one the wallet update points to, or its deltas are out of range');
    } else if (w.path.startsWith(`${root}/rewards/`)) {
      const ok = doc.lastTransactionId === after[root]?.lastTransactionId && txPath(doc.lastTransactionId as string) in after && typeof doc.active === 'boolean';
      if (!ok) throw denied('reward record is not written with its ledger entry');
    } else if (w.path.startsWith(`${root}/freezes/`)) {
      const freezeId = w.path.split('/').pop()!;
      if (existed) throw denied('a freeze application is never updated');
      const ok = freezeId === `${doc.habitId}_${doc.date}` && txPath('freeze_apply_' + freezeId) in after;
      if (!ok) throw denied('freeze application is not written with its ledger entry');
    } else if (w.path.startsWith(`${root}/freezeMonths/`)) {
      const prev = existed ? (before[w.path].count as number) : 0;
      const ok = doc.count === prev + 1 && (doc.count as number) <= 3;
      if (!ok) throw denied('the monthly counter can only go up by one, never past 3');
    } else {
      throw denied('path is not part of a wallet operation: ' + w.path);
    }
  }
}

type Options = {
  /** Mirror the production security rules at commit (default true). */
  rules?: boolean;
  /** Concurrent transactions with optimistic conflict detection and retry (default). `false` runs them strictly one at a time. */
  concurrent?: boolean;
};

/**
 * An in-memory Firestore with transaction semantics like the Web SDK's `runTransaction`: reads see committed data; writes apply
 * together at commit; if a document the block read changed before it committed, the block is RE-RUN (so a block that is not pure
 * over its reads would show up as a wrong balance). Every document is read at most once per attempt and never after a write.
 */
export function createFakeFirestore(uid: string, initial: Record<string, Doc>, opts: Options = {}) {
  const useRules = opts.rules ?? true;
  const concurrent = opts.concurrent ?? true;
  const docs: Record<string, Doc> = clone(initial);
  const versions = new Map<string, number>();
  const version = (p: string) => versions.get(p) ?? 0;
  const commits: Write[][] = [];
  const stats = { attempts: 0, conflicts: 0, runs: 0 };
  let failNext: unknown = null;
  let loseAckNext = false;
  let serial: Promise<unknown> = Promise.resolve();

  const attemptOnce = async <T>(block: (t: LedgerTransaction) => Promise<T>): Promise<{ done: true; value: T } | { done: false }> => {
    stats.attempts++;
    const reads = new Map<string, number>();
    const writes: Write[] = [];
    const value = await block({
      async get(path) {
        if (reads.has(path)) throw new Error('Firestore: document read twice in one transaction: ' + path);
        if (writes.length) throw new Error('Firestore: read after write in a transaction');
        await new Promise((r) => setTimeout(r, 0)); // let other transactions interleave
        reads.set(path, version(path));
        return path in docs ? { id: path.split('/').pop()!, data: clone(docs[path]) as never } : null;
      },
      update: (path, fields) => void writes.push({ path, kind: 'update', fields: { ...fields } }),
      set: (path, fields) => void writes.push({ path, kind: 'set', fields: { ...fields } }),
    });
    // ── commit: atomic and synchronous ──
    if (failNext) {
      const e = failNext;
      failNext = null;
      throw e;
    }
    if ([...reads].some(([p, v]) => version(p) !== v)) {
      stats.conflicts++;
      return { done: false };
    }
    const resolved: Write[] = writes.map((w) => ({ ...w, fields: Object.fromEntries(Object.entries(w.fields).map(([k, v]) => [k, v === SERVER_TIMESTAMP ? 'TS' : v])) }));
    for (const w of resolved) if (w.kind === 'update' && !(w.path in docs)) throw Object.assign(new Error('NOT_FOUND ' + w.path), { code: 'not-found' });
    if (useRules) checkWalletRules(uid, docs, resolved);
    for (const w of resolved) {
      docs[w.path] = w.kind === 'update' ? { ...docs[w.path], ...w.fields } : { ...w.fields };
      versions.set(w.path, version(w.path) + 1);
    }
    if (resolved.length) commits.push(resolved);
    if (loseAckNext) {
      loseAckNext = false;
      throw Object.assign(new Error('the response was lost'), { code: 'unavailable' });
    }
    return { done: true, value };
  };

  const runOnce = async <T>(block: (t: LedgerTransaction) => Promise<T>): Promise<T> => {
    stats.runs++;
    for (let i = 0; i < 25; i++) {
      const r = await attemptOnce(block);
      if (r.done) return r.value;
    }
    throw Object.assign(new Error('transaction aborted after too many retries'), { code: 'aborted' });
  };

  const runner: LedgerRunner = {
    run<T>(block: (t: LedgerTransaction) => Promise<T>): Promise<T> {
      if (concurrent) return runOnce(block);
      const job = serial.then(() => runOnce(block));
      serial = job.catch(() => undefined);
      return job;
    },
  };

  return {
    runner,
    docs,
    commits,
    stats,
    /** The next transaction fails with `e` before anything is written (offline, permission denied, ...). */
    failNext: (e: unknown) => void (failNext = e),
    /** The next transaction COMMITS, but its response is lost: the caller sees `unavailable` although the server has the writes. */
    loseAckNext: () => void (loseAckNext = true),
    /** Writes made from outside the web app, directly into the store (Android / another browser). */
    put: (path: string, data: Doc) => {
      docs[path] = clone(data);
      versions.set(path, version(path) + 1);
    },
    patch: (path: string, data: Doc) => {
      docs[path] = { ...docs[path], ...clone(data) };
      versions.set(path, version(path) + 1);
    },
  };
}

export type FakeFirestore = ReturnType<typeof createFakeFirestore>;
