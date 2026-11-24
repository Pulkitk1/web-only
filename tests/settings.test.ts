/**
 * Settings and Archived Habits rules: archive/unarchive keeps everything but the flag (android ArchivedHabits.kt:
 * "still tracked exactly as before"), Home and the archive list partition the habits in list order, the Settings row
 * subtitle, and the notification switches' persistence (NotificationPrefs, defaults on, scoped by account id).
 */
import { describe, expect, it } from 'vitest';

import { archivedHabits, archivedRowSubtitle, homeHabits, withArchived } from '@/domain/archive';
import { updateSchedule } from '@/domain/habitRules';
import { isRest, scheduleOf, streakOf } from '@/domain/schedule';
import { buildMockHabits } from '@/constants/mockData';
import { createDevicePrefs, MemoryStorage } from '@/services/devicePrefs';
import { PRIVACY_POLICY, APP_VERSION } from '@/domain/settingsContent';

const TODAY = '2026-11-21';
const habits = buildMockHabits(TODAY);
const ids = (hs: { id: string }[]) => hs.map((h) => h.id);

describe('archiving', () => {
  it('hides a habit from Home and lists it under Archived Habits, keeping list order', () => {
    const next = withArchived(habits, 'h2', true);
    expect(ids(homeHabits(next))).toEqual(['h1', 'h3', 'h4', 'h5']);
    expect(ids(archivedHabits(next))).toEqual(['h2']);
    const both = withArchived(next, 'h4', true);
    expect(ids(archivedHabits(both))).toEqual(['h2', 'h4']);
  });
  it('unarchiving returns the habit to its original place on Home', () => {
    const next = withArchived(withArchived(habits, 'h2', true), 'h2', false);
    expect(ids(homeHabits(next))).toEqual(['h1', 'h2', 'h3', 'h4', 'h5']);
    expect(archivedHabits(next)).toEqual([]);
  });
  it('only the flag changes: completions, schedule history, colour, goal and reminder stay', () => {
    const before = habits[0];
    const after = withArchived(habits, before.id, true)[0];
    expect({ ...after, archived: false }).toEqual(before);
    expect(withArchived([after], before.id, false)[0]).toEqual(before);
  });
  it('streaks, best streak and rest days are identical while archived (it keeps being tracked)', () => {
    for (const h of habits) {
      const archived = withArchived(habits, h.id, true).find((x) => x.id === h.id)!;
      const a = streakOf(scheduleOf(h, []), TODAY);
      const b = streakOf(scheduleOf(archived, []), TODAY);
      expect(b).toEqual(a);
      expect(isRest(scheduleOf(archived, []), '2026-11-14')).toBe(isRest(scheduleOf(h, []), '2026-11-14'));
    }
  });
  it('a schedule change made while archived is kept, with history, after unarchiving', () => {
    const archived = withArchived(habits, 'h1', true).find((h) => h.id === 'h1')!;
    const changed = updateSchedule(archived, 6, ['Sun'], TODAY);
    const restored = withArchived([changed], 'h1', false)[0];
    expect(restored.archived).toBe(false);
    expect(restored.scheduleHistory.length).toBeGreaterThan(habits[0].scheduleHistory.length);
    expect(restored.completedDates).toEqual(habits[0].completedDates);
    // The old Saturday rest day still counts for past days.
    expect(isRest(scheduleOf(restored, []), '2026-11-14')).toBe(true);
  });
  it('ignores unknown ids and no-op flips', () => {
    expect(withArchived(habits, 'nope', true)).toEqual(habits);
    expect(withArchived(habits, 'h1', false)[0]).toBe(habits[0]);
  });
  it('the Settings row says how many are archived', () => {
    expect(archivedRowSubtitle(0)).toBe('Hidden from Home, still tracked');
    expect(archivedRowSubtitle(1)).toBe('1 archived · still tracked');
    expect(archivedRowSubtitle(3)).toBe('3 archived · still tracked');
  });
});

describe('notification switches (NotificationPrefs)', () => {
  it('both default to on', () => {
    const p = createDevicePrefs(new MemoryStorage());
    expect(p.habitReminders('guest')).toBe(true);
    expect(p.streakAlerts('guest')).toBe(true);
  });
  it('save independently and survive a restart', () => {
    const storage = new MemoryStorage();
    const p = createDevicePrefs(storage);
    p.setHabitReminders('guest', false);
    expect(createDevicePrefs(storage).habitReminders('guest')).toBe(false);
    expect(createDevicePrefs(storage).streakAlerts('guest')).toBe(true);
    p.setStreakAlerts('guest', false);
    p.setHabitReminders('guest', true);
    expect(createDevicePrefs(storage).habitReminders('guest')).toBe(true);
    expect(createDevicePrefs(storage).streakAlerts('guest')).toBe(false);
  });
  it('are scoped by account id, with Kotlin\'s key names', () => {
    const storage = new MemoryStorage();
    const p = createDevicePrefs(storage);
    p.setHabitReminders('guest', false);
    expect(p.habitReminders('someone-else')).toBe(true);
    expect(storage.getItem('guest_habit_reminders')).toBe('false');
    p.setStreakAlerts('guest', false);
    expect(storage.getItem('guest_streak_alerts')).toBe('false');
  });
});

describe('static content', () => {
  it('the app version is the Kotlin versionName', () => expect(APP_VERSION).toBe('1.2.0'));
  it('the privacy policy has the six Kotlin sections in order', () => {
    expect(PRIVACY_POLICY.map(([t]) => t)).toEqual(['What we store', 'Stored only on this device', 'Guest mode', 'Services we use', "What we don't do", 'Deleting your data']);
  });
});
