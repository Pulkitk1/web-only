/**
 * Where a session's data comes from: the saved state if there is one, otherwise the mock data (once, then saved).
 * Hydration only restores; it never runs reward reconciliation, so loading can't award, deduct or reapply anything.
 */
import { buildMockHabits, mockStartCoins } from '@/constants/mockData';
import { emptyLedger, freezeDatesFor, grantWelcomeFreeze, reconcileRewards, type LedgerState } from '@/domain/ledger';
import { scheduleOf } from '@/domain/schedule';
import type { AppStorage, PersistedData } from '@/services/appStorage';
import { addDays, type DateKey } from '@/utils/date';

export type InitialState = {
  data: { habits: PersistedData['habits']; ledger: LedgerState; notes: PersistedData['notes'] };
  nextId: number;
  /** `saved`: restored; `fresh`: first run; `recovered`: saved data was unreadable (kept as a backup) so we started fresh; `locked`: saved by a newer build, not touched. */
  source: 'saved' | 'fresh' | 'recovered' | 'locked';
};

/** The mock data for a new installation (Phase 2's seed: 20 coins + the welcome freeze, one frozen day, rewards recorded silently). */
export function buildFreshState(today: DateKey, startCoins = mockStartCoins()): PersistedData {
  const habits = buildMockHabits(today);
  // New-user wallet: start coins, then the one free welcome freeze (+1 owned).
  let ledger: LedgerState = { ...emptyLedger(), wallet: { coins: startCoins, freezesOwned: 0, pending: 0 } };
  ledger = grantWelcomeFreeze(ledger).state;
  // A frozen day in the seed history (not charged against the wallet: it predates this mock session).
  ledger = { ...ledger, freezes: [{ habitId: 'h3', date: addDays(today, -5), paidWith: 'inventory' }] };
  // Rewards the seed history already qualifies for are recorded silently, so no popup fires on first load.
  const schedules = habits.map((h) => scheduleOf(h, freezeDatesFor(ledger, h.id)));
  ledger = reconcileRewards(ledger, schedules, today).state;
  return { habits, ledger, notes: {}, nextId: 1 };
}

export function loadInitialState(storage: AppStorage, today: DateKey): InitialState {
  const loaded = storage.load();
  if (loaded.status === 'ok') {
    const { habits, ledger, notes, nextId } = loaded.data;
    return { data: { habits, ledger, notes }, nextId, source: 'saved' };
  }
  const fresh = buildFreshState(today);
  const { nextId, ...data } = fresh;
  if (loaded.status === 'future') return { data, nextId, source: 'locked' }; // never overwrite newer data
  storage.save(fresh);
  return { data, nextId, source: loaded.status === 'corrupt' ? 'recovered' : 'fresh' };
}
