import { describe, expect, it } from 'vitest';

import { assertValidHabitFields, habitFieldProblems, habitImportProblem, HABIT_LIMITS, InvalidHabitError } from '@/domain/habitLimits';
import { habitCreateFields, habitEditFields, habitGoalFields, habitReminderFields, habitScheduleFields, habitArchiveFields } from '@/domain/cloudWrite';
import { guestPreview } from '@/domain/guestImport';
import { createGuestImporter, ImportError } from '@/services/guestMigration';
import { createHabitWriter, ArrayOp, type DocWriter } from '@/services/habitWriter';
import { createMigrationStore } from '@/services/guestMigrationStore';
import { MemoryStorage } from '@/services/devicePrefs';
import type { Habit } from '@/types/habit';
import { createFakeMigration } from './fakeMigration';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h1',
  name: 'Read',
  color: '#4ADE80',
  completedDates: ['2026-11-01'],
  daysPerWeek: 5,
  restDays: ['Sat', 'Sun'],
  createdDate: '2026-11-01',
  scheduleHistory: [{ from: '2026-11-01', restDays: ['Sat', 'Sun'], daysPerWeek: 5 }],
  archived: false,
  goal: null,
  reminderEnabled: false,
  reminderTime: null,
  ...over,
});

describe('habit field validation (the same bounds as the Firestore rules)', () => {
  it('accepts everything the Web itself writes', () => {
    const h = habit({ goal: 'Read daily', reminderEnabled: true, reminderTime: '07:30' });
    expect(habitFieldProblems(habitCreateFields(h, 1_700_000_000_000))).toEqual([]);
    expect(habitFieldProblems(habitEditFields(habit(), habit({ name: 'New name', color: '#FB923C' })))).toEqual([]);
    expect(habitFieldProblems(habitGoalFields(null))).toEqual([]); // "" clears a goal
    expect(habitFieldProblems(habitReminderFields(false, null))).toEqual([]);
    expect(habitFieldProblems(habitScheduleFields(habit(), { current: 3, best: 9 }))).toEqual([]);
    expect(habitFieldProblems(habitArchiveFields(true))).toEqual([]);
  });

  it('accepts a partial update and an array operation, exactly like the rules (every field optional)', () => {
    expect(habitFieldProblems({})).toEqual([]);
    expect(habitFieldProblems({ sortOrder: 3 })).toEqual([]);
    expect(habitFieldProblems({ completedDates: new ArrayOp('union', ['2026-11-02']) })).toEqual([]);
  });

  it('accepts long legacy names up to the bound (Android has no limit on creation)', () => {
    expect(habitFieldProblems({ name: 'x'.repeat(HABIT_LIMITS.NAME_MAX) })).toEqual([]);
  });

  it.each<[string, Record<string, unknown>]>([
    ['empty name', { name: '' }],
    ['blank name', { name: '   ' }],
    ['huge name', { name: 'x'.repeat(HABIT_LIMITS.NAME_MAX + 1) }],
    ['non-text name', { name: 42 }],
    ['huge goal', { goal: 'g'.repeat(HABIT_LIMITS.TEXT_MAX + 1) }],
    ['weekly target 0', { daysPerWeek: 0 }],
    ['weekly target 8', { daysPerWeek: 8 }],
    ['fractional weekly target', { daysPerWeek: 2.5 }],
    ['too many rest days', { restDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'] }],
    ['unknown rest day', { restDays: ['Funday'] }],
    ['invalid created date', { createdDate: 'yesterday' }],
    ['impossible created date', { createdDate: '2026-13-45' }],
    ['invalid cutoff date', { rewardsIgnoredThrough: '2026-1-1' }],
    ['too many completed dates', { completedDates: Array.from({ length: HABIT_LIMITS.COMPLETED_DATES_MAX + 1 }, () => '2026-11-01') }],
    ['malformed completed date', { completedDates: ['2026-11-01', 'soon'] }],
    ['too many schedule periods', { scheduleHistory: Array.from({ length: HABIT_LIMITS.SCHEDULE_PERIODS_MAX + 1 }, () => ({ from: '2026-11-01', restDays: [], daysPerWeek: 7 })) }],
    ['malformed schedule period', { scheduleHistory: [{ from: 'x', restDays: [], daysPerWeek: 7 }] }],
    ['non-boolean archived', { archived: 'yes' }],
    ['bad reminder time', { reminderTime: '25:99' }],
    ['non-numeric streak', { streak: 'many' }],
    ['non-finite colour', { color: Number.POSITIVE_INFINITY }],
    ['too many fields', Object.fromEntries(Array.from({ length: HABIT_LIMITS.FIELDS_MAX + 1 }, (_, i) => [`f${i}`, 1]))],
  ])('refuses %s, with a reason', (_name, fields) => {
    expect(habitFieldProblems(fields).length).toBeGreaterThan(0);
    expect(() => assertValidHabitFields(fields)).toThrow(InvalidHabitError);
  });

  it('the error looks like a refused write so the app undoes its change and tells the user', () => {
    try {
      assertValidHabitFields({ daysPerWeek: 0 });
      expect.unreachable();
    } catch (e) {
      expect((e as InvalidHabitError).code).toBe('invalid-argument');
      expect((e as Error).message).toMatch(/weekly target/);
    }
  });
});

describe('the write layer never sends an invalid habit', () => {
  const recording = () => {
    const writes: string[] = [];
    const w: DocWriter = {
      newId: () => 'id',
      set: async (p) => void writes.push(`set ${p}`),
      update: async (p) => void writes.push(`update ${p}`),
      deleteMany: async () => undefined,
      batch: async () => undefined,
    };
    return { w, writes };
  };

  it('create and update reject before anything is sent, and valid writes go through', async () => {
    const { w, writes } = recording();
    const writer = createHabitWriter(w, { getDoc: async () => null, listDocs: async () => [] }, 'u1');
    await expect(writer.create('h1', habit({ name: '' }))).rejects.toBeInstanceOf(InvalidHabitError);
    await expect(writer.create('h1', habit({ daysPerWeek: 0 }))).rejects.toBeInstanceOf(InvalidHabitError);
    await expect(writer.update('h1', { restDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'] })).rejects.toBeInstanceOf(InvalidHabitError);
    expect(writes).toEqual([]);
    await writer.create('h1', habit());
    await writer.update('h1', { name: 'Renamed' });
    expect(writes).toEqual(['set users/u1/habits/h1', 'update users/u1/habits/h1']);
  });
});

describe('guest import limits (the guest data is editable by the user)', () => {
  it('the preview says why a habit cannot be imported', () => {
    const rows = guestPreview([habit(), habit({ id: 'h2', name: 'x'.repeat(HABIT_LIMITS.NAME_MAX + 1) }), habit({ id: 'h3', completedDates: Array.from({ length: HABIT_LIMITS.COMPLETED_DATES_MAX + 1 }, (_, i) => `d${i}`) })], {});
    expect(rows.map((r) => r.problem === null)).toEqual([true, false, false]);
    expect(rows[1].problem).toMatch(/name is longer/);
    expect(rows[2].problem).toMatch(/check-ins/);
    expect(habitImportProblem(habit({ daysPerWeek: 0 }))).toMatch(/weekly target/);
    expect(habitImportProblem(habit({ name: '  ' }))).toMatch(/no name/);
  });

  const setup = (habits: Habit[]) => {
    const fake = createFakeMigration('u1');
    const importer = createGuestImporter({ backend: fake.backend, store: createMigrationStore(new MemoryStorage()), guest: () => ({ habits, notes: {} }), newId: () => 'abcdef12-0000-4000-8000-000000000000', today: () => '2026-11-23' });
    return { fake, importer };
  };

  it('refuses an oversized habit, and more habits than the cap, before anything is written', async () => {
    const big = setup([habit({ name: 'x'.repeat(HABIT_LIMITS.NAME_MAX + 1) })]);
    await expect(big.importer.migrate('u1', 'a@b.co', ['h1'])).rejects.toMatchObject({ kind: 'invalid' });
    expect(big.fake.state.written).toEqual([]);
    expect(big.fake.state.profileCreates).toBe(0);

    const many = setup(Array.from({ length: HABIT_LIMITS.IMPORT_HABITS_MAX + 1 }, (_, i) => habit({ id: `h${i}`, name: `Habit ${i}` })));
    const e = await many.importer.migrate('u1', 'a@b.co', many.importer ? Array.from({ length: HABIT_LIMITS.IMPORT_HABITS_MAX + 1 }, (_, i) => `h${i}`) : []).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ImportError);
    expect((e as ImportError).message).toMatch(/up to 200 habits/);
    expect(many.fake.state.written).toEqual([]);
  });

  it('imports an ordinary habit as before', async () => {
    const ok = setup([habit()]);
    await expect(ok.importer.migrate('u1', 'a@b.co', ['h1'])).resolves.toMatchObject({ habits: 1 });
  });
});
