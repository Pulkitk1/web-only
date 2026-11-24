/** The account eraser the app uses: the Firebase one, or (development builds only) a fake injected by the browser tests. */
import type { DataEraser } from '@/domain/accountDeletion';
import { db } from './firebase';
import { createFirestoreEraser } from './firestoreEraser';

declare global {
  interface Window {
    /** Development builds only: a fake eraser, so browser tests never delete real Firestore data. */
    __consistoFakeEraser?: DataEraser;
  }
}

export const firestoreEraser: DataEraser = createFirestoreEraser(db);

export const activeEraser = (): DataEraser => (typeof __DEV__ !== 'undefined' && __DEV__ && typeof window !== 'undefined' && window.__consistoFakeEraser) || firestoreEraser;

/** Looks the eraser up at call time (so a test can install its fake after the app has started). */
export const lazyEraser: DataEraser = {
  profileExists: (uid) => activeEraser().profileExists(uid),
  markDeletionRequested: (uid) => activeEraser().markDeletionRequested(uid),
  listDocPaths: (p, n) => activeEraser().listDocPaths(p, n),
  deleteDocs: (paths) => activeEraser().deleteDocs(paths),
  deleteProfile: (uid) => activeEraser().deleteProfile(uid),
};
