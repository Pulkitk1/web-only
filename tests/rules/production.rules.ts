/**
 * Phase 11C.4 review: the rules ACTUALLY in production (a one-line owner-only wildcard, transcribed from the Console and kept in
 * `production-observed.rules`; the original Console backup is still to be verified) against Part A, operation by operation.
 * Each row says what the production rules do and what Part A does. A mismatch with the expected table fails the test, so the
 * permission changes are pinned. Local emulator only (demo- project ids).
 */
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { arrayUnion, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp as ts, setDoc, setLogLevel, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RULESETS } from './rulesets';

setLogLevel('silent');
const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const PROD = readFileSync(join(__dirname, 'production-observed.rules'), 'utf8');
const UID = 'user-a';
const U = `users/${UID}`;
const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`;

type Verdict = 'ok' | 'denied';
type Op = {
  name: string;
  seed?: { coins: number; freezesOwned: number };
  extraSeed?: Record<string, Record<string, unknown>>;
  as?: { uid: string; token?: Record<string, unknown> };
  go: (db: Firestore) => Promise<unknown>;
  prod: Verdict;
  partA: Verdict;
};

/** One batch: the profile update plus the ledger entry (Android `FirestoreLedgerTxn.commit`), and optional extra documents. */
const entry = (db: Firestore, w: { coins: number; freezesOwned: number }, e: Record<string, unknown> & { id: string }, extra: (b: ReturnType<typeof writeBatch>) => void = () => {}) => {
  const b = writeBatch(db);
  const { id, ...f } = e;
  b.update(doc(db, U), { coins: w.coins, freezesOwned: w.freezesOwned, pendingAdjustment: 0, lastTransactionId: id, updatedAt: ts() });
  b.set(doc(db, `${U}/walletTransactions/${id}`), { ...f, createdAt: ts() });
  extra(b);
  return b.commit();
};
const habit = { name: 'Read', color: 4281583945, daysPerWeek: 5, restDays: ['Sat', 'Sun'], createdDate: '2026-11-01', streak: 0, bestStreak: 0, sortOrder: 1, completedDates: [] };
const fb = (uid: string, guest: boolean, extra: Record<string, unknown> = {}) => ({ category: 'bug', description: 'It crashed', userId: uid, isGuest: guest, createdAt: ts(), appVersion: '1.0', status: 'new', ...extra });
const seed0 = { coins: 20, freezesOwned: 0 };
const FB_SEED = { 'feedback/f7': { category: 'bug', description: 'x', userId: UID, isGuest: false, createdAt: new Date(), appVersion: '1', status: 'new' } };

const OPS: Op[] = [
  // what the apps really do: must work under both
  { name: 'profile create (Android loadUser)', go: (db) => setDoc(doc(db, U), { email: 'a@b.co', displayName: 'a', coins: 20, freezesOwned: 0, welcomeFreezePending: true, isDark: true, createdAt: ts(), updatedAt: ts() }), prod: 'ok', partA: 'ok' },
  { name: 'habit create, edit, check, delete with completion', seed: seed0, prod: 'ok', partA: 'ok', go: async (db) => {
    await setDoc(doc(db, `${U}/habits/h1`), { ...habit, createdAt: ts(), updatedAt: ts() });
    await updateDoc(doc(db, `${U}/habits/h1`), { name: 'Read more', updatedAt: ts() });
    await setDoc(doc(db, `${U}/habits/h1/completions/${day(5)}`), { date: day(5), completed: true, updatedAt: ts() });
    await updateDoc(doc(db, `${U}/habits/h1`), { completedDates: arrayUnion(day(5)) });
    await deleteDoc(doc(db, `${U}/habits/h1/completions/${day(5)}`));
    await deleteDoc(doc(db, `${U}/habits/h1`));
  } },
  { name: 'day note create and delete', seed: seed0, prod: 'ok', partA: 'ok', go: async (db) => {
    await setDoc(doc(db, `${U}/dayNotes/h1_${day(5)}`), { habitId: 'h1', date: day(5), text: 'ok', updatedAt: ts() }, { merge: true });
    await deleteDoc(doc(db, `${U}/dayNotes/h1_${day(5)}`));
  } },
  { name: 'daily reward +1 with its reward record', seed: seed0, prod: 'ok', partA: 'ok', go: (db) => entry(db, { coins: 21, freezesOwned: 0 }, { id: `daily_${day(5)}`, type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21, date: day(5) }, (b) => b.set(doc(db, `${U}/rewards/daily_${day(5)}`), { active: true, cycle: 1, amount: 1, type: 'daily_completion', date: day(5), lastTransactionId: `daily_${day(5)}`, updatedAt: ts() })) },
  { name: 'freeze purchase for 20 coins', seed: { coins: 40, freezesOwned: 0 }, prod: 'ok', partA: 'ok', go: (db) => entry(db, { coins: 20, freezesOwned: 1 }, { id: 'freeze_buy_req-0001', type: 'freeze_purchase', coinDelta: -20, freezeDelta: 1, balanceAfter: 20 }) },
  { name: 'freeze application with its freeze record and month counter', seed: { coins: 20, freezesOwned: 1 }, prod: 'ok', partA: 'ok', go: (db) => entry(db, { coins: 20, freezesOwned: 0 }, { id: `freeze_apply_h1_${day(7)}`, type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 20, habitId: 'h1', date: day(7) }, (b) => {
    b.set(doc(db, `${U}/freezes/h1_${day(7)}`), { habitId: 'h1', date: day(7), month: '2026-11', paidWith: 'inventory', transactionId: `freeze_apply_h1_${day(7)}`, createdAt: ts() });
    b.set(doc(db, `${U}/freezeMonths/2026-11`), { count: 1, updatedAt: ts() });
  }) },
  { name: 'account deletion (flag, then data, then profile)', seed: seed0, prod: 'ok', partA: 'ok',
    extraSeed: { [`${U}/walletTransactions/t1`]: { type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21 }, [`${U}/todos/t1`]: { text: 'old' } },
    go: async (db) => {
      await setDoc(doc(db, U), { deletionRequested: true, deletionRequestedAt: ts() }, { merge: true });
      await deleteDoc(doc(db, `${U}/walletTransactions/t1`));
      await deleteDoc(doc(db, `${U}/todos/t1`));
      await deleteDoc(doc(db, U));
    } },
  // the feedback collection: NOT granted by Part A (Phase 11C.4 decision), so it stays denied exactly as in production today
  { name: 'feedback from a signed-in user (Android shape)', as: { uid: UID }, go: (db) => setDoc(doc(db, 'feedback/f1'), fb(UID, false)), prod: 'denied', partA: 'denied' },
  { name: 'feedback from a guest (anonymous sign-in on the second app)', as: { uid: 'guest-1', token: { firebase: { sign_in_provider: 'anonymous' } } }, go: (db) => setDoc(doc(db, 'feedback/f2'), fb('guest-1', true)), prod: 'denied', partA: 'denied' },
  { name: 'feedback naming another user as the author', as: { uid: UID }, go: (db) => setDoc(doc(db, 'feedback/f3'), fb('someone-else', false)), prod: 'denied', partA: 'denied' },
  { name: 'feedback from a signed-in user marked as a guest', as: { uid: UID }, go: (db) => setDoc(doc(db, 'feedback/f4'), fb(UID, true)), prod: 'denied', partA: 'denied' },
  { name: 'feedback of 3000 characters', as: { uid: UID }, go: (db) => setDoc(doc(db, 'feedback/f5'), fb(UID, false, { description: 'x'.repeat(3000) })), prod: 'denied', partA: 'denied' },
  { name: 'feedback with an extra field', as: { uid: UID }, go: (db) => setDoc(doc(db, 'feedback/f6'), fb(UID, false, { extra: 1 })), prod: 'denied', partA: 'denied' },
  { name: 'feedback with a client-chosen timestamp', as: { uid: UID }, go: (db) => setDoc(doc(db, 'feedback/f6b'), fb(UID, false, { createdAt: new Date('2020-01-01') })), prod: 'denied', partA: 'denied' },
  { name: 'feedback: listing the collection', as: { uid: UID }, extraSeed: FB_SEED, go: (db) => getDocs(collection(db, 'feedback')), prod: 'denied', partA: 'denied' },
  { name: 'feedback: editing an existing one', as: { uid: UID }, extraSeed: FB_SEED, go: (db) => updateDoc(doc(db, 'feedback/f7'), { status: 'done' }), prod: 'denied', partA: 'denied' },
  { name: 'feedback: deleting an existing one', as: { uid: UID }, extraSeed: FB_SEED, go: (db) => deleteDoc(doc(db, 'feedback/f7')), prod: 'denied', partA: 'denied' },
  { name: "feedback: reading someone else's", as: { uid: 'user-b' }, extraSeed: FB_SEED, go: (db) => getDoc(doc(db, 'feedback/f7')), prod: 'denied', partA: 'denied' },
  { name: 'feedback: reading your own (the app checks before a retry)', as: { uid: UID }, extraSeed: FB_SEED, go: (db) => getDoc(doc(db, 'feedback/f7')), prod: 'denied', partA: 'denied' },
  // what Part A closes
  { name: 'forged coin reward (unknown type, +5000)', seed: seed0, prod: 'ok', partA: 'denied', go: (db) => entry(db, { coins: 5020, freezesOwned: 0 }, { id: 'bonus-1', type: 'bonus', coinDelta: 5000, freezeDelta: 0, balanceAfter: 5020 }) },
  { name: 'wallet edited with no ledger entry', seed: seed0, prod: 'ok', partA: 'denied', go: (db) => updateDoc(doc(db, U), { coins: 9999 }) },
  { name: 'free freeze (0 coins)', seed: seed0, prod: 'ok', partA: 'denied', go: (db) => entry(db, { coins: 20, freezesOwned: 1 }, { id: 'freeze_buy_free-0001', type: 'freeze_purchase', coinDelta: 0, freezeDelta: 1, balanceAfter: 20 }) },
  { name: 'unknown path nested under a habit', seed: seed0, prod: 'ok', partA: 'denied', go: (db) => setDoc(doc(db, `${U}/habits/h1/secret/x`), { a: 1 }) },
  { name: 'new document under todos', seed: seed0, prod: 'ok', partA: 'denied', go: (db) => setDoc(doc(db, `${U}/todos/new`), { text: 'x' }) },
  { name: 'unknown profile field', seed: seed0, prod: 'ok', partA: 'denied', go: (db) => updateDoc(doc(db, U), { isAdmin: true }) },
  { name: 'any other path under the user', seed: seed0, prod: 'ok', partA: 'denied', go: (db) => setDoc(doc(db, `${U}/anything/x`), { a: 1 }) },
  { name: 'day note with a wrong id', seed: seed0, prod: 'ok', partA: 'denied', go: (db) => setDoc(doc(db, `${U}/dayNotes/wrong-id`), { habitId: 'h1', date: day(5), text: 'ok' }) },
  // unchanged
  { name: 'another user reads this account', as: { uid: 'user-b' }, seed: seed0, prod: 'denied', partA: 'denied', go: (db) => getDoc(doc(db, U)) },
  { name: 'a signed-out client reads this account', as: { uid: '' }, seed: seed0, prod: 'denied', partA: 'denied', go: (db) => getDoc(doc(db, U)) },
];

for (const [label, rules] of [['production (observed)', PROD], ['Part A', RULESETS.A]] as const) {
  run(`Production vs Part A: ${label}`, () => {
    let env: RulesTestEnvironment;
    beforeAll(async () => {
      env = await initializeTestEnvironment({ projectId: `demo-consisto-prodcmp-${label === 'Part A' ? 'a' : 'prod'}`, firestore: { rules } });
    });
    afterAll(async () => {
      await env?.cleanup();
    });
    for (const op of OPS) {
      it(op.name, async () => {
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async (ctx) => {
          const db = ctx.firestore() as unknown as Firestore;
          if (op.seed) await setDoc(doc(db, U), { email: 'a@b.co', displayName: 'a', pendingAdjustment: 0, ...op.seed });
          for (const [p, d] of Object.entries(op.extraSeed ?? {})) await setDoc(doc(db, p), d);
        });
        const who = op.as ?? { uid: UID };
        const ctx = who.uid === '' ? env.unauthenticatedContext() : env.authenticatedContext(who.uid, who.token);
        const result = await op.go(ctx.firestore() as unknown as Firestore).then(() => 'ok', () => 'denied');
        expect(result).toBe(label === 'Part A' ? op.partA : op.prod);
      });
    }
  });
}
