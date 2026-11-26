/**
 * New-account wallet: a newly registered account gets exactly 20 coins and 1 Streak Freeze, once. Runs the REAL web code
 * (`services/profileTransaction.ts` and `services/cloudLedger.ts`) against the Firestore EMULATOR under every rule set (local
 * emulator only, `demo-` project ids). Firebase Authentication is not part of this suite: each test signs in as a synthetic uid.
 *
 * `webOpen` is what the app does when an account loads: create the profile if the server has none, then, only while the profile
 * still carries the `welcomeFreezePending` marker, record the free freeze (fixed id `welcome_freeze`) and clear the marker.
 * Each call uses its own Firestore instance, which is how a refresh, a second browser or a re-login looks to the server.
 */
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, getDocs, collection, runTransaction, serverTimestamp, setDoc, setLogLevel, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createCloudLedger, type LedgerRunner } from '@/services/cloudLedger';
import { SERVER_TIMESTAMP } from '@/services/habitWriter';
import { ensureProfileIn } from '@/services/profileTransaction';
import { ALL_SETS, RULESETS, WITH_A } from './rulesets';

setLogLevel('silent');

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const UID = 'new-user';
const OTHER = 'other-user';
const EMAIL = 'new@example.test';
const U = `users/${UID}`;
const ts = serverTimestamp;

const runnerFor = (db: Firestore): LedgerRunner => ({
  run: (block) =>
    runTransaction(db, (t) => {
      const reads = new Map<string, Promise<{ id: string; data: Record<string, unknown> } | null>>();
      const fix = (f: Record<string, unknown>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === SERVER_TIMESTAMP ? ts() : v]));
      return block({
        get(path) {
          let p = reads.get(path);
          if (!p) {
            p = t.get(doc(db, path)).then((s) => (s.exists() ? { id: s.id, data: s.data() as Record<string, unknown> } : null));
            reads.set(path, p);
          }
          return p;
        },
        update: (path, f) => void t.update(doc(db, path), fix(f)),
        set: (path, f) => void t.set(doc(db, path), fix(f)),
      });
    }),
});

/** What the app does when an account loads (see the header). */
async function webOpen(db: Firestore, uid = UID, email = EMAIL) {
  const created = await ensureProfileIn(db, uid, email);
  const snap = await getDoc(doc(db, `users/${uid}`));
  if (snap.data()?.welcomeFreezePending === true) {
    const ledger = createCloudLedger(runnerFor(db), uid);
    await ledger.grantWelcomeFreeze();
    await ledger.clearWelcomeFreezeMarker();
  }
  return created;
}

for (const rs of ALL_SETS) {
  run(`New-account welcome wallet [${rs}]`, () => {
    let env: RulesTestEnvironment;
    const as = (uid = UID) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
    const read = async (path: string) => {
      let data: Record<string, unknown> | undefined;
      await env.withSecurityRulesDisabled(async (ctx) => {
        const s = await getDoc(doc(ctx.firestore() as unknown as Firestore, path));
        data = s.exists() ? (s.data() as Record<string, unknown>) : undefined;
      });
      return data;
    };
    const list = async (path: string) => {
      let ids: string[] = [];
      await env.withSecurityRulesDisabled(async (ctx) => {
        ids = (await getDocs(collection(ctx.firestore() as unknown as Firestore, path))).docs.map((d) => d.id).sort();
      });
      return ids;
    };
    const wallet = async (uid = UID) => {
      const d = await read(`users/${uid}`);
      return d && { coins: d.coins, freezesOwned: d.freezesOwned, marker: d.welcomeFreezePending, pending: d.pendingAdjustment, last: d.lastTransactionId };
    };

    beforeAll(async () => {
      env = await initializeTestEnvironment({ projectId: `demo-consisto-welcome-${rs.toLowerCase()}`, firestore: { rules: RULESETS[rs] } });
    });
    afterAll(async () => {
      await env?.cleanup();
    });
    beforeEach(async () => {
      await env.clearFirestore();
    });

    it('1. a new account gets 20 coins and 1 streak freeze, and the profile is the same shape Android creates', async () => {
      expect(await webOpen(as())).toBe('created');
      expect(await wallet()).toEqual({ coins: 20, freezesOwned: 1, marker: false, pending: 0, last: 'welcome_freeze' });
      const p = (await read(U))!;
      expect(p.email).toBe(EMAIL);
      expect(p.displayName).toBe('new');
      expect(p.isDark).toBe(true);
      expect(p.createdAt).toBeDefined();
    });

    it('10. the wallet ledger records exactly one welcome_freeze entry: no coins, one freeze, balance 20; nothing else is written', async () => {
      await webOpen(as());
      expect(await list(`${U}/walletTransactions`)).toEqual(['welcome_freeze']);
      expect(await read(`${U}/walletTransactions/welcome_freeze`)).toMatchObject({ type: 'welcome_freeze', coinDelta: 0, freezeDelta: 1, balanceAfter: 20 });
      expect(await list(`${U}/rewards`)).toEqual([]);
      expect(await list(`${U}/freezes`)).toEqual([]);
      expect(await list(`${U}/freezeMonths`)).toEqual([]);
      expect(await list(`${U}/habits`)).toEqual([]);
    });

    it('2. the welcome reward happens once, however many times the account is opened', async () => {
      await webOpen(as());
      for (let i = 0; i < 4; i++) expect(await webOpen(as())).toBe('exists');
      expect(await wallet()).toEqual({ coins: 20, freezesOwned: 1, marker: false, pending: 0, last: 'welcome_freeze' });
      expect(await list(`${U}/walletTransactions`)).toEqual(['welcome_freeze']);
    });

    it('3 and 4. logging out and in, and refreshing the browser, grant nothing more (a fresh Firestore connection each time)', async () => {
      await webOpen(as());
      const before = await read(U);
      await webOpen(env.authenticatedContext(UID).firestore() as unknown as Firestore); // re-login
      await webOpen(env.authenticatedContext(UID).firestore() as unknown as Firestore); // refresh
      expect(await read(U)).toEqual(before);
      expect(await list(`${U}/walletTransactions`)).toEqual(['welcome_freeze']);
    });

    it('5. a second browser opening the same account grants nothing more', async () => {
      await webOpen(as());
      await webOpen(as());
      expect(await wallet()).toMatchObject({ coins: 20, freezesOwned: 1 });
      expect(await list(`${U}/walletTransactions`)).toEqual(['welcome_freeze']);
    });

    it('6. concurrent first loads (several tabs and browsers at once) create one profile and grant one freeze', async () => {
      const results = await Promise.all([webOpen(as()), webOpen(as()), webOpen(as()), webOpen(as()), webOpen(as()), webOpen(as())]);
      expect(results.filter((r) => r === 'created')).toHaveLength(1);
      expect(await wallet()).toEqual({ coins: 20, freezesOwned: 1, marker: false, pending: 0, last: 'welcome_freeze' });
      expect(await list(`${U}/walletTransactions`)).toEqual(['welcome_freeze']);
    });

    it('7. a failed profile creation can be retried safely: nothing is half-written, and the retry gives exactly the welcome wallet', async () => {
      // Attempt 1 is refused (signed in as somebody else): no profile, no wallet documents.
      await expect(ensureProfileIn(as(OTHER), UID, EMAIL)).rejects.toMatchObject({ code: 'permission-denied' });
      expect(await read(U)).toBeUndefined();
      expect(await list(`${U}/walletTransactions`)).toEqual([]);
      // The retry succeeds, twice over.
      await webOpen(as());
      await webOpen(as());
      expect(await wallet()).toEqual({ coins: 20, freezesOwned: 1, marker: false, pending: 0, last: 'welcome_freeze' });
    });

    it('7b. profile created but the welcome freeze not yet recorded (a crash or offline in between): the next open finishes it once', async () => {
      await ensureProfileIn(as(), UID, EMAIL);
      expect(await wallet()).toMatchObject({ coins: 20, freezesOwned: 0, marker: true });
      await webOpen(as());
      await webOpen(as());
      expect(await wallet()).toEqual({ coins: 20, freezesOwned: 1, marker: false, pending: 0, last: 'welcome_freeze' });
      expect(await list(`${U}/walletTransactions`)).toEqual(['welcome_freeze']);
    });

    it('7c. freeze recorded but the marker not cleared: the next open clears it and grants nothing more', async () => {
      await ensureProfileIn(as(), UID, EMAIL);
      await createCloudLedger(runnerFor(as()), UID).grantWelcomeFreeze();
      expect(await wallet()).toMatchObject({ coins: 20, freezesOwned: 1, marker: true });
      await webOpen(as());
      expect(await wallet()).toEqual({ coins: 20, freezesOwned: 1, marker: false, pending: 0, last: 'welcome_freeze' });
      expect(await list(`${U}/walletTransactions`)).toEqual(['welcome_freeze']);
    });

    it('8. an existing account keeps its balance, freezes, pending adjustment, transactions and reward history exactly', async () => {
      const docs: Record<string, Record<string, unknown>> = {
        [U]: { email: EMAIL, displayName: 'old', coins: 57, freezesOwned: 2, pendingAdjustment: 3, lastTransactionId: 'daily_2026-11-01', isDark: false, createdAt: ts(), updatedAt: ts() },
        [`${U}/walletTransactions/welcome_freeze`]: { type: 'welcome_freeze', coinDelta: 0, freezeDelta: 1, balanceAfter: 20, createdAt: ts() },
        [`${U}/walletTransactions/daily_2026-11-01`]: { type: 'daily_completion', coinDelta: 37, freezeDelta: 0, balanceAfter: 57, date: '2026-11-01', rewardId: 'daily_2026-11-01', createdAt: ts() },
        [`${U}/rewards/daily_2026-11-01`]: { active: true, cycle: 1, amount: 37, type: 'daily_completion', date: '2026-11-01', lastTransactionId: 'daily_2026-11-01', updatedAt: ts() },
      };
      await env.withSecurityRulesDisabled(async (ctx) => {
        for (const [p, d] of Object.entries(docs)) await setDoc(doc(ctx.firestore() as unknown as Firestore, p), d);
      });
      const before = { profile: await read(U), tx: await list(`${U}/walletTransactions`), rewards: await list(`${U}/rewards`) };
      expect(await webOpen(as())).toBe('exists');
      expect(await webOpen(as())).toBe('exists');
      expect({ profile: await read(U), tx: await list(`${U}/walletTransactions`), rewards: await list(`${U}/rewards`) }).toEqual(before);
      expect(await wallet()).toMatchObject({ coins: 57, freezesOwned: 2, pending: 3 });
    });

    it('8b. an old account whose marker is still set and whose welcome freeze is already recorded gets no second freeze', async () => {
      await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore() as unknown as Firestore;
        await setDoc(doc(db, U), { email: EMAIL, coins: 20, freezesOwned: 1, pendingAdjustment: 0, lastTransactionId: 'welcome_freeze', welcomeFreezePending: true });
        await setDoc(doc(db, `${U}/walletTransactions/welcome_freeze`), { type: 'welcome_freeze', coinDelta: 0, freezeDelta: 1, balanceAfter: 20 });
      });
      await webOpen(as());
      expect(await wallet()).toMatchObject({ coins: 20, freezesOwned: 1, marker: false });
    });

    it('9. accounts are separate: one account opening creates nothing in another account', async () => {
      await webOpen(as(), UID);
      await webOpen(as(OTHER), OTHER, 'other@example.test');
      expect(await wallet(UID)).toMatchObject({ coins: 20, freezesOwned: 1 });
      expect(await wallet(OTHER)).toMatchObject({ coins: 20, freezesOwned: 1 });
      expect(await list(`users/${OTHER}/walletTransactions`)).toEqual(['welcome_freeze']);
      // And a user cannot create or write another user's profile.
      await assertFails(setDoc(doc(as(OTHER), `users/third`), { email: 'x@y.z', coins: 20, freezesOwned: 0 }));
    });

    it('Android compatibility: a profile Android created (20 coins, no freeze, marker set) is finished by the web without conflict', async () => {
      await env.withSecurityRulesDisabled((ctx) =>
        setDoc(doc(ctx.firestore() as unknown as Firestore, U), { email: EMAIL, displayName: 'new', coins: 20, freezesOwned: 0, welcomeFreezePending: true, isDark: true, createdAt: ts(), updatedAt: ts() }),
      );
      expect(await webOpen(as())).toBe('exists');
      expect(await wallet()).toEqual({ coins: 20, freezesOwned: 1, marker: false, pending: 0, last: 'welcome_freeze' });
    });

    it('Android compatibility: Android gives the welcome freeze first; the web then records nothing more and only clears the marker', async () => {
      await ensureProfileIn(as(), UID, EMAIL);
      const db = as();
      const b = writeBatch(db); // Android FirestoreLedgerTxn.commit for the welcome freeze
      b.update(doc(db, U), { coins: 20, freezesOwned: 1, pendingAdjustment: 0, lastTransactionId: 'welcome_freeze', updatedAt: ts() });
      b.set(doc(db, `${U}/walletTransactions/welcome_freeze`), { type: 'welcome_freeze', coinDelta: 0, freezeDelta: 1, balanceAfter: 20, createdAt: ts() });
      await b.commit();
      await webOpen(as());
      expect(await wallet()).toEqual({ coins: 20, freezesOwned: 1, marker: false, pending: 0, last: 'welcome_freeze' });
      expect(await list(`${U}/walletTransactions`)).toEqual(['welcome_freeze']);
    });

    if (WITH_A.includes(rs)) {
      it('Android compatibility: Android cannot grant a second welcome freeze after the web did (the rules refuse a reused ledger id)', async () => {
        await webOpen(as());
        const db = as();
        const b = writeBatch(db);
        b.update(doc(db, U), { coins: 20, freezesOwned: 2, pendingAdjustment: 0, lastTransactionId: 'welcome_freeze', updatedAt: ts() });
        b.set(doc(db, `${U}/walletTransactions/welcome_freeze`), { type: 'welcome_freeze', coinDelta: 0, freezeDelta: 1, balanceAfter: 20, createdAt: ts() });
        await assertFails(b.commit());
        expect(await wallet()).toMatchObject({ coins: 20, freezesOwned: 1 });
      });

      it('the rules still refuse a profile created with more than 20 coins or any freeze (the welcome rewards cannot be inflated)', async () => {
        await assertFails(setDoc(doc(as(), U), { email: EMAIL, coins: 500, freezesOwned: 0, welcomeFreezePending: true }));
        await assertFails(setDoc(doc(as(), U), { email: EMAIL, coins: 20, freezesOwned: 1, welcomeFreezePending: true }));
        await assertSucceeds(setDoc(doc(as(), U), { email: EMAIL, coins: 20, freezesOwned: 0, welcomeFreezePending: true }));
      });
    }
  });
}
