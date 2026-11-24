/** Celebrations, reminders and goal rules (RestDayCelebrations.qualifies, milestone screen maths, HabitReminderRules, GoalWhyRules). */
import { describe, expect, it } from 'vitest';

import { enqueueMilestone, milestoneCounterRange, milestoneDayText, restDayQualifies, streakFillPct } from '@/domain/celebrations';
import { MILESTONE_BONUSES } from '@/domain/rewards';
import {
  DEFAULT_REMINDER_TIME,
  formatTime,
  formatTime12h,
  GOAL_MAX_LENGTH,
  normalizeGoal,
  parseTime,
  scheduledTime,
  shouldNotify,
  withinGrace,
} from '@/domain/reminder';
import { sched, WEEKENDS } from './helpers';

describe('rest-day celebration rule', () => {
  const day = '2024-06-08';
  it("only today's planned rest day qualifies", () => {
    expect(restDayQualifies(day, day, true)).toBe(true);
    expect(restDayQualifies(day, '2024-06-11', true)).toBe(false); // back-filled
    expect(restDayQualifies(day, day, false)).toBe(false); // ordinary day
  });
});

describe('milestone queue', () => {
  it('holds one entry per habit and milestone, oldest first', () => {
    let q = enqueueMilestone([], { habitId: 'a', milestone: 15, coins: 5 });
    q = enqueueMilestone(q, { habitId: 'b', milestone: 15, coins: 5 });
    q = enqueueMilestone(q, { habitId: 'a', milestone: 15, coins: 5 }); // duplicate
    q = enqueueMilestone(q, { habitId: 'a', milestone: 30, coins: 5 });
    expect(q.map((e) => `${e.habitId}:${e.milestone}`)).toEqual(['a:15', 'b:15', 'a:30']);
  });
});

describe('milestone counter (MilestoneCelebrationScreen)', () => {
  it('every milestone shows the day before, the day, and the day after (the three visible rows)', () => {
    for (const day of Object.keys(MILESTONE_BONUSES).map(Number)) {
      const { first, last, count, start, steps } = milestoneCounterRange(day);
      const rows = Array.from({ length: count }, (_, i) => first + i);
      expect(rows).toContain(day - 1);
      expect(rows).toContain(day);
      expect(rows).toContain(day + 1);
      expect(first).toBe(start - 1);
      expect(last).toBe(day + 1);
      expect(start + steps).toBe(day); // the roll ends on the milestone
    }
  });
  it('rolls six steps (fewer only for tiny milestones)', () => {
    expect(milestoneCounterRange(30).steps).toBe(6);
    expect(milestoneCounterRange(3).start).toBe(1);
  });
  it('labels rows "N  DAYS" with two spaces', () => expect(milestoneDayText(30)).toBe('30  DAYS'));
});

describe('streak celebration progress bar', () => {
  it('fills towards a 14-day goal, capped at 100%', () => {
    expect(streakFillPct(0)).toBe(0);
    expect(streakFillPct(7)).toBe(50);
    expect(streakFillPct(14)).toBe(100);
    expect(streakFillPct(71)).toBe(100);
  });
});

describe('habit reminder rules (HabitReminderRules)', () => {
  it('default time is 09:00', () => expect(DEFAULT_REMINDER_TIME).toBe('09:00'));

  it('parses valid "HH:mm" only', () => {
    expect(parseTime('09:00')).toEqual({ hour: 9, minute: 0 });
    expect(parseTime('23:59')).toEqual({ hour: 23, minute: 59 });
    for (const bad of ['24:00', '9:00', '09:60', 'noon', '', null, undefined]) expect(parseTime(bad as string)).toBeNull();
  });

  it('formats with leading zeros', () => expect(formatTime({ hour: 7, minute: 5 })).toBe('07:05'));

  it('shows the time as "h:mm a"', () => {
    expect(formatTime12h('09:00')).toBe('9:00 AM');
    expect(formatTime12h('00:30')).toBe('12:30 AM');
    expect(formatTime12h('12:00')).toBe('12:00 PM');
    expect(formatTime12h('18:45')).toBe('6:45 PM');
  });

  it('is scheduled only when enabled and the saved time is valid', () => {
    expect(scheduledTime(true, '08:15')).toEqual({ hour: 8, minute: 15 });
    expect(scheduledTime(false, '08:15')).toBeNull();
    expect(scheduledTime(true, 'bogus')).toBeNull();
  });

  const mon = '2024-06-03';
  it('notifies only for an enabled habit scheduled today that is not completed', () => {
    const h = sched('a', [], WEEKENDS, { createdDate: '2024-06-01' });
    expect(shouldNotify(h, true, mon)).toBe(true);
    expect(shouldNotify(h, false, mon)).toBe(false); // reminder off
    expect(shouldNotify(h, true, mon, false)).toBe(false); // master switch off
    expect(shouldNotify(null, true, mon)).toBe(false); // habit gone
    expect(shouldNotify(sched('a', [mon], WEEKENDS, { createdDate: '2024-06-01' }), true, mon)).toBe(false); // done
    expect(shouldNotify(h, true, '2024-06-08')).toBe(false); // Saturday: a rest day
    expect(shouldNotify(sched('a', [], [], { createdDate: '2024-06-10' }), true, mon)).toBe(false); // not started
  });

  it('drops reminders that run more than 3 hours late', () => {
    expect(withinGrace(0, 3 * 60 * 60 * 1000)).toBe(true);
    expect(withinGrace(0, 3 * 60 * 60 * 1000 + 1)).toBe(false);
  });
});

describe('goal (GoalWhyRules)', () => {
  it('trims, and treats empty as not set', () => {
    expect(normalizeGoal('  Build 3 Python projects  ')).toBe('Build 3 Python projects');
    expect(normalizeGoal('   ')).toBeNull();
    expect(normalizeGoal('')).toBeNull();
    expect(normalizeGoal(null)).toBeNull();
    expect(normalizeGoal(undefined)).toBeNull();
  });
  it('is capped at 300 characters', () => {
    expect(GOAL_MAX_LENGTH).toBe(300);
    expect(normalizeGoal('x'.repeat(500))).toHaveLength(300);
  });
});
