/**
 * Archive rules (android ArchivedHabits.kt, HabitsScreen.kt, SettingsScreen.kt): an archived habit is only hidden from
 * Home. It stays in the habit list in its place, still tracked (schedule, streaks, freezes, rewards), and unarchiving
 * only flips the flag.
 */
import type { Habit } from '@/types/habit';

/** The habits Home shows, in list order. */
export const homeHabits = <T extends Pick<Habit, 'archived'>>(habits: readonly T[]): T[] => habits.filter((h) => !h.archived);

/** The habits Settings › Archived Habits shows, in list order. */
export const archivedHabits = <T extends Pick<Habit, 'archived'>>(habits: readonly T[]): T[] => habits.filter((h) => h.archived);

/** Sets one habit's archived flag; every other field and every other habit is returned unchanged. */
export const withArchived = <T extends Pick<Habit, 'id' | 'archived'>>(habits: readonly T[], id: string, archived: boolean): T[] =>
  habits.map((h) => (h.id === id && h.archived !== archived ? { ...h, archived } : h));

/** The Settings row's subtitle. */
export const archivedRowSubtitle = (count: number): string => (count === 0 ? 'Hidden from Home, still tracked' : `${count} archived · still tracked`);
