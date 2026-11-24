/** A fake Firestore for the account-deletion tests: documents by path, a log of every call, and switches that make a call fail or misbehave. */
import type { AccountAuth, DataEraser } from '@/domain/accountDeletion';

export type FakeEraser = DataEraser & {
  docs: Map<string, Record<string, unknown>>;
  log: string[];
  /** Sizes of every batch that was deleted. */
  batches: number[];
  /** Throw this error on the n-th deleteDocs call (1-based), once. */
  failDeleteOn?: { call: number; error: unknown };
  /** Throw on every listDocPaths call while true (simulates being offline). */
  offline: boolean;
  /** A deleteDocs that silently deletes nothing (the documents come straight back). */
  ignoreDeletes: boolean;
  /** Documents that appear in a collection each time it is listed (simulates another device writing). */
  reappear?: { collection: string; path: string };
  /** Runs once, right after the n-th deleteDocs call. */
  after?: { call: number; run: () => void };
  /** deleteProfile does nothing. */
  ignoreProfileDelete: boolean;
};

const parentOf = (p: string) => p.slice(0, p.lastIndexOf('/'));

export function createFakeEraser(initial: Record<string, Record<string, unknown>> = {}): FakeEraser {
  const docs = new Map(Object.entries(initial));
  let deleteCalls = 0;
  const f: FakeEraser = {
    docs,
    log: [],
    batches: [],
    offline: false,
    ignoreDeletes: false,
    ignoreProfileDelete: false,
    async profileExists(uid) {
      if (f.offline) throw Object.assign(new Error('offline'), { code: 'unavailable' });
      return docs.has(`users/${uid}`);
    },
    async markDeletionRequested(uid) {
      f.log.push(`flag ${uid}`);
      if (!docs.has(`users/${uid}`)) throw new Error('no profile');
      docs.set(`users/${uid}`, { ...docs.get(`users/${uid}`), deletionRequested: true });
    },
    async listDocPaths(collection, limit) {
      if (f.offline) throw Object.assign(new Error('offline'), { code: 'unavailable' });
      if (f.reappear && f.reappear.collection === collection) docs.set(f.reappear.path, { again: true });
      return [...docs.keys()].filter((p) => parentOf(p) === collection).sort().slice(0, limit);
    },
    async deleteDocs(paths) {
      deleteCalls++;
      if (f.failDeleteOn && f.failDeleteOn.call === deleteCalls) {
        const e = f.failDeleteOn.error;
        f.failDeleteOn = undefined;
        throw e;
      }
      f.batches.push(paths.length);
      for (const p of paths) f.log.push(`delete ${p}`);
      if (!f.ignoreDeletes) for (const p of paths) docs.delete(p);
      if (f.after && f.after.call === deleteCalls) { const run = f.after.run; f.after = undefined; run(); }
    },
    async deleteProfile(uid) {
      f.log.push(`delete-profile ${uid}`);
      if (!f.ignoreProfileDelete) docs.delete(`users/${uid}`);
    },
  };
  return f;
}

/** A realistic account: a profile, two habits with completions, notes and every wallet collection. */
export function seedAccount(uid: string, extra: Record<string, Record<string, unknown>> = {}): Record<string, Record<string, unknown>> {
  const u = `users/${uid}`;
  return {
    [u]: { email: 'a@b.co', coins: 30, freezesOwned: 1 },
    [`${u}/habits/h1`]: { name: 'Read' },
    [`${u}/habits/h1/completions/2026-11-01`]: { completed: true },
    [`${u}/habits/h1/completions/2026-11-02`]: { completed: true },
    [`${u}/habits/h2`]: { name: 'Run' },
    [`${u}/habits/h2/completions/2026-11-01`]: { completed: false },
    [`${u}/walletTransactions/daily_2026-11-01`]: { type: 'daily_completion' },
    [`${u}/walletTransactions/welcome_freeze`]: { type: 'welcome_freeze' },
    [`${u}/rewards/daily_2026-11-01`]: { active: true },
    [`${u}/freezes/h1_2026-11-03`]: { habitId: 'h1' },
    [`${u}/freezeMonths/2026-11`]: { count: 1 },
    [`${u}/todos/t1`]: { text: 'old' },
    [`${u}/dayNotes/h1_2026-11-01`]: { text: 'note' },
    ...extra,
  };
}

/** A fake Firebase Authentication: records calls, can reject the password, or fail the final deletion. */
export type FakeAuth = AccountAuth & {
  calls: string[];
  password: string;
  signedInUid: string;
  failLoginDelete?: unknown;
  failReauth?: unknown;
  loginDeleted: boolean;
};
export function createFakeAuth(uid: string, password = 'correct-password'): FakeAuth {
  const a: FakeAuth = {
    calls: [],
    password,
    signedInUid: uid,
    loginDeleted: false,
    async reauthenticate(u, _email, pw) {
      a.calls.push('reauth');
      if (a.failReauth) throw a.failReauth;
      if (u !== a.signedInUid) throw Object.assign(new Error('mismatch'), { code: 'auth/user-mismatch' });
      if (pw !== a.password) throw Object.assign(new Error('bad'), { code: 'auth/invalid-credential' });
    },
    async deleteLogin(u) {
      a.calls.push('deleteLogin');
      if (u !== a.signedInUid) throw Object.assign(new Error('mismatch'), { code: 'auth/user-mismatch' });
      if (a.failLoginDelete) { const e = a.failLoginDelete; a.failLoginDelete = undefined; throw e; }
      a.loginDeleted = true;
    },
  };
  return a;
}
