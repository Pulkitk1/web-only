/**
 * Firestore SECURITY RULES tests, run against the local emulator (never the real project):   npm run test:rules
 *
 * Four rule sets run side by side (see rulesets.ts): current (in force), Part A (wallet integrity), Part B (document validation), and A+B.
 *
 * Three suites:
 *   1. ANDROID write shapes (copied from the Kotlin sources: WalletRepository.commit, HabitRepository, DayNotes, AccountRepository,
 *      GuestMigration) must succeed under ALL FOUR rule sets. This is the compatibility guarantee for the unchanged Android app.
 *   2. WEB write shapes (the real `createCloudLedger`, `planImport`, `habitCreateFields`, ...) must succeed under all four.
 *   3. ABUSE cases: each states which rule sets REFUSE it. Wallet abuse is refused exactly by the sets that include Part A, document abuse
 *      exactly by the sets that include Part B, and the rules in force accept what the audit found. So each part is shown to do its own job
 *      and NOT the other's.
 */
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  setDoc,
  setLogLevel,
  Timestamp,
  updateDoc,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { habitCreateFields } from '@/domain/cloudWrite';
import { planImport } from '@/domain/guestImport';
import type { Habit } from '@/types/habit';
import { createCloudLedger, type LedgerRunner } from '@/services/cloudLedger';
import { ArrayOp, SERVER_TIMESTAMP } from '@/services/habitWriter';
import { newProfileFields } from '@/services/guestMigration';
import { ALL_SETS, refusedBy, RULESETS, WITH_A, WITH_ANY, WITH_B } from './rulesets';

setLogLevel('silent'); // denied writes are expected here; the SDK would log each one as an error

const emulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const run = emulator ? describe : describe.skip;

const UID = 'user-a';
const OTHER = 'user-b';
const U = `users/${UID}`;
const ts = serverTimestamp;
const day = (n: number) => `2026-11-${String(n).padStart(2, '0')}`;

type Wallet = { coins: number; freezesOwned: number; pendingAdjustment?: number; lastTransactionId?: string };
type Entry = { id: string; type: string; coinDelta: number; freezeDelta: number; balanceAfter: number; pendingDelta?: number; date?: string; habitId?: string; milestone?: number; rewardId?: string };

/** Kotlin `FirestoreLedgerTxn.commit` (WalletRepository.kt:76), field for field. */
function kotlinCommit(db: Firestore, uid: string, w: { coins: number; freezesOwned: number; pending: number }, e: Entry, x: { reward?: Record<string, unknown> & { id: string }; freeze?: { habitId: string; date: string }; month?: { month: string; count: number } } = {}) {
  const b = writeBatch(db);
  const user = doc(db, `users/${uid}`);
  b.update(user, { coins: w.coins, freezesOwned: w.freezesOwned, pendingAdjustment: w.pending, lastTransactionId: e.id, updatedAt: ts() });
  const tx: Record<string, unknown> = { type: e.type, coinDelta: e.coinDelta, freezeDelta: e.freezeDelta, balanceAfter: e.balanceAfter, createdAt: ts() };
  if (e.date) tx.date = e.date;
  if (e.habitId) tx.habitId = e.habitId;
  if (e.milestone !== undefined) tx.milestone = e.milestone;
  if (e.pendingDelta) tx.pendingDelta = e.pendingDelta;
  if (e.rewardId) tx.rewardId = e.rewardId;
  b.set(doc(db, `users/${uid}/walletTransactions/${e.id}`), tx);
  if (x.reward) {
    const { id, ...fields } = x.reward;
    b.set(doc(db, `users/${uid}/rewards/${id}`), { ...fields, lastTransactionId: e.id, updatedAt: ts() });
  }
  if (x.freeze) b.set(doc(db, `users/${uid}/freezes/${x.freeze.habitId}_${x.freeze.date}`), { habitId: x.freeze.habitId, date: x.freeze.date, month: x.freeze.date.slice(0, 7), paidWith: 'inventory', transactionId: e.id, createdAt: ts() });
  if (x.month) b.set(doc(db, `users/${uid}/freezeMonths/${x.month.month}`), { count: x.month.count, updatedAt: ts() });
  return b.commit();
}

const androidHabit = (extra: Record<string, unknown> = {}) => ({
  name: 'Read', color: 4281583945, daysPerWeek: 5, restDays: ['Sat', 'Sun'], createdDate: '2026-11-01', streak: 0, bestStreak: 0, sortOrder: 1_700_000_000_000,
  scheduleHistory: [{ from: '2026-11-01', restDays: ['Sat', 'Sun'], daysPerWeek: 5 }], completedDates: [], ...extra,
});

for (const rs of ALL_SETS) {
  /** `assertFails` if this rule set is among `sets`, otherwise `assertSucceeds`. */
  const refuse = (sets: readonly (typeof ALL_SETS)[number][]) => refusedBy(rs, sets);

  run(`Firestore rules [${rs}]`, () => {
    let env: RulesTestEnvironment;
    const as = (uid: string) => env.authenticatedContext(uid).firestore() as unknown as Firestore;
    const anon = () => env.unauthenticatedContext().firestore() as unknown as Firestore;
    const seed = (fn: (db: Firestore) => Promise<void>) => env.withSecurityRulesDisabled((ctx) => fn(ctx.firestore() as unknown as Firestore));
    const seedUser = (w: Wallet = { coins: 20, freezesOwned: 0 }, extra: Record<string, unknown> = {}) =>
      seed((db) => setDoc(doc(db, U), { email: 'a@b.co', displayName: 'a', pendingAdjustment: 0, ...w, ...extra }));
    const seedDoc = (path: string, data: Record<string, unknown>) => seed((db) => setDoc(doc(db, path), data));

    beforeAll(async () => {
      env = await initializeTestEnvironment({ projectId: `demo-consisto-${rs.toLowerCase()}`, firestore: { rules: RULESETS[rs] } });
    });
    afterAll(async () => {
      await env?.cleanup();
    });
    beforeEach(async () => {
      await env.clearFirestore();
    });

    // ───────────────────────────── 1. Android write shapes: must succeed under all four ─────────────────────────────
    describe('Android write shapes (compatibility)', () => {
      it('creates a profile like loadUser (welcomeFreezePending) and like the guest migration (without it)', async () => {
        await assertSucceeds(setDoc(doc(as(UID), U), { email: 'a@b.co', displayName: 'a', coins: 20, freezesOwned: 0, welcomeFreezePending: true, isDark: true, createdAt: ts(), updatedAt: ts() }));
        await env.clearFirestore();
        await assertSucceeds(setDoc(doc(as(UID), U), { email: 'a@b.co', displayName: 'a', coins: 20, freezesOwned: 0, isDark: true, createdAt: ts(), updatedAt: ts() }));
      });

      it('grants the welcome freeze and clears the marker', async () => {
        await seedUser({ coins: 20, freezesOwned: 0 }, { welcomeFreezePending: true });
        const db = as(UID);
        await assertSucceeds(kotlinCommit(db, UID, { coins: 20, freezesOwned: 1, pending: 0 }, { id: 'welcome_freeze', type: 'welcome_freeze', coinDelta: 0, freezeDelta: 1, balanceAfter: 20 }));
        await assertSucceeds(updateDoc(doc(db, U), { welcomeFreezePending: false }));
      });

      it('creates, edits, reorders and deletes a habit with its completions, and saves a check and an uncheck', async () => {
        const db = as(UID);
        const habit = doc(db, `${U}/habits/h1`);
        await assertSucceeds(setDoc(habit, { ...androidHabit({ goal: 'Read daily', reminderEnabled: true, reminderTime: '07:30' }), createdAt: ts(), updatedAt: ts() }));
        await assertSucceeds(updateDoc(habit, { name: 'Read more', updatedAt: ts() }));
        await assertSucceeds(updateDoc(habit, { sortOrder: 3 }));
        await assertSucceeds(
          writeBatch(db).set(doc(db, `${U}/habits/h1/completions/${day(5)}`), { date: day(5), completed: true, updatedAt: ts(), completedAt: ts() }, { merge: true }).update(habit, { streak: 1, bestStreak: 1, completedDates: arrayUnion(day(5)), updatedAt: ts() }).commit(),
        );
        await assertSucceeds(
          writeBatch(db).set(doc(db, `${U}/habits/h1/completions/${day(5)}`), { date: day(5), completed: false, updatedAt: ts(), uncheckedAt: ts() }, { merge: true }).update(habit, { completedDates: arrayRemove(day(5)), updatedAt: ts() }).commit(),
        );
        await assertSucceeds(writeBatch(db).delete(doc(db, `${U}/habits/h1/completions/${day(5)}`)).delete(habit).commit());
      });

      it('saves a note (merge, without createdAt) and a migrated note (with it), and deletes one', async () => {
        const db = as(UID);
        await assertSucceeds(setDoc(doc(db, `${U}/dayNotes/h1_${day(6)}`), { habitId: 'h1', date: day(6), text: 'Sick', updatedAt: ts() }, { merge: true }));
        await assertSucceeds(setDoc(doc(db, `${U}/dayNotes/h2_${day(7)}`), { habitId: 'h2', date: day(7), text: 'Away', createdAt: Timestamp.now(), updatedAt: Timestamp.now() }));
        await assertSucceeds(deleteDoc(doc(db, `${U}/dayNotes/h1_${day(6)}`)));
      });

      it('writes every ledger entry the current Android app writes: daily, milestone, reversal, restore, purchase at 20, freeze application', async () => {
        await seedUser({ coins: 20, freezesOwned: 0 });
        const db = as(UID);
        await assertSucceeds(kotlinCommit(db, UID, { coins: 21, freezesOwned: 0, pending: 0 }, { id: `daily_${day(1)}`, type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21, date: day(1), rewardId: `daily_${day(1)}` }, { reward: { id: `daily_${day(1)}`, active: true, cycle: 1, amount: 1, type: 'daily_completion', date: day(1) } }));
        await assertSucceeds(kotlinCommit(db, UID, { coins: 26, freezesOwned: 0, pending: 0 }, { id: 'milestone_h1_15_2026-11-01', type: 'streak_milestone', coinDelta: 5, freezeDelta: 0, balanceAfter: 26, date: day(15), habitId: 'h1', milestone: 15, rewardId: 'milestone_h1_15_2026-11-01' }, { reward: { id: 'milestone_h1_15_2026-11-01', active: true, cycle: 1, amount: 5, type: 'streak_milestone', date: day(15), habitId: 'h1', milestone: 15 } }));
        await assertSucceeds(kotlinCommit(db, UID, { coins: 25, freezesOwned: 0, pending: 0 }, { id: `daily_${day(1)}_rev1`, type: 'reward_reversal', coinDelta: -1, freezeDelta: 0, balanceAfter: 25, rewardId: `daily_${day(1)}` }, { reward: { id: `daily_${day(1)}`, active: false, cycle: 1, amount: 1, type: 'daily_completion', date: day(1) } }));
        await assertSucceeds(kotlinCommit(db, UID, { coins: 26, freezesOwned: 0, pending: 0 }, { id: `daily_${day(1)}_grant2`, type: 'reward_restored', coinDelta: 1, freezeDelta: 0, balanceAfter: 26, rewardId: `daily_${day(1)}` }, { reward: { id: `daily_${day(1)}`, active: true, cycle: 2, amount: 1, type: 'daily_completion', date: day(1) } }));
        await assertSucceeds(kotlinCommit(db, UID, { coins: 6, freezesOwned: 1, pending: 0 }, { id: 'freeze_buy_req-1', type: 'freeze_purchase', coinDelta: -20, freezeDelta: 1, balanceAfter: 6, date: day(8) }));
        await assertSucceeds(kotlinCommit(db, UID, { coins: 6, freezesOwned: 0, pending: 0 }, { id: `freeze_apply_h1_${day(7)}`, type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 6, date: day(7), habitId: 'h1' }, { freeze: { habitId: 'h1', date: day(7) }, month: { month: '2026-11', count: 1 } }));
      });

      it('writes a partial grant paid into pending, and a reversal that becomes pending', async () => {
        await seedUser({ coins: 0, freezesOwned: 0, pendingAdjustment: 1 });
        await assertSucceeds(kotlinCommit(as(UID), UID, { coins: 0, freezesOwned: 0, pending: 0 }, { id: `daily_${day(2)}`, type: 'daily_completion', coinDelta: 0, freezeDelta: 0, balanceAfter: 0, pendingDelta: -1, date: day(2) }, { reward: { id: `daily_${day(2)}`, active: true, cycle: 1, amount: 1, type: 'daily_completion', date: day(2) } }));
        await env.clearFirestore();
        await seedUser({ coins: 0, freezesOwned: 0 });
        await assertSucceeds(kotlinCommit(as(UID), UID, { coins: 0, freezesOwned: 0, pending: 1 }, { id: `daily_${day(3)}_rev1`, type: 'reward_reversal', coinDelta: 0, freezeDelta: 0, balanceAfter: 0, pendingDelta: 1 }, { reward: { id: `daily_${day(3)}`, active: false, cycle: 1, amount: 1, type: 'daily_completion', date: day(3) } }));
      });

      it('a purchase at the earlier price of 10 (older versions only, per the product decision) is refused by Part A and accepted by the rest', async () => {
        await seedUser({ coins: 20, freezesOwned: 0 });
        await refuse(WITH_A)(kotlinCommit(as(UID), UID, { coins: 10, freezesOwned: 1, pending: 0 }, { id: 'freeze_buy_legacy-1', type: 'freeze_purchase', coinDelta: -10, freezeDelta: 1, balanceAfter: 10 }));
      });

      it('applies a freeze to an OLD date, as the guest migration replays it (so the rules must not impose a date window)', async () => {
        await seedUser({ coins: 20, freezesOwned: 1 });
        await assertSucceeds(kotlinCommit(as(UID), UID, { coins: 20, freezesOwned: 0, pending: 0 }, { id: 'freeze_apply_h1_2024-06-12', type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 20, date: '2024-06-12', habitId: 'h1' }, { freeze: { habitId: 'h1', date: '2024-06-12' }, month: { month: '2024-06', count: 1 } }));
      });

      it("uploads a migrated habit with its completions, as GuestMigrator does", async () => {
        const db = as(UID);
        await assertSucceeds(
          writeBatch(db)
            .set(doc(db, `${U}/habits/h1`), { ...androidHabit({ completedDates: [day(1)], migratedFrom: 'mig:h1' }), createdAt: Timestamp.now(), updatedAt: ts() })
            .set(doc(db, `${U}/habits/h1/completions/${day(1)}`), { date: day(1), completed: true, updatedAt: Timestamp.now(), completedAt: Timestamp.now() })
            .commit(),
        );
      });

      it("runs Android's account deletion: flag, completions, habits, ledger collections, todos, then the profile", async () => {
        await seedUser({ coins: 20, freezesOwned: 0 });
        await seedDoc(`${U}/habits/h1`, androidHabit());
        await seedDoc(`${U}/habits/h1/completions/${day(1)}`, { date: day(1), completed: true });
        await seedDoc(`${U}/walletTransactions/daily_x`, { type: 'daily_completion', coinDelta: 1 });
        await seedDoc(`${U}/rewards/daily_x`, { active: true });
        await seedDoc(`${U}/freezes/h1_${day(1)}`, { habitId: 'h1' });
        await seedDoc(`${U}/freezeMonths/2026-11`, { count: 1 });
        await seedDoc(`${U}/todos/t1`, { text: 'old' });
        const db = as(UID);
        await assertSucceeds(setDoc(doc(db, U), { deletionRequested: true, deletionRequestedAt: ts() }, { merge: true }));
        for (const p of [`habits/h1/completions/${day(1)}`, 'habits/h1', 'walletTransactions/daily_x', 'rewards/daily_x', `freezes/h1_${day(1)}`, 'freezeMonths/2026-11', 'todos/t1']) await assertSucceeds(deleteDoc(doc(db, `${U}/${p}`)));
        await assertSucceeds(deleteDoc(doc(db, U)));
      });
    });

    // ───────────────────────────── 2. Web write shapes: must succeed under all four ─────────────────────────────
    describe('Web write shapes (compatibility)', () => {
      const resolveValue = (v: unknown): unknown => (v === SERVER_TIMESTAMP ? ts() : v instanceof ArrayOp ? (v.kind === 'union' ? arrayUnion(...v.values) : arrayRemove(...v.values)) : v);
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

      it("runs the real createCloudLedger: grant, revoke, restore, buy, apply (with the month counter), welcome freeze", async () => {
        await seedUser({ coins: 25, freezesOwned: 0 }, { welcomeFreezePending: true });
        const ledger = createCloudLedger(runnerFor(as(UID)), UID);
        await assertSucceeds(ledger.grantReward({ id: `daily_${day(1)}`, type: 'daily_completion', amount: 1, date: day(1) }));
        await assertSucceeds(ledger.revokeReward(`daily_${day(1)}`));
        await assertSucceeds(ledger.grantReward({ id: `daily_${day(1)}`, type: 'daily_completion', amount: 1, date: day(1) })); // restored: _grant2
        await assertSucceeds(ledger.grantReward({ id: 'milestone_h1_15_2026-11-01', type: 'streak_milestone', amount: 5, date: day(15), habitId: 'h1', milestone: 15 }));
        await assertSucceeds(ledger.grantWelcomeFreeze());
        await assertSucceeds(ledger.clearWelcomeFreezeMarker());
        const bought = await assertSucceeds(ledger.buyFreeze('aaaaaaaa-1111-4222-8333-444444444444', day(10)));
        expect(bought.kind).toBe('done');
        const applied = await assertSucceeds(ledger.applyFreeze('h1', day(9)));
        expect(applied.kind).toBe('done');
        expect((await getDoc(doc(as(UID), `${U}/freezeMonths/2026-11`))).data()?.count).toBe(1);
      });

      it('a reversal that cannot be paid from the balance becomes a pending adjustment', async () => {
        await seedUser({ coins: 0, freezesOwned: 0 });
        await seedDoc(`${U}/walletTransactions/daily_${day(2)}`, { type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 1 });
        await seedDoc(`${U}/rewards/daily_${day(2)}`, { active: true, cycle: 1, amount: 1, type: 'daily_completion', date: day(2), lastTransactionId: `daily_${day(2)}` });
        const out = await assertSucceeds(createCloudLedger(runnerFor(as(UID)), UID).revokeReward(`daily_${day(2)}`));
        expect(out.kind).toBe('done');
        expect((await getDoc(doc(as(UID), U))).data()?.pendingAdjustment).toBe(1);
      });

      it('writes habits like habitWriter: create, check (batch with arrayUnion), edit, and the import planner output with its notes', async () => {
        const db = as(UID);
        const h: Habit = { id: 'h1', name: 'Read', color: '#4ADE80', completedDates: [], daysPerWeek: 5, restDays: ['Sat', 'Sun'], createdDate: day(1), scheduleHistory: [], archived: false, goal: 'Daily', reminderEnabled: true, reminderTime: '07:30' };
        await assertSucceeds(setDoc(doc(db, `${U}/habits/h1`), resolveFields({ ...habitCreateFields(h, Date.now()), createdAt: SERVER_TIMESTAMP, updatedAt: SERVER_TIMESTAMP })));
        await assertSucceeds(
          writeBatch(db)
            .set(doc(db, `${U}/habits/h1/completions/${day(2)}`), { date: day(2), completed: true, updatedAt: ts(), completedAt: ts() }, { merge: true })
            .update(doc(db, `${U}/habits/h1`), { streak: 1, bestStreak: 1, completedDates: arrayUnion(day(2)), updatedAt: ts() })
            .commit(),
        );
        await assertSucceeds(updateDoc(doc(db, `${U}/habits/h1`), { goal: '', updatedAt: ts() }));
        const plan = planImport({ uid: UID, habits: [{ ...h, id: 'local-1', archived: true }], notes: { 'local-1': { [day(3)]: 'Away' } }, selected: ['local-1'], idMap: { 'local-1': 'local-1-mabc12345' }, migrationId: 'abc12345-0000', now: Date.now(), through: day(20) });
        const b = writeBatch(db);
        for (const hab of plan.habits) {
          b.set(doc(db, hab.habit.path), resolveFields(hab.habit.fields));
          for (const c of hab.completions) b.set(doc(db, c.path), resolveFields(c.fields));
        }
        for (const n of plan.notes) b.set(doc(db, n.op.path), resolveFields(n.op.fields));
        await assertSucceeds(b.commit());
      });

      it('creates the new-account profile exactly as the guest import does (transaction), and never over an existing one', async () => {
        const db = as(UID);
        await assertSucceeds(runTransaction(db, async (t) => { const s = await t.get(doc(db, U)); if (!s.exists()) t.set(doc(db, U), resolveFields(newProfileFields('a@b.co'))); }));
        expect((await getDoc(doc(db, U))).data()?.coins).toBe(20);
      });
    });

    // ───────────────────────────── 3. Abuse cases: refused by the part that owns them ─────────────────────────────
    describe('wallet abuse (Part A)', () => {
      it('S-01 mint coins with an arbitrary type or id', async () => {
        await seedUser({ coins: 20, freezesOwned: 0 });
        await refuse(WITH_A)(kotlinCommit(as(UID), UID, { coins: 40, freezesOwned: 0, pending: 0 }, { id: 'anything-1', type: 'bonus', coinDelta: 20, freezeDelta: 0, balanceAfter: 40 }));
      });
      it('S-01 mint 20 coins under a daily reward id (daily is exactly 1)', async () => {
        await seedUser({ coins: 20, freezesOwned: 0 });
        await refuse(WITH_A)(kotlinCommit(as(UID), UID, { coins: 40, freezesOwned: 0, pending: 0 }, { id: `daily_${day(4)}`, type: 'daily_completion', coinDelta: 20, freezeDelta: 0, balanceAfter: 40, date: day(4) }, { reward: { id: `daily_${day(4)}`, active: true, cycle: 1, amount: 20, type: 'daily_completion', date: day(4) } }));
      });
      it('S-01 a reward record with an invented amount', async () => {
        await seedUser({ coins: 20, freezesOwned: 0 });
        await refuse(WITH_A)(kotlinCommit(as(UID), UID, { coins: 21, freezesOwned: 0, pending: 0 }, { id: `daily_${day(4)}`, type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21 }, { reward: { id: `daily_${day(4)}`, active: true, cycle: 1, amount: 100, type: 'daily_completion', date: day(4) } }));
      });
      it('S-02 a free Streak Freeze (purchase for 0 coins, a cut-price purchase, or an invented entry giving +1)', async () => {
        // each write starts from a fresh wallet of 20 coins and no freeze
        await seedUser({ coins: 20, freezesOwned: 0 });
        await refuse(WITH_A)(kotlinCommit(as(UID), UID, { coins: 20, freezesOwned: 1, pending: 0 }, { id: 'freeze_buy_free-0001', type: 'freeze_purchase', coinDelta: 0, freezeDelta: 1, balanceAfter: 20 }));
        await env.clearFirestore();
        await seedUser({ coins: 20, freezesOwned: 0 });
        await refuse(WITH_A)(kotlinCommit(as(UID), UID, { coins: 19, freezesOwned: 1, pending: 0 }, { id: 'freeze_buy_cheap-001', type: 'freeze_purchase', coinDelta: -1, freezeDelta: 1, balanceAfter: 19 }));
        await env.clearFirestore();
        await seedUser({ coins: 20, freezesOwned: 0 });
        await refuse(WITH_A)(kotlinCommit(as(UID), UID, { coins: 20, freezesOwned: 1, pending: 0 }, { id: 'gift-1', type: 'gift', coinDelta: 0, freezeDelta: 1, balanceAfter: 20 }));
      });
      it('S-02 the 20-coin price: an honest purchase at 20 works; two freezes for one price are refused by every rule set', async () => {
        await seedUser({ coins: 40, freezesOwned: 0 });
        await assertSucceeds(kotlinCommit(as(UID), UID, { coins: 20, freezesOwned: 1, pending: 0 }, { id: 'freeze_buy_honest-01', type: 'freeze_purchase', coinDelta: -20, freezeDelta: 1, balanceAfter: 20 }));
        await assertFails(kotlinCommit(as(UID), UID, { coins: 0, freezesOwned: 3, pending: 0 }, { id: 'freeze_buy_double-01', type: 'freeze_purchase', coinDelta: -20, freezeDelta: 2, balanceAfter: 0 }));
      });
      it('S-02 applying a freeze without owning one (the entry removes nothing)', async () => {
        await seedUser({ coins: 20, freezesOwned: 0 });
        await refuse(WITH_A)(kotlinCommit(as(UID), UID, { coins: 20, freezesOwned: 0, pending: 0 }, { id: `freeze_apply_h1_${day(7)}`, type: 'freeze_application', coinDelta: 0, freezeDelta: 0, balanceAfter: 20, date: day(7), habitId: 'h1' }, { freeze: { habitId: 'h1', date: day(7) }, month: { month: '2026-11', count: 1 } }));
      });
      it('S-02 applying a freeze while skipping the monthly counter', async () => {
        await seedUser({ coins: 20, freezesOwned: 1 });
        await refuse(WITH_A)(kotlinCommit(as(UID), UID, { coins: 20, freezesOwned: 0, pending: 0 }, { id: `freeze_apply_h1_${day(7)}`, type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 20, date: day(7), habitId: 'h1' }, { freeze: { habitId: 'h1', date: day(7) } }));
      });
      it('S-02 applying a freeze while the counter jumps by 2 or goes backwards', async () => {
        await seedUser({ coins: 20, freezesOwned: 1 });
        await seedDoc(`${U}/freezeMonths/2026-11`, { count: 1 });
        await assertFails(kotlinCommit(as(UID), UID, { coins: 20, freezesOwned: 0, pending: 0 }, { id: `freeze_apply_h1_${day(7)}`, type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 20, date: day(7), habitId: 'h1' }, { freeze: { habitId: 'h1', date: day(7) }, month: { month: '2026-11', count: 3 } }));
        await assertFails(kotlinCommit(as(UID), UID, { coins: 20, freezesOwned: 0, pending: 0 }, { id: `freeze_apply_h1_${day(8)}`, type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 20, date: day(8), habitId: 'h1' }, { freeze: { habitId: 'h1', date: day(8) }, month: { month: '2026-11', count: 0 } }));
      });
      it('S-02 the fourth application in a month is refused by every rule set; so is a negative freeze count', async () => {
        await seedUser({ coins: 20, freezesOwned: 1 });
        await seedDoc(`${U}/freezeMonths/2026-11`, { count: 3 });
        await assertFails(kotlinCommit(as(UID), UID, { coins: 20, freezesOwned: 0, pending: 0 }, { id: `freeze_apply_h1_${day(7)}`, type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 20, date: day(7), habitId: 'h1' }, { freeze: { habitId: 'h1', date: day(7) }, month: { month: '2026-11', count: 4 } }));
        await env.clearFirestore();
        await seedUser({ coins: 20, freezesOwned: 0 });
        await assertFails(kotlinCommit(as(UID), UID, { coins: 20, freezesOwned: -1, pending: 0 }, { id: `freeze_apply_h1_${day(8)}`, type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 20, date: day(8), habitId: 'h1' }, { freeze: { habitId: 'h1', date: day(8) }, month: { month: '2026-11', count: 1 } }));
      });
      it('S-03 erasing a pending adjustment with an invented entry, or with a real-looking type', async () => {
        await seedUser({ coins: 0, freezesOwned: 0, pendingAdjustment: 3 });
        await refuse(WITH_A)(kotlinCommit(as(UID), UID, { coins: 0, freezesOwned: 0, pending: 0 }, { id: 'forgive-1', type: 'daily_completion', coinDelta: 0, freezeDelta: 0, balanceAfter: 0, pendingDelta: -3 }));
        await refuse(WITH_A)(kotlinCommit(as(UID), UID, { coins: 0, freezesOwned: 0, pending: 0 }, { id: `daily_${day(5)}`, type: 'daily_completion', coinDelta: 0, freezeDelta: 0, balanceAfter: 0, pendingDelta: -3, date: day(5) }, { reward: { id: `daily_${day(5)}`, active: true, cycle: 1, amount: 1, type: 'daily_completion', date: day(5) } }));
      });
      it('moving lastTransactionId on its own (no entry)', async () => {
        await seedUser({ coins: 20, freezesOwned: 0 });
        await refuse(WITH_A)(updateDoc(doc(as(UID), U), { lastTransactionId: 'something' }));
      });
      it('replaying an existing entry id, editing an entry, and deleting an entry are refused by every rule set', async () => {
        await seedUser({ coins: 20, freezesOwned: 0 });
        await assertSucceeds(kotlinCommit(as(UID), UID, { coins: 21, freezesOwned: 0, pending: 0 }, { id: `daily_${day(1)}`, type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21 }));
        await assertFails(kotlinCommit(as(UID), UID, { coins: 22, freezesOwned: 0, pending: 0 }, { id: `daily_${day(1)}`, type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 22 }));
        await assertFails(updateDoc(doc(as(UID), `${U}/walletTransactions/daily_${day(1)}`), { coinDelta: 20 }));
        await assertFails(deleteDoc(doc(as(UID), `${U}/walletTransactions/daily_${day(1)}`)));
      });
      it('a balance change with no entry, or not matching its entry, is refused by every rule set', async () => {
        await seedUser({ coins: 20, freezesOwned: 0 });
        await assertFails(updateDoc(doc(as(UID), U), { coins: 999 }));
        await assertFails(kotlinCommit(as(UID), UID, { coins: 999, freezesOwned: 0, pending: 0 }, { id: `daily_${day(1)}`, type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 999 }));
      });

      it('S-04 KNOWN LIMITATION (every rule set): the owner can set deletionRequested (Android deletion does the same); it cannot be cleared, and it freezes the wallet', async () => {
        await seedUser({ coins: 20, freezesOwned: 0 });
        await assertSucceeds(updateDoc(doc(as(UID), U), { deletionRequested: true }));
        await assertFails(updateDoc(doc(as(UID), U), { deletionRequested: false }));
        await assertFails(kotlinCommit(as(UID), UID, { coins: 21, freezesOwned: 0, pending: 0 }, { id: `daily_${day(1)}`, type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21 }));
      });
      it('S-04 without the flag, ledger documents and the profile cannot be deleted (every rule set)', async () => {
        await seedUser({ coins: 20, freezesOwned: 0 });
        await seedDoc(`${U}/walletTransactions/daily_x`, { type: 'daily_completion', coinDelta: 1 });
        await seedDoc(`${U}/rewards/daily_x`, { active: true });
        await seedDoc(`${U}/freezes/h1_${day(1)}`, { habitId: 'h1' });
        await seedDoc(`${U}/freezeMonths/2026-11`, { count: 1 });
        for (const p of ['walletTransactions/daily_x', 'rewards/daily_x', `freezes/h1_${day(1)}`, 'freezeMonths/2026-11']) await assertFails(deleteDoc(doc(as(UID), `${U}/${p}`)));
        await assertFails(deleteDoc(doc(as(UID), U)));
      });
      it('S-13 the legacy todos path: no new writes under Part A, but reads and deletes still work for account deletion', async () => {
        await seedDoc(`${U}/todos/t1`, { text: 'old' });
        await refuse(WITH_A)(setDoc(doc(as(UID), `${U}/todos/t2`), { text: 'new' }));
        await assertSucceeds(getDoc(doc(as(UID), `${U}/todos/t1`)));
        await assertSucceeds(deleteDoc(doc(as(UID), `${U}/todos/t1`)));
      });
      it('S-14 profile creation with extra fields or a forged pointer; coins other than 20 are refused by every rule set', async () => {
        await refuse(WITH_A)(setDoc(doc(as(UID), U), { email: 'a@b.co', coins: 20, freezesOwned: 0, pendingAdjustment: 500 }));
        await env.clearFirestore();
        await refuse(WITH_A)(setDoc(doc(as(UID), U), { email: 'a@b.co', coins: 20, freezesOwned: 0, isAdmin: true }));
        await env.clearFirestore();
        await assertFails(setDoc(doc(as(UID), U), { email: 'a@b.co', coins: 21, freezesOwned: 0 }));
        await assertFails(setDoc(doc(as(UID), U), { email: 'a@b.co', coins: 20, freezesOwned: 1 }));
      });
      it('S-14 updating the profile with an unknown field', async () => {
        await seedUser({ coins: 20, freezesOwned: 0 });
        await refuse(WITH_A)(updateDoc(doc(as(UID), U), { isAdmin: true }));
        await assertSucceeds(updateDoc(doc(as(UID), U), { displayName: 'New name' }));
      });
      it('unknown paths: nothing below a habit except completions (Part A and B), nothing below the ledger, nothing new under the profile', async () => {
        const db = as(UID);
        await refuse(WITH_ANY)(setDoc(doc(db, `${U}/habits/h1/junk/x`), { a: 1 }));
        await assertFails(setDoc(doc(db, `${U}/walletTransactions/daily_x/junk/y`), { a: 1 }));
        await assertFails(setDoc(doc(db, `${U}/somethingElse/x`), { a: 1 }));
        await assertSucceeds(setDoc(doc(db, `${U}/habits/h1/completions/${day(1)}`, ), { date: day(1), completed: true })); // completions stay open to the owner under A and current
      });
    });

    describe('document abuse (Part B)', () => {
      it('S-05 invalid habits: huge name, bad weekly target, too many rest days, bad date, oversized lists', async () => {
        const db = as(UID);
        const bad: Record<string, unknown>[] = [
          androidHabit({ name: 'x'.repeat(5000) }),
          androidHabit({ name: '' }),
          androidHabit({ daysPerWeek: 0 }),
          androidHabit({ daysPerWeek: 9 }),
          androidHabit({ restDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'] }),
          androidHabit({ createdDate: 'yesterday' }),
          androidHabit({ completedDates: Array.from({ length: 20001 }, (_, i) => `d${i}`) }),
          androidHabit({ goal: 'g'.repeat(5000) }),
          androidHabit({ archived: 'yes' }),
        ];
        for (const [i, fields] of bad.entries()) await refuse(WITH_B)(setDoc(doc(db, `${U}/habits/bad${i}`), fields));
      });
      it('S-05 a completion with a wrong id, another date field, or extra fields', async () => {
        const db = as(UID);
        await refuse(WITH_B)(setDoc(doc(db, `${U}/habits/h1/completions/not-a-date`), { date: 'not-a-date', completed: true }));
        await assertSucceeds(setDoc(doc(db, `${U}/habits/h1/completions/${day(3)}`), { date: day(3), completed: true, payload: 'x' })); // one extra field is tolerated since Phase 11G
        await refuse(WITH_B)(setDoc(doc(db, `${U}/habits/h1/completions/${day(1)}`), { date: day(1), completed: true, ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}`, i])) })); // 11 fields
        await refuse(WITH_B)(setDoc(doc(db, `${U}/habits/h1/completions/${day(1)}`), { date: day(2), completed: true }));
      });
      it('notes: a wrong id and an over-long text are refused by every rule set; 11 fields or a bad date only by Part B (one extra field is tolerated)', async () => {
        const db = as(UID);
        await assertFails(setDoc(doc(db, `${U}/dayNotes/wrong`), { habitId: 'h1', date: day(1), text: 'x' }));
        await assertFails(setDoc(doc(db, `${U}/dayNotes/h1_${day(1)}`), { habitId: 'h1', date: day(1), text: 'x'.repeat(201) }));
        await assertSucceeds(setDoc(doc(db, `${U}/dayNotes/h1_${day(2)}`), { habitId: 'h1', date: day(2), text: 'ok', payload: 'x' }));
        await refuse(WITH_B)(setDoc(doc(db, `${U}/dayNotes/h1_${day(1)}`), { habitId: 'h1', date: day(1), text: 'ok', ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`f${i}`, i])) })); // 11 fields
        await refuse(WITH_B)(setDoc(doc(db, `${U}/dayNotes/h1_tomorrow`), { habitId: 'h1', date: 'tomorrow', text: 'ok' }));
      });
    });

    describe('isolation (every rule set)', () => {
      it('another signed-in user can read and write NOTHING of this account, and a signed-out client nothing at all', async () => {
        await seedUser({ coins: 20, freezesOwned: 1 });
        await seedDoc(`${U}/habits/h1`, androidHabit());
        await seedDoc(`${U}/habits/h1/completions/${day(1)}`, { date: day(1), completed: true });
        await seedDoc(`${U}/dayNotes/h1_${day(1)}`, { habitId: 'h1', date: day(1), text: 'x' });
        await seedDoc(`${U}/walletTransactions/daily_x`, { type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21 });
        await seedDoc(`${U}/rewards/daily_x`, { active: true });
        await seedDoc(`${U}/freezes/h1_${day(1)}`, { habitId: 'h1' });
        await seedDoc(`${U}/freezeMonths/2026-11`, { count: 1 });
        await seedDoc(`${U}/todos/t1`, { text: 'x' });
        const paths = [U, `${U}/habits/h1`, `${U}/habits/h1/completions/${day(1)}`, `${U}/dayNotes/h1_${day(1)}`, `${U}/walletTransactions/daily_x`, `${U}/rewards/daily_x`, `${U}/freezes/h1_${day(1)}`, `${U}/freezeMonths/2026-11`, `${U}/todos/t1`];
        for (const [name, db] of [['other user', as(OTHER)], ['signed out', anon()]] as const) {
          for (const p of paths) {
            await assertFails(getDoc(doc(db, p)));
            await assertFails(setDoc(doc(db, p), { hacked: true }, { merge: true }));
            await assertFails(deleteDoc(doc(db, p)));
          }
          for (const c of ['habits', 'dayNotes', 'walletTransactions', 'rewards', 'freezes', 'freezeMonths', 'todos']) await assertFails(getDocs(collection(db, `${U}/${c}`)));
          await assertFails(getDocs(collection(db, 'users')));
          expect(name).toBeTruthy();
        }
        await assertFails(setDoc(doc(as(OTHER), U), { email: 'x@y.z', coins: 20, freezesOwned: 0 })); // not even creating the profile of another uid
      });

      it('feedback: the repository rules allow a valid create; every staged set leaves it denied (decision of Phase 11C.4); listing and editing are refused everywhere', async () => {
        const db = as(UID);
        await refuse(WITH_ANY)(setDoc(doc(db, 'feedback/f1'), { category: 'bug', description: 'x', userId: UID, isGuest: false, createdAt: ts(), appVersion: '1.0', status: 'new' }));
        await assertFails(getDocs(collection(db, 'feedback')));
        await assertFails(updateDoc(doc(db, 'feedback/f1'), { status: 'done' }));
      });
    });
  });
}
