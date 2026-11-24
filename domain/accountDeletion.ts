/**
 * Permanent account deletion (Phase 12A), ported from Android's `AppViewModel.deleteAccount` and `AccountRepository.deleteAllUserData`.
 * Pure orchestration over two small interfaces, so it is unit-tested with fakes and run against the Firestore emulator with the real rules.
 *
 * The protocol, each step confirmed before the next:
 *   1. Re-authenticate with the password (Firebase requires a recent login to delete an account). Nothing is touched if this fails.
 *   2. Mark the profile `deletionRequested` (the security rules only let ledger documents and the profile be deleted after that).
 *   3. Empty every collection under `users/{uid}`, deepest first (a habit's completions, then the habits, then the wallet collections,
 *      notes and the removed to-do list), in batches. Every step is idempotent, so a retry continues from whatever is left.
 *   4. Check from the server that everything is gone; run again (up to {@link MAX_PASSES} passes) if a document appeared meanwhile.
 *   5. Delete the profile LAST, so its marker stays visible until all other data is gone.
 *   6. Only then delete the Firebase Authentication account.
 * Nothing is reported as deleted unless every step succeeded; a failure says exactly what happened and a retry is always safe.
 * Android's own deletion leaves `dayNotes` behind (a known gap); this one removes them.
 */

/** What the deletion needs from Firestore. Every read must come from the SERVER so documents written on other devices are included. */
export interface DataEraser {
  /** Does the profile document exist? */
  profileExists(uid: string): Promise<boolean>;
  /** Sets `deletionRequested` on the profile (merge). */
  markDeletionRequested(uid: string): Promise<void>;
  /** The full paths of up to `limit` documents currently in the collection. */
  listDocPaths(collectionPath: string, limit: number): Promise<string[]>;
  /** Deletes these documents in one batch. */
  deleteDocs(paths: string[]): Promise<void>;
  /** Deletes the profile document. */
  deleteProfile(uid: string): Promise<void>;
}

/** What the deletion needs from Firebase Authentication. Both methods refuse to act unless the signed-in user is `uid`. */
export interface AccountAuth {
  reauthenticate(uid: string, email: string, password: string): Promise<void>;
  deleteLogin(uid: string): Promise<void>;
}

/** Documents deleted per batch (Firestore allows 500 writes per batch). */
export const BATCH = 400;
/** The subcollections of `users/{uid}` besides `habits` (and `habits/{id}/completions`), as Android's `userCollections` plus the day notes. */
export const USER_COLLECTIONS = ['walletTransactions', 'freezes', 'freezeMonths', 'rewards', 'todos', 'dayNotes'] as const;
export const MAX_PASSES = 3;

/** Some data is still there after the allowed passes: the account must not be reported as deleted. */
export class DataRemainsError extends Error {
  constructor(readonly remaining: string) {
    super(`Some data is still in the account (${remaining}).`);
    this.name = 'DataRemainsError';
  }
}

const SAFE_UID = /^[A-Za-z0-9_-]{1,128}$/;
const isSafeUid = (uid: string) => SAFE_UID.test(uid);

/** Deletes every document in the collection, one batch at a time. Throws if the documents will not go away. */
async function drain(e: DataEraser, collectionPath: string): Promise<void> {
  let previous = '';
  for (;;) {
    const page = await e.listDocPaths(collectionPath, BATCH);
    if (page.length === 0) return;
    const key = page.join('|');
    if (key === previous) throw new DataRemainsError(collectionPath); // the same ones came back: stop, do not loop
    previous = key;
    await e.deleteDocs(page);
  }
}

/**
 * Deletes the habits a page at a time: each habit's completions first (Firestore does not delete a subcollection with its parent, and
 * a completion whose habit is gone could never be found again), then that page of habits.
 */
async function drainHabits(e: DataEraser, habitsPath: string): Promise<void> {
  let previous = '';
  for (;;) {
    const page = await e.listDocPaths(habitsPath, BATCH);
    if (page.length === 0) return;
    const key = page.join('|');
    if (key === previous) throw new DataRemainsError(habitsPath);
    previous = key;
    for (const habitPath of page) await drain(e, `${habitPath}/completions`);
    await e.deleteDocs(page);
  }
}

/**
 * Deletes everything under `users/{uid}`, the profile last. Safe to run again after any failure.
 * Does nothing if the profile no longer exists (a previous run finished the data deletion).
 */
export async function eraseUserData(e: DataEraser, uid: string): Promise<void> {
  if (!isSafeUid(uid)) throw new Error('Invalid account id.'); // the paths below are built from it: never from anything unchecked
  if (!(await e.profileExists(uid))) return;
  await e.markDeletionRequested(uid);

  const root = `users/${uid}`;
  const habits = `${root}/habits`;
  for (let pass = 1; pass <= MAX_PASSES; pass++) {
    await drainHabits(e, habits);
    for (const c of USER_COLLECTIONS) await drain(e, `${root}/${c}`);
    // Check from the server that nothing is left (and nothing arrived from another device meanwhile).
    let remaining = '';
    for (const c of ['habits', ...USER_COLLECTIONS]) if ((await e.listDocPaths(`${root}/${c}`, 1)).length > 0) { remaining = c; break; }
    if (!remaining) {
      await e.deleteProfile(uid);
      if (await e.profileExists(uid)) throw new DataRemainsError('the profile');
      return;
    }
    if (pass === MAX_PASSES) throw new DataRemainsError(remaining);
  }
}

export type DeleteStage = 'password' | 'data' | 'login';
export type DeleteResult = { ok: true } | { ok: false; stage: DeleteStage; message: string };

const codeOf = (e: unknown): string => (typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '');

/** Why a Firestore or network call failed, in a few words (Android's `networkHint`). */
export function failureHint(e: unknown): string {
  const code = codeOf(e);
  if (code === 'unavailable' || code === 'auth/network-request-failed' || code === 'deadline-exceeded') return 'no connection';
  if (code === 'permission-denied') return 'permission denied by security rules';
  return 'unexpected error';
}

/** Messages for a failed password confirmation (Android's `authErrorMessage`). Nothing was deleted. */
export function passwordErrorMessage(e: unknown): string {
  switch (codeOf(e)) {
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
      return 'Incorrect password. Nothing was deleted.';
    case 'auth/network-request-failed':
      return "You're offline. Connect to the internet and try again. Nothing was deleted.";
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again. Nothing was deleted.';
    case 'auth/user-mismatch':
    case 'auth/user-not-found':
      return 'Please sign in again. Nothing was deleted.';
    default:
      return "Couldn't confirm your password. Nothing was deleted.";
  }
}

export const DELETED_MESSAGE = 'Your account and all of its data were deleted.';

export type DeleteArgs = {
  auth: AccountAuth;
  eraser: DataEraser;
  uid: string;
  email: string;
  password: string;
  /** Called once the password is confirmed and the data deletion is about to start (the app stops listening to the account here). */
  onConfirmed?: () => void;
};

/** The whole flow. Never throws: every outcome is a result, and `ok: true` is returned only when the data AND the login are gone. */
export async function deleteAccountFlow({ auth, eraser, uid, email, password, onConfirmed }: DeleteArgs): Promise<DeleteResult> {
  try {
    await auth.reauthenticate(uid, email, password);
  } catch (e) {
    return { ok: false, stage: 'password', message: passwordErrorMessage(e) };
  }
  onConfirmed?.();
  try {
    await eraseUserData(eraser, uid);
  } catch (e) {
    const why = e instanceof DataRemainsError ? 'some data could not be removed' : failureHint(e);
    return {
      ok: false,
      stage: 'data',
      message: `Couldn't delete all of your data (${why}). Your account still exists and some of your data may already be removed. Please try Delete Account again to finish.`,
    };
  }
  try {
    await auth.deleteLogin(uid);
  } catch (e) {
    return { ok: false, stage: 'login', message: `Your data was deleted, but the login couldn't be removed (${failureHint(e)}). Please try Delete Account again.` };
  }
  return { ok: true };
}
