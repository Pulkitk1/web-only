/**
 * Day notes (android/.../data/DayNotes.kt): optional personal notes on a habit's days: completed days (a journal) and
 * missed or frozen days ("why did I miss this?"). One note per habit per date. Notes are reflection only: they never
 * affect streaks, rewards, freezes or analytics.
 */
import { isAfter, isBefore, type DateKey } from '@/utils/date';

export const NOTE_MAX_LENGTH = 200;

/** Notes keyed by habit id, then by yyyy-MM-dd (`NotesByHabit`). */
export type NotesByHabit = Record<string, Record<DateKey, string>>;

export const noteId = (habitId: string, date: DateKey) => `${habitId}_${date}`;

/**
 * Notes are offered on completed days (active or rest, today included) and on past active days that weren't completed,
 * i.e. missed days and days protected by a freeze. Not on uncompleted rest days, today before it is completed, future
 * days, or unrecorded days before the habit's `start` (its creation date; a completion recorded before it is a normal
 * completed day and can have a note).
 */
export function canHaveNote(date: DateKey, today: DateKey, isRest: boolean, isCompleted: boolean, start: DateKey | null = null): boolean {
  return !isAfter(date, today) && (isCompleted || start === null || !isBefore(date, start)) && (isCompleted || (isBefore(date, today) && !isRest));
}

/** Trimmed text to store (capped at 200), or null if there is nothing to save. */
export function normalizeNote(text: string): string | null {
  const t = text.trim().slice(0, NOTE_MAX_LENGTH);
  return t.length ? t : null;
}

export const NOTE_ERR_EMPTY = 'Write something to save a note';
export const NOTE_ERR_NOT_ALLOWED = 'Notes can only be added to completed, missed or frozen days';
export const NOTE_SAVED = '📝 Note saved';
export const NOTE_DELETED = '🗑️ Note deleted';

export type NoteOp = { ok: true; notes: NotesByHabit; message: string } | { ok: false; message: string };

/** Saves (creates or replaces) the note for a habit's day. Only the note is written. */
export function saveNote(notes: NotesByHabit, habitId: string, date: DateKey, text: string, allowed: boolean): NoteOp {
  const clean = normalizeNote(text);
  if (clean === null) return { ok: false, message: NOTE_ERR_EMPTY };
  if (!allowed) return { ok: false, message: NOTE_ERR_NOT_ALLOWED };
  return { ok: true, message: NOTE_SAVED, notes: { ...notes, [habitId]: { ...(notes[habitId] ?? {}), [date]: clean } } };
}

/** Deletes only the note for that day; the habit, its history and any freeze stay as they are. */
export function deleteNote(notes: NotesByHabit, habitId: string, date: DateKey): NoteOp {
  const forHabit = { ...(notes[habitId] ?? {}) };
  delete forHabit[date];
  return { ok: true, message: NOTE_DELETED, notes: { ...notes, [habitId]: forHabit } };
}

/** Removes every note of a habit (deleting a habit removes its day notes too). */
export function notesWithoutHabit(notes: NotesByHabit, habitId: string): NotesByHabit {
  const next = { ...notes };
  delete next[habitId];
  return next;
}
