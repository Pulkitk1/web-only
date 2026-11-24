/**
 * The session: who is using the app (signed-in account, guest, or nobody), and the sign-in actions.
 * Framework-free so it is unit-tested with fakes; `services/auth.ts` binds it to Firebase and `store/SessionStore.tsx`
 * exposes it to React.
 *
 * It never touches app data. Guest data (`appStorage`) is not read, written, uploaded or cleared here: signing in or
 * out only changes which session is active, so guest data stays on the device exactly as it was.
 */
import { DELETED_MESSAGE, deleteAccountFlow, type AccountAuth, type DataEraser, type DeleteResult } from '@/domain/accountDeletion';
import { passwordResetErrorMessage, resolveSession, signInErrorMessage, type SessionKind } from '@/domain/auth';

export type AuthUser = { uid: string; email: string | null };

/** The slice of Firebase Auth the app needs. */
export interface AuthBackend {
  signIn(email: string, password: string): Promise<AuthUser>;
  signUp(email: string, password: string): Promise<AuthUser>;
  sendPasswordReset(email: string): Promise<void>;
  signOut(): Promise<void>;
  /** Calls back once with the restored user (or null) and again on every change. Returns the unsubscribe. */
  onChange(cb: (user: AuthUser | null) => void): () => void;
}

/** The remembered "Continue as Guest" choice (Android `DevicePrefs.isGuestMode`). */
export interface GuestFlag {
  get(): boolean;
  set(on: boolean): void;
}

/** What account deletion needs besides the sign-in backend. Optional: a controller without it cannot delete accounts. */
export interface AccountDeletion {
  auth: AccountAuth;
  eraser: DataEraser;
  /** Runs after an account was deleted: removes that account's preferences from this device. Never touches guest data. */
  onDeleted?: (uid: string) => void;
}

/** A message that outlives the screen that caused it (shown on Settings after a failed deletion, on the login screen after a successful one). */
export type SessionNotice = { kind: 'success' | 'error'; message: string };

export type SessionState = {
  kind: SessionKind;
  uid: string | null;
  email: string | null;
  /** A sign-in / registration request is in flight (Kotlin `AuthState.Loading`, kept apart so the form keeps its fields). */
  busy: boolean;
  /** Last sign-in error, cleared when the user edits a field (Kotlin `authError`). */
  error: string | null;
  /** The account's data is being deleted: the app stops listening to it and shows a blocking screen until this ends. */
  deleting: boolean;
  notice: SessionNotice | null;
};

export function createSessionController(backend: AuthBackend, guest: GuestFlag, account?: AccountDeletion) {
  let user: AuthUser | null = null;
  let restored = false;
  let state: SessionState = { kind: 'loading', uid: null, email: null, busy: false, error: null, deleting: false, notice: null };
  const listeners = new Set<() => void>();

  const recompute = (patch: Partial<Pick<SessionState, 'busy' | 'error' | 'deleting' | 'notice'>> = {}) => {
    const kind = restored ? resolveSession(user?.uid ?? null, guest.get()) : 'loading';
    state = { kind, uid: user?.uid ?? null, email: user?.email ?? null, busy: state.busy, error: state.error, deleting: state.deleting, notice: state.notice, ...patch };
    listeners.forEach((l) => l());
  };

  const unsubscribe = backend.onChange((u) => {
    user = u;
    restored = true;
    recompute();
  });

  return {
    getState: () => state,
    subscribe(l: () => void) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    dispose: unsubscribe,

    clearError() {
      if (state.error !== null) recompute({ error: null });
    },

    /** Kotlin `authenticate`. Returns true on success; on failure the message is in `state.error`. */
    async authenticate(email: string, password: string, createAccount: boolean): Promise<boolean> {
      if (state.busy || state.deleting) return false;
      recompute({ busy: true, error: null, notice: null });
      try {
        const u = await (createAccount ? backend.signUp(email, password) : backend.signIn(email, password));
        // A signed-out user who later logs out must land on the login screen, not silently back in guest mode.
        guest.set(false);
        user = u;
        restored = true;
        recompute({ busy: false });
        return true;
      } catch (e) {
        recompute({ busy: false, error: signInErrorMessage(e, createAccount) });
        return false;
      }
    },

    /** Kotlin `sendPasswordReset`: null when the request was accepted, otherwise a user-facing error. */
    async sendPasswordReset(email: string): Promise<string | null> {
      try {
        await backend.sendPasswordReset(email.trim());
        return null;
      } catch (e) {
        return passwordResetErrorMessage(e);
      }
    },

    /** "Continue as Guest". Ignored while an account is signed in (Kotlin `enterGuestMode`). */
    continueAsGuest() {
      if (user) return;
      guest.set(true);
      recompute({ error: null, notice: null });
    },

    /** Guest → login screen. The guest's data stays in the browser untouched. */
    leaveGuest() {
      if (state.kind !== 'guest') return;
      guest.set(false);
      recompute({ error: null });
    },

    dismissNotice() {
      if (state.notice !== null) recompute({ notice: null });
    },

    /**
     * Permanently deletes the signed-in account and all of its data (see `domain/accountDeletion.ts`). Only ever the CURRENT account: the
     * password is checked first (a wrong one changes nothing and the sheet shows it), then `deleting` stops the app listening to the
     * account, the data goes, and only then the login. Success is reported only when both are gone; a failure leaves a notice on Settings
     * and a retry is safe. Guest data on this device is never touched.
     */
    async deleteAccount(password: string): Promise<DeleteResult> {
      const refuse = (message: string): DeleteResult => ({ ok: false, stage: 'password', message });
      if (!account) return refuse('Deleting an account is not available here.');
      if (state.kind !== 'firebase' || !state.uid || !state.email) return refuse('Guest data has no account to delete.');
      if (state.busy || state.deleting) return refuse('Another action is in progress. Please wait a moment.');
      const { uid, email } = state;
      recompute({ busy: true, notice: null });
      const result = await deleteAccountFlow({ auth: account.auth, eraser: account.eraser, uid, email, password, onConfirmed: () => recompute({ deleting: true }) });
      if (result.ok) {
        try { account.onDeleted?.(uid); } catch { /* clearing local preferences must never turn a finished deletion into a failure */ }
        // The login is gone: Firebase reports "signed out" too, but do not wait for it.
        user = null;
        restored = true;
        recompute({ busy: false, deleting: false, error: null, notice: { kind: 'success', message: DELETED_MESSAGE } });
      } else {
        recompute({ busy: false, deleting: false, notice: result.stage === 'password' ? null : { kind: 'error', message: result.message } });
      }
      return result;
    },

    /** Signs the account out. Nothing in the cloud or on the device is deleted. */
    async signOut() {
      try {
        await backend.signOut();
      } finally {
        user = null;
        recompute({ error: null });
      }
    },
  };
}

export type SessionController = ReturnType<typeof createSessionController>;
