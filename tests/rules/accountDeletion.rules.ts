/**
 * Phase 12A: the REAL account deletion (domain/accountDeletion.ts + services/firestoreEraser.ts) against the Firestore EMULATOR under every
 * rule set, including the Combined rules that are deployed in production. Local emulator only (demo- project ids). Firebase Authentication
 * is faked (the emulator suite here has only Firestore); what is proven is that the real rules allow every deletion step, in order, for the
 * owner, and refuse every attempt on someone else's account.
 */
import { assertFails, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, setLogLevel, Timestamp, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { deleteAccountFlow, eraseUserData, type DataEraser } from '@/domain/accountDeletion';
import { createFirestoreEraser } from '@/services/firestoreEraser';
import { createFakeAuth } from '../fakeEraser';
import { ALL_SETS, RULESETS } from './rulesets';

setLogLevel('silent');
const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const UID = 'user-a';
const OTHER = 'user-b';
const ts = () => Timestamp.now();
const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`;

/** Every document of a realistic account, in the shapes the apps write (so the rules see real data). */
function accountDocs(uid: string, completions = 3): Record<string, Record<string, unknown>> {
  const u = `users/${uid}`;
  const docs: Record<string, Record<string, unknown>> = {
    [u]: { email: 'a@b.co', displayName: 'a', coins: 22, freezesOwned: 0, pendingAdjustment: 0, lastTransactionId: 'freeze_apply_h1_2026-11-03', isDark: true, createdAt: ts(), updatedAt: ts() },
    [`${u}/habits/h1`]: { name: 'Read', color: 4281583945, daysPerWeek: 5, restDays: ['Sat', 'Sun'], createdDate: '2026-11-01', streak: 3, bestStreak: 3, sortOrder: 1, scheduleHistory: [{ from: '2026-11-01', restDays: ['Sat', 'Sun'], daysPerWeek: 5 }], completedDates: [day(1)], archived: false, createdAt: ts(), updatedAt: ts() },
    [`${u}/habits/h2`]: { name: 'Run', color: 4294198070, daysPerWeek: 7, restDays: [], createdDate: '2026-11-02', streak: 0, bestStreak: 0, sortOrder: 2, scheduleHistory: [], completedDates: [], archived: true, reminderEnabled: true, reminderTime: '07:30', createdAt: ts(), updatedAt: ts() },
    [`${u}/habits/h2/completions/${day(3)}`]: { date: day(3), completed: false, updatedAt: ts(), uncheckedAt: ts() },
    [`${u}/walletTransactions/welcome_freeze`]: { type: 'welcome_freeze', coinDelta: 0, freezeDelta: 1, balanceAfter: 20, createdAt: ts() },
    [`${u}/walletTransactions/daily_${day(1)}`]: { type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21, date: day(1), rewardId: `daily_${day(1)}`, createdAt: ts() },
    [`${u}/walletTransactions/freeze_apply_h1_${day(3)}`]: { type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 22, date: day(3), habitId: 'h1', createdAt: ts() },
    [`${u}/rewards/daily_${day(1)}`]: { active: true, cycle: 1, amount: 1, type: 'daily_completion', date: day(1), lastTransactionId: `daily_${day(1)}`, updatedAt: ts() },
    [`${u}/freezes/h1_${day(3)}`]: { habitId: 'h1', date: day(3), month: '2026-11', paidWith: 'inventory', transactionId: `freeze_apply_h1_${day(3)}`, createdAt: ts() },
    [`${u}/freezeMonths/2026-11`]: { count: 1, updatedAt: ts() },
    [`${u}/todos/t1`]: { text: 'old to-do' },
    [`${u}/dayNotes/h1_${day(1)}`]: { habitId: 'h1', date: day(1), text: 'a note', createdAt: ts(), updatedAt: ts() },
  };
  for (let i = 0; i < completions; i++) {
    const d = `2025-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`;
    docs[`${u}/habits/h1/completions/${d}`] = { date: d, completed: true, updatedAt: ts(), completedAt: ts() };
  }
  return docs;
}

for (const rs of ALL_SETS) {
  run(`Account deletion against the real rules [${rs}]`, () => {
    let env: RulesTestEnvironment;
    const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
    const seed = (docs: Record<string, Record<string, unknown>>) =>
      env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore() as unknown as Firestore;
        for (const [p, d] of Object.entries(docs)) await setDoc(doc(db, p), d);
      });
    const existing = async (paths: string[]): Promise<string[]> => {
      const out: string[] = [];
      await env.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore() as unknown as Firestore;
        for (const p of paths) if ((await getDoc(doc(db, p))).exists()) out.push(p);
      });
      return out;
    };
    const runFlow = (uid: string, eraser: DataEraser, auth = createFakeAuth(uid)) => deleteAccountFlow({ auth, eraser, uid, email: 'a@b.co', password: 'correct-password' });

    beforeAll(async () => {
      env = await initializeTestEnvironment({ projectId: `demo-consisto-del-${rs.toLowerCase()}`, firestore: { rules: RULESETS[rs] } });
    });
    afterAll(async () => {
      await env?.cleanup();
    });
    beforeEach(async () => {
      await env.clearFirestore();
    });

    it("deletes the whole account (profile last, notes and to-dos included) and leaves another user's data untouched", async () => {
      await seed({ ...accountDocs(UID), ...accountDocs(OTHER) });
      const mine = Object.keys(accountDocs(UID));
      const theirs = Object.keys(accountDocs(OTHER));
      const auth = createFakeAuth(UID);
      const result = await runFlow(UID, createFirestoreEraser(as(UID)), auth);
      expect(result).toEqual({ ok: true });
      expect(auth.loginDeleted).toBe(true);
      expect(await existing(mine)).toEqual([]);
      expect((await existing(theirs)).sort()).toEqual([...theirs].sort());
    });

    it('deletes 450 completions of one habit in several batches (more than one 400-write batch)', async () => {
      await seed(accountDocs(UID, 450));
      const all = Object.keys(accountDocs(UID, 450));
      expect((await existing(all)).length).toBe(all.length);
      const result = await runFlow(UID, createFirestoreEraser(as(UID)));
      expect(result).toEqual({ ok: true });
      expect(await existing(all)).toEqual([]);
    });

    it('a failure halfway leaves the profile with its marker and the login in place; the retry finishes everything', async () => {
      await seed(accountDocs(UID, 30));
      const real = createFirestoreEraser(as(UID));
      let calls = 0;
      const flaky: DataEraser = { ...real, deleteDocs: async (paths) => { if (++calls === 3) throw Object.assign(new Error('offline'), { code: 'unavailable' }); return real.deleteDocs(paths); } };
      const auth = createFakeAuth(UID);
      const first = await runFlow(UID, flaky, auth);
      expect(first).toMatchObject({ ok: false, stage: 'data' });
      expect(auth.loginDeleted).toBe(false);
      const profile = await existing([`users/${UID}`]);
      expect(profile).toEqual([`users/${UID}`]); // never "deleted" while data remains
      await env.withSecurityRulesDisabled(async (ctx) => {
        expect((await getDoc(doc(ctx.firestore() as unknown as Firestore, `users/${UID}`))).data()?.deletionRequested).toBe(true);
      });
      const second = await runFlow(UID, real, auth);
      expect(second).toEqual({ ok: true });
      expect(await existing(Object.keys(accountDocs(UID, 30)))).toEqual([]);
      expect(auth.loginDeleted).toBe(true);
    });

    it('the wallet is not changed by the deletion marker (only deletionRequested and its time are written)', async () => {
      await seed(accountDocs(UID));
      const before = (await getDoc(doc(as(UID), `users/${UID}`))).data();
      await createFirestoreEraser(as(UID)).markDeletionRequested(UID);
      const after = (await getDoc(doc(as(UID), `users/${UID}`))).data();
      expect(after?.coins).toBe(before?.coins);
      expect(after?.freezesOwned).toBe(before?.freezesOwned);
      expect(after?.lastTransactionId).toBe(before?.lastTransactionId);
      expect(after?.deletionRequested).toBe(true);
    });

    it("another signed-in user cannot erase this account: every step is refused and nothing is deleted", async () => {
      await seed(accountDocs(UID));
      const intruder = createFirestoreEraser(as(OTHER));
      await expect(eraseUserData(intruder, UID)).rejects.toMatchObject({ code: 'permission-denied' });
      await assertFails(intruder.markDeletionRequested(UID));
      await assertFails(intruder.deleteDocs([`users/${UID}/habits/h1`]));
      await assertFails(intruder.deleteProfile(UID));
      expect((await existing(Object.keys(accountDocs(UID)))).length).toBe(Object.keys(accountDocs(UID)).length);
    });

    it("a signed-out client cannot erase anything", async () => {
      await seed(accountDocs(UID));
      const anon = createFirestoreEraser(env.unauthenticatedContext().firestore() as unknown as Firestore);
      await expect(eraseUserData(anon, UID)).rejects.toMatchObject({ code: 'permission-denied' });
      expect((await existing(Object.keys(accountDocs(UID)))).length).toBe(Object.keys(accountDocs(UID)).length);
    });

    it("this user's eraser pointed at ANOTHER user's id is refused and the other account is untouched", async () => {
      await seed({ ...accountDocs(UID), ...accountDocs(OTHER) });
      const result = await runFlow(OTHER, createFirestoreEraser(as(UID)), createFakeAuth(OTHER));
      expect(result).toMatchObject({ ok: false, stage: 'data' });
      expect((await existing(Object.keys(accountDocs(OTHER)))).length).toBe(Object.keys(accountDocs(OTHER)).length);
      expect((await existing(Object.keys(accountDocs(UID)))).length).toBe(Object.keys(accountDocs(UID)).length);
    });

    it('with the marker NOT set the ledger cannot be deleted (the rules, not the app, protect the wallet history)', async () => {
      await seed(accountDocs(UID));
      await expect(createFirestoreEraser(as(UID)).deleteDocs([`users/${UID}/walletTransactions/welcome_freeze`])).rejects.toMatchObject({ code: 'permission-denied' });
    });
  });
}
