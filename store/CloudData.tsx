import { useCallback, useEffect, useState } from 'react';

import type { CloudData } from '@/domain/cloudMapping';
import type { LedgerRunner } from '@/services/cloudLedger';
import type { DocReader, LoadFailure } from '@/services/cloudRepository';
import { createCloudSync, type LiveSource } from '@/services/cloudSync';
import type { MigrationBackend } from '@/services/guestMigration';
import { firestoreLedgerRunner } from '@/services/firestoreLedger';
import { firestoreMigration } from '@/services/firestoreMigration';
import { firestoreLive } from '@/services/firestoreLive';
import { firestoreReader } from '@/services/firestoreReader';
import { firestoreWriter } from '@/services/firestoreWriter';
import type { DocWriter } from '@/services/habitWriter';

export type CloudState = { status: 'loading' } | { status: 'ready'; data: CloudData; fromCache: boolean } | { status: 'failed'; failure: LoadFailure };

declare global {
  interface Window {
    /** Development builds only: lets the browser tests supply a fake reader so no real Firestore data is needed. */
    __consistoFakeReader?: DocReader;
    /** Development builds only: a fake writer, so browser tests never write to the real Firestore. */
    __consistoFakeWriter?: DocWriter;
    /** Development builds only: fake live listeners and ledger transactions, so browser tests simulate Android without real Firestore. */
    __consistoFakeLive?: LiveSource;
    __consistoFakeLedger?: LedgerRunner;
    /** Development builds only: a fake backend for the guest import, so browser tests never write to the real Firestore. */
    __consistoFakeMigration?: MigrationBackend;
  }
}

/** The Firebase reader, or (development builds only) a reader injected by the browser tests. */
export const activeReader = (): DocReader => (typeof __DEV__ !== 'undefined' && __DEV__ && typeof window !== 'undefined' && window.__consistoFakeReader) || firestoreReader;

/** The Firebase writer, or (development builds only) a writer injected by the browser tests. */
export const activeWriter = (): DocWriter => (typeof __DEV__ !== 'undefined' && __DEV__ && typeof window !== 'undefined' && window.__consistoFakeWriter) || firestoreWriter;

export const activeLive = (): LiveSource => (typeof __DEV__ !== 'undefined' && __DEV__ && typeof window !== 'undefined' && window.__consistoFakeLive) || firestoreLive;
export const activeMigration = (): MigrationBackend => (typeof __DEV__ !== 'undefined' && __DEV__ && typeof window !== 'undefined' && window.__consistoFakeMigration) || firestoreMigration;
export const activeLedgerRunner = (): LedgerRunner => (typeof __DEV__ !== 'undefined' && __DEV__ && typeof window !== 'undefined' && window.__consistoFakeLedger) || firestoreLedgerRunner;

type Slot = { uid: string; state: CloudState };

/**
 * Keeps the signed-in account's data live: Firestore listeners (`cloudSync`) deliver every change, from this browser or from
 * Android, without a reload. Each result is tagged with the uid it was read for and ignored unless it is still the current
 * user's, and the listeners are removed when the uid changes or the screen unmounts (sign-out), so one account's events can
 * never reach another session.
 */
export function useCloudData(uid: string): { state: CloudState; reload: () => void } {
  const [slot, setSlot] = useState<Slot | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!uid) return;
    setSlot({ uid, state: { status: 'loading' } });
    const sync = createCloudSync(activeLive(), uid, {
      onData: (e) => setSlot({ uid, state: { status: 'ready', data: e.data, fromCache: e.fromCache } }),
      onError: (failure) => setSlot({ uid, state: { status: 'failed', failure } }),
    });
    return () => sync.dispose();
  }, [uid, attempt]);

  const reload = useCallback(() => setAttempt((a) => a + 1), []);
  return { state: slot && slot.uid === uid ? slot.state : { status: 'loading' }, reload };
}
