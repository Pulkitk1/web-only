// Pure checks that mirror the PROPOSED Firestore rules (Part A: web/firebase/firestore.rules for ledger and reward shapes; Part B: web/firebase/rules/part-b.rules for habits, completions and notes) on a document as STORED, so existing data can be tested without
// touching it. Used by scripts/audit-existing-data.mjs and unit tested (tests/rulesCompat.test.ts), and compared with the real rules in the
// emulator (tests/rules/legacy.rules.ts) so the two cannot drift apart.
//
// Why only some collections matter: a rule re-validates a document only when it is WRITTEN again. Android re-writes habits (every check-in, edit
// and reorder updates the habit document, so the whole RESULTING document must pass), completions and notes (merge writes: the resulting document
// must pass). Profiles are checked on the keys that CHANGE only. Ledger entries, reward records (always written whole), freezes and counters are
// create-only or whole-document writes, so legacy ones are never re-validated; they are scanned for what they TELL us about what older app versions
// write (types and amounts), which is what the rules must accept from an old install that has not updated.

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/; // same as Part B: hours 00 to 23, minutes 00 to 59
const isStr = (v) => typeof v === 'string';
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
// The Admin SDK returns integers and doubles alike as numbers, so `is int` can only be approximated by Number.isInteger.
const isInt = (v) => Number.isInteger(v);
const has = (d, k) => Object.prototype.hasOwnProperty.call(d, k);

/** Problems that would make an UPDATE of this habit document fail under the proposed rules (`validHabit`). Empty = Android can keep updating it. */
export function habitProblems(d) {
  const p = [];
  if (Object.keys(d).length > 40) p.push('more than 40 fields');
  if (has(d, 'name') && !(isStr(d.name) && d.name.length >= 1 && d.name.length <= 1000)) p.push('name not 1 to 1000 characters');
  if (has(d, 'goal') && !(isStr(d.goal) && d.goal.length <= 1000)) p.push('goal not text of at most 1000 characters');
  if (has(d, 'why') && !(isStr(d.why) && d.why.length <= 1000)) p.push('why not text of at most 1000 characters');
  if (has(d, 'daysPerWeek') && !(isInt(d.daysPerWeek) && d.daysPerWeek >= 1 && d.daysPerWeek <= 7)) p.push('daysPerWeek not an integer from 1 to 7');
  if (has(d, 'restDays') && !(Array.isArray(d.restDays) && d.restDays.length <= 7)) p.push('restDays not a list of at most 7');
  if (has(d, 'createdDate') && !(isStr(d.createdDate) && DATE.test(d.createdDate))) p.push('createdDate not yyyy-MM-dd');
  if (has(d, 'completedDates') && !(Array.isArray(d.completedDates) && d.completedDates.length <= 20000)) p.push('completedDates not a list of at most 20000');
  if (has(d, 'scheduleHistory') && !(Array.isArray(d.scheduleHistory) && d.scheduleHistory.length <= 2000)) p.push('scheduleHistory not a list of at most 2000');
  if (has(d, 'archived') && typeof d.archived !== 'boolean') p.push('archived not a boolean');
  if (has(d, 'reminderEnabled') && typeof d.reminderEnabled !== 'boolean') p.push('reminderEnabled not a boolean');
  if (has(d, 'reminderTime') && d.reminderTime !== null && !(isStr(d.reminderTime) && TIME.test(d.reminderTime))) p.push('reminderTime not HH:mm or null');
  for (const k of ['streak', 'bestStreak', 'sortOrder', 'color']) if (has(d, k) && !isNum(d[k])) p.push(`${k} not a number`);
  if (has(d, 'rewardsIgnoredThrough') && !(isStr(d.rewardsIgnoredThrough) && DATE.test(d.rewardsIgnoredThrough))) p.push('rewardsIgnoredThrough not yyyy-MM-dd');
  if (has(d, 'migratedFrom') && !(isStr(d.migratedFrom) && d.migratedFrom.length <= 200)) p.push('migratedFrom not text of at most 200 characters');
  return p;
}

/** Problems that would make a merge write to this completion document fail (`validCompletion`). */
export function completionProblems(d, id) {
  const p = [];
  if (!DATE.test(id)) p.push('document id is not a date');
  if (Object.keys(d).length > 10) p.push('more than 10 fields');
  if (has(d, 'date') && d.date !== id) p.push('date field differs from the document id');
  if (has(d, 'completed') && typeof d.completed !== 'boolean') p.push('completed not a boolean');
  return p;
}

/** Problems that would make a merge write to this note fail. */
export function noteProblems(d, id) {
  const p = [];
  if (Object.keys(d).length > 10) p.push('more than 10 fields');
  if (!isStr(d.habitId)) p.push('habitId not text');
  if (id !== `${d.habitId}_${d.date}`) p.push('id is not habitId_date');
  if (!(isStr(d.date) && DATE.test(d.date))) p.push('date not yyyy-MM-dd');
  if (!(isStr(d.text) && d.text.length > 0 && d.text.length <= 200)) p.push('text not 1 to 200 characters');
  return p;
}

const PROFILE_CREATE_KEYS = new Set(['email', 'displayName', 'coins', 'freezesOwned', 'welcomeFreezePending', 'isDark', 'createdAt', 'updatedAt']);
const PROFILE_UPDATE_KEYS = new Set(['coins', 'freezesOwned', 'pendingAdjustment', 'lastTransactionId', 'updatedAt', 'welcomeFreezePending', 'deletionRequested', 'deletionRequestedAt', 'displayName', 'email', 'isDark']);
/**
 * Profiles are never re-validated as a whole, so extra legacy fields are harmless to Android (an update is judged on the keys it changes). This
 * returns the fields outside the sets, for information: they show what older versions put on a profile.
 */
export function profileExtraFields(d) {
  return Object.keys(d).filter((k) => !PROFILE_CREATE_KEYS.has(k) && !PROFILE_UPDATE_KEYS.has(k) && k !== 'pendingAdjustment' && k !== 'lastTransactionId');
}

/** Whether a ledger entry has a type and amounts the proposed rules would accept if an app wrote it today (`entryShape`, id patterns included). */
export function ledgerEntryAccepted(d, id) {
  const pd = has(d, 'pendingDelta') ? d.pendingDelta : 0;
  if (![d.coinDelta, d.freezeDelta, d.balanceAfter, pd].every(isInt)) return false;
  const keys = new Set(['type', 'coinDelta', 'freezeDelta', 'balanceAfter', 'createdAt', 'date', 'habitId', 'milestone', 'pendingDelta', 'rewardId']);
  if (Object.keys(d).some((k) => !keys.has(k))) return false;
  const sum = d.coinDelta - pd;
  switch (d.type) {
    case 'daily_completion': return /^daily_\d{4}-\d{2}-\d{2}$/.test(id) && d.freezeDelta === 0 && d.coinDelta >= 0 && pd <= 0 && sum === 1;
    case 'streak_milestone': return /^milestone_.+/.test(id) && d.freezeDelta === 0 && d.coinDelta >= 0 && pd <= 0 && [5, 10, 20].includes(sum);
    case 'reward_restored': return /^.+_grant\d+$/.test(id) && d.freezeDelta === 0 && d.coinDelta >= 0 && pd <= 0 && [1, 5, 10, 20].includes(sum);
    case 'reward_reversal': return /^.+_rev\d+$/.test(id) && d.freezeDelta === 0 && d.coinDelta <= 0 && pd >= 0 && [1, 5, 10, 20].includes(pd - d.coinDelta);
    case 'welcome_freeze': return id === 'welcome_freeze' && d.coinDelta === 0 && d.freezeDelta === 1 && pd === 0;
    case 'freeze_purchase': return /^freeze_buy_.+/.test(id) && d.freezeDelta === 1 && d.coinDelta === -20 && pd === 0;
    case 'freeze_application': return /^freeze_apply_.+/.test(id) && d.coinDelta === 0 && d.freezeDelta === -1 && pd === 0;
    default: return false;
  }
}

/** Whether a reward record has the fields and values the proposed rules accept (`rewards` rule). */
export function rewardAccepted(d) {
  const keys = new Set(['active', 'cycle', 'amount', 'type', 'lastTransactionId', 'updatedAt', 'date', 'habitId', 'milestone']);
  return Object.keys(d).every((k) => keys.has(k)) && typeof d.active === 'boolean' && isInt(d.cycle) && d.cycle >= 1 && [1, 5, 10, 20].includes(d.amount) && ['daily_completion', 'streak_milestone'].includes(d.type);
}

/** A short anonymous label for a document, so a problem can be located by someone with access without the report naming anyone. */
export const anonymize = (path, hash) => hash(path).slice(0, 8);

