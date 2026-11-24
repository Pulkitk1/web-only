/**
 * The Firebase-backed `LedgerRunner`: one `runTransaction` per ledger operation (Kotlin `FirestoreLedgerRunner`). Needs a
 * connection: offline a transaction fails instead of queueing, so a balance can never be double-spent from a stale cache.
 * `cloudLedger.ts` restricts which documents the transaction may read and write.
 */
import { doc, runTransaction } from 'firebase/firestore';

import type { RawDoc } from '@/domain/cloudMapping';
import type { LedgerRunner } from './cloudLedger';
import { resolve } from './firestoreWriter';
import { db } from './firebase';

export const firestoreLedgerRunner: LedgerRunner = {
  run: (block) =>
    runTransaction(db, (t) => {
      const reads = new Map<string, Promise<RawDoc | null>>();
      return block({
        // Firestore fails a transaction that reads the same document twice, so each document is read at most once per attempt.
        get(path) {
          let p = reads.get(path);
          if (!p) {
            p = t.get(doc(db, path)).then((snap) => (snap.exists() ? { id: snap.id, data: snap.data() as RawDoc['data'] } : null));
            reads.set(path, p);
          }
          return p;
        },
        update: (path, fields) => void t.update(doc(db, path), resolve(fields)),
        set: (path, fields) => void t.set(doc(db, path), resolve(fields)),
      });
    }),
};
