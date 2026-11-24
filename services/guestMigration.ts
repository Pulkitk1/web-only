/**
 * Guest -> account import (Phase 10): the web port of Kotlin's `GuestMigrator` (data/migration/GuestMigration.kt), limited to what
 * the product decision allows: habits and their history (schedules, completions, calendar notes). The wallet is never touched: this
 * file has no ledger, reward or freeze code, and the backend it writes through (`MigrationBackend`, scoped below) can only reach
 * habit, completion and day-note documents plus the one-time creation of a missing profile.
 *
 * Protocol (Kotlin order, each step idempotent, so an interrupted or failed run is resumed by running it again):
 *   1. Prepare    load or create the migration record (stable id, chosen habits), create the profile only if missing, fix the
 *                 guest-id -> cloud-id map (checking the server for collisions) and save it.
 *   2. Upload     the habit documents, then every completion document, in batches of 400 (Kotlin's size).
 *   3. Notes      day notes, keyed `{cloudHabitId}_{date}`, after the habits.
 *   4. Verify     read everything back FROM THE SERVER: habit + `migratedFrom` + schedule history, every completion date, every note.
 *   5. Complete   the marker is written only after verification succeeded; the guest data is never changed or deleted.
 * A habit already uploaded by an earlier attempt (its `migratedFrom` tag matches) is "ours": its habit document is not rewritten and only
 * missing completions/notes are added, so a retry can't overwrite anything the user changed in between.
 */
import { mapScheduleHistory, type RawDoc } from '@/domain/cloudMapping';
import type { FieldMap } from '@/domain/cloudWrite';
import { HABIT_LIMITS, habitImportProblem } from '@/domain/habitLimits';
import { candidateCloudId, chunk, hasImportableGuestData, migrationTag, planImport, type ImportOp } from '@/domain/guestImport';
import type { NotesByHabit } from '@/domain/notes';
import type { Habit } from '@/types/habit';
import { todayKey, type DateKey } from '@/utils/date';
import { SERVER_TIMESTAMP } from './habitWriter';
import type { MigrationStep, MigrationStore } from './guestMigrationStore';

/** Everything the import needs from Firestore. Reads must come from the server. */
export interface MigrationBackend {
  /** Creates `users/{uid}` (Kotlin's new-account fields) in one transaction, only if it doesn't exist. Never changes an existing profile. */
  ensureProfile(uid: string, email: string): Promise<'created' | 'exists'>;
  getDoc(path: string): Promise<RawDoc | null>;
  listDocs(collectionPath: string): Promise<RawDoc[]>;
  /** Writes whole documents in one atomic batch. */
  setMany(ops: ImportOp[]): Promise<void>;
}

/**
 * The profile a new account gets (Kotlin `AppViewModel.loadUser`, AppViewModel.kt:449): 20 coins, no freezes, and
 * `welcomeFreezePending`, which is how the account's one free Streak Freeze is still granted exactly once. The existing create rule
 * only accepts coins == 20 and freezesOwned == 0.
 */
export const newProfileFields = (email: string): FieldMap => ({
  email,
  displayName: email.split('@')[0],
  coins: 20,
  freezesOwned: 0,
  welcomeFreezePending: true,
  isDark: true,
  createdAt: SERVER_TIMESTAMP,
  updatedAt: SERVER_TIMESTAMP,
});

/** Restricts a backend to the documents the import may touch. Anything else is a programming error. */
export function scopedMigrationBackend(b: MigrationBackend, uid: string): MigrationBackend {
  if (!uid || uid.includes('/')) throw new Error('Invalid user id');
  const root = `users/${uid}`;
  const habit = new RegExp(`^${root}/habits/[^/]+$`);
  const completion = new RegExp(`^${root}/habits/[^/]+/completions/[^/]+$`);
  const note = new RegExp(`^${root}/dayNotes/[^/]+$`);
  const refuse = (what: string, path: string): never => {
    throw new Error(`Refusing to ${what} ${path}`);
  };
  return {
    ensureProfile: (u, email) => (u === uid ? b.ensureProfile(u, email) : refuse('create a profile for', u)),
    getDoc: (p) => (p === root || habit.test(p) || note.test(p) ? b.getDoc(p) : refuse('read', p)),
    listDocs: (p) => (p === `${root}/dayNotes` || new RegExp(`^${root}/habits/[^/]+/completions$`).test(p) ? b.listDocs(p) : refuse('list', p)),
    setMany: (ops) => {
      const bad = ops.find((o) => !(habit.test(o.path) || completion.test(o.path) || note.test(o.path)));
      return bad ? refuse('write', bad.path) : b.setMany(ops);
    },
  };
}

export type ImportErrorKind = 'offline' | 'denied' | 'verification' | 'busy' | 'storage' | 'invalid' | 'finished' | 'other';

export class ImportError extends Error {
  constructor(readonly kind: ImportErrorKind, message: string) {
    super(message);
  }
}

const codeOf = (e: unknown) => (typeof e === 'object' && e !== null && 'code' in e ? String((e as { code: unknown }).code) : '');

/** Turns whatever failed into a kind and a user-facing sentence. The guest data is always still on the device. */
export function importFailure(e: unknown): ImportError {
  if (e instanceof ImportError) return e;
  const code = codeOf(e);
  if (code === 'unavailable' || code === 'deadline-exceeded') return new ImportError('offline', "You're offline. Connect to the internet and try again.");
  if (code === 'permission-denied' || code === 'unauthenticated') return new ImportError('denied', "Your account isn't allowed to save this data (denied by the security rules).");
  return new ImportError('other', "Couldn't finish the import. Your guest data is still on this device. Please try again.");
}

export type ImportReport = { habits: number; checkIns: number; notes: number; profileCreated: boolean; resumed: boolean };

/** What the app should offer for an account (see `GuestImporter.offer`). */
export type ImportOffer =
  | { kind: 'none' } // no guest habits on this device
  | { kind: 'imported'; uid: string } // already imported (to this or another account): never again
  | { kind: 'resume' } // an unfinished import for this account
  | { kind: 'declined' } // the user chose "Start with my existing account": only Settings offers it
  | { kind: 'offer' };

export type GuestData = { habits: Habit[]; notes: NotesByHabit };

const BATCH = 400;
const WRITE_TIMEOUT_MS = 30_000;

export function createGuestImporter(deps: {
  backend: MigrationBackend;
  store: MigrationStore;
  /** A read-only snapshot of the guest data, or null if there is none. */
  guest: () => GuestData | null;
  newId?: () => string;
  now?: () => number;
  today?: () => DateKey;
  writeTimeoutMs?: number;
}) {
  const { store } = deps;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const now = deps.now ?? Date.now;
  const today = deps.today ?? todayKey;
  const timeout = deps.writeTimeoutMs ?? WRITE_TIMEOUT_MS;
  let running = false;

  const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const t = setTimeout(() => reject(Object.assign(new Error('timed out'), { code: 'deadline-exceeded' })), timeout);
      p.then(
        (v) => (clearTimeout(t), resolve(v)),
        (e) => (clearTimeout(t), reject(e)),
      );
    });

  return {
    /** What to show for [uid]: nothing, an offer, a resume, or (declined) only the Settings entry. */
    offer(uid: string): ImportOffer {
      const g = deps.guest();
      if (!g || !hasImportableGuestData(g.habits)) return { kind: 'none' };
      const done = store.completed();
      if (done) return { kind: 'imported', uid: done.uid };
      // A choice to start with the existing account is final for the automatic prompt, even if an earlier attempt was left unfinished.
      if (store.isDeclined(uid)) return { kind: 'declined' };
      if (store.isPendingFor(uid)) return { kind: 'resume' };
      return { kind: 'offer' };
    },

    /** Runs (or resumes) the import of [selected] guest habits into [uid]'s account. Throws an `ImportError`; the guest data is never modified. */
    async migrate(uid: string, email: string, selected: readonly string[], onStep: (s: MigrationStep) => void = () => {}): Promise<ImportReport> {
      if (running) throw new ImportError('busy', 'An import is already running.');
      running = true;
      let uploadStarted = false;
      try {
        const done = store.completed();
        if (done) throw new ImportError('finished', done.uid === uid ? 'This guest data was already imported to this account.' : 'This guest data was already imported to another account.');
        const guest = deps.guest();
        if (!guest || !hasImportableGuestData(guest.habits)) throw new ImportError('invalid', 'There is no guest data to import.');
        const backend = scopedMigrationBackend(deps.backend, uid);

        onStep('preparing');
        // A pending record fixes the habits and ids; a new one takes the user's choice.
        const pending = store.record(uid);
        const resumed = !!pending && pending.step !== 'completed';
        const choice = resumed ? pending!.selected : [...new Set(selected)];
        const known = new Set(guest.habits.map((h) => h.id));
        if (choice.length === 0 || !choice.every((id) => known.has(id))) throw new ImportError('invalid', 'Choose at least one habit to import.');
        // The guest data is editable by the user, so it is checked before anything is written: the same bounds as the Firestore rules.
        if (choice.length > HABIT_LIMITS.IMPORT_HABITS_MAX) throw new ImportError('invalid', `You can import up to ${HABIT_LIMITS.IMPORT_HABITS_MAX} habits at a time.`);
        const unfit = guest.habits.find((h) => choice.includes(h.id) && habitImportProblem(h) !== null);
        if (unfit) throw new ImportError('invalid', `"${unfit.name.slice(0, 40)}" can't be imported: ${habitImportProblem(unfit)}`);
        const rec = store.begin(uid, choice, today(), newId, now());
        if (!rec) throw new ImportError('storage', "This browser can't save the import's progress, so nothing was imported.");

        const profile = await backend.ensureProfile(uid, email);

        const habits = guest.habits.filter((h) => rec.selected.includes(h.id));
        if (Object.keys(rec.idMap).length === 0) {
          const used = new Set<string>();
          const idMap: Record<string, string> = {};
          for (const h of habits) {
            const tag = migrationTag(rec.id, h.id);
            for (let n = 0; ; n++) {
              const candidate = candidateCloudId(h.id, rec.id, n);
              if (used.has(candidate)) continue;
              const doc = await backend.getDoc(`users/${uid}/habits/${candidate}`);
              if (doc === null || doc.data.migratedFrom === tag) {
                idMap[h.id] = candidate;
                used.add(candidate);
                break;
              }
            }
          }
          if (!store.saveIdMap(uid, idMap)) throw new ImportError('storage', "This browser can't save the import's progress, so nothing was imported.");
        }
        const saved = store.record(uid)!;
        const plan = planImport({ uid, habits: guest.habits, notes: guest.notes, selected: rec.selected, idMap: saved.idMap, migrationId: rec.id, now: rec.startedAt, through: rec.through });

        onStep('uploading');
        store.setStep(uid, 'uploading');
        uploadStarted = true;
        const ops: ImportOp[] = [];
        let anyOurs = false;
        for (const h of plan.habits) {
          const existing = await backend.getDoc(h.habit.path);
          if (existing === null) {
            ops.push(h.habit, ...h.completions);
          } else if (existing.data.migratedFrom === h.tag) {
            anyOurs = true;
            const present = new Set((await backend.listDocs(`users/${uid}/habits/${h.cloudId}/completions`)).map((c) => c.id));
            ops.push(...h.completions.filter((c) => !present.has(c.fields.date as string)));
          } else {
            throw new ImportError('other', 'A habit id was taken while importing. Please try again.');
          }
        }
        // Notes follow the habits. On a retry, notes that already exist are left as they are.
        let noteOps = plan.notes;
        if (anyOurs && noteOps.length > 0) {
          const present = new Set((await backend.listDocs(`users/${uid}/dayNotes`)).map((n) => n.id));
          noteOps = noteOps.filter((n) => !present.has(n.id));
        }
        for (const part of chunk(ops, BATCH)) await withTimeout(backend.setMany(part));
        for (const part of chunk(noteOps.map((n) => n.op), BATCH)) await withTimeout(backend.setMany(part));

        onStep('verifying');
        store.setStep(uid, 'verifying');
        await verify(backend, uid, plan);

        const doneAt = new Date(now()).toISOString();
        if (!store.complete(uid, plan.habits.length, doneAt)) throw new ImportError('storage', "The import finished but this browser couldn't record it. Try again to finish.");
        onStep('completed');
        return { habits: plan.habits.length, checkIns: plan.habits.reduce((n, h) => n + h.dates.length, 0), notes: plan.notes.length, profileCreated: profile === 'created', resumed };
      } catch (e) {
        const err = importFailure(e);
        // Before any upload the record stays "preparing", so backing out can still forget it cleanly.
        if (uploadStarted) store.setStep(uid, 'failed');
        onStep('failed');
        throw err;
      } finally {
        running = false;
      }
    },

    /** "Start with my existing account": nothing is imported or written; the choice is remembered. */
    decline(uid: string) {
      store.abandon(uid);
      store.decline(uid);
    },
  };
}

export type GuestImporter = ReturnType<typeof createGuestImporter>;

/** Reads everything back from the server and compares it with what was meant to be written. Any mismatch fails the import (it can be retried). */
async function verify(backend: MigrationBackend, uid: string, plan: ReturnType<typeof planImport>): Promise<void> {
  const fail = (what: string): never => {
    throw new ImportError('verification', `Some of your data didn't arrive safely (${what}). Nothing was lost on this device. Please try again.`);
  };
  for (const h of plan.habits) {
    const doc = await backend.getDoc(h.habit.path);
    if (!doc) fail('a habit is missing');
    const data = doc!.data;
    if (data.migratedFrom !== h.tag) fail('a habit belongs to another habit');
    if (JSON.stringify(mapScheduleHistory(data.scheduleHistory)) !== JSON.stringify(mapScheduleHistory(h.habit.fields.scheduleHistory))) fail('a schedule history differs');
    const present = new Set((await backend.listDocs(`users/${uid}/habits/${h.cloudId}/completions`)).map((c) => c.id));
    if (h.dates.some((d) => !present.has(d))) fail('check-ins are missing');
  }
  for (const n of plan.notes) {
    const doc = await backend.getDoc(n.op.path);
    if (!doc) fail('a note is missing'); // existence only: a note edited in the account since an earlier attempt is the user's

  }
}
