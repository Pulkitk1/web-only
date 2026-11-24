import { describe, expect, it } from 'vitest';

import { canSubmitCredentials, isValidEmail, passwordResetErrorMessage, resolveSession, signInErrorMessage } from '@/domain/auth';
import { MemoryStorage, createDevicePrefs } from '@/services/devicePrefs';
import { createSessionController, type AuthBackend, type AuthUser } from '@/services/sessionController';

const err = (code: string) => Object.assign(new Error(code), { code });

/** A fake Firebase Auth: one known account, restores `initial` on subscribe. */
function fakeBackend(initial: AuthUser | null = null) {
  let current = initial;
  let cb: ((u: AuthUser | null) => void) | null = null;
  const calls: string[] = [];
  const backend: AuthBackend = {
    async signIn(email, password) {
      calls.push(`signIn:${email}`);
      if (email === 'a@b.co' && password === 'secret1') return (current = { uid: 'u1', email });
      throw err('auth/invalid-credential');
    },
    async signUp(email, password) {
      calls.push(`signUp:${email}`);
      if (email === 'a@b.co') throw err('auth/email-already-in-use');
      if (password.length < 6) throw err('auth/weak-password');
      return (current = { uid: 'u2', email });
    },
    async sendPasswordReset(email) {
      calls.push(`reset:${email}`);
      if (email === 'none@b.co') throw err('auth/user-not-found');
      if (email === 'bad') throw err('auth/invalid-email');
    },
    async signOut() {
      calls.push('signOut');
      current = null;
    },
    onChange(fn) {
      cb = fn;
      queueMicrotask(() => fn(current));
      return () => (cb = null);
    },
  };
  return { backend, calls, emit: (u: AuthUser | null) => cb?.(u) };
}

const guestFlag = (on = false) => {
  const prefs = createDevicePrefs(new MemoryStorage());
  prefs.setGuestMode(on);
  return { get: () => prefs.isGuestMode(), set: (v: boolean) => prefs.setGuestMode(v) };
};
const settle = () => new Promise((r) => setTimeout(r, 0));

describe('session priority (Kotlin SessionResolver)', () => {
  it('an account wins over a remembered guest; guest wins over nobody', () => {
    expect(resolveSession('uid', true)).toBe('firebase');
    expect(resolveSession('uid', false)).toBe('firebase');
    expect(resolveSession(null, true)).toBe('guest');
    expect(resolveSession(null, false)).toBe('signedOut');
  });
});

describe('validation', () => {
  it('submit needs an email, 6+ character password and nothing in flight', () => {
    expect(canSubmitCredentials('a@b.co', '123456', false)).toBe(true);
    expect(canSubmitCredentials('  ', '123456', false)).toBe(false);
    expect(canSubmitCredentials('a@b.co', '12345', false)).toBe(false);
    expect(canSubmitCredentials('a@b.co', '123456', true)).toBe(false);
  });
  it('email format check', () => {
    expect(isValidEmail('a@b.co')).toBe(true);
    for (const bad of ['', 'a', 'a@b', 'a b@c.d', '@b.co']) expect(isValidEmail(bad)).toBe(false);
  });
});

describe('error messages match Kotlin', () => {
  it('sign in', () => {
    expect(signInErrorMessage(err('auth/invalid-credential'), false)).toBe('Incorrect email or password.');
    expect(signInErrorMessage(err('auth/wrong-password'), false)).toBe('Incorrect email or password.');
    expect(signInErrorMessage(err('auth/invalid-credential'), true)).toBe('Please enter a valid email address.');
    expect(signInErrorMessage(err('auth/email-already-in-use'), true)).toBe('An account with this email already exists. Try signing in.');
    expect(signInErrorMessage(err('auth/weak-password'), true)).toBe('Please choose a stronger password (at least 6 characters).');
    expect(signInErrorMessage(err('auth/network-request-failed'), false)).toBe("You're offline. Check your connection and try again.");
    expect(signInErrorMessage(err('auth/too-many-requests'), false)).toBe('Too many attempts. Please wait a moment and try again.');
    expect(signInErrorMessage(new Error('x'), false)).toBe('Unable to sign in. Please try again.');
  });
  it('password reset reveals nothing about which accounts exist', () => {
    expect(passwordResetErrorMessage(err('auth/user-not-found'))).toBeNull();
    expect(passwordResetErrorMessage(err('auth/invalid-email'))).toBe('Please enter a valid email address.');
    expect(passwordResetErrorMessage(err('auth/too-many-requests'))).toBe('Too many requests. Please wait a few minutes and try again.');
    expect(passwordResetErrorMessage(new Error('x'))).toBe("Couldn't send the reset email. Please try again.");
  });
});

describe('session controller', () => {
  it('is loading until Firebase reports the restored user, then signed out', async () => {
    const c = createSessionController(fakeBackend().backend, guestFlag());
    expect(c.getState().kind).toBe('loading');
    await settle();
    expect(c.getState().kind).toBe('signedOut');
  });

  it('restores a signed-in account after a refresh (persistence) and beats a remembered guest flag', async () => {
    const c = createSessionController(fakeBackend({ uid: 'u1', email: 'a@b.co' }).backend, guestFlag(true));
    await settle();
    expect(c.getState()).toMatchObject({ kind: 'firebase', uid: 'u1', email: 'a@b.co' });
  });

  it('restores the remembered guest when nobody is signed in', async () => {
    const c = createSessionController(fakeBackend().backend, guestFlag(true));
    await settle();
    expect(c.getState().kind).toBe('guest');
  });

  it('valid login signs in; invalid credentials show the generic error and stay signed out', async () => {
    const c = createSessionController(fakeBackend().backend, guestFlag());
    await settle();
    expect(await c.authenticate('a@b.co', 'wrong!!', false)).toBe(false);
    expect(c.getState()).toMatchObject({ kind: 'signedOut', error: 'Incorrect email or password.', busy: false });
    c.clearError();
    expect(c.getState().error).toBeNull();
    expect(await c.authenticate('a@b.co', 'secret1', false)).toBe(true);
    expect(c.getState()).toMatchObject({ kind: 'firebase', uid: 'u1', error: null, busy: false });
  });

  it('registration works; a duplicate email and a weak password give Kotlin messages', async () => {
    const c = createSessionController(fakeBackend().backend, guestFlag());
    await settle();
    expect(await c.authenticate('a@b.co', 'secret1', true)).toBe(false);
    expect(c.getState().error).toBe('An account with this email already exists. Try signing in.');
    expect(await c.authenticate('new@b.co', '123', true)).toBe(false);
    expect(c.getState().error).toBe('Please choose a stronger password (at least 6 characters).');
    expect(await c.authenticate('new@b.co', '123456', true)).toBe(true);
    expect(c.getState()).toMatchObject({ kind: 'firebase', uid: 'u2' });
  });

  it('is busy while a request is in flight and ignores a second submit', async () => {
    const f = fakeBackend();
    const c = createSessionController(f.backend, guestFlag());
    await settle();
    const first = c.authenticate('a@b.co', 'secret1', false);
    expect(c.getState().busy).toBe(true);
    expect(await c.authenticate('a@b.co', 'secret1', false)).toBe(false);
    await first;
    expect(f.calls.filter((x) => x.startsWith('signIn'))).toHaveLength(1);
  });

  it('password reset: success, unknown address looks like success, bad address errors', async () => {
    const f = fakeBackend();
    const c = createSessionController(f.backend, guestFlag());
    await settle();
    expect(await c.sendPasswordReset(' a@b.co ')).toBeNull();
    expect(f.calls).toContain('reset:a@b.co');
    expect(await c.sendPasswordReset('none@b.co')).toBeNull();
    expect(await c.sendPasswordReset('bad')).toBe('Please enter a valid email address.');
    expect(c.getState().kind).toBe('signedOut');
  });

  it('guest ↔ login ↔ account switching keeps the guest choice rules', async () => {
    const flag = guestFlag();
    const f = fakeBackend();
    const c = createSessionController(f.backend, flag);
    await settle();
    c.continueAsGuest();
    expect(c.getState().kind).toBe('guest');
    expect(flag.get()).toBe(true);
    c.leaveGuest(); // Settings → Sign in
    expect(c.getState().kind).toBe('signedOut');
    expect(flag.get()).toBe(false);
    await c.authenticate('a@b.co', 'secret1', false);
    expect(c.getState().kind).toBe('firebase');
    c.continueAsGuest(); // not allowed while signed in
    expect(c.getState().kind).toBe('firebase');
    await c.signOut();
    // After signing out we land on login, not silently in guest mode; the guest choice is made explicitly again.
    expect(c.getState().kind).toBe('signedOut');
    c.continueAsGuest();
    expect(c.getState().kind).toBe('guest');
  });

  it('never touches app data: no backend call other than auth, and the guest storage is untouched', async () => {
    const storage = new MemoryStorage();
    storage.setItem('consisto_app_data', '{"keep":"me"}');
    const prefs = createDevicePrefs(storage);
    const c = createSessionController(fakeBackend().backend, { get: prefs.isGuestMode, set: prefs.setGuestMode });
    await settle();
    c.continueAsGuest();
    c.leaveGuest();
    await c.authenticate('a@b.co', 'secret1', false);
    await c.signOut();
    expect(storage.getItem('consisto_app_data')).toBe('{"keep":"me"}');
  });

  it('follows Firebase when the session changes elsewhere (another tab signs out)', async () => {
    const f = fakeBackend({ uid: 'u1', email: 'a@b.co' });
    const c = createSessionController(f.backend, guestFlag());
    await settle();
    expect(c.getState().kind).toBe('firebase');
    f.emit(null);
    expect(c.getState().kind).toBe('signedOut');
  });
});
