/**
 * The Firebase-backed `MigrationBackend` (Phase 10). Reads come from the SERVER (`getDocFromServer` / `getDocsFromServer`), as
 * Kotlin's migration reads with `Source.SERVER`, so verification can't be satisfied by a local cache. The profile is created in one
 * transaction that reads first and writes only if the document is missing, so two tabs or devices can't both create it and an
 * existing profile (and its wallet) is never reset. `guestMigration.ts` restricts which paths can reach this.
 */
import { doc, collection, getDocFromServer, getDocsFromServer, writeBatch } from 'firebase/firestore';

import type { RawDoc } from '@/domain/cloudMapping';
import type { MigrationBackend } from './guestMigration';
import { ensureProfileIn } from './profileTransaction';
import { resolve } from './firestoreWriter';
import { db } from './firebase';

export const firestoreMigration: MigrationBackend = {
  ensureProfile: (uid, email) => ensureProfileIn(db, uid, email),

  async getDoc(path) {
    const snap = await getDocFromServer(doc(db, path));
    return snap.exists() ? ({ id: snap.id, data: snap.data() } as RawDoc) : null;
  },

  async listDocs(collectionPath) {
    const snap = await getDocsFromServer(collection(db, collectionPath));
    return snap.docs.map((d) => ({ id: d.id, data: d.data() }) as RawDoc);
  },

  async setMany(ops) {
    const b = writeBatch(db);
    for (const o of ops) b.set(doc(db, o.path), resolve(o.fields));
    await b.commit();
  },
};
