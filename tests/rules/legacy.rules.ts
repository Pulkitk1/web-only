/**
 * EXISTING DATA compatibility of the staged rules (Phase 11C.2), in the local emulator:   npm run test:rules
 *
 * A rule only re-checks a document when it is written again, and Android re-writes habits, completions and notes whenever the user checks a
 * day, edits or reorders. So for each plausible STORED document shape (taken from what the Kotlin readers still tolerate: `HabitRecordParsing`,
 * `HabitRepository`, `WalletLedger`, `AppViewModel.loadUser`) this seeds the document, performs the Android write that would touch it, and compares:
 *   - the real rules, for all four rule sets (current, Part A, Part B, A+B), and
 *   - `scripts/lib/rulesCompat.mjs`, the pure checker the data scanner uses (so the scanner predicts Part B exactly).
 *
 * The central claim this file proves: PART A NEVER REJECTS A STORED HABIT, COMPLETION OR NOTE, however odd. Only Part B can (and only where the
 * scanner flags it). Shapes marked RISK PROBE are not known to exist in production data: they show what the stricter rules would refuse.
 */
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, doc, serverTimestamp, setDoc, setLogLevel, updateDoc, writeBatch, type Firestore } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { completionProblems, habitProblems, ledgerEntryAccepted, noteProblems } from '../../scripts/lib/rulesCompat.mjs';
import { ALL_SETS, RULESETS, WITH_A, WITH_B } from './rulesets';

setLogLevel('silent');
const run = process.env.FIRESTORE_EMULATOR_HOST ? describe : describe.skip;
const UID = 'legacy-user';
const U = `users/${UID}`;
const ts = serverTimestamp;

type Data = Record<string, unknown>;
const longList = (n: number) => Array.from({ length: n }, (_, i) => `2020-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 28) + 1).padStart(2, '0')}`);

const HABITS: [string, Data][] = [
  ['minimal legacy habit (no createdAt, sortOrder, schedule history, goal, reminder)', { name: 'Read', color: 4281583945, completedDates: ['2024-06-01'], streak: 1, bestStreak: 3, daysPerWeek: 7, restDays: [], createdDate: '2024-06-01' }],
  ['legacy habit with no createdDate at all', { name: 'Read', color: 4281583945, completedDates: [], streak: 0, bestStreak: 0, daysPerWeek: 5, restDays: ['Sat', 'Sun'] }],
  ['current Android habit with goal, why, reminder and archived', { name: 'Read', color: 4281583945, daysPerWeek: 5, restDays: ['Sat', 'Sun'], createdDate: '2026-11-01', streak: 2, bestStreak: 9, sortOrder: 3, scheduleHistory: [{ from: '2026-11-01', restDays: ['Sat', 'Sun'], daysPerWeek: 5 }], completedDates: ['2026-11-02'], goal: 'Daily', why: 'Calm', archived: true, reminderEnabled: true, reminderTime: '07:30' }],
  ['reminder time null', { name: 'Read', daysPerWeek: 7, restDays: [], reminderEnabled: false, reminderTime: null }],
  ['unknown extra legacy fields', { name: 'Read', daysPerWeek: 7, restDays: [], icon: 'star', category: 'health', streakRuns: [] }],
  ['a 300-character name (Android has no limit on creation)', { name: 'n'.repeat(300), daysPerWeek: 7, restDays: [] }],
  ['a name exactly at the 1000 bound', { name: 'n'.repeat(1000), daysPerWeek: 7, restDays: [] }],
  ['five years of legacy completedDates (1825)', { name: 'Read', daysPerWeek: 7, restDays: [], completedDates: longList(1825) }],
  ['RISK PROBE: a name over 1000 characters', { name: 'n'.repeat(1001), daysPerWeek: 7, restDays: [] }],
  ['RISK PROBE: weekly target 9', { name: 'Read', daysPerWeek: 9, restDays: [] }],
  ['RISK PROBE: rest days stored as a string', { name: 'Read', daysPerWeek: 5, restDays: 'Sat,Sun' }],
  ['RISK PROBE: an empty createdDate', { name: 'Read', daysPerWeek: 5, restDays: [], createdDate: '' }],
  ['RISK PROBE: a created date in another format', { name: 'Read', daysPerWeek: 5, restDays: [], createdDate: '01/06/2024' }],
  ['RISK PROBE: more than 40 fields', { name: 'Read', ...Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`legacy${i}`, i])) }],
];

const COMPLETIONS: [string, Data][] = [
  ['legacy completion with date and completed', { date: '2024-06-01', completed: true }],
  ['completion without a date field', { completed: true }],
  ['uncheck record', { date: '2024-06-01', completed: false, uncheckedAt: Date.now(), updatedAt: Date.now() }],
  ['completion carrying completedAt', { date: '2024-06-01', completed: true, completedAt: Date.now(), updatedAt: Date.now() }],
  ['a completion with one unknown field (tolerated since Phase 11G)', { date: '2024-06-01', completed: true, note: 'x' }],
  ['RISK PROBE: a completion with 11 fields', { date: '2024-06-01', completed: true, f0: 0, f1: 1, f2: 2, f3: 3, f4: 4, f5: 5, f6: 6, f7: 7, f8: 8 }],
  ['a completion whose date field differs from its id (Android overwrites the field, so this one is repaired by the next check-in)', { date: '2024-06-09', completed: true }],
];

const NOTES: [string, Data][] = [
  ['note saved by Android (no createdAt)', { habitId: 'h1', date: '2024-06-03', text: 'Sick', updatedAt: Date.now() }],
  ['note with createdAt (migration)', { habitId: 'h1', date: '2024-06-03', text: 'Sick', createdAt: Date.now(), updatedAt: Date.now() }],
  ['a note with one unknown field (tolerated since Phase 11G)', { habitId: 'h1', date: '2024-06-03', text: 'Sick', mood: 3, updatedAt: Date.now() }],
  ['RISK PROBE: a note with 11 fields', { habitId: 'h1', date: '2024-06-03', text: 'Sick', updatedAt: Date.now(), f0: 0, f1: 1, f2: 2, f3: 3, f4: 4, f5: 5, f6: 6 }],
];

for (const rs of ALL_SETS) {
  const hasA = WITH_A.includes(rs);
  const hasB = WITH_B.includes(rs);
  const verb = (refused: boolean) => (refused ? 'FAILS' : 'succeeds');
  run(`Stored data under [${rs}]`, () => {
    let env: RulesTestEnvironment;
    const db = () => env.authenticatedContext(UID).firestore() as unknown as Firestore;
    const seed = (path: string, data: Data) => env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore() as unknown as Firestore, path), data));
    beforeAll(async () => {
      env = await initializeTestEnvironment({ projectId: `demo-consisto-legacy-${rs.toLowerCase()}`, firestore: { rules: RULESETS[rs] } });
    });
    afterAll(async () => env?.cleanup());
    beforeEach(async () => env.clearFirestore());

    describe('habits: every Android update re-validates the whole document (Part B only)', () => {
      for (const [name, data] of HABITS) {
        // Only Part B can refuse; Part A and the rules in force never look at a stored habit.
        const refused = hasB && habitProblems(data).length > 0;
        it(`${name}: Android's check-in update and reorder ${verb(refused)}`, async () => {
          await seed(`${U}/habits/h1`, data);
          const ref = doc(db(), `${U}/habits/h1`);
          const verdict = refused ? assertFails : assertSucceeds;
          // setCompletion's habit update (derived streak values + updatedAt) and reorderHabits (sortOrder alone): neither repairs an existing problem
          await verdict(updateDoc(ref, { streak: 1, bestStreak: 1, updatedAt: ts() }));
          await verdict(updateDoc(ref, { sortOrder: 4 }));
        });
      }
      if (!hasB) {
        it(`PART A / CURRENT: not one of the ${HABITS.length} stored habit shapes above, including every RISK PROBE, is rejected on update`, () => {
          expect(hasB).toBe(false); // the per-shape tests above assert assertSucceeds for each; this line names the guarantee
        });
      }
    });

    describe('completions and notes: a merge write validates the resulting document (Part B only)', () => {
      for (const [name, data] of COMPLETIONS) {
        const merged = { ...data, date: '2024-06-01', completed: true, updatedAt: 1, completedAt: 1 };
        const refused = hasB && completionProblems(merged, '2024-06-01').length > 0;
        it(`${name}: Android's check-in merge ${verb(refused)}`, async () => {
          await seed(`${U}/habits/h1/completions/2024-06-01`, data);
          await (refused ? assertFails : assertSucceeds)(setDoc(doc(db(), `${U}/habits/h1/completions/2024-06-01`), { date: '2024-06-01', completed: true, updatedAt: ts(), completedAt: ts() }, { merge: true }));
        });
      }
      for (const [name, data] of NOTES) {
        const merged = { ...data, habitId: 'h1', date: '2024-06-03', text: 'Edited', updatedAt: 1 };
        const refused = hasB && noteProblems(merged, 'h1_2024-06-03').length > 0;
        it(`${name}: editing it ${verb(refused)}`, async () => {
          await seed(`${U}/dayNotes/h1_2024-06-03`, data);
          await (refused ? assertFails : assertSucceeds)(setDoc(doc(db(), `${U}/dayNotes/h1_2024-06-03`), { habitId: 'h1', date: '2024-06-03', text: 'Edited', updatedAt: ts() }, { merge: true }));
        });
      }
    });

    describe('old profiles and ledgers keep working under every rule set: updates are judged on the keys they change', () => {
      const profiles: [string, Data][] = [
        ['oldest profile (no pendingAdjustment, lastTransactionId, createdAt)', { email: 'a@b.co', coins: 20, freezesOwned: 0 }],
        ['profile with the legacy freezeDates list and isDark', { email: 'a@b.co', displayName: 'a', coins: 24, freezesOwned: 1, isDark: true, freezeDates: ['2024-05-01', '2024-05-02'] }],
        ['profile with fields no current code writes', { email: 'a@b.co', coins: 20, freezesOwned: 0, theme: 'light', streakFreezes: 2, lastLogin: 1 }],
      ];
      for (const [name, data] of profiles) {
        it(`${name}: a reward, the welcome-freeze marker and Android's account deletion all succeed`, async () => {
          await seed(U, data);
          const d = db();
          const grant = (coins: number, id: string, type: string, delta: number, extra: Data = {}) =>
            writeBatch(d).update(doc(d, U), { coins, freezesOwned: Number(data.freezesOwned), pendingAdjustment: 0, lastTransactionId: id, updatedAt: ts() })
              .set(doc(d, `${U}/walletTransactions/${id}`), { type, coinDelta: delta, freezeDelta: 0, balanceAfter: coins, createdAt: ts(), ...extra }).commit();
          await assertSucceeds(grant(Number(data.coins) + 1, 'daily_2026-11-01', 'daily_completion', 1, { date: '2026-11-01' }));
          await assertSucceeds(updateDoc(doc(d, U), { welcomeFreezePending: false }));
          await assertSucceeds(setDoc(doc(d, U), { deletionRequested: true, deletionRequestedAt: ts() }, { merge: true }));
          await assertSucceeds(deleteDoc(doc(d, `${U}/walletTransactions/daily_2026-11-01`)));
          await assertSucceeds(deleteDoc(doc(d, U)));
        });
      }

      it('a reward recorded long ago has only a ledger entry (no reward record): reversing it writes a fresh record and succeeds', async () => {
        await seed(U, { email: 'a@b.co', coins: 21, freezesOwned: 0, pendingAdjustment: 0, lastTransactionId: 'daily_2026-11-01' });
        await seed(`${U}/walletTransactions/daily_2026-11-01`, { type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21, date: '2026-11-01' }); // no pendingDelta, no rewardId
        const d = db();
        await assertSucceeds(
          writeBatch(d)
            .update(doc(d, U), { coins: 20, freezesOwned: 0, pendingAdjustment: 0, lastTransactionId: 'daily_2026-11-01_rev1', updatedAt: ts() })
            .set(doc(d, `${U}/walletTransactions/daily_2026-11-01_rev1`), { type: 'reward_reversal', coinDelta: -1, freezeDelta: 0, balanceAfter: 20, createdAt: ts() })
            .set(doc(d, `${U}/rewards/daily_2026-11-01`), { active: false, cycle: 1, amount: 1, type: 'daily_completion', lastTransactionId: 'daily_2026-11-01_rev1', updatedAt: ts(), date: '2026-11-01' })
            .commit(),
        );
      });
    });

    describe('RISK PROBES: shapes no current code writes (Part A refuses them; they are not needed by the current Android source)', () => {
      const entry = (id: string, tx: Data, userDelta: { coins: number; freezes?: number }) => async () => {
        await seed(U, { email: 'a@b.co', coins: 20, freezesOwned: 1, pendingAdjustment: 0 });
        const d = db();
        return writeBatch(d)
          .update(doc(d, U), { coins: 20 + userDelta.coins, freezesOwned: 1 + (userDelta.freezes ?? 0), pendingAdjustment: 0, lastTransactionId: id, updatedAt: ts() })
          .set(doc(d, `${U}/walletTransactions/${id}`), { freezeDelta: 0, createdAt: ts(), balanceAfter: 20 + userDelta.coins, ...tx })
          .commit();
      };
      const probes: [string, string, Data, { coins: number; freezes?: number }][] = [
        ['an unknown ledger type (for example a one-off bonus)', 'guest_bonus', { type: 'guest_bonus', coinDelta: 20 }, { coins: 20 }],
        ['a milestone worth 7 coins', 'milestone_h1_7_2026-11-01', { type: 'streak_milestone', coinDelta: 7 }, { coins: 7 }],
        ['a purchase at the earlier price of 10', 'freeze_buy_old10', { type: 'freeze_purchase', coinDelta: -10, freezeDelta: 1 }, { coins: -10, freezes: 1 }],
        ['a purchase at a price of 15', 'freeze_buy_old15', { type: 'freeze_purchase', coinDelta: -15, freezeDelta: 1 }, { coins: -15, freezes: 1 }],
        ['a daily reward worth 2', 'daily_2026-11-01', { type: 'daily_completion', coinDelta: 2 }, { coins: 2 }],
      ];
      for (const [name, id, tx, delta] of probes) {
        it(`${name}: ${hasA ? 'REFUSED' : 'accepted'}`, async () => {
          expect(ledgerEntryAccepted({ freezeDelta: 0, balanceAfter: 0, ...tx }, id)).toBe(false); // the scanner flags it as well
          await (hasA ? assertFails : assertSucceeds)(entry(id, tx, delta)());
        });
      }

      it(`an older freeze applied by PAYING COINS (coin -10, no freeze used, paidWith "coins"): ${hasA ? 'REFUSED' : 'accepted'}`, async () => {
        await seed(U, { email: 'a@b.co', coins: 20, freezesOwned: 0, pendingAdjustment: 0 });
        const d = db();
        const id = 'freeze_apply_h1_2026-11-07';
        const write = writeBatch(d)
          .update(doc(d, U), { coins: 10, freezesOwned: 0, pendingAdjustment: 0, lastTransactionId: id, updatedAt: ts() })
          .set(doc(d, `${U}/walletTransactions/${id}`), { type: 'freeze_application', coinDelta: -10, freezeDelta: 0, balanceAfter: 10, createdAt: ts(), date: '2026-11-07', habitId: 'h1' })
          .set(doc(d, `${U}/freezes/h1_2026-11-07`), { habitId: 'h1', date: '2026-11-07', month: '2026-11', paidWith: 'coins', transactionId: id, createdAt: ts() })
          .set(doc(d, `${U}/freezeMonths/2026-11`), { count: 1, updatedAt: ts() })
          .commit();
        expect(ledgerEntryAccepted({ type: 'freeze_application', coinDelta: -10, freezeDelta: 0, balanceAfter: 10 }, id)).toBe(false);
        await (hasA ? assertFails : assertSucceeds)(write);
      });
    });
  });
}
