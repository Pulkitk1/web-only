/**
 * Where a session's data comes from: the saved state if there is one, otherwise an EMPTY new-user state (once, then saved).
 * A brand-new guest never gets sample habits or history. The sample data (`buildDemoState`) exists only for development
 * and the browser tests, behind a development-only switch (`demoSeedEnabled`) that is removed from a production build.
 * Hydration only restores; it never runs reward reconciliation, so loading can't award, deduct or reapply anything.
 */
import { buildMockHabits, demoSeedEnabled, mockStartCoins } from '@/constants/mockData';
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

/**
 * A new user's state: no habits, no history, no rewards, no frozen days. Only the standard new-user wallet (the 20 starting coins and the one
 * free welcome freeze, the same as a new account) so the Wallet screen behaves exactly as it does for any new user.
 */
export function buildFreshState(_today: DateKey, startCoins = mockStartCoins()): PersistedData {
  let ledger: LedgerState = { ...emptyLedger(), wallet: { coins: startCoins, freezesOwned: 0, pending: 0 } };
  ledger = grantWelcomeFreeze(ledger).state;
  return { habits: [], ledger, notes: {}, nextId: 1 };
}

/** DEVELOPMENT / TESTS ONLY: the old sample seed (five habits, a frozen day, rewards recorded silently). Never used in a production build. */
export function buildDemoState(today: DateKey, startCoins = mockStartCoins()): PersistedData {
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

/** `demo` seeds the sample data instead of the empty state (default: the development-only switch, always false in production). */
export function loadInitialState(storage: AppStorage, today: DateKey, demo: boolean = demoSeedEnabled()): InitialState {
  const loaded = storage.load();
  if (loaded.status === 'ok') {
    const { habits, ledger, notes, nextId } = loaded.data;
    return { data: { habits, ledger, notes }, nextId, source: 'saved' };
  }
  const fresh = demo ? buildDemoState(today) : buildFreshState(today);
  const { nextId, ...data } = fresh;
  if (loaded.status === 'future') return { data, nextId, source: 'locked' }; // never overwrite newer data
  storage.save(fresh);
  return { data, nextId, source: loaded.status === 'corrupt' ? 'recovered' : 'fresh' };
}
