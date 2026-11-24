/**
 * Phase 11E: Part B validation, field by field, in the local Firestore EMULATOR only (demo- project ids).
 * Every case is run as a CREATE of a full habit and as an UPDATE of a stored valid habit (the update is what Android does on every
 * check-in, edit and reorder), under all four rule sets. Valid values must be accepted by all four; an invalid value must be refused
 * by Part B and A+B, and accepted (it is not Part B's job) by the rules in force and Part A.
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { arrayUnion, deleteDoc, doc, getDoc, serverTimestamp as ts, setDoc, setLogLevel, Timestamp, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ALL_SETS, RULESETS, WITH_B } from './rulesets';

setLogLevel('silent');
const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const UID = 'user-a';
const U = `users/${UID}`;
const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`;
const stored = {
  name: 'Read', color: 4281583945, daysPerWeek: 5, restDays: ['Sat', 'Sun'], createdDate: '2026-11-01', streak: 3, bestStreak: 7, sortOrder: 1_700_000_000_000,
  scheduleHistory: [{ from: '2026-11-01', restDays: ['Sat', 'Sun'], daysPerWeek: 5 }], completedDates: [day(1), day(2)], archived: false, goal: 'Daily', why: 'Calm',
  reminderEnabled: true, reminderTime: '07:30', createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
};
const many = <T,>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));

type Case = { name: string; patch: Record<string, unknown>; valid: boolean };
const HABIT_CASES: Case[] = [
  // name
  { name: 'name: one character', patch: { name: 'x' }, valid: true },
  { name: 'name: 1000 characters (the bound)', patch: { name: 'x'.repeat(1000) }, valid: true },
  { name: 'name: 300 characters (legacy long name)', patch: { name: 'x'.repeat(300) }, valid: true },
  { name: 'name: empty', patch: { name: '' }, valid: false },
  { name: 'name: 1001 characters', patch: { name: 'x'.repeat(1001) }, valid: false },
  { name: 'name: a number', patch: { name: 5 }, valid: false },
  // colour
  { name: 'colour: a positive 32-bit ARGB number (Android Long)', patch: { color: 4294967295 }, valid: true },
  { name: 'colour: a negative number (signed Int ARGB)', patch: { color: -16711936 }, valid: true },
  { name: 'colour: a string', patch: { color: '#00ff00' }, valid: false },
  { name: 'colour: null', patch: { color: null }, valid: false },
  // days per week
  { name: 'daysPerWeek: 1', patch: { daysPerWeek: 1 }, valid: true },
  { name: 'daysPerWeek: 7', patch: { daysPerWeek: 7 }, valid: true },
  { name: 'daysPerWeek: 0', patch: { daysPerWeek: 0 }, valid: false },
  { name: 'daysPerWeek: 8', patch: { daysPerWeek: 8 }, valid: false },
  { name: 'daysPerWeek: 3.5', patch: { daysPerWeek: 3.5 }, valid: false },
  { name: 'daysPerWeek: a string', patch: { daysPerWeek: '5' }, valid: false },
  // rest days
  { name: 'restDays: empty', patch: { restDays: [], daysPerWeek: 7 }, valid: true },
  { name: 'restDays: seven days', patch: { restDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], daysPerWeek: 1 }, valid: true },
  { name: 'restDays: eight entries', patch: { restDays: many(8, () => 'Mon') }, valid: false },
  { name: 'restDays: a string instead of a list', patch: { restDays: 'Sat' }, valid: false },
  // goal and why
  { name: 'goal: cleared with an empty string (Android clears this way)', patch: { goal: '' }, valid: true },
  { name: 'goal: 1000 characters', patch: { goal: 'g'.repeat(1000) }, valid: true },
  { name: 'goal: 1001 characters', patch: { goal: 'g'.repeat(1001) }, valid: false },
  { name: 'goal: a number', patch: { goal: 1 }, valid: false },
  { name: 'why: 1001 characters', patch: { why: 'w'.repeat(1001) }, valid: false },
  // reminder
  { name: 'reminder: on at 00:00', patch: { reminderEnabled: true, reminderTime: '00:00' }, valid: true },
  { name: 'reminder: on at 23:59', patch: { reminderEnabled: true, reminderTime: '23:59' }, valid: true },
  { name: 'reminder: off, time kept (Android keeps the time while off)', patch: { reminderEnabled: false, reminderTime: '09:00' }, valid: true },
  { name: 'reminder: off, time null (Web)', patch: { reminderEnabled: false, reminderTime: null }, valid: true },
  { name: 'reminder: time 7:30 without the leading zero', patch: { reminderTime: '7:30' }, valid: false },
  { name: 'reminder: time 24:00', patch: { reminderTime: '24:00' }, valid: false },
  { name: 'reminder: time 12:60', patch: { reminderTime: '12:60' }, valid: false },
  { name: 'reminder: time with seconds', patch: { reminderTime: '07:30:00' }, valid: false },
  { name: 'reminder: enabled as a string', patch: { reminderEnabled: 'yes' }, valid: false },
  // created date
  { name: 'createdDate: a valid date', patch: { createdDate: '2024-02-29' }, valid: true },
  { name: 'createdDate: day-first format', patch: { createdDate: '29/02/2024' }, valid: false },
  { name: 'createdDate: month without a zero', patch: { createdDate: '2026-1-5' }, valid: false },
  { name: 'createdDate: a number', patch: { createdDate: 20260101 }, valid: false },
  // schedule history
  { name: 'scheduleHistory: empty list', patch: { scheduleHistory: [] }, valid: true },
  { name: 'scheduleHistory: 2000 periods (the bound)', patch: { scheduleHistory: many(2000, (i) => ({ from: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`, restDays: [], daysPerWeek: 7 })) }, valid: true },
  { name: 'scheduleHistory: 2001 periods', patch: { scheduleHistory: many(2001, () => ({ from: '2026-01-01', restDays: [], daysPerWeek: 7 })) }, valid: false },
  { name: 'scheduleHistory: not a list', patch: { scheduleHistory: { from: '2026-01-01' } }, valid: false },
  // archive status
  { name: 'archived: true', patch: { archived: true }, valid: true },
  { name: 'archived: false', patch: { archived: false }, valid: true },
  { name: 'archived: the string "true"', patch: { archived: 'true' }, valid: false },
  // sort order and counters
  { name: 'sortOrder: a reorder index', patch: { sortOrder: 0 }, valid: true },
  { name: 'sortOrder: a millisecond timestamp', patch: { sortOrder: 1_800_000_000_000 }, valid: true },
  { name: 'sortOrder: a string', patch: { sortOrder: 'first' }, valid: false },
  { name: 'streak: a string', patch: { streak: '3' }, valid: false },
  { name: 'bestStreak: a string', patch: { bestStreak: '7' }, valid: false },
  // completed dates (legacy array)
  { name: 'completedDates: 20000 entries (the bound)', patch: { completedDates: many(20000, (i) => `d${i}`) }, valid: true },
  { name: 'completedDates: 20001 entries', patch: { completedDates: many(20001, (i) => `d${i}`) }, valid: false },
  { name: 'completedDates: not a list', patch: { completedDates: day(1) }, valid: false },
  // import fields and timestamps
  { name: 'rewardsIgnoredThrough: a valid date', patch: { rewardsIgnoredThrough: '2026-11-10' }, valid: true },
  { name: 'rewardsIgnoredThrough: a bad date', patch: { rewardsIgnoredThrough: '10-11-2026' }, valid: false },
  { name: 'migratedFrom: a tag', patch: { migratedFrom: 'mig:abc' }, valid: true },
  { name: 'migratedFrom: 201 characters', patch: { migratedFrom: 'm'.repeat(201) }, valid: false },
  { name: 'createdAt: a Timestamp (guest import)', patch: { createdAt: Timestamp.fromMillis(1_700_000_000_000) }, valid: true },
  { name: 'createdAt: a server timestamp (create, Web and Android)', patch: { createdAt: ts() }, valid: true },
  { name: 'createdAt: a number (timestamp types are deliberately not checked)', patch: { createdAt: 1_700_000_000_000 }, valid: true },
  { name: 'updatedAt: a string (timestamp types are deliberately not checked)', patch: { updatedAt: 'now' }, valid: true },
  // field count
  { name: 'fields: 41 keys in total', patch: Object.fromEntries(many(30, (i) => [`extra${i}`, i] as [string, number])), valid: false },
  { name: 'fields: an unknown extra field (Android and Web tolerate them)', patch: { somethingNew: 1 }, valid: true },
];

const COMPLETION_CASES: (Case & { id?: string })[] = [
  { name: 'check: date, completed, updatedAt, completedAt (Android)', patch: { date: day(5), completed: true, updatedAt: ts(), completedAt: ts() }, valid: true },
  { name: 'uncheck: completed false with uncheckedAt (Android keeps the record)', patch: { date: day(5), completed: false, updatedAt: ts(), uncheckedAt: ts() }, valid: true },
  { name: 'migrated: Timestamp fields', patch: { date: day(5), completed: true, updatedAt: Timestamp.now(), completedAt: Timestamp.now() }, valid: true },
  { name: 'legacy: only completed (no date field)', patch: { completed: true }, valid: true },
  { name: 'legacy: only date and completed', patch: { date: day(5), completed: true }, valid: true },
  { name: 'date field that differs from the id', patch: { date: day(6), completed: true }, valid: false },
  { name: 'completed as a string', patch: { date: day(5), completed: 'true' }, valid: false },
  { name: 'one extra field (tolerated since Phase 11G)', patch: { date: day(5), completed: true, note: 'x' }, valid: true },
  { name: 'ten fields in all (the bound)', patch: { date: day(5), completed: true, updatedAt: ts(), completedAt: ts(), uncheckedAt: ts(), e1: 1, e2: 2, e3: 3, e4: 4, e5: 5 }, valid: true },
  { name: 'eleven fields', patch: { date: day(5), completed: true, updatedAt: ts(), completedAt: ts(), uncheckedAt: ts(), e1: 1, e2: 2, e3: 3, e4: 4, e5: 5, e6: 6 }, valid: false },
  { name: 'updatedAt as a number (timestamp types are deliberately not checked)', patch: { date: day(5), completed: true, updatedAt: 1700000000000 }, valid: true },
  { name: 'completedAt as a string (timestamp types are deliberately not checked)', patch: { date: day(5), completed: true, completedAt: 'today' }, valid: true },
  { name: 'uncheckedAt as a number (timestamp types are deliberately not checked)', patch: { date: day(5), completed: false, uncheckedAt: 5 }, valid: true },
  { name: 'a document id that is not a date', id: 'yesterday', patch: { completed: true }, valid: false },
  { name: 'a document id with a single-digit month', id: '2026-1-05', patch: { completed: true }, valid: false },
];

/** `all`: the rules in force already refuse it, so every rule set does. */
const NOTE_CASES: { name: string; id?: string; data: Record<string, unknown>; valid: boolean; all?: boolean }[] = [
  { name: 'Android save (merge, without createdAt)', data: { habitId: 'h1', date: day(5), text: 'felt good', updatedAt: ts() }, valid: true },
  { name: 'Android migrated note (with createdAt and updatedAt Timestamps)', data: { habitId: 'h1', date: day(5), text: 'felt good', createdAt: Timestamp.now(), updatedAt: Timestamp.now() }, valid: true },
  { name: 'text: exactly 200 characters', data: { habitId: 'h1', date: day(5), text: 't'.repeat(200), updatedAt: ts() }, valid: true },
  { name: 'text: 201 characters', data: { habitId: 'h1', date: day(5), text: 't'.repeat(201), updatedAt: ts() }, valid: false, all: true },
  { name: 'text: empty', data: { habitId: 'h1', date: day(5), text: '', updatedAt: ts() }, valid: false, all: true },
  { name: 'text: a number', data: { habitId: 'h1', date: day(5), text: 5, updatedAt: ts() }, valid: false, all: true },
  { name: 'id that does not match habitId_date', id: 'h2_' + day(5), data: { habitId: 'h1', date: day(5), text: 'x', updatedAt: ts() }, valid: false, all: true },
  { name: 'habitId missing', id: 'undefined_' + day(5), data: { date: day(5), text: 'x' }, valid: false, all: true },
  { name: 'date in a bad format (id follows the data)', id: 'h1_5-11-2026', data: { habitId: 'h1', date: '5-11-2026', text: 'x', updatedAt: ts() }, valid: false },
  { name: 'one extra field (tolerated since Phase 11G)', data: { habitId: 'h1', date: day(5), text: 'x', mood: 'ok', updatedAt: ts() }, valid: true },
  { name: 'ten fields in all (the bound)', data: { habitId: 'h1', date: day(5), text: 'x', createdAt: ts(), updatedAt: ts(), e1: 1, e2: 2, e3: 3, e4: 4, e5: 5 }, valid: true },
  { name: 'eleven fields', data: { habitId: 'h1', date: day(5), text: 'x', createdAt: ts(), updatedAt: ts(), e1: 1, e2: 2, e3: 3, e4: 4, e5: 5, e6: 6 }, valid: false },
  { name: 'habitId that is not text', id: '5_' + day(5), data: { habitId: 5, date: day(5), text: 'x' }, valid: false, all: true },
  { name: 'updatedAt as a string (timestamp types are deliberately not checked)', data: { habitId: 'h1', date: day(5), text: 'x', updatedAt: 'now' }, valid: true },
];

for (const rs of ALL_SETS) {
  const hasB = WITH_B.includes(rs);
  const verdict = (valid: boolean) => (valid || !hasB ? 'accepted' : 'REFUSED');

  run(`Part B validation [${rs}]`, () => {
    let env: RulesTestEnvironment;
    const as = () => env.authenticatedContext(UID).firestore() as unknown as Firestore;
    const seed = (path: string, data: Record<string, unknown>) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore() as unknown as Firestore, path), data));
    const outcome = (p: Promise<unknown>) => p.then(() => 'accepted', () => 'REFUSED');

    beforeAll(async () => {
      env = await initializeTestEnvironment({ projectId: `demo-consisto-partb-${rs.toLowerCase()}`, firestore: { rules: RULESETS[rs] } });
    });
    afterAll(async () => {
      await env?.cleanup();
    });

    describe('habits', () => {
      for (const c of HABIT_CASES) {
        it(`create, ${c.name}: ${verdict(c.valid)}`, async () => {
          await env.clearFirestore();
          expect(await outcome(setDoc(doc(as(), `${U}/habits/h1`), { ...stored, ...c.patch, createdAt: (c.patch.createdAt as unknown) ?? ts(), updatedAt: (c.patch.updatedAt as unknown) ?? ts() }))).toBe(verdict(c.valid));
        });
        it(`update of a stored valid habit, ${c.name}: ${verdict(c.valid)}`, async () => {
          await env.clearFirestore();
          await seed(`${U}/habits/h1`, stored);
          expect(await outcome(updateDoc(doc(as(), `${U}/habits/h1`), c.patch))).toBe(verdict(c.valid));
        });
      }
      it('an update that touches nothing invalid (Android reorder: sortOrder only) is accepted on a stored valid habit', async () => {
        await env.clearFirestore();
        await seed(`${U}/habits/h1`, stored);
        expect(await outcome(updateDoc(doc(as(), `${U}/habits/h1`), { sortOrder: 3 }))).toBe('accepted');
      });
      it('archive then unarchive (Android writes only the archived flag) is accepted; deleting an archived habit is accepted', async () => {
        await env.clearFirestore();
        await seed(`${U}/habits/h1`, { ...stored, archived: false });
        const d = doc(as(), `${U}/habits/h1`);
        expect(await outcome(updateDoc(d, { archived: true }))).toBe('accepted');
        expect(await outcome(updateDoc(d, { archived: false, updatedAt: ts() }))).toBe('accepted');
        expect(await outcome(updateDoc(d, { archived: true }))).toBe('accepted');
        expect(await outcome(deleteDoc(d))).toBe('accepted');
      });
    });


    // Phase 11F: what a stored document that breaks a Part B bound does to Android's real batches.
    describe('a stored invalid document and Android batches (Part B only; the other sets accept all of these)', () => {
      const bad = { ...stored, name: 'x'.repeat(1500) }; // a stored habit over the 1,000-character bound
      it('reorder: ONE invalid habit among three makes the whole reorder batch fail, so no habit moves', async () => {
        await env.clearFirestore();
        await seed(`${U}/habits/h1`, { ...stored, sortOrder: 11 });
        await seed(`${U}/habits/h2`, { ...bad, sortOrder: 12 });
        await seed(`${U}/habits/h3`, { ...stored, sortOrder: 13 });
        const db = as();
        const b = writeBatch(db);
        ['h3', 'h1', 'h2'].forEach((id, i) => b.update(doc(db, `${U}/habits/${id}`), { sortOrder: i }));
        expect(await outcome(b.commit())).toBe(hasB ? 'REFUSED' : 'accepted');
        let orders: unknown[] = [];
        await env.withSecurityRulesDisabled(async (c) => {
          const d = c.firestore() as unknown as Firestore;
          orders = await Promise.all(['h1', 'h2', 'h3'].map(async (id) => (await getDoc(doc(d, `${U}/habits/${id}`))).data()?.sortOrder));
        });
        expect(orders).toEqual(hasB ? [11, 12, 13] : [1, 2, 0]);
      });
      it('check-in on the invalid habit: the batch (completion + habit update) fails as a whole, so no completion document is written', async () => {
        await env.clearFirestore();
        await seed(`${U}/habits/h2`, bad);
        const db = as();
        const b = writeBatch(db);
        b.set(doc(db, `${U}/habits/h2/completions/${day(9)}`), { date: day(9), completed: true, updatedAt: ts(), completedAt: ts() }, { merge: true });
        b.update(doc(db, `${U}/habits/h2`), { completedDates: arrayUnion(day(9)), streak: 4, bestStreak: 7, updatedAt: ts() });
        expect(await outcome(b.commit())).toBe(hasB ? 'REFUSED' : 'accepted');
        let written = false;
        await env.withSecurityRulesDisabled(async (c) => {
          written = (await getDoc(doc(c.firestore() as unknown as Firestore, `${U}/habits/h2/completions/${day(9)}`))).exists();
        });
        expect(written).toBe(!hasB);
      });
      it('the invalid habit can still be DELETED with its completions (so a user is never locked out, but history is lost)', async () => {
        await env.clearFirestore();
        await seed(`${U}/habits/h2`, bad);
        await seed(`${U}/habits/h2/completions/${day(9)}`, { date: day(9), completed: true });
        const db = as();
        const b = writeBatch(db);
        b.delete(doc(db, `${U}/habits/h2/completions/${day(9)}`));
        b.delete(doc(db, `${U}/habits/h2`));
        expect(await outcome(b.commit())).toBe('accepted');
      });
      it('a habit whose invalid value is FIXED by the update is accepted (the update that repairs it is not blocked)', async () => {
        await env.clearFirestore();
        await seed(`${U}/habits/h2`, bad);
        expect(await outcome(updateDoc(doc(as(), `${U}/habits/h2`), { name: 'Short name' }))).toBe('accepted');
      });
    });
    describe('completions', () => {
      for (const c of COMPLETION_CASES) {
        it(`create, ${c.name}: ${verdict(c.valid)}`, async () => {
          await env.clearFirestore();
          expect(await outcome(setDoc(doc(as(), `${U}/habits/h1/completions/${c.id ?? day(5)}`), c.patch))).toBe(verdict(c.valid));
        });
        it(`merge-update of a stored completion, ${c.name}: ${verdict(c.valid)}`, async () => {
          await env.clearFirestore();
          await seed(`${U}/habits/h1/completions/${c.id ?? day(5)}`, { date: c.id ?? day(5), completed: true });
          expect(await outcome(setDoc(doc(as(), `${U}/habits/h1/completions/${c.id ?? day(5)}`), c.patch, { merge: true }))).toBe(verdict(c.valid));
        });
      }
      it('required field: a completion CREATED without `completed` is refused by Part B; a merge that leaves a stored `completed` in place is accepted', async () => {
        await env.clearFirestore();
        expect(await outcome(setDoc(doc(as(), `${U}/habits/h1/completions/${day(5)}`), { date: day(5), updatedAt: ts() }))).toBe(verdict(false));
        await seed(`${U}/habits/h1/completions/${day(6)}`, { date: day(6), completed: true });
        expect(await outcome(setDoc(doc(as(), `${U}/habits/h1/completions/${day(6)}`), { updatedAt: ts() }, { merge: true }))).toBe('accepted');
      });
      it('history is preserved: a stored check is turned into an uncheck record, never deleted by the apps; a deletion is accepted (habit deletion removes them)', async () => {
        await env.clearFirestore();
        await seed(`${U}/habits/h1/completions/${day(5)}`, { date: day(5), completed: true, completedAt: Timestamp.now(), updatedAt: Timestamp.now() });
        const d = doc(as(), `${U}/habits/h1/completions/${day(5)}`);
        expect(await outcome(setDoc(d, { date: day(5), completed: false, updatedAt: ts(), uncheckedAt: ts() }, { merge: true }))).toBe('accepted');
        expect(await outcome(deleteDoc(d))).toBe('accepted');
      });
    });

    describe('day notes', () => {
      for (const c of NOTE_CASES) {
        const id = c.id ?? `h1_${day(5)}`;
        it(`create, ${c.name}: ${c.all ? 'REFUSED' : verdict(c.valid)}`, async () => {
          await env.clearFirestore();
          expect(await outcome(setDoc(doc(as(), `${U}/dayNotes/${id}`), c.data, { merge: true }))).toBe(c.all ? 'REFUSED' : verdict(c.valid));
        });
      }
      it('editing a stored note (merge without createdAt) and deleting it are accepted', async () => {
        await env.clearFirestore();
        await seed(`${U}/dayNotes/h1_${day(5)}`, { habitId: 'h1', date: day(5), text: 'old', createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
        const d = doc(as(), `${U}/dayNotes/h1_${day(5)}`);
        expect(await outcome(setDoc(d, { habitId: 'h1', date: day(5), text: 'new', updatedAt: ts() }, { merge: true }))).toBe('accepted');
        expect(await outcome(deleteDoc(d))).toBe('accepted');
      });
    });
  });
}





