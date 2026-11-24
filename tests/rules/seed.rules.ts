/**
 * The staging seed (scripts/lib/syntheticData.mjs) against all four rule sets in the emulator, so the data the staging guide tells you to import is
 * known to be accepted by the rules it is meant to test: the default seed under every rule set, and the --risk-probes seed accepted by the rules in
 * force and by Part A (which never re-validates habits) but stopped by Part B (which is exactly what the probes exist to show).
 */
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import * as firestoreFns from 'firebase/firestore';
import { doc, getDoc, getDocs, collection, setLogLevel, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { seedAccount, syntheticHabits } from '../../scripts/lib/syntheticData.mjs';
import { ALL_SETS, RULESETS, WITH_B } from './rulesets';

setLogLevel('silent');
const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const UID = 'staging-test-user';
const TODAY = '2026-11-23';
const fs = { doc: firestoreFns.doc, setDoc: firestoreFns.setDoc, writeBatch: firestoreFns.writeBatch, serverTimestamp: firestoreFns.serverTimestamp };

for (const rs of ALL_SETS) {
  run(`Staging seed under [${rs}]`, () => {
    let env: RulesTestEnvironment;
    const db = () => env.authenticatedContext(UID).firestore() as unknown as Firestore;
    beforeAll(async () => {
      env = await initializeTestEnvironment({ projectId: `demo-consisto-seed-${rs.toLowerCase()}`, firestore: { rules: RULESETS[rs] } });
    });
    afterAll(async () => env?.cleanup());
    beforeEach(async () => env.clearFirestore());

    it('the default synthetic account is accepted, and leaves the wallet consistent with its ledger', async () => {
      const s = await seedAccount({ db: db(), uid: UID, fs, today: TODAY });
      expect(s).toMatchObject({ habits: 7, ledgerEntries: 22, notes: 3 });
      const user = (await getDoc(doc(db(), `users/${UID}`))).data()!;
      expect(user).toMatchObject({ coins: 23, freezesOwned: 1, welcomeFreezePending: false });
      const entries = (await getDocs(collection(db(), `users/${UID}/walletTransactions`))).docs.map((d) => d.data());
      expect(entries.reduce((n, e) => n + (e.coinDelta as number), 20)).toBe(user.coins); // the ledger explains the balance
      expect(entries.reduce((n, e) => n + (e.freezeDelta as number), 0)).toBe(user.freezesOwned);
      // every seeded reward is dated before the current month, outside the window in which the apps issue and reverse rewards
      const rewards = (await getDocs(collection(db(), `users/${UID}/rewards`))).docs.map((d) => d.data().date as string);
      expect(rewards).toHaveLength(19);
      expect(rewards.every((d) => d < `${TODAY.slice(0, 7)}-01`)).toBe(true);
    });

    it(`--risk-probes: ${WITH_B.includes(rs) ? 'stopped by Part B (the point of the probes)' : 'accepted (nothing re-validates habits)'}`, async () => {
      const probe = seedAccount({ db: db(), uid: UID, fs, today: TODAY, includeRiskProbes: true });
      if (WITH_B.includes(rs)) await assertFails(probe);
      else await expect(probe).resolves.toMatchObject({ habits: 11 });
    });
  });
}

describe('synthetic data plan', () => {
  it('is entirely synthetic and covers the legacy shapes', () => {
    const habits = syntheticHabits(TODAY, { includeRiskProbes: true });
    expect(habits.map((h) => h[0]).every((id) => id.startsWith('syn-'))).toBe(true);
    expect(JSON.stringify(habits)).not.toMatch(/@(?!example\.invalid)/); // no email-like text
    expect(habits.some(([, , d]) => !('createdDate' in d))).toBe(true); // a legacy habit with no creation date
    expect(habits.some(([, , d]) => String(d.name).length === 300)).toBe(true);
    expect(syntheticHabits(TODAY).length).toBe(7);
    expect(habits.length).toBe(11);
  });
});
