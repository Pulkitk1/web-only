/**
 * The Firestore side of account deletion (Phase 12A): server reads, batched deletes, and the `deletionRequested` marker.
 * `domain/accountDeletion.ts` decides the order and the checks; this file only talks to Firestore. It is a factory over a Firestore
 * instance (and imports no app configuration) so the emulator tests run it against the real security rules; the app wiring is in
 * `services/accountEraser.ts`.
 *
 * Every read comes from the SERVER (`getDocFromServer`, `getDocsFromServer`): the web app has no persistent cache, but a cached answer
 * must never be mistaken for "nothing is left".
 */
import { collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, limit, query, serverTimestamp, setDoc, writeBatch, type Firestore } from 'firebase/firestore';

import type { DataEraser } from '@/domain/accountDeletion';

export function createFirestoreEraser(firestore: Firestore): DataEraser {
  return {
    async profileExists(uid) {
      return (await getDocFromServer(doc(firestore, `users/${uid}`))).exists();
    },
    async markDeletionRequested(uid) {
      // The security rules allow exactly these two keys to change here, and only once the wallet is left alone.
      await setDoc(doc(firestore, `users/${uid}`), { deletionRequested: true, deletionRequestedAt: serverTimestamp() }, { merge: true });
    },
    async listDocPaths(collectionPath, max) {
      const snap = await getDocsFromServer(query(collection(firestore, collectionPath), limit(max)));
      return snap.docs.map((d) => d.ref.path);
    },
    async deleteDocs(paths) {
      const batch = writeBatch(firestore);
      for (const p of paths) batch.delete(doc(firestore, p));
      await batch.commit();
    },
    async deleteProfile(uid) {
      await deleteDoc(doc(firestore, `users/${uid}`));
    },
  };
}
