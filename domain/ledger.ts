/**
 * In-memory port of the wallet ledger (android/.../data/WalletLedger.kt) plus the reward reconciliation that
 * `AppViewModel.reconcileRewards()` performs. Pure functions over an immutable `LedgerState`: no storage, no network.
 * (Phase 2 keeps the state in React; a later phase puts a `services/` layer behind the same shapes.)
 *
 * Rules preserved: every operation is idempotent by id; rewards that stop qualifying are reversed and restored if they
 * qualify again; spent coins are never taken below zero (the rest becomes `pending`, paid off first by later earnings);
 * applying a freeze consumes one owned freeze and never spends coins.
 */
import { addDays, isAfter, isBefore, monthOf, type DateKey } from '@/utils/date';
import { FREEZE_PRICE_COINS, MAX_FREEZE_APPLICATIONS_PER_MONTH, WELCOME_FREEZE_ID } from './freeze';
import { dailyRewardEligible, eligibleRewards, rewardTypeOf, rewardWindowStart, TxType, type RewardGrant, type RewardRecord } from './rewards';
import type { HabitSchedule } from './schedule';

export type WalletState = { coins: number; freezesOwned: number; pending: number };

export type FreezeApplication = { habitId: string; date: DateKey; paidWith: string };

export type LedgerState = {
  wallet: WalletState;
  rewards: Record<string, RewardRecord>;
  /** Transaction ids already recorded (the idempotency set). */
  txIds: string[];
  /** Every recorded transaction (the audit trail: balances are fully explained by it). */
  transactions: Tx[];
  freezes: FreezeApplication[];
};

export const emptyLedger = (): LedgerState => ({ wallet: { coins: 0, freezesOwned: 0, pending: 0 }, rewards: {}, txIds: [], transactions: [], freezes: [] });

export type RejectReason = 'InsufficientCoins' | 'NoFreezes' | 'MonthlyLimit' | 'HoldLimit' | 'AlreadyFrozen' | 'NotEligible' | 'NoReward';

export const REJECT_MESSAGE: Record<RejectReason, string> = {
  InsufficientCoins: 'Not enough coins',
  NoFreezes: 'No Streak Freezes Available',
  MonthlyLimit: `Monthly freeze limit reached (${MAX_FREEZE_APPLICATIONS_PER_MONTH}/month)`,
  HoldLimit: 'You already own all the freezes you can use this month',
  AlreadyFrozen: 'This day is already protected by a freeze',
  NotEligible: "This day can't be protected by a freeze",
  NoReward: 'Nothing to reward',
};

export type Tx = { id: string; type: string; coinDelta: number; freezeDelta: number; balanceAfter: number; pendingDelta: number };

export type LedgerResult =
  | { kind: 'done'; state: LedgerState; tx: Tx }
  | { kind: 'duplicate'; state: LedgerState }
  | { kind: 'rejected'; state: LedgerState; reason: RejectReason };

/** The dates a habit has been frozen on (what `scheduleOf` needs). */
export const freezeDatesFor = (s: LedgerState, habitId: string): DateKey[] => s.freezes.filter((f) => f.habitId === habitId).map((f) => f.date);

/** Freezes applied to dates in `month` ("yyyy-MM"), across all habits. */
export const freezeCount = (s: LedgerState, month: string) => s.freezes.filter((f) => monthOf(f.date) === month).length;

/** Freezes that can still be bought this month: the monthly allowance minus applied and already-owned ones (`freezesLeft`). */
export const freezesLeft = (s: LedgerState, today: DateKey): number =>
  Math.max(0, MAX_FREEZE_APPLICATIONS_PER_MONTH - freezeCount(s, monthOf(today)) - s.wallet.freezesOwned);

/** `canBuyFreeze`: enough coins and at least one freeze still buyable this month. */
export const canBuyFreeze = (s: LedgerState, today: DateKey): boolean => s.wallet.coins >= FREEZE_PRICE_COINS && freezesLeft(s, today) > 0;

export function grantReward(s: LedgerState, g: RewardGrant): LedgerResult {
  if (g.amount <= 0) return { kind: 'rejected', state: s, reason: 'NoReward' };
  const rec = s.rewards[g.id];
  // Rewards granted before reward records existed are recognised by their original transaction (Kotlin `transactionCoinDelta`).
  if (rec?.active || (!rec && s.transactions.some((t) => t.id === g.id))) return { kind: 'duplicate', state: s };
  const cycle = (rec?.cycle ?? 0) + 1;
  const txId = cycle === 1 ? g.id : `${g.id}_grant${cycle}`;
  if (cycle > 1 && s.txIds.includes(txId)) return { kind: 'duplicate', state: s };
  const w = s.wallet;
  const applied = Math.min(w.pending, g.amount);
  const next: WalletState = { ...w, coins: w.coins + g.amount - applied, pending: w.pending - applied };
  const tx: Tx = { id: txId, type: cycle === 1 ? g.type : TxType.RESTORED, coinDelta: g.amount - applied, freezeDelta: 0, balanceAfter: next.coins, pendingDelta: -applied };
  const record: RewardRecord = { id: g.id, active: true, cycle, amount: g.amount, type: rec?.type ?? g.type, date: g.date, habitId: g.habitId, milestone: g.milestone };
  return { kind: 'done', tx, state: { ...s, wallet: next, txIds: [...s.txIds, txId], transactions: [...s.transactions, tx], rewards: { ...s.rewards, [g.id]: record } } };
}

export function revokeReward(s: LedgerState, id: string): LedgerResult {
  const rec = s.rewards[id];
  const legacy = rec ? undefined : s.transactions.find((t) => t.id === id && t.coinDelta > 0);
  const current: RewardRecord | undefined = rec ?? (legacy ? { id, active: true, cycle: 1, amount: legacy.coinDelta, type: rewardTypeOf(id), date: id.startsWith('daily_') ? id.slice('daily_'.length) : undefined } : undefined);
  if (!current || !current.active) return { kind: 'duplicate', state: s };
  const txId = `${id}_rev${current.cycle}`;
  if (s.txIds.includes(txId)) return { kind: 'duplicate', state: s };
  const w = s.wallet;
  const taken = Math.min(w.coins, current.amount);
  const next: WalletState = { ...w, coins: w.coins - taken, pending: w.pending + current.amount - taken };
  const tx: Tx = { id: txId, type: TxType.REVERSAL, coinDelta: taken === 0 ? 0 : -taken, freezeDelta: 0, balanceAfter: next.coins, pendingDelta: current.amount - taken };
  return { kind: 'done', tx, state: { ...s, wallet: next, txIds: [...s.txIds, txId], transactions: [...s.transactions, tx], rewards: { ...s.rewards, [id]: { ...current, active: false } } } };
}

/** The one free Streak Freeze for a new user: +1 to inventory, no coins, fixed id so it happens once. */
export function grantWelcomeFreeze(s: LedgerState): LedgerResult {
  if (s.txIds.includes(WELCOME_FREEZE_ID)) return { kind: 'duplicate', state: s };
  const next = { ...s.wallet, freezesOwned: s.wallet.freezesOwned + 1 };
  const tx: Tx = { id: WELCOME_FREEZE_ID, type: TxType.WELCOME_FREEZE, coinDelta: 0, freezeDelta: 1, balanceAfter: next.coins, pendingDelta: 0 };
  return { kind: 'done', tx, state: { ...s, wallet: next, txIds: [...s.txIds, WELCOME_FREEZE_ID], transactions: [...s.transactions, tx] } };
}

/**
 * Buys one freeze into inventory for `price` coins (FREEZE_PRICE_COINS today). `requestId` identifies one purchase
 * attempt, so retries and double taps of the same attempt buy once. You can't hold more freezes than you can still
 * apply this month.
 */
export function buyFreeze(s: LedgerState, requestId: string, today: DateKey, price = FREEZE_PRICE_COINS, usedThisMonth?: number): LedgerResult {
  const id = `freeze_buy_${requestId}`;
  if (s.txIds.includes(id)) return { kind: 'duplicate', state: s };
  const w = s.wallet;
  // `usedThisMonth` is the `freezeMonths/{yyyy-MM}` counter a Firestore transaction reads (Kotlin `LedgerTxn.freezeCount`); the guest ledger counts its own applications.
  const used = usedThisMonth ?? freezeCount(s, monthOf(today));
  if (w.coins < price) return { kind: 'rejected', state: s, reason: 'InsufficientCoins' };
  if (used >= MAX_FREEZE_APPLICATIONS_PER_MONTH) return { kind: 'rejected', state: s, reason: 'MonthlyLimit' };
  if (w.freezesOwned >= MAX_FREEZE_APPLICATIONS_PER_MONTH - used) return { kind: 'rejected', state: s, reason: 'HoldLimit' };
  const next: WalletState = { coins: w.coins - price, freezesOwned: w.freezesOwned + 1, pending: w.pending };
  const tx: Tx = { id, type: 'freeze_purchase', coinDelta: -price, freezeDelta: 1, balanceAfter: next.coins, pendingDelta: 0 };
  return { kind: 'done', tx, state: { ...s, wallet: next, txIds: [...s.txIds, id], transactions: [...s.transactions, tx] } };
}

/** Day eligibility is checked with `checkFreeze` first. Uses one owned freeze; never spends coins. */
export function applyFreeze(s: LedgerState, habitId: string, date: DateKey, usedThisMonth?: number): LedgerResult {
  const key = `${habitId}_${date}`;
  if (s.freezes.some((f) => `${f.habitId}_${f.date}` === key)) return { kind: 'rejected', state: s, reason: 'AlreadyFrozen' };
  const used = usedThisMonth ?? freezeCount(s, monthOf(date));
  if (used >= MAX_FREEZE_APPLICATIONS_PER_MONTH) return { kind: 'rejected', state: s, reason: 'MonthlyLimit' };
  if (s.wallet.freezesOwned <= 0) return { kind: 'rejected', state: s, reason: 'NoFreezes' };
  const next = { ...s.wallet, freezesOwned: s.wallet.freezesOwned - 1 };
  const txId = `freeze_apply_${key}`;
  const tx: Tx = { id: txId, type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: next.coins, pendingDelta: 0 };
  return {
    kind: 'done',
    tx,
    state: { ...s, wallet: next, txIds: [...s.txIds, txId], transactions: [...s.transactions, tx], freezes: [...s.freezes, { habitId, date, paidWith: 'inventory' }] },
  };
}

// ─── Reward reconciliation (AppViewModel.reconcileRewards) ───────────────────

export type MilestoneEvent = { habitId: string; milestone: number; coins: number };

export type ReconcileOutcome = {
  state: LedgerState;
  /** Coins from daily rewards that reached the balance (milestone coins excluded): the coin popup amount. */
  dailyCoins: number;
  celebrations: MilestoneEvent[];
  /** User-facing notice, or null. */
  notice: string | null;
};

/** What `reconcileRewards` decided to do: the rewards to grant and the reward ids to reverse (in that order of execution: reversals first). */
export type RewardPlan = { grants: RewardGrant[]; reversals: string[] };

/**
 * The decision half of `AppViewModel.reconcileRewards()`: which rewards the current history qualifies for and which
 * rewards in effect no longer qualify. New rewards are only issued for dates in the current calendar month; rewards in
 * effect that no longer qualify are reversed. `editedOldDates` are (habit, date) completions just removed from days
 * before this month, so their old rewards can be corrected (never issued). `rewards` are the reward records in effect.
 * Pure: it runs no ledger operation, so the same decision drives the guest ledger and the Firestore ledger.
 */
export function planRewards(
  rewards: Readonly<Record<string, RewardRecord>>,
  schedules: readonly HabitSchedule[],
  today: DateKey,
  editedOldDates: ReadonlyArray<{ habitId: string; date: DateKey }> = [],
): RewardPlan {
  const from = rewardWindowStart(today);
  const active = Object.values(rewards).filter((r) => r.active);
  const eligible = eligibleRewards(schedules, today, active);
  const stillEligibleOld = [...new Set(editedOldDates.map((e) => e.date))].filter((d) => dailyRewardEligible(schedules, d)).map((d) => `daily_${d}`);
  const eligibleIds = new Set([...eligible.map((g) => g.id), ...stillEligibleOld]);
  const grants = eligible.filter((g) => !rewards[g.id]?.active);

  const windowDailies: string[] = [];
  for (let d = from; !isAfter(d, today); d = addDays(d, 1)) windowDailies.push(`daily_${d}`);
  const inWindow = active.filter((r) => r.date !== undefined && !isBefore(r.date, from)).map((r) => r.id);
  const editedCandidates = editedOldDates.flatMap(({ habitId, date }) => [
    `daily_${date}`,
    ...active.filter((r) => r.habitId === habitId && r.type === TxType.MILESTONE).map((r) => r.id),
  ]);
  const reversals = [...new Set([...inWindow, ...windowDailies, ...editedCandidates])].filter((id) => !eligibleIds.has(id));
  return { grants, reversals };
}

/** One executed ledger operation of a reconciliation, as `summarizeRewards` needs it. */
export type RewardStep = { kind: 'reversal'; tx: Tx } | { kind: 'grant'; grant: RewardGrant; tx: Tx };

/**
 * The reporting half of `reconcileRewards()`: what the user is told. Only operations that actually changed the ledger
 * (`done`) are passed in. The coin popup counts daily coins that reached the balance (milestone coins are celebrated by
 * their own screen), and only the first grant of a milestone is celebrated (a restored reward is not a new achievement).
 */
export function summarizeRewards(steps: readonly RewardStep[]): { dailyCoins: number; celebrations: MilestoneEvent[]; notice: string | null } {
  let earned = 0;
  let applied = 0;
  let milestoneCoins = 0;
  let reversed = 0;
  let uncovered = 0;
  const celebrations: MilestoneEvent[] = [];
  for (const step of steps) {
    if (step.kind === 'reversal') {
      reversed += -step.tx.coinDelta + step.tx.pendingDelta;
      uncovered += step.tx.pendingDelta;
    } else {
      earned += step.tx.coinDelta;
      applied += -step.tx.pendingDelta;
      const g = step.grant;
      if (g.milestone !== undefined && g.habitId !== undefined && step.tx.type === TxType.MILESTONE) {
        milestoneCoins += step.tx.coinDelta;
        celebrations.push({ habitId: g.habitId, milestone: g.milestone, coins: g.amount });
      }
    }
  }
  const notice =
    uncovered > 0
      ? 'Coin reward adjusted. Tap ⓘ in your wallet for details.'
      : reversed > 0
        ? 'Daily reward adjusted.'
        : applied > 0
          ? `${applied} ${applied === 1 ? 'coin' : 'coins'} went toward balancing an earlier reward adjustment.`
          : null;
  return { dailyCoins: Math.max(0, earned - milestoneCoins), celebrations, notice };
}

/** Brings the (guest) ledger in line with the current history: the plan, then each operation applied in order. */
export function reconcileRewards(
  start: LedgerState,
  schedules: readonly HabitSchedule[],
  today: DateKey,
  editedOldDates: ReadonlyArray<{ habitId: string; date: DateKey }> = [],
): ReconcileOutcome {
  let s = start;
  const plan = planRewards(s.rewards, schedules, today, editedOldDates);
  const steps: RewardStep[] = [];
  for (const id of plan.reversals) {
    const r = revokeReward(s, id);
    s = r.state;
    if (r.kind === 'done') steps.push({ kind: 'reversal', tx: r.tx });
  }
  for (const g of plan.grants) {
    const r = grantReward(s, g);
    s = r.state;
    if (r.kind === 'done') steps.push({ kind: 'grant', grant: g, tx: r.tx });
  }
  return { state: s, ...summarizeRewards(steps) };
}
