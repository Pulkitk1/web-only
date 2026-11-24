import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { hexToComposeColor, type RawDoc } from '@/domain/cloudMapping';
import { habitArchiveFields, habitCreateFields, habitEditFields, habitGoalFields, habitReminderFields, habitScheduleFields, scheduleHistoryToFirestore } from '@/domain/cloudWrite';
import { updateSchedule } from '@/domain/habitRules';
import type { DocReader } from '@/services/cloudRepository';
import { arrayRemove, arrayUnion, createHabitWriter, scopedWriter, SERVER_TIMESTAMP, type DocWriter } from '@/services/habitWriter';
import type { Habit } from '@/types/habit';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1', name: 'Read', color: '#60A5FA', completedDates: [], daysPerWeek: 5, restDays: ['Sun', 'Sat'], createdDate: '2026-11-21', scheduleHistory: [], archived: false, goal: null, reminderEnabled: false, reminderTime: null, ...over,
});

describe('create: the exact document Android writes (AppViewModel.addHabit)', () => {
  it('has exactly the Kotlin fields, no optional fields when unset', () => {
    const f = habitCreateFields(habit(), 1_700_000_000_000);
    expect(f).toEqual({
      name: 'Read',
      color: hexToComposeColor('#60A5FA'),
      completedDates: [],
      streak: 0,
      bestStreak: 0,
      daysPerWeek: 5,
      restDays: ['Sun', 'Sat'], // as chosen, like Kotlin's `restDays`
      createdDate: '2026-11-21',
      sortOrder: 1_700_000_000_000,
      scheduleHistory: [{ from: '2026-11-21', restDays: ['Sat', 'Sun'], daysPerWeek: 5 }], // week-ordered, like ScheduleHistory.toFirestore
    });
    expect(Object.keys(f)).not.toContain('goal');
    expect(Object.keys(f)).not.toContain('reminderEnabled');
    expect(Object.keys(f)).not.toContain('archived'); // Android only writes `archived` when toggled
  });
  it('writes goal and the reminder pair only when set / on', () => {
    expect(habitCreateFields(habit({ goal: 'Finish 12 books', reminderEnabled: true, reminderTime: '07:30' }), 1)).toMatchObject({ goal: 'Finish 12 books', reminderEnabled: true, reminderTime: '07:30' });
    const off = habitCreateFields(habit({ reminderEnabled: false, reminderTime: '07:30' }), 1);
    expect(off).not.toHaveProperty('reminderEnabled');
    expect(off).not.toHaveProperty('reminderTime');
    expect(habitCreateFields(habit({ reminderEnabled: true, reminderTime: null }), 1)).not.toHaveProperty('reminderEnabled');
  });
  it('the colour is the Compose-packed signed Long (negative for opaque colours)', () => {
    const f = habitCreateFields(habit({ color: '#F26B4E' }), 1);
    expect(f.color).toBe(Number(BigInt.asIntN(64, 0xfff26b4en << 32n)));
    expect(f.color as number).toBeLessThan(0);
    expect(() => habitCreateFields(habit({ color: 'red' }), 1)).toThrow();
  });
  it('unknown rest-day names are dropped from the history, recognised long names normalised', () => {
    expect(scheduleHistoryToFirestore([{ from: '2026-01-01', restDays: ['sunday', 'Mon', 'Funday'], daysPerWeek: 5 }])).toEqual([{ from: '2026-01-01', restDays: ['Mon', 'Sun'], daysPerWeek: 5 }]);
  });
});

describe('edit fields', () => {
  it('name and colour: only what changed', () => {
    expect(habitEditFields(habit(), habit({ name: 'Read more' }))).toEqual({ name: 'Read more' });
    expect(habitEditFields(habit(), habit({ color: '#F87171' }))).toEqual({ color: hexToComposeColor('#F87171') });
    expect(habitEditFields(habit(), habit({ name: 'X', color: '#F87171' }))).toEqual({ name: 'X', color: hexToComposeColor('#F87171') });
    expect(habitEditFields(habit(), habit())).toEqual({});
    expect(habitEditFields(habit(), habit({ color: '#60a5fa' }))).toEqual({}); // same colour, different case
  });
  it('goal: cleared is "" (never missing/null)', () => {
    expect(habitGoalFields(null)).toEqual({ goal: '' });
    expect(habitGoalFields('Run 5k')).toEqual({ goal: 'Run 5k' });
  });
  it('reminder: both fields, the time kept while off', () => {
    expect(habitReminderFields(false, '09:00')).toEqual({ reminderEnabled: false, reminderTime: '09:00' });
    expect(habitReminderFields(true, '07:30')).toEqual({ reminderEnabled: true, reminderTime: '07:30' });
  });
  it('archive: only the flag', () => {
    expect(habitArchiveFields(true)).toEqual({ archived: true });
    expect(habitArchiveFields(false)).toEqual({ archived: false });
  });
  it('schedule: new schedule from TOMORROW with the full history and re-derived streak values', () => {
    const before = habit({ daysPerWeek: 7, restDays: [], createdDate: '2026-11-01', completedDates: ['2026-11-01'], scheduleHistory: [] });
    const after = updateSchedule(before, 5, ['Sat', 'Sun'], '2026-11-21');
    const f = habitScheduleFields(after, { current: 3, best: 9 });
    expect(f).toEqual({
      daysPerWeek: 5,
      restDays: ['Sat', 'Sun'],
      scheduleHistory: [
        { from: '2026-11-01', restDays: [], daysPerWeek: 7 }, // the old schedule is recorded so the past is not reinterpreted
        { from: '2026-11-22', restDays: ['Sat', 'Sun'], daysPerWeek: 5 },
      ],
      streak: 3,
      bestStreak: 9,
    });
    // completions are never part of a schedule write
    expect(f).not.toHaveProperty('completedDates');
  });
});

/** A fake Firestore writer that records every call. */
function fakeWriter(failOn?: (call: string) => boolean) {
  const calls: { op: string; path?: string; paths?: string[]; fields?: Record<string, unknown> }[] = [];
  const writer: DocWriter = {
    newId: (c) => (calls.push({ op: 'newId', path: c }), 'new-id-1'),
    async set(path, fields) {
      calls.push({ op: 'set', path, fields });
      if (failOn?.('set')) throw Object.assign(new Error('x'), { code: 'permission-denied' });
    },
    async update(path, fields) {
      calls.push({ op: 'update', path, fields });
      if (failOn?.('update')) throw Object.assign(new Error('x'), { code: 'not-found' });
    },
    async deleteMany(paths) {
      calls.push({ op: 'deleteMany', paths });
      if (failOn?.('deleteMany:' + paths[0])) throw Object.assign(new Error('x'), { code: 'permission-denied' });
    },
    async batch(ops) {
      calls.push({ op: 'batch', paths: ops.map((o) => o.path), fields: Object.fromEntries(ops.map((o) => [o.path, o.fields])) });
      if (failOn?.('batch')) throw Object.assign(new Error('x'), { code: 'permission-denied' });
    },
  };
  return { writer, calls };
}
const reader = (docs: Record<string, Record<string, unknown>>): DocReader => ({
  async getDoc(p) {
    return p in docs ? { id: p.split('/').pop()!, data: docs[p] } : null;
  },
  async listDocs(p): Promise<RawDoc[]> {
    return Object.keys(docs).filter((x) => x.startsWith(p + '/') && !x.slice(p.length + 1).includes('/')).map((x) => ({ id: x.split('/').pop()!, data: docs[x] }));
  },
});

describe('habit writer (Stage 1 writes)', () => {
  it('create: sets users/{uid}/habits/{id} with the habit fields plus createdAt and updatedAt (server timestamps)', async () => {
    const { writer, calls } = fakeWriter();
    const w = createHabitWriter(writer, reader({}), 'u1', () => 5);
    const id = w.newHabitId();
    await w.create(id, habit({ id }));
    expect(calls[0]).toEqual({ op: 'newId', path: 'users/u1/habits' });
    expect(calls[1].op).toBe('set');
    expect(calls[1].path).toBe('users/u1/habits/new-id-1');
    expect(calls[1].fields).toMatchObject({ name: 'Read', sortOrder: 5, createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP });
    expect(calls).toHaveLength(2); // nothing else is written (no wallet, no completion documents)
  });
  it('update: merges the fields and refreshes updatedAt; an empty change writes nothing', async () => {
    const { writer, calls } = fakeWriter();
    const w = createHabitWriter(writer, reader({}), 'u1');
    await w.update('h1', { name: 'New' });
    expect(calls).toEqual([{ op: 'update', path: 'users/u1/habits/h1', fields: { name: 'New', updatedAt: SERVER_TIMESTAMP } }]);
    await w.update('h1', {});
    expect(calls).toHaveLength(1);
  });
  it('a failed write rejects with the Firestore error (the store then undoes the change)', async () => {
    await expect(createHabitWriter(fakeWriter((c) => c === 'update').writer, reader({}), 'u1').update('h1', { archived: true })).rejects.toMatchObject({ code: 'not-found' });
    await expect(createHabitWriter(fakeWriter((c) => c === 'set').writer, reader({}), 'u1').create('x', habit())).rejects.toMatchObject({ code: 'permission-denied' });
  });

  const docs = {
    'users/u1/habits/h1': { name: 'Read' },
    'users/u1/habits/h1/completions/2026-11-01': { completed: true },
    'users/u1/habits/h1/completions/2026-11-02': { completed: false },
    'users/u1/habits/h2': { name: 'Other habit' },
    'users/u1/habits/h2/completions/2026-11-01': { completed: true },
    'users/u1/dayNotes/h1_2026-11-01': { habitId: 'h1', date: '2026-11-01', text: 'a' },
    'users/u1/dayNotes/h2_2026-11-01': { habitId: 'h2', date: '2026-11-01', text: 'b' },
    'users/u1/walletTransactions/t1': { type: 'daily_completion' },
    'users/u1/rewards/daily_2026-11-01': { active: true },
    'users/u1/freezes/h1_2026-11-05': { habitId: 'h1', date: '2026-11-05' },
  };
  it("delete: removes the habit's completions with the habit in one batch (habit last) and its notes; nothing else", async () => {
    const { writer, calls } = fakeWriter();
    await createHabitWriter(writer, reader(docs), 'u1').remove('h1');
    const deleted = calls.filter((c) => c.op === 'deleteMany');
    const all = deleted.flatMap((c) => c.paths!);
    expect(all.sort()).toEqual(['users/u1/dayNotes/h1_2026-11-01', 'users/u1/habits/h1', 'users/u1/habits/h1/completions/2026-11-01', 'users/u1/habits/h1/completions/2026-11-02']);
    const habitBatch = deleted.find((c) => c.paths!.includes('users/u1/habits/h1'))!;
    expect(habitBatch.paths!.at(-1)).toBe('users/u1/habits/h1');
    expect(habitBatch.paths).toHaveLength(3);
    // another habit's data, its notes, and the wallet records (transactions, rewards, freezes) are untouched, as on Android
    expect(all.some((p) => p.includes('h2') || p.includes('walletTransactions') || p.includes('rewards') || p.includes('freezes'))).toBe(false);
  });
  it('delete: a habit with no completions or notes is just its own document', async () => {
    const { writer, calls } = fakeWriter();
    await createHabitWriter(writer, reader({ 'users/u1/habits/h9': { name: 'Empty' } }), 'u1').remove('h9');
    expect(calls).toEqual([{ op: 'deleteMany', paths: ['users/u1/habits/h9'] }]);
  });
  it('delete: more completions than one batch holds are removed in chunks, the habit in the last batch', async () => {
    const many: Record<string, Record<string, unknown>> = { 'users/u1/habits/big': { name: 'Big' } };
    for (let i = 0; i < 1000; i++) many[`users/u1/habits/big/completions/c${i}`] = { completed: true };
    const { writer, calls } = fakeWriter();
    await createHabitWriter(writer, reader(many), 'u1').remove('big');
    const batches = calls.filter((c) => c.op === 'deleteMany');
    expect(batches.length).toBe(3);
    expect(batches.every((b) => b.paths!.length <= 451)).toBe(true);
    expect(batches.flatMap((b) => b.paths!)).toHaveLength(1001);
    expect(batches.at(-1)!.paths!.at(-1)).toBe('users/u1/habits/big');
    expect(batches.slice(0, -1).some((b) => b.paths!.includes('users/u1/habits/big'))).toBe(false);
  });
  it('delete: if the notes cannot be removed the habit deletion is still attempted and the failure is reported', async () => {
    const { writer, calls } = fakeWriter((c) => c.startsWith('deleteMany:users/u1/dayNotes'));
    await expect(createHabitWriter(writer, reader(docs), 'u1').remove('h1')).rejects.toMatchObject({ code: 'permission-denied' });
    expect(calls.some((c) => c.op === 'deleteMany' && c.paths!.includes('users/u1/habits/h1'))).toBe(true);
  });
});

describe("one user can never write to another user's documents, or to the wallet", () => {
  const { writer, calls } = fakeWriter();
  const s = scopedWriter(writer, 'u1');
  it('refuses every path outside users/u1/habits (set/update) and outside habit, completion and note documents (delete)', () => {
    for (const p of ['users/u2/habits/h1', 'users/u1', 'users/u1/walletTransactions/t', 'users/u1/rewards/r', 'users/u1/freezes/f', 'users/u1/freezeMonths/2026-11', 'users/u1/dayNotes/n', 'users/u1/habits/h1/completions/2026-11-01', 'users/u1x/habits/h1', 'feedback/f1', 'users/u1/habits/']) {
      expect(() => s.set(p, {}), p).toThrow(/Refusing/);
      expect(() => s.update(p, {}), p).toThrow(/Refusing/);
    }
    expect(() => s.deleteMany(['users/u1/habits/h1', 'users/u2/habits/h1'])).toThrow(/Refusing/);
    expect(() => s.deleteMany(['users/u1']).valueOf()).toThrow(/Refusing/);
    expect(() => s.deleteMany(['users/u1/walletTransactions/t1'])).toThrow(/Refusing/);
    expect(() => s.deleteMany(['users/u1/freezes/h1_2026-11-05'])).toThrow(/Refusing/);
    expect(() => s.newId('users/u2/habits')).toThrow(/Refusing/);
    expect(() => scopedWriter(writer, '')).toThrow();
    expect(() => scopedWriter(writer, 'a/b')).toThrow();
    expect(calls).toEqual([]);
  });
  it('allows exactly the documents Stage 1 needs', async () => {
    await s.set('users/u1/habits/h1', {});
    await s.update('users/u1/habits/h1', {});
    await s.deleteMany(['users/u1/habits/h1', 'users/u1/habits/h1/completions/2026-11-01', 'users/u1/dayNotes/h1_2026-11-01']);
    expect(calls.map((c) => c.op)).toEqual(['set', 'update', 'deleteMany']);
  });
});

describe('completion write (HabitRepository.setCompletion)', () => {
  it('checking a day: one batch = completions/{date} merge-set + the habit update with the legacy array and streak values', async () => {
    const { writer, calls } = fakeWriter();
    await createHabitWriter(writer, reader({}), 'u1').setCompletion('h1', '2026-11-21', true, { current: 4, best: 9 });
    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe('batch');
    expect(calls[0].paths).toEqual(['users/u1/habits/h1/completions/2026-11-21', 'users/u1/habits/h1']);
    const f = calls[0].fields as Record<string, Record<string, unknown>>;
    expect(f['users/u1/habits/h1/completions/2026-11-21']).toEqual({ date: '2026-11-21', completed: true, updatedAt: SERVER_TIMESTAMP, completedAt: SERVER_TIMESTAMP });
    expect(f['users/u1/habits/h1']).toEqual({ streak: 4, bestStreak: 9, completedDates: arrayUnion('2026-11-21'), updatedAt: SERVER_TIMESTAMP });
  });
  it('undo: the document is kept with completed=false and uncheckedAt; the legacy array loses the date', async () => {
    const { writer, calls } = fakeWriter();
    await createHabitWriter(writer, reader({}), 'u1').setCompletion('h1', '2026-11-21', false, { current: 0, best: 9 });
    const f = calls[0].fields as Record<string, Record<string, unknown>>;
    expect(f['users/u1/habits/h1/completions/2026-11-21']).toEqual({ date: '2026-11-21', completed: false, updatedAt: SERVER_TIMESTAMP, uncheckedAt: SERVER_TIMESTAMP });
    expect(f['users/u1/habits/h1'].completedDates).toEqual(arrayRemove('2026-11-21'));
    expect(Object.keys(f['users/u1/habits/h1/completions/2026-11-21'])).not.toContain('completedAt');
  });
  it('the completion is a merge-set (existing completedAt etc. are preserved) and nothing else is written', async () => {
    const seen: { kind: string; merge?: boolean }[] = [];
    const { writer } = fakeWriter();
    const spy: DocWriter = { ...writer, batch: async (ops) => void ops.forEach((o) => seen.push({ kind: o.kind, merge: o.kind === 'set' ? o.merge : undefined })) };
    await createHabitWriter(spy, reader({}), 'u1').setCompletion('h1', '2026-11-21', true, { current: 1, best: 1 });
    expect(seen).toEqual([{ kind: 'set', merge: true }, { kind: 'update', merge: undefined }]);
  });
  it('a malformed date is refused before anything is written', async () => {
    const { writer, calls } = fakeWriter();
    await expect(createHabitWriter(writer, reader({}), 'u1').setCompletion('h1', '21-11-2026', true, { current: 0, best: 0 })).rejects.toThrow(/Invalid completion date/);
    await expect(createHabitWriter(writer, reader({}), 'u1').setCompletion('h1', '2026-02-30', true, { current: 0, best: 0 })).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  it('a failed batch rejects (the store then undoes the change)', async () => {
    await expect(createHabitWriter(fakeWriter((c) => c === 'batch').writer, reader({}), 'u1').setCompletion('h1', '2026-11-21', true, { current: 0, best: 0 })).rejects.toMatchObject({ code: 'permission-denied' });
  });
  it("the batch can only touch this user's habit and completion documents", () => {
    const { writer, calls } = fakeWriter();
    const s = scopedWriter(writer, 'u1');
    expect(() => s.batch([{ kind: 'set', merge: true, path: 'users/u2/habits/h1/completions/2026-11-21', fields: {} }])).toThrow(/Refusing/);
    expect(() => s.batch([{ kind: 'update', path: 'users/u1', fields: { coins: 99 } }])).toThrow(/Refusing/);
    expect(() => s.batch([{ kind: 'set', merge: true, path: 'users/u1/walletTransactions/t', fields: {} }])).toThrow(/Refusing/);
    expect(() => s.batch([{ kind: 'update', path: 'users/u1/habits/h1/completions/2026-11-21', fields: {} }])).toThrow(/Refusing/);
    expect(calls).toEqual([]);
  });
});

describe('Stage 1 touches no wallet data', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');
  for (const file of ['services/habitWriter.ts', 'services/firestoreWriter.ts', 'domain/cloudWrite.ts']) {
    it(`${file} has no wallet, reward, freeze or transaction code`, () => {
      expect(read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')).not.toMatch(/walletTransactions|rewards\b|freezeMonths|freezes\b|runTransaction|coins|freezesOwned|pendingAdjustment|lastTransactionId/);
    });
  }
  it('the SDK adapter uses only setDoc, updateDoc, a write batch and array operations (no transactions, no increment)', () => {
    const imports = [...read('services/firestoreWriter.ts').matchAll(/import \{([^}]*)\} from 'firebase\/firestore'/g)].flatMap((m) => m[1].split(',').map((x) => x.trim()));
    expect(imports.sort()).toEqual(['arrayRemove', 'arrayUnion', 'collection', 'doc', 'serverTimestamp', 'setDoc', 'updateDoc', 'writeBatch']);
  });
  it('the guest storage is never written from the cloud paths of the store', () => {
    const store = read('store/AppStore.tsx');
    expect(store).toContain('if (!cloud) appStorage.save');
    expect((store.match(/appStorage\.save/g) ?? []).length).toBe(1);
  });
});
