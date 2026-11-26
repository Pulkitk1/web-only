/**
 * The Firestore transaction that creates an account's profile (`users/{uid}`) when it is missing. Kept apart from `services/firebase.ts`
 * (it takes the database as an argument) so the Firestore emulator tests run exactly this code against the real security rules.
 *
 * It reads first and writes only if the document does not exist, so two tabs, two browsers or Android creating the same
 * profile at once cannot both write it (Firestore re-runs the loser, which then sees the document and does nothing), and an
 * existing profile, with its wallet, is never replaced or reset.
 */
import { doc, runTransaction, serverTimestamp, type Firestore } from 'firebase/firestore';

import { SERVER_TIMESTAMP } from './habitWriter';
import { newProfileFields } from './guestMigration';

export function ensureProfileIn(db: Firestore, uid: string, email: string): Promise<'created' | 'exists'> {
  return runTransaction(db, async (t) => {
    const ref = doc(db, `users/${uid}`);
    const snap = await t.get(ref);
    if (snap.exists()) return 'exists' as const;
    const fields = Object.fromEntries(Object.entries(newProfileFields(email)).map(([k, v]) => [k, v === SERVER_TIMESTAMP ? serverTimestamp() : v]));
    t.set(ref, fields);
    return 'created' as const;
  });
}
