/**
 * Persistence for the user's app data (habits, wallet ledger, day notes, id counter), behind one small interface.
 * Nothing outside this file touches the stored shape, and nothing outside `devicePrefs.ts`/this file touches
 * localStorage, so a later database layer can replace `createAppStorage`'s backing store without touching any screen.
 *
 * Format: one JSON envelope `{ version, savedAt, data }` under `consisto_app_data`.
 *  - Reads are defensive: anything that doesn't parse or doesn't look like our data is reported as `corrupt`, and the
 *    raw text is kept under `consisto_app_data_backup` (once) instead of being silently overwritten.
 *  - A newer `version` than this build understands is reported as `future` and the store is locked (never overwritten).
 *  - An older version is upgraded through `MIGRATIONS` (one function per step, oldest first) before it is validated.
 *
 * Only durable data lives here. Transient UI state (coin popup, wallet notice, celebration in progress) is not saved, so
 * a refresh can never replay it. Theme, notification switches, milestone queue and rest-day celebration markers keep
 * their own keys in `devicePrefs`.
 */
import type { LedgerState } from '@/domain/ledger';
import type { NotesByHabit } from '@/domain/notes';
import type { Habit } from '@/types/habit';
import { defaultStorage, type KeyValueStorage } from './devicePrefs';

export const STORAGE_KEY = 'consisto_app_data';
export const BACKUP_KEY = 'consisto_app_data_backup';
/** Bump when the stored shape changes, and add the upgrade step to `MIGRATIONS`. */
export const STORAGE_VERSION = 1;

/** Everything a session needs to restore: the AppStore's data plus the id counter (so ids are never reused). */
export type PersistedData = { habits: Habit[]; ledger: LedgerState; notes: NotesByHabit; nextId: number };

/** `MIGRATIONS[n]` turns version-n data into version n+1 data. Version 1 is the first stored version. */
export type Migration = (data: unknown) => unknown;
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export type LoadResult =
  | { status: 'empty' }
  | { status: 'ok'; data: PersistedData; version: number }
  | { status: 'corrupt'; reason: string }
  | { status: 'future'; version: number };

// ─── Validation (returns a clean copy, or a reason) ──────────────────────────

type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };
const fail = (reason: string): { ok: false; reason: string } => ({ ok: false, reason });
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isInt = (v: unknown, min = 0): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min;
const isKey = (v: unknown): v is string => isStr(v) && /^\d{4}-\d{2}-\d{2}$/.test(v);

function checkHabit(v: unknown, i: number): Checked<Habit> {
  if (!isObj(v)) return fail(`habit ${i} is not an object`);
  if (!isStr(v.id) || !v.id) return fail(`habit ${i} has no id`);
  if (!isStr(v.name) || !isStr(v.color)) return fail(`habit ${i} has no name/colour`);
  if (!Array.isArray(v.completedDates) || !v.completedDates.every(isKey)) return fail(`habit ${i} has bad completions`);
  if (!isInt(v.daysPerWeek, 1) || v.daysPerWeek > 7) return fail(`habit ${i} has a bad weekly target`);
  if (!isStrArr(v.restDays) || !isKey(v.createdDate)) return fail(`habit ${i} has bad rest days/created date`);
  if (!Array.isArray(v.scheduleHistory)) return fail(`habit ${i} has no schedule history`);
  for (const p of v.scheduleHistory) {
    if (!isObj(p) || !isKey(p.from) || !isStrArr(p.restDays) || !isInt(p.daysPerWeek, 1)) return fail(`habit ${i} has a bad schedule period`);
  }
  return {
    ok: true,
    value: {
      id: v.id,
      name: v.name,
      color: v.color,
      completedDates: [...new Set(v.completedDates as string[])],
      daysPerWeek: v.daysPerWeek,
      restDays: v.restDays,
      createdDate: v.createdDate,
      scheduleHistory: (v.scheduleHistory as Record<string, unknown>[]).map((p) => ({ from: p.from as string, restDays: p.restDays as string[], daysPerWeek: p.daysPerWeek as number })),
      archived: v.archived === true,
      goal: isStr(v.goal) ? v.goal : null,
      reminderEnabled: v.reminderEnabled === true,
      reminderTime: isStr(v.reminderTime) ? v.reminderTime : null,
      ...(v.dataOrigin === 'demo' ? { dataOrigin: 'demo' as const } : {}),
    },
  };
}

function checkLedger(v: unknown): Checked<LedgerState> {
  if (!isObj(v)) return fail('ledger is not an object');
  const w = v.wallet;
  if (!isObj(w) || !isInt(w.coins) || !isInt(w.freezesOwned) || !isInt(w.pending)) return fail('ledger wallet is invalid');
  if (!isObj(v.rewards)) return fail('ledger rewards are invalid');
  for (const [id, r] of Object.entries(v.rewards)) {
    if (!isObj(r) || r.id !== id || typeof r.active !== 'boolean' || !isInt(r.cycle) || !isInt(r.amount)) return fail(`reward ${id} is invalid`);
  }
  if (!isStrArr(v.txIds)) return fail('ledger txIds are invalid');
  if (!Array.isArray(v.transactions) || !v.transactions.every((t) => isObj(t) && isStr(t.id) && typeof t.coinDelta === 'number' && typeof t.freezeDelta === 'number' && typeof t.pendingDelta === 'number')) return fail('ledger transactions are invalid');
  if (!Array.isArray(v.freezes) || !v.freezes.every((f) => isObj(f) && isStr(f.habitId) && isKey(f.date) && isStr(f.paidWith))) return fail('ledger freezes are invalid');
  return { ok: true, value: { wallet: { coins: w.coins, freezesOwned: w.freezesOwned, pending: w.pending }, rewards: v.rewards as LedgerState['rewards'], txIds: v.txIds, transactions: v.transactions as LedgerState['transactions'], freezes: v.freezes as LedgerState['freezes'] } };
}

function checkNotes(v: unknown): Checked<NotesByHabit> {
  if (!isObj(v)) return fail('notes are not an object');
  const out: NotesByHabit = {};
  for (const [habitId, days] of Object.entries(v)) {
    if (!isObj(days)) return fail(`notes of ${habitId} are invalid`);
    out[habitId] = {};
    for (const [d, text] of Object.entries(days)) {
      if (!isKey(d) || !isStr(text)) return fail(`a note of ${habitId} is invalid`);
      out[habitId][d] = text;
    }
  }
  return { ok: true, value: out };
}

/** Validates the `data` part of an envelope; returns a clean copy. */
export function validateData(v: unknown): Checked<PersistedData> {
  if (!isObj(v)) return fail('data is not an object');
  if (!Array.isArray(v.habits)) return fail('habits are missing');
  const habits: Habit[] = [];
  for (let i = 0; i < v.habits.length; i++) {
    const h = checkHabit(v.habits[i], i);
    if (!h.ok) return h;
    habits.push(h.value);
  }
  if (new Set(habits.map((h) => h.id)).size !== habits.length) return fail('duplicate habit ids');
  const ledger = checkLedger(v.ledger);
  if (!ledger.ok) return ledger;
  const notes = checkNotes(v.notes ?? {});
  if (!notes.ok) return notes;
  if (!isInt(v.nextId, 1)) return fail('id counter is invalid');
  return { ok: true, value: { habits, ledger: ledger.value, notes: notes.value, nextId: v.nextId } };
}

// ─── The storage service ─────────────────────────────────────────────────────

export function createAppStorage(storage: KeyValueStorage = defaultStorage(), migrations: Readonly<Record<number, Migration>> = MIGRATIONS, currentVersion = STORAGE_VERSION) {
  /** Set when the stored data is from a newer build: we must not overwrite it. */
  let locked = false;

  const keepBackup = (raw: string) => {
    try {
      if (storage.getItem(BACKUP_KEY) === null) storage.setItem(BACKUP_KEY, raw);
    } catch {
      /* best effort */
    }
  };

  return {
    load(): LoadResult {
      let raw: string | null;
      try {
        raw = storage.getItem(STORAGE_KEY);
      } catch {
        return { status: 'empty' };
      }
      if (raw === null) return { status: 'empty' };
      let env: unknown;
      try {
        env = JSON.parse(raw);
      } catch {
        keepBackup(raw);
        return { status: 'corrupt', reason: 'not valid JSON' };
      }
      if (!isObj(env) || !isInt(env.version, 1) || !('data' in env)) {
        keepBackup(raw);
        return { status: 'corrupt', reason: 'not a Consisto data envelope' };
      }
      if (env.version > currentVersion) {
        locked = true;
        return { status: 'future', version: env.version };
      }
      let data: unknown = env.data;
      try {
        for (let v = env.version; v < currentVersion; v++) {
          const step = migrations[v];
          if (!step) throw new Error(`no migration from version ${v}`);
          data = step(data);
        }
      } catch (e) {
        keepBackup(raw);
        return { status: 'corrupt', reason: `migration failed: ${(e as Error).message}` };
      }
      const checked = validateData(data);
      if (!checked.ok) {
        keepBackup(raw);
        return { status: 'corrupt', reason: checked.reason };
      }
      return { status: 'ok', data: checked.value, version: env.version };
    },

    /** Writes the whole state. Returns false if it could not be saved (locked, quota, private mode). Never throws. */
    save(data: PersistedData): boolean {
      if (locked) return false;
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify({ version: currentVersion, savedAt: Date.now(), data }));
        return true;
      } catch {
        return false;
      }
    },

    /** Removes the saved data (and the corrupt-data backup): the next start begins from the mock data again. */
    clear() {
      locked = false;
      try {
        storage.removeItem(STORAGE_KEY);
        storage.removeItem(BACKUP_KEY);
      } catch {
        /* nothing to do */
      }
    },
  };
}

export type AppStorage = ReturnType<typeof createAppStorage>;

/** The app-wide instance, bound to localStorage. */
export const appStorage: AppStorage = createAppStorage();
