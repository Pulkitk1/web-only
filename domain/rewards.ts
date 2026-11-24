/**
 * Port of `RewardRules` (android/.../data/RewardRules.kt) and the reward constants (data/WalletLedger.kt).
 *
 * New coins can only be earned for activity dated in the current local calendar month. Earlier months can be edited
 * for tracking and streaks but never issue new rewards.
 */
import { addDays, isAfter, isBefore, parseKey, type DateKey } from '@/utils/date';
import { countsForRewards, isRest, streakOf, type HabitSchedule } from './schedule';

export const DAILY_REWARD = 1;
/** Bonus coins for reaching each streak milestone, per habit. */
export const MILESTONE_BONUSES: Readonly<Record<number, number>> = { 15: 5, 30: 5, 45: 5, 60: 5, 75: 10, 100: 20 };
export const STREAK_MILESTONES = Object.keys(MILESTONE_BONUSES)
  .map(Number)
  .sort((a, b) => a - b);
export const milestoneBonus = (m: number) => MILESTONE_BONUSES[m];

export const TxType = {
  DAILY: 'daily_completion',
  MILESTONE: 'streak_milestone',
  RESTORED: 'reward_restored',
  REVERSAL: 'reward_reversal',
  WELCOME_FREEZE: 'welcome_freeze',
} as const;

/** Reward type from its id (`daily_…` / `milestone_…`), for rewards recorded before reward records existed (Kotlin `rewardTypeOf`). */
export const rewardTypeOf = (rewardId: string): string => (rewardId.startsWith('milestone_') ? TxType.MILESTONE : TxType.DAILY);

/** A reward the user qualifies for. `id` is the ledger idempotency key. */
export type RewardGrant = { id: string; type: string; amount: number; date: DateKey; habitId?: string; milestone?: number };

/** Current state of one reward: whether it is in effect, and how many grant/reversal cycles it went through. */
export type RewardRecord = {
  id: string;
  active: boolean;
  cycle: number;
  amount: number;
  type: string;
  date?: DateKey;
  habitId?: string;
  milestone?: number;
};

/** First day on which new rewards can still be earned: the first of the current local month. */
export const rewardWindowStart = (today: DateKey): DateKey => `${today.slice(0, 7)}-01`;

export function dailyRewardEligible(habits: readonly HabitSchedule[], date: DateKey): boolean {
  // An imported habit's days up to its `rewardsIgnoredThrough` cutoff are not part of the day at all: it can neither complete it nor block it.
  const active = habits.filter((h) => countsForRewards(h, date));
  return active.length > 0 && active.every((h) => h.completed.has(date));
}

/**
 * Milestones reached by `habit` whose milestone day falls on `from`..`today`. A milestone already recorded in
 * `existing` for the same habit and run is kept as that same reward, wherever back-filling has moved its date.
 */
export function milestonesReached(
  habit: HabitSchedule,
  today: DateKey,
  from: DateKey = rewardWindowStart(today),
  existing: readonly RewardRecord[] = [],
): RewardGrant[] {
  const result = streakOf(habit, today);
  return result.runs.flatMap((run) => {
    // Milestones count completed active days only (rest-day completions extend the streak but never earn coins).
    const counted = [...habit.completed].filter((d) => !isBefore(d, run.start) && !isAfter(d, run.end) && !isRest(habit, d)).sort();
    const runKey = counted[0];
    if (runKey === undefined) return [];
    const grants: RewardGrant[] = [];
    for (const m of STREAK_MILESTONES) {
      const day = counted[m - 1];
      if (day === undefined) continue;
      const prior = existing.find(
        (r) =>
          r.habitId === habit.id &&
          r.milestone === m &&
          r.date !== undefined &&
          parseKey(r.date) !== null &&
          !isBefore(r.date, run.start) &&
          !isAfter(r.date, run.end),
      );
      if (prior) {
        grants.push({ id: prior.id, type: TxType.MILESTONE, amount: prior.amount, date: prior.date!, habitId: habit.id, milestone: m });
      } else if (isBefore(day, from) || isAfter(day, today)) {
        continue; // reached before this month: history only, no coins
      } else if (habit.rewardsIgnoredThrough !== undefined && !isAfter(day, habit.rewardsIgnoredThrough)) {
        continue; // reached on an imported (historical) day: no coins
      } else {
        grants.push({ id: `milestone_${habit.id}_${m}_${runKey}`, type: TxType.MILESTONE, amount: milestoneBonus(m), date: day, habitId: habit.id, milestone: m });
      }
    }
    return grants;
  });
}

/** Which coin rewards the current history qualifies for. */
export function eligibleRewards(habits: readonly HabitSchedule[], today: DateKey, existing: readonly RewardRecord[] = []): RewardGrant[] {
  const from = rewardWindowStart(today);
  const daily: RewardGrant[] = [];
  for (let d = from; !isAfter(d, today); d = addDays(d, 1)) {
    if (dailyRewardEligible(habits, d)) daily.push({ id: `daily_${d}`, type: TxType.DAILY, amount: DAILY_REWARD, date: d });
  }
  return [...daily, ...habits.flatMap((h) => milestonesReached(h, today, from, existing))];
}
