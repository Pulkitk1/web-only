/**
 * Port of `FreezeRules` and the freeze constants.
 * Sources: android/.../data/RewardRules.kt (FreezeRules, FreezeEligibility), data/WalletLedger.kt (constants).
 * Verified rules: price 20 coins, max 3 applications per calendar month (of the protected date), 3-day recovery window,
 * one free welcome freeze for a new user.
 */
import { addDays, isAfter, isBefore, type DateKey } from '@/utils/date';
import { isRest, isScheduledOn, streakOf, type HabitSchedule } from './schedule';

export const FREEZE_PRICE_COINS = 20;
export const MAX_FREEZE_APPLICATIONS_PER_MONTH = 3;
export const STREAK_FREEZE_RECOVERY_DAYS = 3;
export const WELCOME_FREEZE_ID = 'welcome_freeze';

export type FreezeEligibility =
  | 'Eligible'
  | 'Future'
  | 'Today'
  | 'RestDay'
  | 'Completed'
  | 'AlreadyFrozen'
  | 'TooOld'
  | 'NotStarted'
  | 'EarlierDayFirst'
  | 'NoStreak';

/** Messages shown in the calendar's freeze sheet (Kotlin `FreezeEligibility.message`). */
export const FREEZE_ELIGIBILITY_MESSAGE: Record<FreezeEligibility, string> = {
  Eligible: '',
  Future: "You can't freeze a future day.",
  Today: "Today isn't over yet. Complete your habit to keep your streak.",
  RestDay: 'Rest days never break your streak, so no freeze is needed.',
  Completed: 'You completed this day, so no freeze is needed.',
  AlreadyFrozen: 'This day is already protected by a Streak Freeze.',
  TooOld: `Freezes can only protect missed days from the last ${STREAK_FREEZE_RECOVERY_DAYS} days.`,
  NotStarted: "This habit hadn't started yet on this day.",
  EarlierDayFirst: 'Protect the earlier missed day first. Each missed day needs its own freeze, oldest first.',
  NoStreak: 'There was no active streak to protect on this day.',
};

/** First day a freeze can recover: STREAK_FREEZE_RECOVERY_DAYS calendar days before `today`. */
export const windowStart = (today: DateKey): DateKey => addDays(today, -STREAK_FREEZE_RECOVERY_DAYS);

/** The streak alive at the start of `date` (`date` itself is treated as still open). */
export const streakEntering = (habit: HabitSchedule, date: DateKey): number => streakOf(habit, date).current;

/** Unprotected missed active days inside the window before `date`: the freezes that would have to come first. */
function earlierMisses(habit: HabitSchedule, date: DateKey, today: DateKey): Set<DateKey> {
  const out = new Set<DateKey>();
  for (let d = windowStart(today); isBefore(d, date); d = addDays(d, 1)) {
    if (isScheduledOn(habit, d) && !habit.completed.has(d) && !habit.freezes.has(d)) out.add(d);
  }
  return out;
}

export function checkFreeze(habit: HabitSchedule, date: DateKey, today: DateKey): FreezeEligibility {
  if (isAfter(date, today)) return 'Future';
  if (date === today) return 'Today';
  if (isRest(habit, date)) return 'RestDay';
  if (habit.completed.has(date)) return 'Completed';
  if (habit.freezes.has(date)) return 'AlreadyFrozen';
  if (isBefore(date, windowStart(today))) return 'TooOld';
  if (!isScheduledOn(habit, date)) return 'NotStarted';
  if (streakEntering(habit, date) === 0) {
    const withEarlier: HabitSchedule = { ...habit, freezes: new Set([...habit.freezes, ...earlierMisses(habit, date, today)]) };
    return streakEntering(withEarlier, date) > 0 ? 'EarlierDayFirst' : 'NoStreak';
  }
  return 'Eligible';
}

export const isFreezeEligible = (habit: HabitSchedule, date: DateKey, today: DateKey) =>
  checkFreeze(habit, date, today) === 'Eligible';

/** The most recent missed day that a freeze could protect, across all habits, or null. */
export function latestEligibleMiss(
  habits: readonly HabitSchedule[],
  today: DateKey,
): { habit: HabitSchedule; date: DateKey } | null {
  for (let i = 1; i <= STREAK_FREEZE_RECOVERY_DAYS; i++) {
    const d = addDays(today, -i);
    const habit = habits.find((h) => isFreezeEligible(h, d, today));
    if (habit) return { habit, date: d };
  }
  return null;
}
