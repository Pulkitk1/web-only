import { describe, expect, it } from 'vitest';

import { candidateCloudId, guestPreview, hasImportableGuestData, planImport } from '@/domain/guestImport';
import { createGuestImporter, importFailure, ImportError, newProfileFields, scopedMigrationBackend, type GuestData } from '@/services/guestMigration';
import { createMigrationStore } from '@/services/guestMigrationStore';
import { MemoryStorage } from '@/services/devicePrefs';
import type { Habit } from '@/types/habit';
import { addDays } from '@/utils/date';
import { createFakeMigration } from './fakeMigration';

const TODAY = '2026-11-23';
const UID = 'uid-1';
const EMAIL = 'tester@example.com';
const root = `users/${UID}`;

const habit = (id: string, name: string, dates: string[], extra: Partial<Habit> = {}): Habit => ({
  id,
  name,
  color: '#4ADE80',
  completedDates: dates,
  daysPerWeek: 5,
  restDays: ['Sat', 'Sun'],
  createdDate: '2026-01-01',
  scheduleHistory: [{ from: '2026-01-01', restDays: ['Sat', 'Sun'], daysPerWeek: 5 }],
  archived: false,
  goal: null,
  reminderEnabled: false,
  reminderTime: null,
  ...extra,
});

let seq = 0;
/** A migration id like a UUID; each call is a different "browser". */
const uuid = () => `${(++seq).toString(16).padStart(8, '0')}-1111-4222-8333-444444444444`;

function setup(data: GuestData | null, opts: { initial?: Record<string, Record<string, unknown>>; storage?: MemoryStorage; newId?: () => string; writeTimeoutMs?: number } = {}) {
  const storage = opts.storage ?? new MemoryStorage();
  const store = createMigrationStore(storage);
  const fake = createFakeMigration(UID, opts.initial ?? {});
  const importer = createGuestImporter({ backend: fake.backend, store, guest: () => data, newId: opts.newId ?? uuid, now: () => 1_800_000_000_000, today: () => TODAY, writeTimeoutMs: opts.writeTimeoutMs });
  return { storage, store, fake, importer };
}

const two: GuestData = {
  habits: [habit('h1', 'SQL Practice', ['2026-11-18', '2026-11-19', '2026-11-20']), habit('local-2', 'Read', ['2026-11-10'])],
  notes: { h1: { '2026-11-21': 'Sick day' }, 'local-2': { '2026-11-11': 'Travelling' } },
};

const accountWithWallet = {
  [root]: { email: EMAIL, coins: 37, freezesOwned: 2, pendingAdjustment: 1, lastTransactionId: 'daily_2026-11-20' },
  [`${root}/walletTransactions/daily_2026-11-20`]: { type: 'daily_completion', coinDelta: 1 },
  [`${root}/rewards/daily_2026-11-20`]: { active: true, cycle: 1, amount: 1 },
  [`${root}/freezes/x_2026-11-01`]: { habitId: 'x', date: '2026-11-01' },
  [`${root}/freezeMonths/2026-11`]: { count: 1 },
  [`${root}/habits/existing`]: { name: 'Existing habit', completedDates: [] },
};

const cloudHabitIds = (f: ReturnType<typeof createFakeMigration>) => f.paths(`${root}/habits/`).filter((p) => !p.includes('/completions/')).map((p) => p.split('/').pop()!);

describe('preview (decision 1: nothing is guessed or selected)', () => {
  it('lists every guest habit with its check-ins, notes and archived state, and marks only explicit demo habits', () => {
    const rows = guestPreview(
      [habit('h1', 'A', ['2026-11-01', '2026-11-01', '2026-11-02'], { dataOrigin: 'demo' }), habit('local-1', 'B', [], { archived: true })],
      { h1: { '2026-11-03': 'x', '2026-11-04': '   ' }, 'local-1': {} },
    );
    expect(rows.map((r) => [r.id, r.checkIns, r.notes, r.archived, r.sample])).toEqual([
      ['h1', 2, 1, false, true], // duplicate dates counted once; a blank note is not a note
      ['local-1', 0, 0, true, false], // no marker: never assumed to be a sample
    ]);
    expect('selected' in rows[0]).toBe(false);
  });

  it('a habit seeded like the demo habits but without the marker is not labelled', () => {
    expect(guestPreview([habit('h1', 'SQL Practice', [])], {})[0].sample).toBe(false);
  });

  it('offers the import only when there are guest habits (the wallet does not count)', () => {
    expect(hasImportableGuestData([])).toBe(false);
    expect(hasImportableGuestData([habit('h1', 'A', [])])).toBe(true);
  });
});

describe('offer states and the recorded decision (decision 4)', () => {
  it('none without habits, offer with habits, declined after "Start with my existing account", never again after an import', async () => {
    expect(setup(null).importer.offer(UID).kind).toBe('none');
    expect(setup({ habits: [], notes: {} }).importer.offer(UID).kind).toBe('none');

    const s = setup(two);
    expect(s.importer.offer(UID).kind).toBe('offer');
    s.importer.decline(UID);
    expect(s.importer.offer(UID).kind).toBe('declined');
    expect(s.fake.state.written).toEqual([]); // declining writes nothing to the account
    expect(s.fake.state.reads).toEqual([]);

    await s.importer.migrate(UID, EMAIL, ['h1']); // Settings can still import after declining
    expect(s.importer.offer(UID).kind).toBe('imported');
    expect(s.importer.offer('someone-else').kind).toBe('imported');
  });

  it('a declined choice survives a reload (stored) and does not affect another account', () => {
    const storage = new MemoryStorage();
    setup(two, { storage }).importer.decline(UID);
    const again = setup(two, { storage });
    expect(again.importer.offer(UID).kind).toBe('declined');
    expect(again.importer.offer('other-uid').kind).toBe('offer');
  });

  it('an unfinished import is offered for resume, unless the user declined', async () => {
    const s = setup(two);
    s.fake.state.failSetManyOn = 1;
    await expect(s.importer.migrate(UID, EMAIL, ['h1'])).rejects.toBeInstanceOf(ImportError);
    expect(s.importer.offer(UID).kind).toBe('resume');
    s.importer.decline(UID);
    expect(s.importer.offer(UID).kind).toBe('declined');
  });
});

describe('selecting habits', () => {
  it('imports only the selected habits and their own completions and notes', async () => {
    const s = setup(two);
    const report = await s.importer.migrate(UID, EMAIL, ['local-2']);
    expect(report).toMatchObject({ habits: 1, checkIns: 1, notes: 1 });
    expect(cloudHabitIds(s.fake)).toHaveLength(1);
    expect(s.fake.paths(`${root}/dayNotes/`)).toEqual([`${root}/dayNotes/${cloudHabitIds(s.fake)[0]}_2026-11-11`]);
    expect([...s.fake.docs.keys()].some((p) => p.includes('h1'))).toBe(false);
  });

  it('refuses an empty selection or an unknown habit, before anything is written or remembered', async () => {
    const s = setup(two);
    await expect(s.importer.migrate(UID, EMAIL, [])).rejects.toMatchObject({ kind: 'invalid' });
    await expect(s.importer.migrate(UID, EMAIL, ['nope'])).rejects.toMatchObject({ kind: 'invalid' });
    expect(s.fake.state.written).toEqual([]);
    expect(s.store.record(UID)).toBeNull();
    expect(s.fake.state.profileCreates).toBe(0);
  });

  it('duplicate ids in the selection import the habit once', async () => {
    const s = setup(two);
    expect((await s.importer.migrate(UID, EMAIL, ['h1', 'h1'])).habits).toBe(1);
  });
});

describe('what is written: habit fields, schedule history, completions', () => {
  it('writes the habit like Android does, with the full schedule history, archived, goal and reminder, and migratedFrom', async () => {
    const h = habit('local-7', 'Gym', ['2026-11-02', '2026-11-03', '2026-11-04'], {
      color: '#FB923C',
      daysPerWeek: 4,
      restDays: ['Mon', 'Thu', 'Sun'],
      createdDate: '2026-10-01',
      scheduleHistory: [
        { from: '2026-10-01', restDays: ['Sun'], daysPerWeek: 6 },
        { from: '2026-11-01', restDays: ['Mon', 'Thu', 'Sun'], daysPerWeek: 4 },
      ],
      archived: true,
      goal: 'Run a 10k',
      reminderEnabled: true,
      reminderTime: '07:30',
    });
    const s = setup({ habits: [habit('h1', 'Existing order', []), h], notes: {} }, { newId: () => 'abcdef12-0000-4000-8000-000000000000' });
    await s.importer.migrate(UID, EMAIL, ['local-7']);
    const id = 'local-7-mabcdef12';
    const d = s.fake.get(`${root}/habits/${id}`)!;
    expect(d).toMatchObject({
      name: 'Gym',
      daysPerWeek: 4,
      restDays: ['Mon', 'Thu', 'Sun'],
      createdDate: '2026-10-01',
      archived: true,
      goal: 'Run a 10k',
      reminderEnabled: true,
      reminderTime: '07:30',
      completedDates: ['2026-11-02', '2026-11-03', '2026-11-04'],
      migratedFrom: 'abcdef12-0000-4000-8000-000000000000:local-7', // the original guest id is preserved
    });
    expect(d.scheduleHistory).toEqual([
      { from: '2026-10-01', restDays: ['Sun'], daysPerWeek: 6 },
      { from: '2026-11-01', restDays: ['Mon', 'Thu', 'Sun'], daysPerWeek: 4 },
    ]);
    expect(typeof d.color).toBe('number'); // Android's 64-bit ARGB number
    expect(d.createdAt).toBeInstanceOf(Date);
    expect(d.bestStreak).toBeGreaterThanOrEqual(1);
    for (const date of ['2026-11-02', '2026-11-03', '2026-11-04']) {
      expect(s.fake.get(`${root}/habits/${id}/completions/${date}`)).toMatchObject({ date, completed: true });
    }
  });

  it('writes rewardsIgnoredThrough (the import date) on every imported habit, in yyyy-MM-dd form, and on nothing else', async () => {
    const s = setup(two, { initial: { [`${root}/habits/existing`]: { name: 'Existing habit' } } });
    await s.importer.migrate(UID, EMAIL, ['h1', 'local-2']);
    for (const id of cloudHabitIds(s.fake).filter((x) => x !== 'existing')) expect(s.fake.get(`${root}/habits/${id}`)!.rewardsIgnoredThrough).toBe(TODAY);
    expect(s.fake.get(`${root}/habits/existing`)).toEqual({ name: 'Existing habit' }); // a non-imported habit is never rewritten
    expect([...s.fake.docs].filter(([p]) => p.includes('/completions/') || p.includes('/dayNotes/')).some(([, d]) => 'rewardsIgnoredThrough' in d)).toBe(false);
  });

  it('survives retries with the same date, even when the retry happens on a later day', async () => {
    const storage = new MemoryStorage();
    const first = setup(two, { storage });
    first.fake.state.failSetManyOn = 2; // the habit batch is written, the notes fail
    await expect(first.importer.migrate(UID, EMAIL, ['h1'])).rejects.toBeInstanceOf(ImportError);
    const id = cloudHabitIds(first.fake)[0];
    expect(first.fake.get(`${root}/habits/${id}`)!.rewardsIgnoredThrough).toBe(TODAY);
    // a new importer over the same record, two days later: the record's date is kept, and the stored value is not rewritten
    const store = createMigrationStore(storage);
    const later = createGuestImporter({ backend: first.fake.backend, store, guest: () => two, newId: uuid, now: () => 1_800_000_000_000, today: () => '2026-11-25' });
    first.fake.state.failSetManyOn = Infinity;
    await later.migrate(UID, EMAIL, ['h1']);
    expect(store.record(UID)!.through).toBe(TODAY);
    expect(first.fake.get(`${root}/habits/${id}`)!.rewardsIgnoredThrough).toBe(TODAY);
  });

  it('writes optional fields only when they are set, like a habit created on Android', async () => {
    const s = setup({ habits: [habit('h1', 'Plain', ['2026-11-02'])], notes: {} });
    await s.importer.migrate(UID, EMAIL, ['h1']);
    const d = s.fake.get(`${root}/habits/${cloudHabitIds(s.fake)[0]}`)!;
    expect('goal' in d).toBe(false);
    expect('reminderEnabled' in d).toBe(false);
    expect('archived' in d).toBe(false);
  });

  it('imported habits sort after the account’s existing ones, in the guest’s order', async () => {
    const s = setup({ habits: [habit('a', 'A', []), habit('b', 'B', [])], notes: {} });
    await s.importer.migrate(UID, EMAIL, ['b', 'a']);
    const orders = cloudHabitIds(s.fake).map((id) => [s.fake.get(`${root}/habits/${id}`)!.name, s.fake.get(`${root}/habits/${id}`)!.sortOrder] as const);
    const byName = Object.fromEntries(orders);
    expect(byName.A as number).toBeLessThan(byName.B as number);
    expect(byName.A as number).toBeGreaterThan(1_000_000_000_000); // creation-time style, always above reorder positions
  });

  it('an unsupported colour falls back to the default instead of failing', async () => {
    const s = setup({ habits: [habit('h1', 'Odd', [], { color: 'not-a-colour' })], notes: {} });
    await expect(s.importer.migrate(UID, EMAIL, ['h1'])).resolves.toMatchObject({ habits: 1 });
  });

  it('the same input always plans the same documents (no clock or randomness in the plan)', () => {
    const args = { uid: UID, habits: two.habits, notes: two.notes, selected: ['h1', 'local-2'], idMap: { h1: 'h1-m1', 'local-2': 'local-2-m1' }, migrationId: 'mig', now: 5, through: TODAY };
    expect(JSON.stringify(planImport(args), (_k, v) => (typeof v === 'symbol' ? 'ts' : v))).toBe(JSON.stringify(planImport(args), (_k, v) => (typeof v === 'symbol' ? 'ts' : v)));
  });
});

describe('notes', () => {
  it('writes day notes under {cloudHabitId}_{date} with the cloud habit id, trimmed, skipping blank ones', async () => {
    const s = setup({ habits: [habit('h1', 'A', ['2026-11-02'])], notes: { h1: { '2026-11-05': '  Sick  ', '2026-11-06': '   ' } } });
    const report = await s.importer.migrate(UID, EMAIL, ['h1']);
    const id = cloudHabitIds(s.fake)[0];
    expect(report.notes).toBe(1);
    expect(s.fake.get(`${root}/dayNotes/${id}_2026-11-05`)).toMatchObject({ habitId: id, date: '2026-11-05', text: 'Sick' });
    expect(s.fake.get(`${root}/dayNotes/${id}_2026-11-06`)).toBeUndefined();
  });

  it('notes that are already in the account (an earlier attempt, possibly edited since) are left as they are on a retry', async () => {
    const s = setup({ habits: [habit('h1', 'A', ['2026-11-02'])], notes: { h1: { '2026-11-05': 'Sick' } } });
    s.fake.state.failSetManyOn = 2; // habit batch succeeds, the notes batch fails
    await expect(s.importer.migrate(UID, EMAIL, ['h1'])).rejects.toMatchObject({ kind: 'offline' });
    const id = cloudHabitIds(s.fake)[0];
    expect(s.fake.get(`${root}/dayNotes/${id}_2026-11-05`)).toBeUndefined();
    s.fake.put(`${root}/dayNotes/${id}_2026-11-05`, { habitId: id, date: '2026-11-05', text: 'Edited in the account' });
    s.fake.state.failSetManyOn = Infinity;
    await s.importer.migrate(UID, EMAIL, ['h1']);
    expect(s.fake.get(`${root}/dayNotes/${id}_2026-11-05`)!.text).toBe('Edited in the account');
  });
});

describe('ids (decision 5)', () => {
  it('uses {guestId}-m{migrationId[0..8]}, keeps the guest id in migratedFrom', () => {
    expect(candidateCloudId('local-3', '0000002a-1111-4222-8333-444444444444', 0)).toBe('local-3-m0000002a');
    expect(candidateCloudId('local-3', '0000002a-1111-4222-8333-444444444444', 2)).toBe('local-3-m0000002a-2');
    expect(candidateCloudId('a b/c', 'abcdef12-0000-4000-8000-000000000000', 0)).toBe('a_b_c-mabcdef12'); // characters Firestore ids can't hold are replaced
  });

  it('two browsers with the same guest ids import into one account without touching each other', async () => {
    const a = setup(two, { newId: () => 'aaaaaaaa-0000-4000-8000-000000000000' });
    await a.importer.migrate(UID, EMAIL, ['h1', 'local-2']);
    const b = createGuestImporter({
      backend: a.fake.backend,
      store: createMigrationStore(new MemoryStorage()), // another browser: its own record and marker
      guest: () => two,
      newId: () => 'bbbbbbbb-0000-4000-8000-000000000000',
      now: () => 1,
      today: () => TODAY,
    });
    await b.migrate(UID, EMAIL, ['h1', 'local-2']);
    expect(cloudHabitIds(a.fake).sort()).toEqual(['h1-maaaaaaaa', 'h1-mbbbbbbbb', 'local-2-maaaaaaaa', 'local-2-mbbbbbbbb']);
  });

  it('a collision with an unrelated habit takes the next free id and leaves that habit alone', async () => {
    const s = setup({ habits: [habit('h1', 'A', ['2026-11-02'])], notes: {} }, { newId: () => 'cccccccc-0000-4000-8000-000000000000', initial: { [`${root}/habits/h1-mcccccccc`]: { name: 'Unrelated', migratedFrom: 'some-other:h1' } } });
    await s.importer.migrate(UID, EMAIL, ['h1']);
    expect(s.fake.get(`${root}/habits/h1-mcccccccc`)).toEqual({ name: 'Unrelated', migratedFrom: 'some-other:h1' });
    expect(s.fake.get(`${root}/habits/h1-mcccccccc-1`)).toMatchObject({ name: 'A', migratedFrom: 'cccccccc-0000-4000-8000-000000000000:h1' });
  });

  it('guest ids that become the same cloud id still get distinct ids', async () => {
    const s = setup({ habits: [habit('a b', 'One', []), habit('a_b', 'Two', [])], notes: {} });
    await s.importer.migrate(UID, EMAIL, ['a b', 'a_b']);
    expect(new Set(cloudHabitIds(s.fake)).size).toBe(2);
  });

  it('ids are identical on every retry, however the first attempt ended', async () => {
    const s = setup(two);
    s.fake.state.failSetManyOn = 1;
    await expect(s.importer.migrate(UID, EMAIL, ['h1', 'local-2'])).rejects.toBeInstanceOf(ImportError);
    const first = s.store.record(UID)!;
    const map = { ...first.idMap };
    s.fake.state.failSetManyOn = Infinity;
    await s.importer.migrate(UID, EMAIL, ['h1', 'local-2']);
    expect(s.store.record(UID)!.idMap).toEqual(map);
    expect(s.store.record(UID)!.id).toBe(first.id);
    expect(cloudHabitIds(s.fake).sort()).toEqual(Object.values(map).sort());
  });

  it('a retry keeps the habits chosen the first time, whatever is passed', async () => {
    const s = setup(two);
    s.fake.state.failSetManyOn = 1;
    await expect(s.importer.migrate(UID, EMAIL, ['h1'])).rejects.toBeInstanceOf(ImportError);
    s.fake.state.failSetManyOn = Infinity;
    await s.importer.migrate(UID, EMAIL, ['h1', 'local-2']);
    expect(cloudHabitIds(s.fake)).toHaveLength(1);
  });
});

describe('interrupted migration and retries', () => {
  it('a failure leaves the guest data untouched, nothing marked complete, and the retry finishes without duplicates', async () => {
    const data = JSON.parse(JSON.stringify(two)) as GuestData;
    const s = setup(data);
    s.fake.state.failSetManyOn = 2;
    await expect(s.importer.migrate(UID, EMAIL, ['h1', 'local-2'])).rejects.toMatchObject({ kind: 'offline' });
    expect(s.store.record(UID)!.step).toBe('failed');
    expect(s.store.completed()).toBeNull();
    expect(data).toEqual(two);

    s.fake.state.failSetManyOn = Infinity;
    const report = await s.importer.migrate(UID, EMAIL, ['h1', 'local-2']);
    expect(report).toMatchObject({ habits: 2, checkIns: 4, notes: 2, resumed: true });
    expect(s.store.completed()).toMatchObject({ uid: UID, habits: 2 });
    expect(cloudHabitIds(s.fake)).toHaveLength(2);
    expect(s.fake.paths(`${root}/dayNotes/`)).toHaveLength(2);
    expect(data).toEqual(two);
  });

  it('an already-uploaded habit is not rewritten on retry; only missing completions are added', async () => {
    const dates = Array.from({ length: 450 }, (_, i) => addDays('2025-01-01', i));
    const s = setup({ habits: [habit('h1', 'Long', dates, { createdDate: '2024-12-01' })], notes: {} });
    s.fake.state.failSetManyOn = 2; // 451 writes = batches of 400 + 51: the second fails
    await expect(s.importer.migrate(UID, EMAIL, ['h1'])).rejects.toMatchObject({ kind: 'offline' });
    const id = cloudHabitIds(s.fake)[0];
    expect(s.fake.paths(`${root}/habits/${id}/completions/`)).toHaveLength(399);
    s.fake.patch(`${root}/habits/${id}`, { name: 'Renamed in the account' });

    s.fake.state.failSetManyOn = Infinity;
    s.fake.state.written.length = 0;
    await s.importer.migrate(UID, EMAIL, ['h1']);
    expect(s.fake.get(`${root}/habits/${id}`)!.name).toBe('Renamed in the account');
    expect(s.fake.paths(`${root}/habits/${id}/completions/`)).toHaveLength(450);
    expect(s.fake.state.written).toHaveLength(51); // exactly the missing ones
    expect(s.fake.state.written.includes(`${root}/habits/${id}`)).toBe(false);
  });

  it('batches never exceed 400 writes', async () => {
    const dates = Array.from({ length: 900 }, (_, i) => addDays('2024-01-01', i));
    const s = setup({ habits: [habit('h1', 'Huge', dates, { createdDate: '2023-12-01' })], notes: {} });
    await s.importer.migrate(UID, EMAIL, ['h1']);
    expect(s.fake.state.setManyCalls).toBe(3); // 901 writes -> 400 + 400 + 101
  });

  it('a repeated attempt after completion is refused and writes nothing, for this account and for another', async () => {
    const s = setup(two);
    await s.importer.migrate(UID, EMAIL, ['h1']);
    const before = s.fake.state.written.length;
    await expect(s.importer.migrate(UID, EMAIL, ['h1'])).rejects.toMatchObject({ kind: 'finished' });
    await expect(s.importer.migrate('uid-2', EMAIL, ['h1'])).rejects.toMatchObject({ kind: 'finished' });
    expect(s.fake.state.written).toHaveLength(before);
  });

  it('only one import runs at a time', async () => {
    const s = setup(two);
    const first = s.importer.migrate(UID, EMAIL, ['h1']);
    await expect(s.importer.migrate(UID, EMAIL, ['h1'])).rejects.toMatchObject({ kind: 'busy' });
    await first;
  });

  it('an unfinished import for one account is not replaced by signing in to another', async () => {
    const s = setup(two);
    s.fake.state.failSetManyOn = 1;
    await expect(s.importer.migrate(UID, EMAIL, ['h1'])).rejects.toBeInstanceOf(ImportError);
    const a = s.store.record(UID)!;
    s.store.begin('uid-2', ['local-2'], TODAY, uuid, 1);
    expect(s.store.record(UID)).toEqual(a);
    expect(s.store.record('uid-2')!.id).not.toBe(a.id);
  });

  it('backing out before anything was uploaded forgets the record; after upload started it is kept', async () => {
    const offline = setup(two);
    offline.fake.state.offline = true;
    await expect(offline.importer.migrate(UID, EMAIL, ['h1'])).rejects.toMatchObject({ kind: 'offline' });
    expect(offline.store.record(UID)!.step).toBe('preparing');
    offline.importer.decline(UID);
    expect(offline.store.record(UID)).toBeNull();

    const started = setup(two);
    started.fake.state.failSetManyOn = 1;
    await expect(started.importer.migrate(UID, EMAIL, ['h1'])).rejects.toBeInstanceOf(ImportError);
    started.importer.decline(UID);
    expect(started.store.record(UID)).not.toBeNull();
  });

  it('offline: fails with a clear message, the guest data is untouched and no profile or habit is written', async () => {
    const s = setup(two);
    s.fake.state.offline = true;
    const e = (await s.importer.migrate(UID, EMAIL, ['h1']).catch((x: unknown) => x)) as ImportError;
    expect(e).toBeInstanceOf(ImportError);
    expect(e.message).toMatch(/offline/i);
    expect(s.fake.state.written).toEqual([]);
  });

  it('a write that never answers is reported as offline instead of hanging', async () => {
    const s = setup(two, { writeTimeoutMs: 20 });
    s.fake.state.hangSetMany = true;
    await expect(s.importer.migrate(UID, EMAIL, ['h1'])).rejects.toMatchObject({ kind: 'offline' });
  });

  it('a record that cannot be saved stops the import before anything is written', async () => {
    const storage = new MemoryStorage();
    storage.setItem = () => {
      throw new Error('quota');
    };
    const s = setup(two, { storage });
    await expect(s.importer.migrate(UID, EMAIL, ['h1'])).rejects.toMatchObject({ kind: 'storage' });
    expect(s.fake.state.written).toEqual([]);
    expect(s.fake.state.profileCreates).toBe(0);
  });
});

describe('verification', () => {
  it('a document that is not on the server fails the import, which is then not marked complete; the retry succeeds', async () => {
    const s = setup({ habits: [habit('h1', 'A', ['2026-11-02', '2026-11-03'])], notes: {} });
    // A write that silently didn't reach the server: after each batch, the second completion can't be read back.
    const hide = () => [...s.fake.docs.keys()].filter((p) => p.endsWith('/completions/2026-11-03'));
    const realSetMany = s.fake.backend.setMany;
    s.fake.backend.setMany = async (ops) => {
      await realSetMany(ops);
      hide().forEach((p) => s.fake.state.hidden.add(p));
    };
    await expect(s.importer.migrate(UID, EMAIL, ['h1'])).rejects.toMatchObject({ kind: 'verification' });
    expect(s.store.completed()).toBeNull();
    expect(s.store.record(UID)!.step).toBe('failed');

    s.fake.state.hidden.clear();
    s.fake.backend.setMany = realSetMany;
    await expect(s.importer.migrate(UID, EMAIL, ['h1'])).resolves.toMatchObject({ habits: 1 });
    expect(s.store.completed()).not.toBeNull();
  });

  it('a habit that belongs to another habit, or a missing note, fails verification', async () => {
    const s = setup({ habits: [habit('h1', 'A', ['2026-11-02'])], notes: { h1: { '2026-11-03': 'n' } } });
    const real = s.fake.backend.setMany;
    s.fake.backend.setMany = async (ops) => {
      await real(ops);
      s.fake.state.hidden.add([...s.fake.docs.keys()].find((p) => p.includes('/dayNotes/'))!);
    };
    await expect(s.importer.migrate(UID, EMAIL, ['h1'])).rejects.toMatchObject({ kind: 'verification' });
  });
});

describe('the wallet is never touched (decision 2)', () => {
  it('leaves the existing profile, balance, freezes, rewards and ledger exactly as they were', async () => {
    const s = setup({ habits: two.habits.map((h) => ({ ...h, completedDates: [...h.completedDates, '2026-11-20', '2026-11-22'] })), notes: two.notes }, { initial: accountWithWallet });
    const before = s.fake.walletSnapshot();
    const report = await s.importer.migrate(UID, EMAIL, ['h1', 'local-2']);
    expect(s.fake.walletSnapshot()).toBe(before);
    expect(report.profileCreated).toBe(false);
    expect(s.fake.state.profileCreates).toBe(0);
    expect(s.fake.state.written.every((p) => /\/(habits|dayNotes)\//.test(p))).toBe(true);
    expect(s.fake.get(`${root}/habits/existing`)).toEqual(accountWithWallet[`${root}/habits/existing`]);
  });

  it('writes no reward, transaction, freeze or coin field anywhere, even when imported days would qualify', async () => {
    const days = Array.from({ length: 30 }, (_, i) => addDays('2026-10-24', i));
    const s = setup({ habits: [habit('h1', 'Streak', days, { daysPerWeek: 7, restDays: [], createdDate: '2026-10-01' })], notes: {} }, { initial: { [root]: { email: EMAIL, coins: 5, freezesOwned: 0 } } });
    await s.importer.migrate(UID, EMAIL, ['h1']);
    expect(s.fake.state.written.some((p) => /(walletTransactions|rewards|freezes|freezeMonths)/.test(p))).toBe(false);
    const imported = [...s.fake.docs].filter(([p]) => p !== root).map(([, d]) => Object.keys(d));
    expect(JSON.stringify(imported)).not.toMatch(/coins|freezesOwned|pendingAdjustment|lastTransactionId/);
    expect(s.fake.get(root)).toEqual({ email: EMAIL, coins: 5, freezesOwned: 0 });
  });

  it('the scoped backend cannot write or read wallet documents, other accounts, or create another profile', async () => {
    const fake = createFakeMigration(UID);
    const b = scopedMigrationBackend(fake.backend, UID);
    const wallet = ['walletTransactions/x', 'rewards/x', 'freezes/x', 'freezeMonths/2026-11'].map((p) => `${root}/${p}`);
    for (const path of wallet) {
      expect(() => b.setMany([{ path, fields: {} }])).toThrow(/Refusing to write/);
      expect(() => b.getDoc(path)).toThrow(/Refusing to read/);
    }
    expect(() => b.setMany([{ path: root, fields: { coins: 1000 } }])).toThrow(/Refusing to write/);
    expect(() => b.setMany([{ path: `users/other/habits/h`, fields: {} }])).toThrow(/Refusing to write/);
    expect(() => b.getDoc('users/other')).toThrow(/Refusing to read/);
    expect(() => b.listDocs(`${root}/walletTransactions`)).toThrow(/Refusing to list/);
    expect(() => b.ensureProfile('other', EMAIL)).toThrow(/Refusing to create a profile/);
    // the allowed paths work
    await expect(b.setMany([{ path: `${root}/habits/h`, fields: {} }, { path: `${root}/habits/h/completions/2026-11-01`, fields: {} }])).resolves.toBeUndefined();
  });
});

describe('profile creation (decision 3)', () => {
  it('creates a missing profile with the same fields as Android, once, and no wallet documents', async () => {
    const s = setup(two);
    const report = await s.importer.migrate(UID, 'tester@example.com', ['h1']);
    expect(report.profileCreated).toBe(true);
    expect(s.fake.get(root)).toEqual({
      email: 'tester@example.com',
      displayName: 'tester',
      coins: 20,
      freezesOwned: 0,
      welcomeFreezePending: true,
      isDark: true,
      createdAt: 'server-timestamp',
      updatedAt: 'server-timestamp',
    });
    expect(s.fake.paths(`${root}/walletTransactions`)).toEqual([]);
    expect(s.fake.paths(`${root}/freezes`)).toEqual([]);
  });

  it('matches the field list Kotlin writes in AppViewModel.loadUser', () => {
    expect(Object.keys(newProfileFields('a@b.c')).sort()).toEqual(['coins', 'createdAt', 'displayName', 'email', 'freezesOwned', 'isDark', 'updatedAt', 'welcomeFreezePending']);
    expect(newProfileFields('a@b.c')).toMatchObject({ coins: 20, freezesOwned: 0, welcomeFreezePending: true, isDark: true, displayName: 'a' });
  });

  it('never resets or overwrites an existing profile, even one with a different balance', async () => {
    const s = setup(two, { initial: { [root]: { email: EMAIL, coins: 91, freezesOwned: 3, welcomeFreezePending: false, displayName: 'Custom' } } });
    await s.importer.migrate(UID, EMAIL, ['h1']);
    expect(s.fake.get(root)).toEqual({ email: EMAIL, coins: 91, freezesOwned: 3, welcomeFreezePending: false, displayName: 'Custom' });
  });

  it('two tabs creating the profile at once produce exactly one profile (transaction)', async () => {
    const fake = createFakeMigration(UID);
    fake.state.yieldInTransaction = true;
    const [a, b] = await Promise.all([fake.backend.ensureProfile(UID, EMAIL), fake.backend.ensureProfile(UID, EMAIL)]);
    expect([a, b].sort()).toEqual(['created', 'exists']);
    expect(fake.state.profileCreates).toBe(1);
  });

  it('a failed import after the profile was created leaves the profile alone and the retry does not recreate it', async () => {
    const s = setup(two);
    s.fake.state.failSetManyOn = 1;
    await expect(s.importer.migrate(UID, EMAIL, ['h1'])).rejects.toBeInstanceOf(ImportError);
    expect(s.fake.state.profileCreates).toBe(1);
    s.fake.state.failSetManyOn = Infinity;
    const report = await s.importer.migrate(UID, EMAIL, ['h1']);
    expect(s.fake.state.profileCreates).toBe(1);
    expect(report.profileCreated).toBe(false);
  });
});

describe('guest data preservation and failure messages', () => {
  it('never changes or deletes the guest data, on success or on failure', async () => {
    const data = JSON.parse(JSON.stringify(two)) as GuestData;
    const frozen = JSON.stringify(data);
    const ok = setup(data);
    await ok.importer.migrate(UID, EMAIL, ['h1', 'local-2']);
    expect(JSON.stringify(data)).toBe(frozen);
    const bad = setup(data);
    bad.fake.state.failSetManyOn = 1;
    await bad.importer.migrate(UID, EMAIL, ['h1']).catch(() => {});
    expect(JSON.stringify(data)).toBe(frozen);
  });

  it('classifies errors into user-facing messages that say the guest data is safe', () => {
    expect(importFailure({ code: 'unavailable' }).kind).toBe('offline');
    expect(importFailure({ code: 'deadline-exceeded' }).kind).toBe('offline');
    expect(importFailure({ code: 'permission-denied' }).kind).toBe('denied');
    expect(importFailure(new Error('boom')).message).toMatch(/still on this device/);
  });
});
