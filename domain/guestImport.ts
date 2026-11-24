/**
 * Pure planning for the guest-to-account import (Phase 10): what the preview shows, which cloud ids the habits get, and the exact
 * documents to write. No storage, no network, no clock: everything that varies (ids, time) is passed in, so a retry that passes the
 * same migration id and id map produces the same documents.
 *
 * What is imported (decision 2): habits (name, colour, goal, reminder, weekly target, rest days, schedule history, archived), their
 * completion history, and their calendar notes. NOT imported: coins, wallet transactions, rewards, milestone records, streak freezes
 * and freeze usage. Nothing here can produce a wallet, reward or freeze document.
 *
 * Kotlin reference: `GuestMigrator.uploadFor` / `NoteUpload` (data/migration/GuestMigration.kt) and `FirestoreMigrationCloud`.
 * Documents (all under `users/{uid}`), matching what the Android app writes:
 *   habits/{cloudId}                        the habit (+ `migratedFrom`, the migration metadata of the Kotlin protocol)
 *   habits/{cloudId}/completions/{date}     one per checked day: date, completed, completedAt, updatedAt
 *   dayNotes/{cloudId}_{date}               habitId, date, text, createdAt, updatedAt
 */
import { habitCreateFields, scheduleHistoryToFirestore, type FieldMap } from '@/domain/cloudWrite';
import { DEFAULT_HABIT_COLOR, hexToComposeColor } from '@/domain/cloudMapping';
import { habitImportProblem } from '@/domain/habitLimits';
import { NOTE_MAX_LENGTH, noteId, type NotesByHabit } from '@/domain/notes';
import { scheduleOf, streakOf } from '@/domain/schedule';
import type { Habit } from '@/types/habit';
import { parseKey, type DateKey } from '@/utils/date';
import { SERVER_TIMESTAMP } from '@/services/habitWriter';

/** One row of the import preview. */
export type GuestHabitPreview = {
  id: string;
  name: string;
  color: string;
  checkIns: number;
  notes: number;
  archived: boolean;
  /** True only when the habit carries the explicit demo marker. An unmarked habit is never assumed to be genuine or demo. */
  sample: boolean;
  /** Why this habit cannot be imported (too large, or not valid), or null. It cannot be ticked while this is set. */
  problem: string | null;
};

const validNotes = (notes: NotesByHabit, habitId: string): [DateKey, string][] =>
  Object.entries(notes[habitId] ?? {})
    .filter(([date, text]) => parseKey(date) !== null && text.trim().length > 0)
    .sort(([a], [b]) => (a < b ? -1 : 1));

const checkedDates = (h: Habit): DateKey[] => [...new Set(h.completedDates.filter((d) => parseKey(d) !== null))].sort();

/** Every guest habit, in the guest's order. Nothing is selected: that is the user's choice. */
export function guestPreview(habits: readonly Habit[], notes: NotesByHabit): GuestHabitPreview[] {
  return habits.map((h) => ({
    id: h.id,
    name: h.name,
    color: h.color,
    checkIns: checkedDates(h).length,
    notes: validNotes(notes, h.id).length,
    archived: h.archived,
    sample: h.dataOrigin === 'demo',
    problem: habitImportProblem(h),
  }));
}

/** Guest data is worth offering when there is at least one habit (the wallet is never imported, so it doesn't count). */
export const hasImportableGuestData = (habits: readonly Habit[]): boolean => habits.length > 0;

/** The `migratedFrom` tag Kotlin writes: `{migrationId}:{guestHabitId}`. It keeps the original guest id. */
export const migrationTag = (migrationId: string, guestId: string) => `${migrationId}:${guestId}`;

const slug = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '_');

/**
 * Candidate cloud ids for a guest habit, in order: `{guestId}-m{migrationId[0..8]}`, then `...-1`, `...-2`. This is Kotlin's derived id
 * form. Unlike Kotlin the guest id is never used as is: web guest ids (`h1`, `local-3`) repeat across browsers, so the migration id
 * is always part of the cloud id.
 */
export const candidateCloudId = (guestId: string, migrationId: string, n: number): string =>
  `${slug(guestId)}-m${migrationId.replace(/-/g, '').slice(0, 8)}${n === 0 ? '' : `-${n}`}`;

export type ImportOp = { path: string; fields: FieldMap };

export type HabitImport = {
  guestId: string;
  cloudId: string;
  tag: string;
  habit: ImportOp;
  /** One per checked day. */
  completions: ImportOp[];
  dates: DateKey[];
};

export type NoteImport = { id: string; habitCloudId: string; date: DateKey; op: ImportOp };

export type ImportPlan = { habits: HabitImport[]; notes: NoteImport[] };

/** A deterministic timestamp for a day (local noon), so rewriting a document on retry writes identical values. */
const noonOf = (date: DateKey): Date => {
  const d = parseKey(date)!;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
};

/**
 * The documents to write for the selected habits. `idMap` maps every selected guest id to its cloud id (fixed by the migration record).
 * `now` orders the imported habits after the account's existing ones (`sortOrder`, as `habitCreateFields` does for a new habit);
 * `through` is the import day, used for the cached streak values only.
 */
export function planImport(args: {
  uid: string;
  habits: readonly Habit[];
  notes: NotesByHabit;
  selected: readonly string[];
  idMap: Readonly<Record<string, string>>;
  migrationId: string;
  now: number;
  through: DateKey;
}): ImportPlan {
  const { uid, notes, idMap, migrationId, now, through } = args;
  const root = `users/${uid}`;
  const chosen = new Set(args.selected);
  const habits: HabitImport[] = [];
  const noteOps: NoteImport[] = [];

  args.habits
    .filter((h) => chosen.has(h.id))
    .forEach((h, index) => {
      const cloudId = idMap[h.id];
      if (!cloudId) throw new Error(`No cloud id for guest habit ${h.id}`);
      const dates = checkedDates(h);
      const tag = migrationTag(migrationId, h.id);
      // The same fields a new habit gets on Android, with its own colour fallback instead of an error, then the import-specific ones.
      const color = hexToComposeColor(h.color) !== null ? h.color : DEFAULT_HABIT_COLOR;
      const base = habitCreateFields({ ...h, color }, now + index);
      // Streak values are the cached ones Android persists. Freezes are not imported, so they are computed without them.
      const st = streakOf(scheduleOf(h, []), through);
      const fields: FieldMap = {
        ...base,
        // The full schedule history, not just the creation period `habitCreateFields` writes for a new habit.
        scheduleHistory: scheduleHistoryFields(h),
        completedDates: dates,
        streak: st.current,
        bestStreak: st.best,
        createdAt: noonOf(h.createdDate),
        updatedAt: SERVER_TIMESTAMP,
        migratedFrom: tag,
        // Phase 10.1: the import date. Android and the Web both ignore this habit's days up to and including it for rewards, so imported
        // history can neither earn a reward nor take one the account already holds. Fixed by the migration record, so a retry writes the same date.
        rewardsIgnoredThrough: through,
        ...(h.archived ? { archived: true } : {}),
      };
      habits.push({
        guestId: h.id,
        cloudId,
        tag,
        habit: { path: `${root}/habits/${cloudId}`, fields },
        dates,
        completions: dates.map((date) => ({
          path: `${root}/habits/${cloudId}/completions/${date}`,
          fields: { date, completed: true, completedAt: noonOf(date), updatedAt: noonOf(date) },
        })),
      });
      for (const [date, rawText] of validNotes(notes, h.id)) {
        const text = rawText.trim().slice(0, NOTE_MAX_LENGTH);
        const id = noteId(cloudId, date);
        noteOps.push({ id, habitCloudId: cloudId, date, op: { path: `${root}/dayNotes/${id}`, fields: { habitId: cloudId, date, text, createdAt: noonOf(date), updatedAt: noonOf(date) } } });
      }
    });

  return { habits, notes: noteOps };
}

const scheduleHistoryFields = (h: Habit) => scheduleHistoryToFirestore(h.scheduleHistory.length > 0 ? h.scheduleHistory : [{ from: h.createdDate, restDays: h.restDays, daysPerWeek: h.daysPerWeek }]);

/** Splits `ops` into batches of at most `size` (Firestore allows 500 writes per batch; Kotlin uses 400). */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
