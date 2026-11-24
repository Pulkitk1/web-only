/**
 * The Firebase-backed `DocWriter` for habit writes (Stage 1). Uses the single Firestore instance from `services/firebase.ts`.
 * Only `setDoc`, `updateDoc` and one batched delete are used; there are no transactions and no wallet writes here, and
 * `habitWriter.ts` restricts which paths can reach it.
 */
import { arrayRemove, arrayUnion, collection, doc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

import type { FieldMap } from '@/domain/cloudWrite';
import { db } from './firebase';
import { ArrayOp, SERVER_TIMESTAMP, type DocWriter } from './habitWriter';

const value = (v: unknown): unknown => (v === SERVER_TIMESTAMP ? serverTimestamp() : v instanceof ArrayOp ? (v.kind === 'union' ? arrayUnion(...v.values) : arrayRemove(...v.values)) : v);
export const resolve = (fields: FieldMap): FieldMap => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, value(v)]));

export const firestoreWriter: DocWriter = {
  newId: (collectionPath) => doc(collection(db, collectionPath)).id,
  set: (path, fields) => setDoc(doc(db, path), resolve(fields)),
  update: (path, fields) => updateDoc(doc(db, path), resolve(fields)),
  deleteMany: async (paths) => {
    const batch = writeBatch(db);
    paths.forEach((p) => batch.delete(doc(db, p)));
    await batch.commit();
  },
  batch: async (ops) => {
    const b = writeBatch(db);
    for (const o of ops) {
      if (o.kind === 'set') b.set(doc(db, o.path), resolve(o.fields), { merge: true });
      else b.update(doc(db, o.path), resolve(o.fields));
    }
    await b.commit();
  },
};
