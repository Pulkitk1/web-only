/**
 * Binds the session controller to Firebase Auth (email + password only, like Android) and to the device's guest flag.
 * Uses the single Firebase app created in `services/firebase.ts`; nothing is initialised here.
 *
 * Persistence: Firebase Auth on the web keeps the signed-in user in IndexedDB (falling back to localStorage), so a
 * refresh or a new tab restores the session without signing in again.
 */
import { createUserWithEmailAndPassword, deleteUser, EmailAuthProvider, onAuthStateChanged, reauthenticateWithCredential, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';

import type { AccountAuth } from '@/domain/accountDeletion';

import { lazyEraser } from './accountEraser';
import { auth } from './firebase';
import { devicePrefs } from './devicePrefs';
import { migrationStore } from './guestMigrationStore';
import { createSessionController, type AuthBackend, type AuthUser } from './sessionController';

const toUser = (u: User): AuthUser => ({ uid: u.uid, email: u.email });

const firebaseBackend: AuthBackend = {
  signIn: async (email, password) => toUser((await signInWithEmailAndPassword(auth, email, password)).user),
  signUp: async (email, password) => toUser((await createUserWithEmailAndPassword(auth, email, password)).user),
  sendPasswordReset: (email) => sendPasswordResetEmail(auth, email),
  signOut: () => signOut(auth),
  onChange: (cb) => onAuthStateChanged(auth, (u) => cb(u ? toUser(u) : null)),
};

/**
 * Re-authentication and login deletion for the account being deleted. Both refuse to act unless the signed-in Firebase user IS `uid`, so
 * a stale screen can never delete a different account.
 */
const signedInAs = (uid: string): User => {
  const u = auth.currentUser;
  if (!u || u.uid !== uid) throw Object.assign(new Error('The signed-in account changed.'), { code: 'auth/user-mismatch' });
  return u;
};
const accountAuth: AccountAuth = {
  reauthenticate: async (uid, email, password) => {
    await reauthenticateWithCredential(signedInAs(uid), EmailAuthProvider.credential(email, password));
  },
  deleteLogin: async (uid) => {
    await deleteUser(signedInAs(uid));
  },
};

export const sessionController = createSessionController(
  firebaseBackend,
  {
    get: () => devicePrefs.isGuestMode(),
    set: (on) => devicePrefs.setGuestMode(on),
  },
  {
    auth: accountAuth,
    eraser: lazyEraser,
    // Only this account's preferences go; guest data (`appStorage`) and the theme are not account data and stay.
    onDeleted: (uid) => {
      devicePrefs.clearAccount(uid);
      migrationStore.forget(uid);
    },
  },
);
