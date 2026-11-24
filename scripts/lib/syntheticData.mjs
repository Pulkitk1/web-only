// SYNTHETIC test data for a STAGING Firebase project (never production). Nothing here comes from a real user: every name, email and id is made up.
// The same code is used by scripts/seed-staging-data.mjs (against a staging project) and by tests/rules/seed.rules.ts (against the emulator, under all
// four rule sets), so what the staging guide tells you to import is known to be accepted by the rules it is meant to test.
//
// It writes through the ordinary client write paths, as the signed-in test user, so the rules decide what is accepted: the wallet is built with
// the real ledger shapes (the welcome freeze, daily rewards, a milestone, a 20-coin purchase, a freeze application with its month counter).
//
// `fs` is the bag of Firestore functions { doc, setDoc, writeBatch, serverTimestamp } of the firebase/firestore package in use.

const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (key, n) => { const [y, m, d] = key.split('-').map(Number); return dayKey(new Date(y, m - 1, d + n)); };
const legacyDates = (today, n) => Array.from({ length: n }, (_, i) => addDays(today, -(i + 1)));

/** [id, label, document] for each habit shape. Shapes marked RISK PROBE break a Part B bound on purpose (they are included only on request). */
export function syntheticHabits(today, { includeRiskProbes = false } = {}) {
  const plain = (extra = {}) => ({ name: 'Synthetic Habit', color: 4281583945, daysPerWeek: 5, restDays: ['Sat', 'Sun'], createdDate: addDays(today, -40), streak: 0, bestStreak: 0, ...extra });
  const habits = [
    ['syn-current', 'current Android shape with goal, why, reminder and schedule history', plain({ name: 'Synthetic Current', sortOrder: 1, goal: 'Daily', why: 'Calm', reminderEnabled: true, reminderTime: '07:30', archived: false, scheduleHistory: [{ from: addDays(today, -40), restDays: ['Sat', 'Sun'], daysPerWeek: 5 }], completedDates: [] })],
    ['syn-minimal', 'minimal legacy shape (no createdAt, sortOrder, schedule history, goal or reminder)', { name: 'Synthetic Minimal', color: 4281583945, completedDates: legacyDates(today, 5), streak: 5, bestStreak: 9, daysPerWeek: 7, restDays: [], createdDate: addDays(today, -60) }],
    ['syn-nodate', 'legacy shape with no createdDate', { name: 'Synthetic No Date', color: 4281583945, completedDates: legacyDates(today, 3), streak: 3, bestStreak: 3, daysPerWeek: 5, restDays: ['Sat', 'Sun'] }],
    ['syn-long', 'a 300-character name (Android has no length limit on creation)', plain({ name: `Synthetic ${'long '.repeat(58)}`.slice(0, 300), sortOrder: 2 })],
    ['syn-legacy-history', 'about five years of legacy completedDates and no completion documents', plain({ name: 'Synthetic History', sortOrder: 3, completedDates: Array.from({ length: 1800 }, (_, i) => addDays(today, -(i + 100))) })],
    ['syn-archived', 'archived habit', plain({ name: 'Synthetic Archived', sortOrder: 4, archived: true, reminderEnabled: false, reminderTime: null })],
    ['syn-streak14', 'a 14-day streak ending yesterday (check today for the 15-day milestone)', plain({ name: 'Synthetic Streak 14', sortOrder: 5, daysPerWeek: 7, restDays: [], createdDate: addDays(today, -14), completedDates: [] })],
  ];
  if (includeRiskProbes) {
    habits.push(
      ['syn-risk-longname', 'RISK PROBE: a name over 1000 characters', plain({ name: 'x'.repeat(1001), sortOrder: 6 })],
      ['syn-risk-target', 'RISK PROBE: weekly target 9', plain({ name: 'Synthetic Risk Target', sortOrder: 7, daysPerWeek: 9 })],
      ['syn-risk-restdays', 'RISK PROBE: rest days stored as a string', plain({ name: 'Synthetic Risk Rest Days', sortOrder: 8, restDays: 'Sat,Sun' })],
      ['syn-risk-date', 'RISK PROBE: a created date in another format', plain({ name: 'Synthetic Risk Date', sortOrder: 9, createdDate: '01/06/2024' })],
    );
  }
  return habits;
}

/** Writes the synthetic account for `uid`. Returns a summary. Throws the first rule refusal (so a seed that the rules refuse is noticed). */
export async function seedAccount({ db, uid, fs, today, includeRiskProbes = false }) {
  const { doc, setDoc, writeBatch, serverTimestamp: ts } = fs;
  const U = `users/${uid}`;
  const summary = { habits: 0, completions: 0, notes: 0, ledgerEntries: 0 };

  // 1. Profile exactly as Android's loadUser creates it.
  await setDoc(doc(db, U), { email: 'staging-test@example.invalid', displayName: 'staging-test', coins: 20, freezesOwned: 0, welcomeFreezePending: true, isDark: true, createdAt: ts(), updatedAt: ts() });

  // 2. The wallet, through the real ledger shapes. Each commit changes the user document and writes its entry (and extras) together.
  const wallet = { coins: 20, freezesOwned: 0, pending: 0 };
  const commit = async (entry, extras = {}) => {
    const b = writeBatch(db);
    b.update(doc(db, U), { coins: wallet.coins, freezesOwned: wallet.freezesOwned, pendingAdjustment: wallet.pending, lastTransactionId: entry.id, updatedAt: ts() });
    const tx = { type: entry.type, coinDelta: entry.coinDelta, freezeDelta: entry.freezeDelta, balanceAfter: wallet.coins, createdAt: ts() };
    for (const k of ['date', 'habitId', 'milestone', 'rewardId']) if (entry[k] !== undefined) tx[k] = entry[k];
    if (entry.pendingDelta) tx.pendingDelta = entry.pendingDelta;
    b.set(doc(db, `${U}/walletTransactions/${entry.id}`), tx);
    if (extras.reward) b.set(doc(db, `${U}/rewards/${extras.reward.id}`), { ...extras.reward.fields, lastTransactionId: entry.id, updatedAt: ts() });
    if (extras.freeze) b.set(doc(db, `${U}/freezes/${extras.freeze.habitId}_${extras.freeze.date}`), { habitId: extras.freeze.habitId, date: extras.freeze.date, month: extras.freeze.date.slice(0, 7), paidWith: 'inventory', transactionId: entry.id, createdAt: ts() });
    if (extras.month) b.set(doc(db, `${U}/freezeMonths/${extras.month.month}`), { count: extras.month.count, updatedAt: ts() });
    await b.commit();
    summary.ledgerEntries++;
  };
  wallet.freezesOwned = 1;
  await commit({ id: 'welcome_freeze', type: 'welcome_freeze', coinDelta: 0, freezeDelta: 1 });
  await setDoc(doc(db, U), { welcomeFreezePending: false }, { merge: true });
  // 18 daily rewards, so after the 5-coin milestone and one 20-coin purchase the account still holds 23 coins: enough to buy another freeze in a smoke test.
  // The rewards are dated BEFORE the current month: the apps only issue and reverse rewards inside the current month's window, so a seeded reward
  // inside it would be reversed on the first load (the synthetic completions do not earn it) and the wallet would not stay at 23 coins.
  const monthStart = `${today.slice(0, 8)}01`;
  for (let n = 1; n <= 18; n++) {
    wallet.coins += 1;
    const date = addDays(monthStart, -n), id = `daily_${date}`;
    await commit({ id, type: 'daily_completion', coinDelta: 1, freezeDelta: 0, date, rewardId: id }, { reward: { id, fields: { active: true, cycle: 1, amount: 1, type: 'daily_completion', date } } });
  }
  wallet.coins += 5;
  const mDate = addDays(monthStart, -1), mId = `milestone_syn-current_15_${addDays(monthStart, -20)}`;
  await commit({ id: mId, type: 'streak_milestone', coinDelta: 5, freezeDelta: 0, date: mDate, habitId: 'syn-current', milestone: 15, rewardId: mId }, { reward: { id: mId, fields: { active: true, cycle: 1, amount: 5, type: 'streak_milestone', date: mDate, habitId: 'syn-current', milestone: 15 } } });
  wallet.coins -= 20; wallet.freezesOwned += 1;
  await commit({ id: 'freeze_buy_synthetic-0001', type: 'freeze_purchase', coinDelta: -20, freezeDelta: 1, date: addDays(today, -2) });
  wallet.freezesOwned -= 1;
  const fDate = addDays(today, -1);
  await commit({ id: `freeze_apply_syn-current_${fDate}`, type: 'freeze_application', coinDelta: 0, freezeDelta: -1, date: fDate, habitId: 'syn-current' }, { freeze: { habitId: 'syn-current', date: fDate }, month: { month: fDate.slice(0, 7), count: 1 } });

  // 3. Habits, completions and notes.
  for (const [id, , data] of syntheticHabits(today, { includeRiskProbes })) {
    await setDoc(doc(db, `${U}/habits/${id}`), { ...data, createdAt: ts(), updatedAt: ts() });
    summary.habits++;
  }
  const withCompletions = ['syn-current', 'syn-streak14'];
  for (const id of withCompletions) {
    const b = writeBatch(db);
    const days = id === 'syn-streak14' ? 14 : 10;
    for (let i = 1; i <= days; i++) {
      const date = addDays(today, -i);
      b.set(doc(db, `${U}/habits/${id}/completions/${date}`), i % 4 === 0 && id === 'syn-current' ? { date, completed: false, updatedAt: ts(), uncheckedAt: ts() } : { date, completed: true, updatedAt: ts(), completedAt: ts() });
      summary.completions++;
    }
    await b.commit();
  }
  for (const [habit, n, text] of [['syn-current', -2, 'Synthetic note: felt great'], ['syn-current', -5, 'Synthetic note: travelling'], ['syn-streak14', -3, 'Synthetic note: short on time']]) {
    const date = addDays(today, n);
    await setDoc(doc(db, `${U}/dayNotes/${habit}_${date}`), { habitId: habit, date, text, createdAt: ts(), updatedAt: ts() });
    summary.notes++;
  }
  return summary;
}
