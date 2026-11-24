/**
 * Habit creation and editing (Phase 3). Ported from android HabitNameRulesTest, EditHabitDialogTest (the rules behind
 * it), ScheduleHistoryTest (schedule edits) and AppViewModel.editHabit/updateSchedule/updateGoal/updateHabitReminder.
 */
import { describe, expect, it } from 'vitest';

import { dayProgress, daysCompletion, percent } from '@/domain/analytics';
import {
  canSaveName,
  daysPerWeekFor,
  editHabit,
  ERR_NAME_DUPLICATE,
  ERR_NAME_INVALID,
  ERR_NOT_FOUND,
  isValidName,
  NAME_MAX_LENGTH,
  normalizeName,
  orderedDays,
  reminderLabel,
  slugOf,
  updateGoal,
  updateReminder,
  updateSchedule,
  withScheduleChange,
} from '@/domain/habitRules';
import { normalizeGoal } from '@/domain/reminder';
import { isActiveOn, isRest, restDaysOn, scheduleOf, streakOf } from '@/domain/schedule';
import { shouldNotify } from '@/domain/reminder';
import {
  canContinueRest,
  canCreateHabit,
  isAcceptableRestInput,
  maxRestDays,
  nextStepAfterWeekly,
  parseCustomRest,
  restCapMessage,
  stepRestDays,
  toggleRestDay,
  WEEKLY_OPTIONS,
} from '@/domain/weeklyGoal';
import { HABIT_PALETTE } from '@/theme';
import type { Habit } from '@/types/habit';
import { addDays } from '@/utils/date';
import { buildMockHabits } from '@/constants/mockData';
import { range } from './helpers';

const habit = (over: Partial<Habit> = {}): Habit => ({
  id: 'h',
  name: 'Read',
  color: '#60A5FA',
  completedDates: [],
  daysPerWeek: 7,
  restDays: [],
  createdDate: '2024-06-01',
  scheduleHistory: [],
  archived: false,
  goal: null,
  reminderEnabled: false,
  reminderTime: null,
  ...over,
});

describe('HabitNameRules (Kotlin HabitNameRulesTest)', () => {
  it('trims surrounding spaces', () => expect(normalizeName('  Read books \n')).toBe('Read books'));

  it('empty and whitespace-only names are rejected', () => {
    for (const s of ['', ' ', '   ', '\t\n']) expect(isValidName(s, 'Old')).toBe(false);
  });

  it('save is only offered for a valid, changed name', () => {
    expect(canSaveName('Morning run', 'Run')).toBe(true);
    expect(canSaveName('  Morning run  ', 'Run')).toBe(true);
    expect(canSaveName('Run', 'Run')).toBe(false); // unchanged
    expect(canSaveName('  Run  ', 'Run')).toBe(false); // unchanged once trimmed
    expect(canSaveName('   ', 'Run')).toBe(false);
    expect(canSaveName('', 'Run')).toBe(false);
  });

  it('length is capped at 100 but an existing long name is kept', () => {
    expect(NAME_MAX_LENGTH).toBe(100);
    expect(isValidName('a'.repeat(100), 'x')).toBe(true);
    expect(isValidName('a'.repeat(101), 'x')).toBe(false);
    const long = 'b'.repeat(120);
    expect(isValidName(long, long)).toBe(true); // legacy name not rejected
    expect(canSaveName(long, long)).toBe(false);
  });

  it('the slug matches the habit route', () => {
    expect(slugOf('Job  Apply')).toBe('job-apply');
    expect(slugOf('Job Apply')).toBe(slugOf('job apply'));
  });
});

describe('creating a habit: weekly target and rest days', () => {
  it('offers 5, 6 or 7 days a week with 2, 1 or 0 rest days', () => {
    expect(WEEKLY_OPTIONS).toEqual([[5, '2 rest days'], [6, '1 rest day'], [7, '0 rest days']]);
  });

  it('rest days to pick = 7 - days per week', () => {
    expect(maxRestDays(5)).toBe(2);
    expect(maxRestDays(6)).toBe(1);
    expect(maxRestDays(7)).toBe(0);
    expect(maxRestDays(null)).toBe(0);
    expect(daysPerWeekFor(['Sat', 'Sun'])).toBe(5);
    expect(daysPerWeekFor([])).toBe(7);
  });

  it('a custom number of rest days (0 to 6) sets the weekly target to 7 minus it', () => {
    for (let n = 0; n <= 6; n++) {
      const c = parseCustomRest(String(n));
      expect(c.valid && c.daysPerWeek).toBe(7 - n);
    }
    expect(parseCustomRest('7')).toEqual({ valid: false });
    expect(parseCustomRest('-1')).toEqual({ valid: false });
    expect(parseCustomRest('')).toEqual({ valid: false });
    expect(parseCustomRest('abc')).toEqual({ valid: false });
  });

  it('describes the custom target: presets plain, others "(custom)", singular for one day', () => {
    expect((parseCustomRest('2') as { label: string }).label).toBe('→ 5 active days/week');
    expect((parseCustomRest('0') as { label: string }).label).toBe('→ 7 active days/week');
    expect((parseCustomRest('3') as { label: string }).label).toBe('→ 4 active days/week (custom)');
    expect((parseCustomRest('6') as { label: string }).label).toBe('→ 1 active day/week (custom)');
  });

  it('the stepper stays between 0 and 6', () => {
    expect(stepRestDays(0, -1)).toBe(0);
    expect(stepRestDays(6, 1)).toBe(6);
    expect(stepRestDays(2, 1)).toBe(3);
    expect(stepRestDays(2, -1)).toBe(1);
  });

  it('the custom field accepts up to two digits only', () => {
    expect(isAcceptableRestInput('')).toBe(true);
    expect(isAcceptableRestInput('3')).toBe(true);
    expect(isAcceptableRestInput('12')).toBe(true);
    expect(isAcceptableRestInput('123')).toBe(false);
    expect(isAcceptableRestInput('a')).toBe(false);
    expect(isAcceptableRestInput('1.')).toBe(false);
  });

  it('a 7-day habit skips the rest-day step', () => {
    expect(nextStepAfterWeekly(7)).toBe('create');
    expect(nextStepAfterWeekly(5)).toBe('rest');
    expect(nextStepAfterWeekly(1)).toBe('rest');
  });

  it('continue needs exactly the allowed number of rest days', () => {
    expect(canContinueRest(1, 5)).toBe(false);
    expect(canContinueRest(2, 5)).toBe(true);
    expect(canContinueRest(3, 5)).toBe(false);
    expect(canContinueRest(0, 7)).toBe(true);
  });

  it('picking more rest days than allowed is refused with a message', () => {
    let r = toggleRestDay([], 'Sat', 2);
    r = toggleRestDay(r.restDays, 'Sun', 2);
    expect(r).toEqual({ restDays: ['Sat', 'Sun'], error: false });
    const over = toggleRestDay(r.restDays, 'Mon', 2);
    expect(over).toEqual({ restDays: ['Sat', 'Sun'], error: true });
    expect(restCapMessage(2)).toBe('You already selected 2 rest days.');
    expect(restCapMessage(1)).toBe('You already selected 1 rest day.');
    // tapping a selected day removes it and clears the error
    expect(toggleRestDay(r.restDays, 'Sun', 2)).toEqual({ restDays: ['Sat'], error: false });
  });

  it('create is enabled for any non-blank name (no length cap when creating)', () => {
    expect(canCreateHabit('Run')).toBe(true);
    expect(canCreateHabit('  Run  ')).toBe(true);
    expect(canCreateHabit('   ')).toBe(false);
    expect(canCreateHabit('')).toBe(false);
    expect(canCreateHabit('x'.repeat(500))).toBe(true);
  });

  it('the colour palette is the shared 18 distinct colours', () => {
    expect(HABIT_PALETTE).toHaveLength(18);
    expect(new Set(HABIT_PALETTE.map((c) => c.color)).size).toBe(18);
  });
});

describe('editing name and colour (AppViewModel.editHabit)', () => {
  const habits = [habit({ id: 'a', name: 'Read', color: '#60A5FA', completedDates: ['2024-06-03', '2024-06-04'] }), habit({ id: 'b', name: 'Run', color: '#4ADE80' })];

  it('changes only the colour (the name is untouched)', () => {
    const r = editHabit(habits, 'a', 'Read', '#FB7185');
    expect(r.error).toBeNull();
    expect(r.habits[0]).toMatchObject({ name: 'Read', color: '#FB7185' });
  });

  it('changes only the name, trimmed, and keeps the colour', () => {
    const r = editHabit(habits, 'a', '  Read books  ', '#60A5FA');
    expect(r.error).toBeNull();
    expect(r.habits[0]).toMatchObject({ name: 'Read books', color: '#60A5FA' });
  });

  it('changes both', () => {
    const r = editHabit(habits, 'a', 'Study', '#FB7185');
    expect(r.habits[0]).toMatchObject({ name: 'Study', color: '#FB7185' });
  });

  it('writes nothing when nothing changed (also with only spaces added)', () => {
    const r = editHabit(habits, 'a', '  Read ', '#60a5fa'); // same name once trimmed, same colour (case-insensitive)
    expect(r.error).toBeNull();
    expect(r.habits).toEqual(habits);
  });

  it('rejects an empty or blank name', () => {
    for (const bad of ['', '   ', '\t']) {
      const r = editHabit(habits, 'a', bad, '#FB7185');
      expect(r.error).toBe(ERR_NAME_INVALID);
      expect(r.habits).toEqual(habits); // nothing changed, not even the colour
    }
    expect(ERR_NAME_INVALID).toBe('Enter a habit name (up to 100 characters).');
  });

  it('rejects a name over 100 characters, but keeps an existing long name when only the colour changes', () => {
    expect(editHabit(habits, 'a', 'x'.repeat(101), '#60A5FA').error).toBe(ERR_NAME_INVALID);
    const long = 'L'.repeat(130);
    const withLong = [habit({ id: 'l', name: long })];
    expect(editHabit(withLong, 'l', long, '#FB7185').error).toBeNull();
    expect(editHabit(withLong, 'l', long, '#FB7185').habits[0].color).toBe('#FB7185');
  });

  it('rejects a name another habit already uses (same route), ignoring case and spacing', () => {
    expect(editHabit(habits, 'a', 'Run', '#60A5FA').error).toBe(ERR_NAME_DUPLICATE);
    expect(editHabit(habits, 'a', '  rUN ', '#60A5FA').error).toBe(ERR_NAME_DUPLICATE);
    expect(editHabit([habit({ id: 'x', name: 'Job Apply' }), habit({ id: 'y', name: 'Z' })], 'y', 'job   apply', '#60A5FA').error).toBe(ERR_NAME_DUPLICATE);
    expect(ERR_NAME_DUPLICATE).toBe('You already have a habit with this name.');
  });

  it("renaming to a different casing of its own name is allowed (it can't clash with itself)", () => {
    expect(editHabit(habits, 'a', 'read', '#60A5FA').error).toBeNull();
  });

  it('a rejected edit leaves every habit exactly as it was', () => {
    const r = editHabit(habits, 'a', 'Run', '#FB7185');
    expect(r.habits).toEqual(habits);
  });

  it('an unknown habit is reported', () => expect(editHabit(habits, 'nope', 'X', '#000000').error).toBe(ERR_NOT_FOUND));

  it('the new colour and name persist through later edits of other things in the session', () => {
    let hs = editHabit(habits, 'a', 'Read books', '#FB7185').habits;
    hs = hs.map((h) => (h.id === 'a' ? updateGoal(h, 'Finish 12 books') : h));
    hs = hs.map((h) => (h.id === 'a' ? updateReminder(h, true, '07:30') : h));
    hs = hs.map((h) => (h.id === 'a' ? updateSchedule(h, 6, ['Sun'], '2024-06-10') : h));
    expect(hs[0]).toMatchObject({ name: 'Read books', color: '#FB7185', goal: 'Finish 12 books', reminderEnabled: true });
    // and the other habit was never touched
    expect(hs[1]).toEqual(habits[1]);
  });

  it('editing never touches completions, streak history, schedule, goal, reminder or archive state', () => {
    const full = habit({
      id: 'a',
      name: 'Read',
      color: '#60A5FA',
      completedDates: range('2024-06-01', 20),
      daysPerWeek: 5,
      restDays: ['Sat', 'Sun'],
      scheduleHistory: [{ from: '2024-06-01', restDays: ['Sat', 'Sun'], daysPerWeek: 5 }],
      goal: 'Goal text',
      reminderEnabled: true,
      reminderTime: '08:00',
      archived: true,
    });
    const after = editHabit([full], 'a', 'Study', '#FB7185').habits[0];
    expect(after).toEqual({ ...full, name: 'Study', color: '#FB7185' });
    // the derived streak is identical before and after
    const sched = (h: Habit) => scheduleOf(h, []);
    expect(streakOf(sched(after), '2024-06-20')).toEqual(streakOf(sched(full), '2024-06-20'));
  });
});

describe('editing rest days (from tomorrow) - Kotlin ScheduleHistoryTest', () => {
  const today = '2024-06-12'; // Wednesday
  const tomorrow = addDays(today, 1);
  const none = new Set<string>();

  it('a first change records the previous schedule from the habit start', () => {
    const r = withScheduleChange([], new Set(['Sat', 'Sun']), 5, '2024-01-15', '2024-06-10', new Set(['Wed', 'Sun']), 5);
    expect(r).toEqual([
      { from: '2024-01-15', restDays: ['Sat', 'Sun'], daysPerWeek: 5 },
      { from: '2024-06-10', restDays: ['Wed', 'Sun'], daysPerWeek: 5 },
    ]);
  });

  it('a second change on the same day replaces the first', () => {
    const base = [{ from: '2024-06-01', restDays: ['Sat', 'Sun'], daysPerWeek: 5 }];
    const once = withScheduleChange(base, new Set(['Sat', 'Sun']), 5, '2024-06-01', '2024-06-10', new Set(['Wed', 'Sun']), 5);
    const twice = withScheduleChange(once, new Set(['Wed', 'Sun']), 5, '2024-06-01', '2024-06-10', new Set(['Sun']), 6);
    expect(twice).toEqual([
      { from: '2024-06-01', restDays: ['Sat', 'Sun'], daysPerWeek: 5 },
      { from: '2024-06-10', restDays: ['Sun'], daysPerWeek: 6 },
    ]);
  });

  it('a change on the creation day leaves one period', () => {
    const r = withScheduleChange([{ from: '2024-06-10', restDays: ['Sat', 'Sun'], daysPerWeek: 5 }], new Set(['Sat', 'Sun']), 5, '2024-06-10', '2024-06-10', new Set(['Wed', 'Sun']), 5);
    expect(r).toEqual([{ from: '2024-06-10', restDays: ['Wed', 'Sun'], daysPerWeek: 5 }]);
  });

  it('rest days are stored in week order', () => {
    expect(orderedDays(['Sun', 'Mon', 'Wed'])).toEqual(['Mon', 'Wed', 'Sun']);
  });

  it('each day uses the schedule in effect then; before the first period the first applies', () => {
    const history = [
      { from: '2024-06-01', restDays: ['Sat', 'Sun'], daysPerWeek: 5 },
      { from: '2024-06-10', restDays: ['Wed', 'Sun'], daysPerWeek: 5 },
    ];
    const wedSun = new Set(['Wed', 'Sun']);
    expect(restDaysOn(history, wedSun, '2024-06-08')).toEqual(new Set(['Sat', 'Sun']));
    expect(restDaysOn(history, wedSun, '2024-06-12')).toEqual(wedSun);
    expect(restDaysOn(history, wedSun, '2024-05-01')).toEqual(new Set(['Sat', 'Sun']));
    expect(restDaysOn([], wedSun, '2024-05-01')).toEqual(wedSun);
  });

  it('updateSchedule applies from tomorrow, not today, and a past Wednesday stays active', () => {
    const h = updateSchedule(habit({ createdDate: '2024-06-01' }), 5, ['Wed', 'Thu'], today);
    expect(h.daysPerWeek).toBe(5);
    expect(h.restDays).toEqual(['Wed', 'Thu']);
    const s = scheduleOf(h, []);
    expect(isRest(s, today)).toBe(false); // today (a Wednesday) is unchanged
    expect(isRest(s, tomorrow)).toBe(true); // Thursday: a rest day from tomorrow
    expect(isRest(s, '2024-06-05')).toBe(false); // a past Wednesday stays active
    expect(h.scheduleHistory.map((p) => p.from)).toEqual(['2024-06-01', tomorrow]);
  });

  it('editing again before tomorrow replaces the pending change', () => {
    let h = updateSchedule(habit({ createdDate: '2024-06-01' }), 6, ['Sat'], today);
    h = updateSchedule(h, 6, ['Sun'], today);
    expect(h.scheduleHistory).toEqual([
      { from: '2024-06-01', restDays: [], daysPerWeek: 7 },
      { from: tomorrow, restDays: ['Sun'], daysPerWeek: 6 },
    ]);
  });

  it('does not change the streak or turn a missed day into a rest day', () => {
    // Every day active; Mon 10 missed, Tue 11 and Wed 12 (today) done. Mondays become rest from tomorrow.
    const before = habit({ createdDate: '2024-06-01', completedDates: ['2024-06-11', '2024-06-12'] });
    const after = updateSchedule(before, 6, ['Mon'], today);
    expect(streakOf(scheduleOf(after, []), today)).toEqual(streakOf(scheduleOf(before, []), today));
    expect(isRest(scheduleOf(after, []), '2024-06-10')).toBe(false); // the missed Monday is still a missed active day
    expect(isRest(scheduleOf(after, []), '2024-06-17')).toBe(true); // next Monday is a rest day
  });

  it("does not rewrite past completion percentages", () => {
    const before = habit({ createdDate: '2024-06-01', completedDates: ['2024-06-11', '2024-06-12'] });
    const after = updateSchedule(before, 6, ['Mon'], today);
    const window = ['2024-06-12', '2024-06-11', '2024-06-10', '2024-06-09', '2024-06-08'];
    expect(percent(daysCompletion(scheduleOf(after, []), window, today))).toBe(percent(daysCompletion(scheduleOf(before, []), window, today)));
  });

  it("today's reminder and progress still follow today's schedule after an edit", () => {
    // Today (Wed) becomes a rest day only from next week: today's reminder still applies.
    const h = updateSchedule(habit({ createdDate: '2024-06-01' }), 6, ['Wed'], today);
    const s = scheduleOf(h, []);
    expect(shouldNotify(s, true, today)).toBe(true);
    expect(shouldNotify(s, true, '2024-06-19')).toBe(false);
    expect(isActiveOn(s, today)).toBe(true);
    expect(dayProgress([s], today)).toEqual({ completed: 0, eligible: 1 });
  });

  it('keeps the whole completion history and uses the earlier of createdDate and first completion as the start', () => {
    const done = ['2024-05-20', '2024-05-21', '2024-06-11'];
    const h = updateSchedule(habit({ createdDate: '2024-06-01', completedDates: done }), 5, ['Sat', 'Sun'], today);
    expect(h.completedDates).toEqual(done);
    expect(h.scheduleHistory[0].from).toBe('2024-05-20'); // back-filled history is part of the habit
  });

  it('a habit with no history and no completions starts its history today', () => {
    const h = updateSchedule(habit({ createdDate: '' }), 5, ['Sat', 'Sun'], today);
    expect(h.scheduleHistory[0].from).toBe(today);
  });

  it('only the schedule fields change', () => {
    const before = habit({ name: 'Keep', color: '#FB7185', goal: 'G', reminderEnabled: true, reminderTime: '07:00', archived: true, completedDates: ['2024-06-10'] });
    const after = updateSchedule(before, 6, ['Sun'], today);
    expect({ ...after, daysPerWeek: before.daysPerWeek, restDays: before.restDays, scheduleHistory: before.scheduleHistory }).toEqual(before);
  });

  it('the weekly target follows the rest days (7 minus rest days)', () => {
    expect(updateSchedule(habit(), daysPerWeekFor(['Sat', 'Sun']), ['Sat', 'Sun'], today).daysPerWeek).toBe(5);
    expect(updateSchedule(habit(), daysPerWeekFor([]), [], today).daysPerWeek).toBe(7);
  });
});

describe('goal and reminder editing', () => {
  it('saves a trimmed goal, and clearing it removes it', () => {
    const h = updateGoal(habit(), '  Build 3 Python projects ');
    expect(h.goal).toBe('Build 3 Python projects');
    expect(updateGoal(h, '   ').goal).toBeNull();
    expect(updateGoal(h, null).goal).toBeNull();
    expect(updateGoal(habit(), 'x'.repeat(500)).goal).toHaveLength(300);
  });

  it('the goal sheet offers Save only when the goal would change', () => {
    const goal: string | null = 'A goal';
    expect(normalizeGoal('A goal ') !== goal).toBe(false); // trimmed-equal: not a change
    expect(normalizeGoal('Another') !== goal).toBe(true);
    expect(normalizeGoal('') !== goal).toBe(true); // clearing is a change
    expect(normalizeGoal('') !== null).toBe(false); // clearing an empty goal is not
  });

  it('turning the reminder on and off keeps the chosen time', () => {
    let h = updateReminder(habit(), true, '18:45');
    expect(h).toMatchObject({ reminderEnabled: true, reminderTime: '18:45' });
    h = updateReminder(h, false, '18:45');
    expect(h).toMatchObject({ reminderEnabled: false, reminderTime: '18:45' }); // kept while off
    h = updateReminder(h, true, '18:45');
    expect(h.reminderTime).toBe('18:45');
  });

  it('an invalid time is never stored', () => {
    expect(updateReminder(habit({ reminderTime: '09:00' }), true, 'bogus').reminderTime).toBe('09:00');
    expect(updateReminder(habit(), true, 'bogus').reminderTime).toBe('09:00');
  });

  it('the reminder label: Off, the time, Paused, or Blocked', () => {
    expect(reminderLabel(habit(), true)).toBe('Off');
    expect(reminderLabel(habit({ reminderEnabled: true, reminderTime: '07:30' }), true)).toBe('7:30 AM');
    expect(reminderLabel(habit({ reminderEnabled: true, reminderTime: '19:05' }), true)).toBe('7:05 PM');
    expect(reminderLabel(habit({ reminderEnabled: true, reminderTime: '07:30' }), false)).toBe('Blocked');
    expect(reminderLabel(habit({ reminderEnabled: true, reminderTime: '07:30' }), true, false)).toBe('Paused');
    expect(reminderLabel(habit({ reminderEnabled: false, reminderTime: '07:30' }), true)).toBe('Off');
    expect(reminderLabel(habit({ reminderEnabled: true, reminderTime: 'bad' }), true)).toBe('Off');
  });

  it('editing the goal or reminder changes only those fields', () => {
    const before = habit({ name: 'Keep', color: '#FB7185', completedDates: ['2024-06-10'], restDays: ['Sun'], daysPerWeek: 6 });
    expect({ ...updateGoal(before, 'G'), goal: null }).toEqual(before);
    expect({ ...updateReminder(before, true, '08:00'), reminderEnabled: false, reminderTime: null }).toEqual(before);
  });
});

describe('mock data sanity for editing tests', () => {
  it('every mock habit has the fields the editor needs', () => {
    for (const h of buildMockHabits('2026-11-21')) {
      expect(h).toMatchObject({ goal: null, reminderEnabled: false, reminderTime: null, archived: false });
      expect(HABIT_PALETTE.some((c) => c.color.toLowerCase() === h.color.toLowerCase())).toBe(true);
    }
  });
});
