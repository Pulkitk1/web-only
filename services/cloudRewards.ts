/**
 * Reward reconciliation for a signed-in account: the execution half of Kotlin's `AppViewModel.reconcileRewards()`.
 *
 * The decision (which rewards to grant or reverse) is the shared domain `planRewards`; the reporting is the shared
 * `summarizeRewards`; each operation is one Firestore transaction (`cloudLedger`). What this adds is Kotlin's bookkeeping
 * that keeps repeated calls cheap and safe:
 *   - `inFlight`: a reward whose operation is still running is never started twice (repeated taps, overlapping calls);
 *   - `known[id]`: the last known state of a reward (true = in effect, false = reversed/not granted), seeded from the live
 *     rewards listener, so already-settled rewards are not sent to Firestore again on every call.
 * A failed operation (offline, rejected) is simply retried on the next call. One reconciler belongs to one signed-in user.
 */
import { planRewards, summarizeRewards, type RewardStep } from '@/domain/ledger';
import type { RewardRecord } from '@/domain/rewards';
import type { HabitSchedule } from '@/domain/schedule';
import type { DateKey } from '@/utils/date';
import type { CloudLedger } from './cloudLedger';

export type ReconcileReport = {
  dailyCoins: number;
  celebrations: ReturnType<typeof summarizeRewards>['celebrations'];
  notice: string | null;
  /** Number of grants that could not be written (offline or rejected); they are retried on the next call. */
  failedGrants: number;
  lastError: unknown;
};

export function createRewardReconciler(ledger: CloudLedger) {
  const inFlight = new Set<string>();
  const known = new Map<string, boolean>();

  return {
    /** The rewards currently in effect, as reported by the live rewards listener (Kotlin: `rewardKnown[id] = true`). */
    noteActive(rewards: Iterable<RewardRecord>) {
      for (const r of rewards) if (r.active) known.set(r.id, true);
    },

    /** Test hook: how many operations are running. */
    inFlightCount: () => inFlight.size,

    /**
     * Brings the ledger in line with the history. `active` are the rewards in effect (from the listener). Returns null when
     * there was nothing to do, or when `isCurrent()` turned false (the user signed out / switched while it ran).
     */
    async reconcile(opts: {
      active: Readonly<Record<string, RewardRecord>>;
      schedules: readonly HabitSchedule[];
      today: DateKey;
      editedOldDates?: ReadonlyArray<{ habitId: string; date: DateKey }>;
      /** Whether the ledger holds anything for this reward id (a reward record or a transaction with that id). */
      hasLedgerEntry?: (id: string) => boolean;
      isCurrent?: () => boolean;
    }): Promise<ReconcileReport | null> {
      const plan = planRewards(opts.active, opts.schedules, opts.today, opts.editedOldDates ?? []);
      // Same filters as Kotlin: skip rewards in flight, grants already known to be in effect, reversals already known to be off.
      const grants = plan.grants.filter((g) => !inFlight.has(g.id) && known.get(g.id) !== true);
      const reversals = plan.reversals.filter((id) => {
        if (inFlight.has(id) || known.get(id) === false) return false;
        // Nothing recorded for this id: a reversal would be a no-op transaction, so it is skipped (and remembered as not in effect).
        if (opts.hasLedgerEntry && !opts.hasLedgerEntry(id)) {
          known.set(id, false);
          return false;
        }
        return true;
      });
      if (grants.length === 0 && reversals.length === 0) return null;
      for (const g of grants) inFlight.add(g.id);
      for (const id of reversals) inFlight.add(id);

      const steps: RewardStep[] = [];
      let failedGrants = 0;
      let lastError: unknown;
      for (const id of reversals) {
        try {
          const r = await ledger.revokeReward(id);
          known.set(id, false);
          if (r.kind === 'done') steps.push({ kind: 'reversal', tx: r.tx });
        } catch (e) {
          lastError = e; // retried on the next call
        } finally {
          inFlight.delete(id);
        }
      }
      for (const g of grants) {
        try {
          const r = await ledger.grantReward(g);
          known.set(g.id, true);
          if (r.kind === 'done') steps.push({ kind: 'grant', grant: g, tx: r.tx });
        } catch (e) {
          failedGrants++;
          lastError = e;
        } finally {
          inFlight.delete(g.id);
        }
      }
      if (opts.isCurrent && !opts.isCurrent()) return null;
      return { ...summarizeRewards(steps), failedGrants, lastError };
    },
  };
}

export type RewardReconciler = ReturnType<typeof createRewardReconciler>;
