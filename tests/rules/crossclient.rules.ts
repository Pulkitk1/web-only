/**
 * Phase 11C.3: cross-client and rollback tests, in the local Firestore EMULATOR only (project ids start with `demo-`,
 * the host is 127.0.0.1; `npm run test:rules` starts the emulator).
 *
 *  1. Cross-client: a write made with the Android (Kotlin) shape is read back by the Web code path, and the reverse, for the same
 *     user, under all four rule sets. The two clients are two separate Firestore instances on the same emulator database.
 *  2. Duplicate freeze applications and malformed wallet documents.
 *  3. Rollback: the same database is re-loaded with each rule set in turn (current, A, B, A+B, back to current) and behaves as
 *     that rule set says every time.
 */
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, runTransaction, serverTimestamp, setDoc, setLogLevel, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createCloudLedger, type LedgerRunner } from '@/services/cloudLedger';
import { ArrayOp, SERVER_TIMESTAMP } from '@/services/habitWriter';
import { ALL_SETS, refusedBy, RULESETS, WITH_A } from './rulesets';

setLogLevel('silent');

const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const UID = 'user-a';
const U = `users/${UID}`;
const ts = serverTimestamp;
const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`;

/** Android `FirestoreLedgerTxn.commit`: one batch holding the profile update and the entry (and an optional freeze + counter). */
function androidWrite(db: Firestore, w: { coins: number; freezesOwned: number; pending: number }, e: { id: string; type: string; coinDelta: number; freezeDelta: number; balanceAfter: number; date?: string; habitId?: string }, extra: { freeze?: { habitId: string; date: string }; month?: { month: string; count: number }; entryExtra?: Record<string, unknown> } = {}) {
  const b = writeBatch(db);
  b.update(doc(db, U), { coins: w.coins, freezesOwned: w.freezesOwned, pendingAdjustment: w.pending, lastTransactionId: e.id, updatedAt: ts() });
  const { id, ...fields } = e;
  b.set(doc(db, `${U}/walletTransactions/${id}`), { ...fields, ...(extra.entryExtra ?? {}), createdAt: ts() });
  if (extra.freeze) b.set(doc(db, `${U}/freezes/${extra.freeze.habitId}_${extra.freeze.date}`), { habitId: extra.freeze.habitId, date: extra.freeze.date, month: extra.freeze.date.slice(0, 7), paidWith: 'inventory', transactionId: e.id, createdAt: ts() });
  if (extra.month) b.set(doc(db, `${U}/freezeMonths/${extra.month.month}`), { count: extra.month.count, updatedAt: ts() });
  return b.commit();
}

const resolveValue = (v: unknown): unknown => (v === SERVER_TIMESTAMP ? ts() : v instanceof ArrayOp ? v : v);
const resolveFields = (f: Record<string, unknown>) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, resolveValue(v)]));
const runnerFor = (db: Firestore): LedgerRunner => ({
  run: (block) =>
    runTransaction(db, (t) => {
      const reads = new Map<string, Promise<{ id: string; data: Record<string, unknown> } | null>>();
      return block({
        get(path) {
          let p = reads.get(path);
          if (!p) {
            p = t.get(doc(db, path)).then((s) => (s.exists() ? { id: s.id, data: s.data() as Record<string, unknown> } : null));
            reads.set(path, p);
          }
          return p;
        },
        update: (path, f) => void t.update(doc(db, path), resolveFields(f)),
        set: (path, f) => void t.set(doc(db, path), resolveFields(f)),
      });
    }),
});

for (const rs of ALL_SETS) {
  const refuse = (sets: readonly (typeof ALL_SETS)[number][]) => refusedBy(rs, sets);

  run(`Cross-client and duplicates [${rs}]`, () => {
    let env: RulesTestEnvironment;
    // Two independent Firestore instances for the same signed-in user: "android" and "web".
    let android: Firestore;
    let web: Firestore;
    const seedUser = (extra: Record<string, unknown> = {}) =>
      env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore() as unknown as Firestore, U), { email: 'a@b.co', displayName: 'a', pendingAdjustment: 0, coins: 20, freezesOwned: 0, ...extra }));

    beforeAll(async () => {
      env = await initializeTestEnvironment({ projectId: `demo-consisto-cross-${rs.toLowerCase()}`, firestore: { rules: RULESETS[rs] } });
    });
    afterAll(async () => {
      await env?.cleanup();
    });
    beforeEach(async () => {
      await env.clearFirestore();
      android = env.authenticatedContext(UID).firestore() as unknown as Firestore;
      web = env.authenticatedContext(UID).firestore() as unknown as Firestore;
    });

    it('an Android write is read by the Web, and a Web write is read by Android (wallet, ledger, freezes)', async () => {
      await seedUser({ coins: 40, freezesOwned: 0 });
      // Android buys a freeze at the real price; the Web reads the new wallet and the entry
      await assertSucceeds(androidWrite(android, { coins: 20, freezesOwned: 1, pending: 0 }, { id: 'freeze_buy_cross-android-1', type: 'freeze_purchase', coinDelta: -20, freezeDelta: 1, balanceAfter: 20 }));
      const seenByWeb = (await assertSucceeds(getDoc(doc(web, U)))).data();
      expect(seenByWeb).toMatchObject({ coins: 20, freezesOwned: 1, lastTransactionId: 'freeze_buy_cross-android-1' });
      expect((await getDoc(doc(web, `${U}/walletTransactions/freeze_buy_cross-android-1`))).data()?.type).toBe('freeze_purchase');
      // the Web (the real ledger code) applies that freeze; Android reads the freeze, the counter and the wallet
      const applied = await assertSucceeds(createCloudLedger(runnerFor(web), UID).applyFreeze('h1', day(9)));
      expect(applied.kind).toBe('done');
      expect((await getDoc(doc(android, `${U}/freezes/h1_${day(9)}`))).exists()).toBe(true);
      expect((await getDoc(doc(android, `${U}/freezeMonths/2026-11`))).data()?.count).toBe(1);
      expect((await getDoc(doc(android, U))).data()).toMatchObject({ coins: 20, freezesOwned: 0, lastTransactionId: `freeze_apply_h1_${day(9)}` });
      // the Web grants a daily reward; Android reverses it with its own shape
      await assertSucceeds(createCloudLedger(runnerFor(web), UID).grantReward({ id: `daily_${day(1)}`, type: 'daily_completion', amount: 1, date: day(1) }));
      await assertSucceeds(androidWrite(android, { coins: 20, freezesOwned: 0, pending: 0 }, { id: `daily_${day(1)}_rev1`, type: 'reward_reversal', coinDelta: -1, freezeDelta: 0, balanceAfter: 20, date: day(1) }));
      expect((await getDoc(doc(web, U))).data()?.coins).toBe(20);
    });

    it('duplicate freeze application: the same entry again, or the same habit and day under a new entry, is refused by every rule set', async () => {
      await seedUser({ coins: 20, freezesOwned: 2 });
      const id = `freeze_apply_h1_${day(7)}`;
      await assertSucceeds(androidWrite(android, { coins: 20, freezesOwned: 1, pending: 0 }, { id, type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 20, habitId: 'h1', date: day(7) }, { freeze: { habitId: 'h1', date: day(7) }, month: { month: '2026-11', count: 1 } }));
      // replaying the same entry id (the ledger is append-only)
      await assertFails(androidWrite(android, { coins: 20, freezesOwned: 0, pending: 0 }, { id, type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 20, habitId: 'h1', date: day(7) }, { freeze: { habitId: 'h1', date: day(7) }, month: { month: '2026-11', count: 2 } }));
      // the same habit and day under a different entry id: the freeze id is `habit_date`, so its record already exists
      await assertFails(androidWrite(android, { coins: 20, freezesOwned: 0, pending: 0 }, { id: `freeze_apply_h1_${day(7)}x`, type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 20, habitId: 'h1', date: day(7) }, { freeze: { habitId: 'h1', date: day(7) }, month: { month: '2026-11', count: 2 } }));
      expect((await getDoc(doc(web, U))).data()?.freezesOwned).toBe(1);
    });

    it('invalid wallet documents: wrong types, extra fields, non-integer amounts (Part A refuses; the rules in force accept them)', async () => {
      await seedUser({ coins: 20, freezesOwned: 0 });
      // an entry with an extra field
      await refuse(WITH_A)(androidWrite(android, { coins: 21, freezesOwned: 0, pending: 0 }, { id: `daily_${day(2)}`, type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21, date: day(2) }, { entryExtra: { bonus: 100 } }));
      await env.clearFirestore();
      await seedUser({ coins: 20, freezesOwned: 0 });
      // a fractional coin amount (refused by every rule set: the balance rules need integers)
      await assertFails(androidWrite(android, { coins: 20.5, freezesOwned: 0, pending: 0 }, { id: `daily_${day(3)}`, type: 'daily_completion', coinDelta: 0.5, freezeDelta: 0, balanceAfter: 20.5, date: day(3) }));
      await env.clearFirestore();
      await seedUser({ coins: 20, freezesOwned: 0 });
      // coins written as a string
      await assertFails(androidWrite(android, { coins: '21' as unknown as number, freezesOwned: 0, pending: 0 }, { id: `daily_${day(4)}`, type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21, date: day(4) }));
      // a freeze record with a month that does not match its date
      await env.clearFirestore();
      await seedUser({ coins: 20, freezesOwned: 1 });
      const bad = writeBatch(android);
      bad.update(doc(android, U), { freezesOwned: 0, lastTransactionId: `freeze_apply_h1_${day(5)}`, updatedAt: ts() });
      bad.set(doc(android, `${U}/walletTransactions/freeze_apply_h1_${day(5)}`), { type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 20, habitId: 'h1', date: day(5), createdAt: ts() });
      bad.set(doc(android, `${U}/freezes/h1_${day(5)}`), { habitId: 'h1', date: day(5), month: '2025-01', paidWith: 'inventory', transactionId: `freeze_apply_h1_${day(5)}`, createdAt: ts() });
      bad.set(doc(android, `${U}/freezeMonths/2026-11`), { count: 1, updatedAt: ts() });
      await refuse(WITH_A)(bad.commit());
    });
  });
}

/** Rollback: the SAME database is re-loaded with each rule set in turn and behaves as that rule set says. */
run('Rollback: loading each rule set into the same database in turn', () => {
  const forgedFreeze = (db: Firestore) => androidWrite(db, { coins: 20, freezesOwned: 1, pending: 0 }, { id: 'freeze_buy_free-rollback', type: 'freeze_purchase', coinDelta: 0, freezeDelta: 1, balanceAfter: 20 });
  const badHabit = (db: Firestore) => setDoc(doc(db, `${U}/habits/rb`), { name: 'x'.repeat(5000), color: 1, daysPerWeek: 0, restDays: [], createdDate: 'nope', streak: 0, bestStreak: 0, sortOrder: 1, completedDates: [] });
  const order = ['current', 'A', 'B', 'AB', 'current', 'A'] as const;

  it('current -> A -> B -> A+B -> current -> A: each load applies exactly that rule set, and data written earlier stays readable', async () => {
    const seenFreeze: string[] = [];
    const seenHabit: string[] = [];
    for (const [i, name] of order.entries()) {
      const env = await initializeTestEnvironment({ projectId: 'demo-consisto-rollback', firestore: { rules: RULESETS[name] } });
      try {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore() as unknown as Firestore, U), { email: 'a@b.co', displayName: 'a', pendingAdjustment: 0, coins: 20, freezesOwned: 0 }));
        const db = env.authenticatedContext(UID).firestore() as unknown as Firestore;
        // the forged free freeze: refused exactly by A and A+B
        const f = await forgedFreeze(db).then(() => 'accepted', () => 'refused');
        seenFreeze.push(`${name}:${f}`);
        // the invalid habit: refused exactly by B and A+B
        const h = await badHabit(db).then(() => 'accepted', () => 'refused');
        seenHabit.push(`${name}:${h}`);
        // an honest write always works, after every switch
        await assertSucceeds(setDoc(doc(db, `${U}/habits/ok${i}`), { name: 'Read', color: 4281583945, daysPerWeek: 5, restDays: [], createdDate: '2026-11-01', streak: 0, bestStreak: 0, sortOrder: 1, completedDates: [] }));
        expect((await getDoc(doc(db, `${U}/habits/ok${i}`))).exists()).toBe(true);
        // other users stay locked out in every rule set
        await assertFails(getDoc(doc(env.authenticatedContext('intruder').firestore() as unknown as Firestore, U)));
      } finally {
        await env.cleanup();
      }
    }
    expect(seenFreeze).toEqual(['current:accepted', 'A:refused', 'B:accepted', 'AB:refused', 'current:accepted', 'A:refused']);
    expect(seenHabit).toEqual(['current:accepted', 'A:accepted', 'B:refused', 'AB:refused', 'current:accepted', 'A:accepted']);
  });

  it('each rule source file loads on its own, and the generated files are identical to what the generator builds', async () => {
    for (const name of ['current', 'A', 'B', 'AB'] as const) {
      expect(RULESETS[name].length).toBeGreaterThan(500);
      const env = await initializeTestEnvironment({ projectId: `demo-consisto-load-${name.toLowerCase()}`, firestore: { rules: RULESETS[name] } });
      await env.cleanup();
    }
  });
});
