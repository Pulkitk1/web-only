import { describe, expect, it } from 'vitest';

import { runAudit } from '../scripts/audit-existing-data.mjs';
import { completionProblems, habitProblems, ledgerEntryAccepted, noteProblems, profileExtraFields, rewardAccepted } from '../scripts/lib/rulesCompat.mjs';

describe('rulesCompat: the stored-document checks that mirror the proposed rules', () => {
  it('a minimal legacy habit (no createdAt, sortOrder, schedule history, goal, reminder) is fine', () => {
    expect(habitProblems({ name: 'Read', color: 4281583945, completedDates: ['2024-06-01'], streak: 1, bestStreak: 3, daysPerWeek: 7, restDays: [] })).toEqual([]);
    expect(habitProblems({})).toEqual([]);
  });

  it('unknown legacy fields are not a problem (only the field count is bounded)', () => {
    expect(habitProblems({ name: 'x', icon: 'star', description: 'old', streakRuns: [] })).toEqual([]);
    expect(habitProblems(Object.fromEntries(Array.from({ length: 41 }, (_, i) => [`f${i}`, 1])))).toContain('more than 40 fields');
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['blank name', { name: '' }, 'name'],
    ['huge name', { name: 'x'.repeat(1001) }, 'name'],
    ['weekly target 0', { daysPerWeek: 0 }, 'daysPerWeek'],
    ['weekly target 8', { daysPerWeek: 8 }, 'daysPerWeek'],
    ['fractional weekly target', { daysPerWeek: 5.5 }, 'daysPerWeek'],
    ['8 rest days', { restDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'] }, 'restDays'],
    ['rest days as a string', { restDays: 'Mon,Sat' }, 'restDays'],
    ['a created date in another format', { createdDate: '1/2/2024' }, 'createdDate'],
    ['empty created date', { createdDate: '' }, 'createdDate'],
    ['completed dates as a map', { completedDates: { a: 1 } }, 'completedDates'],
    ['a text streak', { streak: '3' }, 'streak'],
    ['a text archived flag', { archived: 'true' }, 'archived'],
  ])('flags %s', (_n, d, key) => {
    expect(habitProblems(d).join(' ')).toContain(key);
  });

  it('completions: legacy shapes and one extra field pass; more than 10 fields or a mismatched date do not', () => {
    expect(completionProblems({ date: '2024-06-01', completed: true }, '2024-06-01')).toEqual([]);
    expect(completionProblems({ completed: true }, '2024-06-01')).toEqual([]);
    expect(completionProblems({ date: '2024-06-01', completed: false, uncheckedAt: 1, updatedAt: 1 }, '2024-06-01')).toEqual([]);
    expect(completionProblems({ date: '2024-06-02', completed: true }, '2024-06-01')).toHaveLength(1);
    expect(completionProblems({ date: '2024-06-01', completed: true, note: 'x' }, '2024-06-01')).toEqual([]);
    expect(completionProblems({ date: '2024-06-01', completed: true, ...Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`f${i}`, i])) }, '2024-06-01')[0]).toMatch(/more than 10 fields/);
    expect(completionProblems({ completed: true }, 'monday')[0]).toMatch(/not a date/);
  });

  it('notes: the Android and Web shapes and one extra field pass; more than 10 fields or a wrong id do not', () => {
    expect(noteProblems({ habitId: 'h', date: '2024-06-01', text: 'x', updatedAt: 1 }, 'h_2024-06-01')).toEqual([]);
    expect(noteProblems({ habitId: 'h', date: '2024-06-01', text: 'x', createdAt: 1, updatedAt: 1 }, 'h_2024-06-01')).toEqual([]);
    expect(noteProblems({ habitId: 'h', date: '2024-06-01', text: 'x', mood: 1 }, 'h_2024-06-01')).toEqual([]);
    expect(noteProblems({ habitId: 'h', date: '2024-06-01', text: 'x', ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`f${i}`, i])) }, 'h_2024-06-01')[0]).toMatch(/more than 10 fields/);
    expect(noteProblems({ habitId: 'h', date: '2024-06-01', text: 'x'.repeat(201) }, 'h_2024-06-01')).not.toEqual([]);
    expect(noteProblems({ habitId: 'h', date: '2024-06-01', text: 'x' }, 'wrong')).not.toEqual([]);
  });

  it('profiles: only fields outside the known sets are reported, for information', () => {
    expect(profileExtraFields({ email: 'a', coins: 1, freezesOwned: 0, isDark: true, freezeDates: ['2024-01-01'], theme: 'x' }).sort()).toEqual(['freezeDates', 'theme']);
  });

  it('ledger entries: every type Android writes today is accepted; an unknown type or an unusual amount is not', () => {
    const ok = (d: Record<string, unknown>, id: string) => ledgerEntryAccepted(d, id);
    expect(ok({ type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21 }, 'daily_2026-11-01')).toBe(true);
    expect(ok({ type: 'daily_completion', coinDelta: 0, freezeDelta: 0, balanceAfter: 21, pendingDelta: -1 }, 'daily_2026-11-01')).toBe(true);
    expect(ok({ type: 'streak_milestone', coinDelta: 5, freezeDelta: 0, balanceAfter: 26, milestone: 15 }, 'milestone_h1_15_2026-11-01')).toBe(true);
    expect(ok({ type: 'reward_reversal', coinDelta: -1, freezeDelta: 0, balanceAfter: 20 }, 'daily_2026-11-01_rev1')).toBe(true);
    expect(ok({ type: 'reward_restored', coinDelta: 1, freezeDelta: 0, balanceAfter: 21 }, 'daily_2026-11-01_grant2')).toBe(true);
    expect(ok({ type: 'freeze_purchase', coinDelta: -20, freezeDelta: 1, balanceAfter: 0 }, 'freeze_buy_abc')).toBe(true);
    expect(ok({ type: 'freeze_purchase', coinDelta: -10, freezeDelta: 1, balanceAfter: 10 }, 'freeze_buy_abc')).toBe(false); // the earlier price of 10: Part A requires exactly 20
    expect(ok({ type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 5 }, 'freeze_apply_h1_2026-11-01')).toBe(true);
    expect(ok({ type: 'welcome_freeze', coinDelta: 0, freezeDelta: 1, balanceAfter: 20 }, 'welcome_freeze')).toBe(true);
    expect(ok({ type: 'bonus', coinDelta: 20, freezeDelta: 0, balanceAfter: 40 }, 'x')).toBe(false); // an unknown (older?) type
    expect(ok({ type: 'streak_milestone', coinDelta: 7, freezeDelta: 0, balanceAfter: 27 }, 'milestone_h1_7_x')).toBe(false); // an unusual milestone amount
    expect(ok({ type: 'freeze_purchase', coinDelta: -15, freezeDelta: 1, balanceAfter: 5 }, 'freeze_buy_abc')).toBe(false); // an unusual price
  });

  it('reward records', () => {
    expect(rewardAccepted({ active: true, cycle: 1, amount: 1, type: 'daily_completion', lastTransactionId: 'x', updatedAt: 1, date: '2026-11-01' })).toBe(true);
    expect(rewardAccepted({ active: true, cycle: 1, amount: 1, lastTransactionId: 'x' })).toBe(false); // no type
    expect(rewardAccepted({ active: true, cycle: 1, amount: 3, type: 'daily_completion' })).toBe(false);
  });
});

// ── the scanner itself: read only, aggregate only, nothing personal ──────────────────────────────────────────────────────────────────
type Doc = { id: string; path: string; data: Record<string, unknown> };
const NAME_SECRET = 'My Private Habit Name';
const EMAIL_SECRET = 'person@example.com';
const NOTE_SECRET = 'a very private note';
const UID = 'uid-secret-123';

function fakeDb(groups: Record<string, Doc[]>) {
  const writes: string[] = [];
  const snap = (docs: Doc[]) => ({ docs: docs.map((d) => ({ id: d.id, ref: { path: d.path }, data: () => d.data })) });
  const query = (name: string) =>
    new Proxy(
      {
        limit: (n: number) => ({ get: async () => snap((groups[name] ?? []).slice(0, n)) }),
        get: async () => snap(groups[name] ?? []),
      },
      { get: (t, k: string) => (k in t ? (t as never)[k] : (writes.push(k), () => { throw new Error(`write attempted: ${k}`); })) },
    );
  return { db: { collection: (n: string) => query(n), collectionGroup: (n: string) => query(n) }, writes };
}

describe('audit-existing-data (the read-only scanner)', () => {
  const groups: Record<string, Doc[]> = {
    users: [
      { id: UID, path: `users/${UID}`, data: { email: EMAIL_SECRET, displayName: 'person', coins: 31, freezesOwned: 1, isDark: true, freezeDates: ['2024-01-01'], createdAt: 1 } },
      { id: 'u2', path: 'users/u2', data: { email: 'b@b.co', coins: 20, freezesOwned: 0, pendingAdjustment: 0, lastTransactionId: 'welcome_freeze', welcomeFreezePending: true, deletionRequested: true } },
    ],
    habits: [
      { id: 'h1', path: `users/${UID}/habits/h1`, data: { name: NAME_SECRET, color: 1, completedDates: ['2024-06-01'], daysPerWeek: 5, restDays: ['Sat', 'Sun'], createdDate: '2024-06-01' } },
      { id: 'h2', path: `users/${UID}/habits/h2`, data: { name: 'x'.repeat(1500), daysPerWeek: 9, createdDate: 'soon' } },
    ],
    completions: [
      { id: '2024-06-01', path: `users/${UID}/habits/h1/completions/2024-06-01`, data: { date: '2024-06-01', completed: true } },
      { id: '2024-06-02', path: `users/${UID}/habits/h1/completions/2024-06-02`, data: { date: '2024-06-09', completed: true, mood: 3 } }, // a date field that differs from the id (the extra field `mood` is tolerated)
    ],
    dayNotes: [{ id: 'h1_2024-06-03', path: `users/${UID}/dayNotes/h1_2024-06-03`, data: { habitId: 'h1', date: '2024-06-03', text: NOTE_SECRET, updatedAt: 1 } }],
    walletTransactions: [
      { id: 'daily_2024-06-01', path: `users/${UID}/walletTransactions/daily_2024-06-01`, data: { type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21 } },
      { id: 'old1', path: `users/${UID}/walletTransactions/old1`, data: { type: 'guest_bonus', coinDelta: 20, freezeDelta: 0, balanceAfter: 40 } },
    ],
    rewards: [{ id: 'daily_2024-06-01', path: `users/${UID}/rewards/daily_2024-06-01`, data: { active: true, cycle: 1, amount: 1, type: 'daily_completion' } }],
    freezes: [{ id: 'h1_2024-06-04', path: `users/${UID}/freezes/h1_2024-06-04`, data: { habitId: 'h1', date: '2024-06-04', month: '2024-06', paidWith: 'inventory', transactionId: 't', createdAt: 1 } }],
    freezeMonths: [{ id: '2024-06', path: `users/${UID}/freezeMonths/2024-06`, data: { count: 1 } }],
  };

  it('counts what would break, and reads only', async () => {
    const { db, writes } = fakeDb(groups);
    const r = await runAudit(db, { limit: 100 });
    expect(writes).toEqual([]);
    expect(r.habits).toMatchObject({ count: 2, wouldFailAnUpdate: 1, longestName: 1500 });
    expect(r.habits.problems).toMatchObject({ 'daysPerWeek not an integer from 1 to 7': 1, 'createdDate not yyyy-MM-dd': 1 });
    expect(r.completions).toMatchObject({ count: 2, wouldFailAMergeWrite: 1 });
    expect(r.notes).toMatchObject({ count: 1, wouldFailAMergeWrite: 0 });
    expect(r.ledger.types).toEqual({ daily_completion: 1, guest_bonus: 1 });
    expect(r.ledger.wouldBeRejectedIfWrittenToday).toBe(1);
    expect(r.profiles).toMatchObject({ count: 2, withLegacyFreezeDates: 1, deletionRequested: 1, welcomeFreezePending: 1, withoutPendingAdjustment: 1 });
    expect(r.profiles.extraFieldNames).toEqual({ freezeDates: 1 });
    expect(r.verdict.safeToPublishOnThisDataAlone).toBe(false);
  });

  it('prints nothing personal: no name, email, note text, uid or path', async () => {
    const { db } = fakeDb(groups);
    const text = JSON.stringify(await runAudit(db, { limit: 100 }));
    for (const secret of [NAME_SECRET, EMAIL_SECRET, NOTE_SECRET, UID, 'users/', 'person']) expect(text).not.toContain(secret);
    const withPaths = JSON.stringify(await runAudit(db, { limit: 100, showPaths: true }));
    expect(withPaths).toContain(`users/${UID}/habits/h2`); // only on request
  });

  it('says so when it stopped at the read limit, and a clean small database is safe', async () => {
    const { db } = fakeDb(groups);
    expect((await runAudit(db, { limit: 2 })).truncated).toEqual(expect.arrayContaining(['users', 'habits', 'completions']));
    const clean = fakeDb({ users: groups.users, habits: [groups.habits[0]], completions: [groups.completions[0]], dayNotes: groups.dayNotes, walletTransactions: [groups.walletTransactions[0]], rewards: groups.rewards, freezes: groups.freezes, freezeMonths: groups.freezeMonths });
    const r = await runAudit(clean.db, { limit: 100 });
    expect(r.verdict.safeToPublishOnThisDataAlone).toBe(true);
    expect(r.verdict.note).toMatch(/old app version/);
  });
});

describe('the scanner flags a reminder time the way Part B does (hours 00 to 23, minutes 00 to 59)', () => {
  it.each(['00:00', '07:30', '23:59'])('%s is fine', (t) => expect(habitProblems({ reminderTime: t })).toEqual([]));
  it.each(['24:00', '12:60', '7:30', '07:30:00', '', 'noon'])('%s is flagged', (t) => expect(habitProblems({ reminderTime: t })).toContain('reminderTime not HH:mm or null'));
  it('null is fine (the Web writes null when the reminder is off)', () => expect(habitProblems({ reminderTime: null })).toEqual([]));
});
