/**
 * Sign-in rules ported from Kotlin: `Session.kt` (SessionResolver), `LoginScreen.kt` (validation) and
 * `AppViewModel.kt` (`signInErrorMessage`, `passwordResetErrorMessage`). Pure functions, no Firebase import.
 */

export const MIN_PASSWORD_LENGTH = 6;

/** Id the on-device guest uses in place of a Firebase uid (Kotlin `GUEST_UID`). */
export const GUEST_UID = 'guest';

/** Who is using the app. Mirrors Kotlin `Session` plus the two "no session yet" states of `AuthState`. */
export type SessionKind = 'loading' | 'signedOut' | 'guest' | 'firebase';

/**
 * `SessionResolver.resolve`: a Firebase login always wins; otherwise the remembered guest choice; otherwise nobody
 * (show the login screen).
 */
export function resolveSession(firebaseUid: string | null, guestMode: boolean): Exclude<SessionKind, 'loading'> {
  if (firebaseUid) return 'firebase';
  return guestMode ? 'guest' : 'signedOut';
}

/** Kotlin `isValidEmail`: the basic format check used by Forgot Password. */
export const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

/** Kotlin `canSubmit`: an email, a password of at least six characters, and nothing in flight. */
export const canSubmitCredentials = (email: string, password: string, loading: boolean): boolean =>
  email.trim().length > 0 && password.length >= MIN_PASSWORD_LENGTH && !loading;

const codeOf = (e: unknown): string => (typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '');

/**
 * User-facing sign-in / registration errors. Deliberately generic for credential problems so accounts can't be
 * probed (same wording as Kotlin). Firebase JS error codes stand in for the Android exception classes.
 */
export function signInErrorMessage(e: unknown, createAccount: boolean): string {
  switch (codeOf(e)) {
    case 'auth/weak-password':
      return 'Please choose a stronger password (at least 6 characters).';
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in.';
    case 'auth/invalid-email':
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return createAccount ? 'Please enter a valid email address.' : 'Incorrect email or password.';
    case 'auth/network-request-failed':
      return "You're offline. Check your connection and try again.";
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a moment and try again.';
    default:
      return 'Unable to sign in. Please try again.';
  }
}

/** Reset-email errors. An unknown address counts as success (null), so the screen never reveals whether an account exists. */
export function passwordResetErrorMessage(e: unknown): string | null {
  switch (codeOf(e)) {
    case 'auth/user-not-found':
      return null;
    case 'auth/invalid-email':
      return 'Please enter a valid email address.';
    case 'auth/network-request-failed':
      return "You're offline. Check your connection and try again.";
    case 'auth/too-many-requests':
      return 'Too many requests. Please wait a few minutes and try again.';
    default:
      return "Couldn't send the reset email. Please try again.";
  }
}
