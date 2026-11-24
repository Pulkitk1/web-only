/**
 * An in-memory Firestore for the guest import: documents by path, a mirror of the security rules that apply to what the import may
 * write (habits and completions: any owner write; day notes: id = habitId_date and 1..200 characters; profile create: 20 coins and no
 * freezes; wallet collections: the import must never write them), batches that are atomic and limited to 500 writes, a profile
 * transaction with optimistic retry, and failure injection (offline, a failing batch, missing documents on read).
 */
import type { RawDoc } from '@/domain/cloudMapping';
import type { ImportOp } from '@/domain/guestImport';
import type { MigrationBackend } from '@/services/guestMigration';

export type Doc = Record<string, unknown>;

const WALLET = /\/(walletTransactions|rewards|freezes|freezeMonths)\//;

export function createFakeMigration(uid: string, initial: Record<string, Doc> = {}) {
  const docs = new Map<string, Doc>(Object.entries(initial).map(([k, v]) => [k, { ...v }]));
  const versions = new Map<string, number>();
  const root = `users/${uid}`;
  const state = {
    /** Number of `setMany` calls so far, and the call number (1-based) that fails; Infinity = never. */
    setManyCalls: 0,
    failSetManyOn: Infinity,
    offline: false,
    hangSetMany: false,
    /** Reads of these paths return null (a write that silently didn't reach the server). */
    hidden: new Set<string>(),
    /** Every path written, in order. */
    written: [] as string[],
    profileCreates: 0,
    /** Every path read. */
    reads: [] as string[],
    /** Pause between a transaction's read and its write (lets a second transaction interleave). */
    yieldInTransaction: false,
  };

  const deny = (msg: string) => Object.assign(new Error(msg), { code: 'permission-denied' });
  const unavailable = () => Object.assign(new Error('offline'), { code: 'unavailable' });

  function checkWrite(op: ImportOp) {
    const p = op.path;
    if (WALLET.test(p)) throw deny(`the import must never write ${p}`);
    if (p === root) throw deny('the import must not write the profile in a batch');
    const note = new RegExp(`^${root}/dayNotes/([^/]+)$`).exec(p);
    if (note) {
      const f = op.fields;
      const text = f.text;
      if (note[1] !== `${f.habitId}_${f.date}` || typeof text !== 'string' || text.length < 1 || text.length > 200) throw deny(`dayNotes rule rejected ${p}`);
      return;
    }
    if (new RegExp(`^${root}/habits/[^/]+(/completions/[^/]+)?$`).test(p)) return;
    throw deny(`no rule allows ${p}`);
  }

  const backend: MigrationBackend = {
    async ensureProfile(u, email) {
      if (state.offline) throw unavailable();
      const path = `users/${u}`;
      // Firestore transaction semantics: read, then write only if nothing changed in between, else run the block again.
      for (;;) {
        const seen = versions.get(path) ?? 0;
        const exists = docs.has(path);
        if (state.yieldInTransaction) await Promise.resolve();
        if ((versions.get(path) ?? 0) !== seen) continue;
        if (exists) return 'exists';
        const fields: Doc = {
          email,
          displayName: email.split('@')[0],
          coins: 20,
          freezesOwned: 0,
          welcomeFreezePending: true,
          isDark: true,
          createdAt: 'server-timestamp',
          updatedAt: 'server-timestamp',
        };
        if (fields.coins !== 20 || fields.freezesOwned !== 0) throw deny('create rule');
        docs.set(path, fields);
        versions.set(path, seen + 1);
        state.profileCreates++;
        state.written.push(path);
        return 'created';
      }
    },
    async getDoc(path): Promise<RawDoc | null> {
      if (state.offline) throw unavailable();
      state.reads.push(path);
      if (state.hidden.has(path)) return null;
      const d = docs.get(path);
      return d ? { id: path.split('/').pop()!, data: { ...d } } : null;
    },
    async listDocs(collectionPath): Promise<RawDoc[]> {
      if (state.offline) throw unavailable();
      state.reads.push(collectionPath);
      const out: RawDoc[] = [];
      for (const [p, d] of docs) {
        if (p.startsWith(collectionPath + '/') && !p.slice(collectionPath.length + 1).includes('/') && !state.hidden.has(p)) out.push({ id: p.split('/').pop()!, data: { ...d } });
      }
      return out;
    },
    async setMany(ops) {
      if (state.hangSetMany) return new Promise<void>(() => {});
      if (state.offline) throw unavailable();
      state.setManyCalls++;
      if (state.setManyCalls === state.failSetManyOn) throw unavailable();
      if (ops.length > 500) throw new Error('Firestore batches are limited to 500 writes');
      ops.forEach(checkWrite); // all rules first: a rejected batch writes nothing
      for (const o of ops) {
        docs.set(o.path, { ...o.fields });
        versions.set(o.path, (versions.get(o.path) ?? 0) + 1);
        state.written.push(o.path);
      }
    },
  };

  return {
    backend,
    state,
    docs,
    get: (path: string) => docs.get(path),
    put: (path: string, d: Doc) => void docs.set(path, { ...d }),
    patch: (path: string, d: Doc) => void docs.set(path, { ...docs.get(path)!, ...d }),
    paths: (prefix: string) => [...docs.keys()].filter((p) => p.startsWith(prefix)).sort(),
    /** A copy of every wallet-related document (profile wallet fields and the ledger collections), to prove they didn't change. */
    walletSnapshot: () => JSON.stringify([...docs].filter(([p]) => p === root || WALLET.test(p)).sort(([a], [b]) => (a < b ? -1 : 1))),
  };
}

export type FakeMigration = ReturnType<typeof createFakeMigration>;
