/**
 * Read-only access to the signed-in user's Firestore data (Phase 9D.1). It reads exactly the documents the Android app
 * writes, all under `users/{uid}`:
 *
 *   users/{uid}                                 profile + wallet counters (coins, freezesOwned, pendingAdjustment)
 *   users/{uid}/habits/{habitId}                habit
 *   users/{uid}/habits/{habitId}/completions/{yyyy-MM-dd}
 *   users/{uid}/walletTransactions/{txId}       immutable ledger
 *   users/{uid}/rewards/{rewardId}
 *   users/{uid}/freezes/{habitId}_{yyyy-MM-dd}
 *   users/{uid}/freezeMonths/{yyyy-MM}
 *   users/{uid}/dayNotes/{habitId}_{yyyy-MM-dd}
 *
 * This file only knows how to READ: the `DocReader` interface has no write method, so nothing here (or built on it) can
 * create, update or delete a document. Nothing is created for an empty account either: a missing `users/{uid}` is
 * reported as `profileExists: false`. The Firebase-backed reader is in `firestoreReader.ts`, so this logic is unit-tested
 * with a fake.
 */
import { buildCloudData, type CloudData, type RawDoc } from '@/domain/cloudMapping';

export interface DocReader {
  /** One document, or null if it does not exist. */
  getDoc(path: string): Promise<RawDoc | null>;
  /** Every document of a collection (or subcollection). */
  listDocs(collectionPath: string): Promise<RawDoc[]>;
}

/** Wraps a reader so it can only touch `users/{uid}` and below. A path outside it is a programming error. */
export function scopedReader(reader: DocReader, uid: string): DocReader {
  if (!uid || uid.includes('/')) throw new Error('Invalid user id');
  const root = `users/${uid}`;
  const check = (path: string) => {
    if (path !== root && !path.startsWith(root + '/')) throw new Error(`Refusing to read outside users/${uid}`);
  };
  return {
    getDoc: (p) => (check(p), reader.getDoc(p)),
    listDocs: (p) => (check(p), reader.listDocs(p)),
  };
}

/** Reads everything the web app shows for [uid]. Rejects with the Firestore error (see `classifyLoadError`). */
export async function loadCloudData(reader: DocReader, uid: string): Promise<CloudData> {
  const r = scopedReader(reader, uid);
  const root = `users/${uid}`;
  const [user, habitDocs, transactions, rewards, freezes, freezeMonths, notes] = await Promise.all([
    r.getDoc(root),
    r.listDocs(`${root}/habits`),
    r.listDocs(`${root}/walletTransactions`),
    r.listDocs(`${root}/rewards`),
    r.listDocs(`${root}/freezes`),
    r.listDocs(`${root}/freezeMonths`),
    r.listDocs(`${root}/dayNotes`),
  ]);
  const habits = await Promise.all(habitDocs.map(async (doc) => ({ doc, completions: await r.listDocs(`${root}/habits/${doc.id}/completions`) })));
  return buildCloudData({ uid, user, habits, transactions, rewards, freezes, freezeMonths, notes });
}

export type LoadFailure = { kind: 'permission-denied' | 'offline' | 'error'; message: string };

/** Turns a Firestore error into a user-facing failure (Kotlin shows "permission denied by security rules" / "no connection"). */
export function classifyLoadError(e: unknown): LoadFailure {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '';
  if (code === 'permission-denied' || code === 'unauthenticated') return { kind: 'permission-denied', message: "Your account isn't allowed to read this data (denied by the security rules)." };
  if (code === 'unavailable' || code === 'deadline-exceeded') return { kind: 'offline', message: "Couldn't reach the server. Check your connection and try again." };
  return { kind: 'error', message: "Couldn't load your data. Please try again." };
}
