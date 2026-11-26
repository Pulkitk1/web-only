/**
 * Creates an account's `users/{uid}` profile when it has none: Android's `loadUser` for a new account, on the web.
 *
 * Why this exists: signing up only creates the Firebase Auth login. Without a profile document there is no wallet, which the
 * app showed as 0 coins and 0 freezes (and every wallet operation refuses to run). The profile is the same one Android creates
 * (`newProfileFields`: 20 coins, no freezes, `welcomeFreezePending`); the one free Streak Freeze is then recorded by the existing
 * welcome-freeze step under the fixed ledger id `welcome_freeze`, exactly as for an Android-created account.
 *
 * Safe to call any number of times, from any number of tabs, browsers or devices, and next to Android:
 *   - the profile is created in one Firestore transaction that reads first and writes only if the document is missing, so an
 *     existing profile (and its wallet, history and pending adjustments) is never created again, reset or changed;
 *   - calls for the same account that overlap in this page share one request;
 *   - a failure is thrown to the caller and nothing is remembered, so the next call simply tries again.
 */
import type { MigrationBackend } from './guestMigration';

export type EnsureResult = 'created' | 'exists';

export function createProfileEnsurer(backend: Pick<MigrationBackend, 'ensureProfile'>) {
  const inFlight = new Map<string, Promise<EnsureResult>>();
  return {
    ensure(uid: string, email: string): Promise<EnsureResult> {
      if (!uid || uid.includes('/')) return Promise.reject(new Error('Invalid user id'));
      const running = inFlight.get(uid);
      if (running) return running;
      const p = backend.ensureProfile(uid, email).finally(() => inFlight.delete(uid));
      inFlight.set(uid, p);
      return p;
    },
  };
}

export type ProfileEnsurer = ReturnType<typeof createProfileEnsurer>;

/** Waits between attempts after a failed creation (offline, a dropped connection). The app also tries again on every new server snapshot. */
export const ENSURE_RETRY_DELAYS_MS = [2_000, 5_000, 15_000, 30_000] as const;
