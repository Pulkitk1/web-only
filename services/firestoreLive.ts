/**
 * The Firebase-backed `LiveSource`: `onSnapshot` listeners on the signed-in user's documents. Habit metadata changes are
 * included, so `fromCache` flips to false when the server confirms the data (Kotlin `MetadataChanges.INCLUDE`). Server
 * timestamps that are still pending are estimated, like Kotlin's `ServerTimestampBehavior.ESTIMATE`.
 */
import { collection, doc, onSnapshot, type DocumentData } from 'firebase/firestore';

import type { RawDoc } from '@/domain/cloudMapping';
import { db } from './firebase';
import type { LiveSource } from './cloudSync';

const toRaw = (id: string, data: DocumentData): RawDoc => ({ id, data: data as RawDoc['data'] });

export const firestoreLive: LiveSource = {
  watchDoc: (path, next, error) =>
    onSnapshot(
      doc(db, path),
      (snap) => next(snap.exists() ? toRaw(snap.id, snap.data({ serverTimestamps: 'estimate' })) : null, { fromCache: snap.metadata.fromCache }),
      error,
    ),
  watchCollection: (path, next, error) =>
    onSnapshot(
      collection(db, path),
      { includeMetadataChanges: path.endsWith('/habits') },
      (snap) => next(snap.docs.map((d) => toRaw(d.id, d.data({ serverTimestamps: 'estimate' }))), { fromCache: snap.metadata.fromCache }),
      error,
    ),
};
