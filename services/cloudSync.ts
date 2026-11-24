/**
 * Live synchronisation of a signed-in account's data (Stage 3): Firestore listeners for everything the app shows, merged
 * into one `CloudData` snapshot. It replaces the one-shot read, so changes made on Android (or another browser) arrive
 * without a reload. Mirrors Kotlin's `HabitRepository.observeHabits` and the wallet/notes observers:
 *
 *   users/{uid}                                  the wallet counters and profile
 *   users/{uid}/habits                           habits (with metadata, to know whether the data is confirmed by the server)
 *   users/{uid}/habits/{id}/completions          one listener per habit; a snapshot is only emitted once every habit's completions
 *                                                have arrived, so a habit never flashes without its history
 *   users/{uid}/walletTransactions, rewards, freezes, freezeMonths, dayNotes
 *
 * Snapshots are coalesced (a completion batch reaches the habit and completion listeners separately). `fromCache` is true
 * while the habits are not yet confirmed by the server (offline / reconnecting): rewards are only reconciled from
 * confirmed data. `dispose()` removes every listener; after it nothing is delivered, so a signed-out or switched account
 * can never receive a late event. Framework-free: the SDK is behind `LiveSource` (`firestoreLive.ts`).
 */
import { buildCloudData, type CloudData, type RawDoc } from '@/domain/cloudMapping';
import { classifyLoadError, type LoadFailure } from './cloudRepository';

export type Unsubscribe = () => void;
export type SnapshotMeta = { fromCache: boolean };

export interface LiveSource {
  watchDoc(path: string, next: (doc: RawDoc | null, meta: SnapshotMeta) => void, error: (e: unknown) => void): Unsubscribe;
  watchCollection(path: string, next: (docs: RawDoc[], meta: SnapshotMeta) => void, error: (e: unknown) => void): Unsubscribe;
}

export type SyncEvent = { data: CloudData; fromCache: boolean };
export type SyncHandlers = { onData(event: SyncEvent): void; onError(failure: LoadFailure): void };

export function createCloudSync(source: LiveSource, uid: string, handlers: SyncHandlers, debounceMs = 40) {
  if (!uid || uid.includes('/')) throw new Error('Invalid user id');
  const root = `users/${uid}`;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // undefined = the first snapshot has not arrived yet
  let user: RawDoc | null | undefined;
  let habits: RawDoc[] | undefined;
  let habitsFromCache = true;
  const completions = new Map<string, RawDoc[] | undefined>();
  const completionListeners = new Map<string, Unsubscribe>();
  const parts: Record<'transactions' | 'rewards' | 'freezes' | 'freezeMonths' | 'notes', RawDoc[] | undefined> = { transactions: undefined, rewards: undefined, freezes: undefined, freezeMonths: undefined, notes: undefined };
  const unsubs: Unsubscribe[] = [];

  const ready = () => user !== undefined && habits !== undefined && Object.values(parts).every((p) => p !== undefined) && [...completions.values()].every((c) => c !== undefined);

  const emit = () => {
    timer = null;
    if (disposed || !ready()) return;
    const data = buildCloudData({
      uid,
      user: user ?? null,
      habits: habits!.map((doc) => ({ doc, completions: completions.get(doc.id) ?? [] })),
      transactions: parts.transactions!,
      rewards: parts.rewards!,
      freezes: parts.freezes!,
      freezeMonths: parts.freezeMonths!,
      notes: parts.notes!,
    });
    handlers.onData({ data, fromCache: habitsFromCache });
  };
  const schedule = () => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(emit, debounceMs);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (timer) clearTimeout(timer);
    timer = null;
    unsubs.splice(0).forEach((u) => u());
    completionListeners.forEach((u) => u());
    completionListeners.clear();
    completions.clear();
  };
  const fail = (e: unknown) => {
    if (disposed) return;
    const failure = classifyLoadError(e);
    dispose();
    handlers.onError(failure);
  };
  /** Wraps a callback so an event that arrives after dispose() (or from a removed listener) is ignored. */
  const live =
    <A extends unknown[]>(fn: (...a: A) => void) =>
    (...a: A) => {
      if (!disposed) fn(...a);
    };

  unsubs.push(
    source.watchDoc(root, live((d) => ((user = d), schedule())), fail),
    source.watchCollection(
      `${root}/habits`,
      live((docs, meta) => {
        habits = docs;
        habitsFromCache = meta.fromCache;
        const ids = new Set(docs.map((d) => d.id));
        for (const id of [...completionListeners.keys()]) {
          if (!ids.has(id)) {
            completionListeners.get(id)!();
            completionListeners.delete(id);
            completions.delete(id);
          }
        }
        for (const id of ids) {
          if (completionListeners.has(id)) continue;
          completions.set(id, undefined); // pending until its first snapshot
          completionListeners.set(
            id,
            source.watchCollection(`${root}/habits/${id}/completions`, live((cs) => (completions.set(id, cs), schedule())), fail),
          );
        }
        schedule();
      }),
      fail,
    ),
  );
  for (const [key, name] of [['transactions', 'walletTransactions'], ['rewards', 'rewards'], ['freezes', 'freezes'], ['freezeMonths', 'freezeMonths'], ['notes', 'dayNotes']] as const) {
    unsubs.push(source.watchCollection(`${root}/${name}`, live((docs) => ((parts[key] = docs), schedule())), fail));
  }

  return { dispose, isDisposed: () => disposed };
}

export type CloudSync = ReturnType<typeof createCloudSync>;
