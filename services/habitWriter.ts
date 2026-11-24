/**
 * Habit writes to Firestore (Stage 1) and completion writes (Stage 3). Mirrors Kotlin's `HabitRepository` (createHabit / updateHabit / deleteHabit) and
 * `FirestoreNoteStore.deleteNotesFor`, under `users/{uid}/habits`, plus `HabitRepository.setCompletion` (the completion
 * document and the legacy `completedDates` array, in one batch). Framework-free: the SDK is behind `DocWriter`
 * (`firestoreWriter.ts`), so the behaviour is unit-tested with a fake.
 *
 * Safety: every path is checked against the signed-in uid and against a short allow-list, so this layer can never write to
 * another user's documents, nor to the wallet (user document, walletTransactions, rewards, freezes, freezeMonths).
 */
import type { RawDoc } from '@/domain/cloudMapping';
import { habitCreateFields, type FieldMap } from '@/domain/cloudWrite';
import { assertValidHabitFields } from '@/domain/habitLimits';
import { parseKey } from '@/utils/date';
import type { Habit } from '@/types/habit';
import type { DocReader } from './cloudRepository';

/** Placeholder the SDK adapter turns into Firestore's server timestamp (`FieldValue.serverTimestamp()`). */
export const SERVER_TIMESTAMP: unique symbol = Symbol('serverTimestamp');

/** `FieldValue.arrayUnion` / `arrayRemove`, turned into the SDK's field values by `firestoreWriter`. */
export class ArrayOp {
  constructor(
    readonly kind: 'union' | 'remove',
    readonly values: readonly unknown[],
  ) {}
}
export const arrayUnion = (...values: unknown[]) => new ArrayOp('union', values);
export const arrayRemove = (...values: unknown[]) => new ArrayOp('remove', values);

/** One operation of an atomic batch: a merge-set of a document, or an update of an existing one. */
export type BatchOp = { kind: 'set'; path: string; fields: FieldMap; merge: true } | { kind: 'update'; path: string; fields: FieldMap };

export interface DocWriter {
  /** A new auto-generated document id in the collection (no network). */
  newId(collectionPath: string): string;
  /** Creates (or replaces) a whole document. */
  set(path: string, fields: FieldMap): Promise<void>;
  /** Merges fields into an existing document; rejects if it does not exist. */
  update(path: string, fields: FieldMap): Promise<void>;
  /** Deletes the documents in one atomic batch. */
  deleteMany(paths: string[]): Promise<void>;
  /** Applies the operations atomically (Firestore `writeBatch`). */
  batch(ops: BatchOp[]): Promise<void>;
}

const BATCH_LIMIT = 450; // Firestore allows 500 operations per batch

/** Allows only habit documents (set/update) and habit, completion and day-note documents (delete) of this user. */
export function scopedWriter(writer: DocWriter, uid: string): DocWriter {
  if (!uid || uid.includes('/')) throw new Error('Invalid user id');
  const habit = new RegExp(`^users/${uid}/habits/[^/]+$`);
  const completion = new RegExp(`^users/${uid}/habits/[^/]+/completions/[^/]+$`);
  const note = new RegExp(`^users/${uid}/dayNotes/[^/]+$`);
  const refuse = (what: string, path: string): never => {
    throw new Error(`Refusing to ${what} ${path}`);
  };
  return {
    newId: (c) => (c === `users/${uid}/habits` ? writer.newId(c) : refuse('create an id in', c)),
    set: (p, f) => (habit.test(p) ? writer.set(p, f) : refuse('write', p)),
    update: (p, f) => (habit.test(p) ? writer.update(p, f) : refuse('update', p)),
    deleteMany: (ps) => {
      const bad = ps.find((p) => !(habit.test(p) || completion.test(p) || note.test(p)));
      return bad === undefined ? writer.deleteMany(ps) : refuse('delete', bad);
    },
    // A completion document is merge-set; the habit document is updated. Nothing else can be part of a batch.
    batch: (ops) => {
      const bad = ops.find((o) => (o.kind === 'set' ? !completion.test(o.path) : !habit.test(o.path)));
      return bad === undefined ? writer.batch(ops) : refuse(`${bad.kind} (batch)`, bad.path);
    },
  };
}

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

export type HabitWriter = ReturnType<typeof createHabitWriter>;

export function createHabitWriter(rawWriter: DocWriter, reader: DocReader, uid: string, now: () => number = Date.now) {
  const writer = scopedWriter(rawWriter, uid);
  const root = `users/${uid}`;
  const habitPath = (id: string) => `${root}/habits/${id}`;
  const stamp = (fields: FieldMap, ...keys: string[]): FieldMap => ({ ...fields, ...Object.fromEntries(keys.map((k) => [k, SERVER_TIMESTAMP])) });

  return {
    /** `HabitRepository.newHabitId`. */
    newHabitId: (): string => writer.newId(`${root}/habits`),

    /** `createHabit`: the document plus `createdAt` and `updatedAt`. Creates only the new habit's own document. */
    create: (id: string, habit: Habit): Promise<void> => {
      const fields = habitCreateFields(habit, now());
      // Never send a malformed or oversized habit (the same bounds as the Firestore rules): the caller undoes its local change and tells the user.
      try {
        assertValidHabitFields(fields);
      } catch (e) {
        return Promise.reject(e);
      }
      return writer.set(habitPath(id), stamp(fields, 'createdAt', 'updatedAt'));
    },

    /** `updateHabit`: merges the fields and refreshes `updatedAt`. An empty change writes nothing. */
    update: async (id: string, fields: FieldMap): Promise<void> => {
      if (Object.keys(fields).length === 0) return;
      assertValidHabitFields(fields);
      await writer.update(habitPath(id), stamp(fields, 'updatedAt'));
    },

    /**
     * `HabitRepository.setCompletion`: records a check or uncheck of [date] (yyyy-MM-dd) in ONE batch. Unchecking keeps the
     * `completions/{date}` document with `completed = false` so the history of changes is preserved; the legacy
     * `completedDates` array is kept in sync, and the derived `streak` / `bestStreak` are persisted as Android does.
     * The document id is the date, so a date can never have two completion records.
     */
    setCompletion: (habitId: string, date: string, completed: boolean, streak: { current: number; best: number }): Promise<void> => {
      if (!parseKey(date)) return Promise.reject(new Error(`Invalid completion date: ${date}`));
      return writer.batch([
        {
          kind: 'set',
          merge: true,
          path: `${habitPath(habitId)}/completions/${date}`,
          fields: { date, completed, updatedAt: SERVER_TIMESTAMP, [completed ? 'completedAt' : 'uncheckedAt']: SERVER_TIMESTAMP },
        },
        {
          kind: 'update',
          path: habitPath(habitId),
          fields: { streak: streak.current, bestStreak: streak.best, completedDates: completed ? arrayUnion(date) : arrayRemove(date), updatedAt: SERVER_TIMESTAMP },
        },
      ]);
    },

    /**
     * `deleteHabit`: Firestore does not cascade, so the habit's day notes and its completion records are removed with it.
     * Notes (found by `habitId`) go in their own batch; the completions and then the habit document go together in one
     * batch (the habit last). Wallet records (transactions, rewards, freezes) are left alone, as on Android.
     */
    remove: async (id: string): Promise<void> => {
      const deleteNotes = async () => {
        const notes: RawDoc[] = await reader.listDocs(`${root}/dayNotes`);
        const paths = notes.filter((n) => n.data.habitId === id).map((n) => `${root}/dayNotes/${n.id}`);
        for (const part of chunk(paths, BATCH_LIMIT)) await writer.deleteMany(part);
      };
      const deleteHabitAndCompletions = async () => {
        const completions = (await reader.listDocs(`${root}/habits/${id}/completions`)).map((c) => `${root}/habits/${id}/completions/${c.id}`);
        // Normally one batch; a habit with more than a batch of completions has the surplus removed first.
        const parts = chunk(completions, BATCH_LIMIT);
        const last = parts.pop() ?? [];
        for (const part of parts) await writer.deleteMany(part);
        await writer.deleteMany([...last, habitPath(id)]);
      };
      const results = await Promise.allSettled([deleteNotes(), deleteHabitAndCompletions()]);
      const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
    },
  };
}
