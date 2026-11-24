/**
 * Local bookkeeping for the guest-to-account import (Phase 10), the web equivalent of Kotlin's `MigrationRecord` in the guest
 * database's `local_meta` table. It lives under its own localStorage key, so the guest data envelope (`appStorage`) is never
 * touched, and it is never written to Firestore.
 *
 * Kotlin keys (GuestMigration.kt): `migration.id`, `migration.uid`, `migration.step`, `migration.completedUid`,
 * `migration.completedAt`. Differences, all because the web import lets the user choose habits and may be started for more than one
 * account before it is finished:
 *   - one record PER account (`records[uid]`), so an unfinished import to account A is never overwritten by signing in to account B;
 *   - the record also keeps the chosen habits and the guest-id -> cloud-id map, so a retry can never pick different ids;
 *   - `declined` remembers accounts for which the user chose "Start with my existing account" (the prompt is not shown again).
 *
 * The import date (`through`) is fixed by the record and written to every imported habit as `rewardsIgnoredThrough`, so retries write the
 * same value; the reward rules read it from the habit document (on Android and the Web), not from this device.
 */
import { defaultStorage, type KeyValueStorage } from './devicePrefs';
import type { DateKey } from '@/utils/date';

export const MIGRATION_KEY = 'consisto_guest_migration';

/** Kotlin `MigrationStep` (NotStarted is the absence of a record; Completed is `completed`). */
export type MigrationStep = 'preparing' | 'uploading' | 'verifying' | 'failed' | 'completed';

export type MigrationRecord = {
  /** Stable for the whole import (and every retry); part of every cloud id and every `migratedFrom` tag. */
  id: string;
  uid: string;
  step: MigrationStep;
  /** Guest habit ids the user chose. Fixed once the record exists. */
  selected: string[];
  /** Guest habit id -> cloud habit id. Empty until prepared; fixed afterwards. */
  idMap: Record<string, string>;
  /** The day the import was prepared: guest history up to and including it never earns or removes rewards. */
  through: DateKey;
  startedAt: number;
};

type Stored = {
  version: 1;
  records: Record<string, MigrationRecord>;
  /** The account the guest data was imported to. After this the guest data can't be imported again. */
  completed: { uid: string; at: string; habits: number } | null;
  declined: string[];
};

const empty = (): Stored => ({ version: 1, records: {}, completed: null, declined: [] });

const isStr = (v: unknown): v is string => typeof v === 'string';
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const STEPS = new Set<string>(['preparing', 'uploading', 'verifying', 'failed', 'completed']);

function cleanRecord(v: unknown): MigrationRecord | null {
  if (!isObj(v) || !isStr(v.id) || !isStr(v.uid) || !isStr(v.step) || !STEPS.has(v.step) || !isStr(v.through)) return null;
  if (!Array.isArray(v.selected) || !v.selected.every(isStr) || !isObj(v.idMap)) return null;
  const idMap: Record<string, string> = {};
  for (const [k, id] of Object.entries(v.idMap)) if (isStr(id)) idMap[k] = id;
  return { id: v.id, uid: v.uid, step: v.step as MigrationStep, selected: v.selected as string[], idMap, through: v.through, startedAt: typeof v.startedAt === 'number' ? v.startedAt : 0 };
}

export function createMigrationStore(storage: KeyValueStorage = defaultStorage()) {
  const read = (): Stored => {
    try {
      const raw = storage.getItem(MIGRATION_KEY);
      if (raw === null) return empty();
      const v: unknown = JSON.parse(raw);
      if (!isObj(v) || v.version !== 1) return empty();
      const records: Record<string, MigrationRecord> = {};
      if (isObj(v.records)) for (const r of Object.values(v.records)) { const c = cleanRecord(r); if (c) records[c.uid] = c; }
      const c = v.completed;
      const completed = isObj(c) && isStr(c.uid) && isStr(c.at) ? { uid: c.uid, at: c.at, habits: typeof c.habits === 'number' ? c.habits : 0 } : null;
      return { version: 1, records, completed, declined: Array.isArray(v.declined) ? v.declined.filter(isStr) : [] };
    } catch {
      return empty();
    }
  };
  /** Returns false if it could not be saved (quota, private mode): the caller must then not continue with a step it cannot remember. */
  const write = (s: Stored): boolean => {
    try {
      storage.setItem(MIGRATION_KEY, JSON.stringify(s));
      return true;
    } catch {
      return false;
    }
  };
  const update = (fn: (s: Stored) => void): boolean => {
    const s = read();
    fn(s);
    return write(s);
  };

  return {
    record: (uid: string): MigrationRecord | null => read().records[uid] ?? null,

    /** The account the guest data was already imported to, if any (Kotlin `completedFor`). */
    completed: (): Stored['completed'] => read().completed,

    /** An unfinished import for [uid] that should be resumed (Kotlin `isPendingFor`). */
    isPendingFor(uid: string): boolean {
      const r = read();
      return r.completed === null && !!r.records[uid] && r.records[uid].step !== 'completed';
    },

    isDeclined: (uid: string): boolean => read().declined.includes(uid),

    /**
     * Returns the record for [uid], reusing an unfinished one so a retry keeps the same id, habits and ids (Kotlin `begin`). The chosen
     * habits are only used for a new record. Returns null if the record could not be saved.
     */
    begin(uid: string, selected: readonly string[], through: DateKey, newId: () => string, now: number): MigrationRecord | null {
      const existing = read().records[uid];
      if (existing && existing.step !== 'completed') return existing;
      const rec: MigrationRecord = { id: newId(), uid, step: 'preparing', selected: [...selected], idMap: {}, through, startedAt: now };
      return update((s) => { s.records[uid] = rec; s.declined = s.declined.filter((u) => u !== uid); }) ? rec : null;
    },

    setStep: (uid: string, step: MigrationStep): boolean => update((s) => { if (s.records[uid]) s.records[uid].step = step; }),

    /** Saves the id map once; it is never replaced afterwards, so a retry can't pick different ids for the same habit. */
    saveIdMap(uid: string, idMap: Record<string, string>): boolean {
      const existing = read().records[uid];
      if (existing && Object.keys(existing.idMap).length > 0) return true;
      return update((s) => { if (s.records[uid]) s.records[uid].idMap = { ...idMap }; });
    },

    /** Kotlin `complete`: the guest data can never be imported again. */
    complete(uid: string, habits: number, at: string): boolean {
      return update((s) => {
        if (s.records[uid]) s.records[uid].step = 'completed';
        s.completed = { uid, at, habits };
      });
    },

    /**
     * Kotlin `abandon`: forgets an import the user backed out of, but only if nothing was uploaded yet. Once uploading has started the
     * record stays, so a later retry recognises its own earlier uploads.
     */
    abandon(uid: string): void {
      update((s) => { if (s.records[uid]?.step === 'preparing') delete s.records[uid]; });
    },

    /** An account was deleted: forget everything this device remembers about it (its import record, its decline, a completed marker for it). */
    forget: (uid: string): boolean => update((s) => {
      delete s.records[uid];
      s.declined = s.declined.filter((u) => u !== uid);
      if (s.completed?.uid === uid) s.completed = null;
    }),

    /** "Start with my existing account": remembered so the prompt isn't shown again (Settings still offers the import). */
    decline: (uid: string): boolean => update((s) => { if (!s.declined.includes(uid)) s.declined.push(uid); }),
  };
}

export type MigrationStore = ReturnType<typeof createMigrationStore>;
export const migrationStore: MigrationStore = createMigrationStore();
