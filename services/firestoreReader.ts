/**
 * The Firebase-backed `DocReader`. One-shot reads only (`getDoc`, `getDocs`): no listeners yet, and no write function of
 * the SDK is imported here. Uses the single Firestore instance from `services/firebase.ts`.
 */
import { collection, doc, getDoc, getDocs, type DocumentData } from 'firebase/firestore';

import type { RawDoc } from '@/domain/cloudMapping';
import type { DocReader } from './cloudRepository';
import { db } from './firebase';

const toRaw = (id: string, data: DocumentData): RawDoc => ({ id, data: data as RawDoc['data'] });

export const firestoreReader: DocReader = {
  async getDoc(path) {
    const snap = await getDoc(doc(db, path));
    return snap.exists() ? toRaw(snap.id, snap.data()) : null;
  },
  async listDocs(collectionPath) {
    const snap = await getDocs(collection(db, collectionPath));
    return snap.docs.map((d) => toRaw(d.id, d.data()));
  },
};
