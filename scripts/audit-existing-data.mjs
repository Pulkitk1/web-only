// READ-ONLY compatibility scan of the existing Firestore data against the PROPOSED rules. The habit, completion and note checks are PART B (web/firebase/rules/part-b.rules); the ledger and reward checks are informational for PART A (web/firebase/firestore.rules).
//
//   npm install --no-save firebase-admin            # not a project dependency; --no-save keeps package.json unchanged
//   gcloud auth application-default login           # your own identity; no service-account key file is needed or wanted
//   node scripts/audit-existing-data.mjs --project habbit-tracker-12 --yes [--limit 5000 | --all] [--out report.json] [--show-paths]
//
// It only READS. It never calls set, update, delete, add, batch or a transaction (the unit test runs it against a fake that throws on any write).
// Reads are billed: by default at most --limit (5000) documents per collection group are read; --all reads everything. It asks for --yes.
//
// PRIVACY: the report holds COUNTS, field NAMES, and numbers such as the longest name length. It never prints a name, an email, a note's text, a
// value, a uid or a document path. A document that has a problem is labelled with a short hash so it can be found by someone with Console access
// (--show-paths prints the real paths instead; use it only in a private terminal, and do not paste the output anywhere).
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { ledgerEntryAccepted, rewardAccepted, completionProblems, habitProblems, noteProblems, profileExtraFields } from './lib/rulesCompat.mjs';

const bump = (o, k, n = 1) => { o[k] = (o[k] ?? 0) + n; };
const sample = (arr, v) => { if (arr.length < 3) arr.push(v); };

/** Runs the scan over `db` (a Firestore Admin instance, or any object with the same read methods). Returns the report; writes nothing. */
export async function runAudit(db, { limit = 5000, all = false, showPaths = false, hash = (s) => createHash('sha256').update(s).digest('hex') } = {}) {
  const label = (path) => (showPaths ? path : hash(path).slice(0, 8));
  const read = async (q) => {
    const snap = await (all ? q.get() : q.limit(limit).get());
    return snap.docs;
  };
  const report = { readLimitPerGroup: all ? 'all' : limit, truncated: [], profiles: {}, habits: {}, completions: {}, notes: {}, ledger: {}, rewards: {}, freezes: {}, freezeMonths: {} };
  const truncated = (name, n) => { if (!all && n >= limit) report.truncated.push(name); };

  // Profiles: never re-validated as a whole, so this is information only.
  const users = await read(db.collection('users'));
  truncated('users', users.length);
  const P = { count: users.length, extraFieldNames: {}, withoutPendingAdjustment: 0, withoutLastTransactionId: 0, welcomeFreezePending: 0, deletionRequested: 0, withLegacyFreezeDates: 0, withoutCreatedAt: 0 };
  for (const u of users) {
    const d = u.data();
    for (const k of profileExtraFields(d)) bump(P.extraFieldNames, k);
    if (!('pendingAdjustment' in d)) P.withoutPendingAdjustment++;
    if (!('lastTransactionId' in d)) P.withoutLastTransactionId++;
    if (d.welcomeFreezePending === true) P.welcomeFreezePending++;
    if (d.deletionRequested === true) P.deletionRequested++;
    if ('freezeDates' in d) P.withLegacyFreezeDates++;
    if (!('createdAt' in d)) P.withoutCreatedAt++;
  }
  report.profiles = P;

  // Habits: an update re-validates the whole resulting document.
  const habits = await read(db.collectionGroup('habits'));
  truncated('habits', habits.length);
  const H = { count: habits.length, wouldFailAnUpdate: 0, problems: {}, examples: [], longestName: 0, mostCompletedDates: 0, mostScheduleHistory: 0, mostFields: 0, withoutCreatedDate: 0, withoutCreatedAt: 0, withoutSortOrder: 0, withoutScheduleHistory: 0, archived: 0, imported: 0, nonIntegerDaysPerWeek: 0 };
  for (const h of habits) {
    const d = h.data();
    const problems = habitProblems(d);
    if (problems.length) {
      H.wouldFailAnUpdate++;
      for (const p of problems) bump(H.problems, p);
      sample(H.examples, label(h.ref.path));
    }
    H.longestName = Math.max(H.longestName, typeof d.name === 'string' ? d.name.length : 0);
    H.mostCompletedDates = Math.max(H.mostCompletedDates, Array.isArray(d.completedDates) ? d.completedDates.length : 0);
    H.mostScheduleHistory = Math.max(H.mostScheduleHistory, Array.isArray(d.scheduleHistory) ? d.scheduleHistory.length : 0);
    H.mostFields = Math.max(H.mostFields, Object.keys(d).length);
    if (!('createdDate' in d)) H.withoutCreatedDate++;
    if (!('createdAt' in d)) H.withoutCreatedAt++;
    if (!('sortOrder' in d)) H.withoutSortOrder++;
    if (!('scheduleHistory' in d)) H.withoutScheduleHistory++;
    if (d.archived === true) H.archived++;
    if ('migratedFrom' in d) H.imported++;
    if ('daysPerWeek' in d && typeof d.daysPerWeek === 'number' && !Number.isInteger(d.daysPerWeek)) H.nonIntegerDaysPerWeek++;
  }
  report.habits = H;

  // Completions and notes: a merge write validates the resulting document.
  const completions = await read(db.collectionGroup('completions'));
  truncated('completions', completions.length);
  const C = { count: completions.length, wouldFailAMergeWrite: 0, problems: {}, fieldSets: {}, examples: [] };
  for (const c of completions) {
    const d = c.data();
    bump(C.fieldSets, Object.keys(d).sort().join(','));
    const problems = completionProblems(d, c.id);
    if (problems.length) {
      C.wouldFailAMergeWrite++;
      for (const p of problems) bump(C.problems, p.replace(/"[^"]*"/, '"<field>"'));
      sample(C.examples, label(c.ref.path));
    }
  }
  report.completions = C;

  const notes = await read(db.collectionGroup('dayNotes'));
  truncated('dayNotes', notes.length);
  const N = { count: notes.length, wouldFailAMergeWrite: 0, problems: {}, fieldSets: {}, examples: [] };
  for (const n of notes) {
    const d = n.data();
    bump(N.fieldSets, Object.keys(d).sort().join(','));
    const problems = noteProblems(d, n.id);
    if (problems.length) {
      N.wouldFailAMergeWrite++;
      for (const p of problems) bump(N.problems, p.replace(/"[^"]*"/, '"<field>"'));
      sample(N.examples, label(n.ref.path));
    }
  }
  report.notes = N;

  // Ledger entries are append-only: they are scanned for what older app versions WROTE (types and amounts), since an old install that has not
  // updated will keep writing those shapes under the new rules.
  const tx = await read(db.collectionGroup('walletTransactions'));
  truncated('walletTransactions', tx.length);
  const L = { count: tx.length, types: {}, wouldBeRejectedIfWrittenToday: 0, rejectedShapes: {}, withoutPendingDelta: 0, examples: [] };
  for (const t of tx) {
    const d = t.data();
    bump(L.types, String(d.type));
    if (!('pendingDelta' in d)) L.withoutPendingDelta++;
    if (!ledgerEntryAccepted(d, t.id)) {
      L.wouldBeRejectedIfWrittenToday++;
      bump(L.rejectedShapes, `${d.type} coin=${d.coinDelta} freeze=${d.freezeDelta} pending=${d.pendingDelta ?? 0} keys=${Object.keys(d).sort().join('+')}`);
      sample(L.examples, label(t.ref.path));
    }
  }
  report.ledger = L;

  const rewards = await read(db.collectionGroup('rewards'));
  truncated('rewards', rewards.length);
  const R = { count: rewards.length, amounts: {}, types: {}, wouldBeRejectedIfWrittenToday: 0, withoutType: 0, examples: [] };
  for (const r of rewards) {
    const d = r.data();
    bump(R.amounts, String(d.amount));
    bump(R.types, String(d.type));
    if (!('type' in d)) R.withoutType++;
    if (!rewardAccepted(d)) { R.wouldBeRejectedIfWrittenToday++; sample(R.examples, label(r.ref.path)); }
  }
  report.rewards = R;

  const freezes = await read(db.collectionGroup('freezes'));
  truncated('freezes', freezes.length);
  const F = { count: freezes.length, fieldSets: {}, paidWith: {}, monthFieldMismatch: 0 };
  for (const f of freezes) {
    const d = f.data();
    bump(F.fieldSets, Object.keys(d).sort().join(','));
    bump(F.paidWith, String(d.paidWith));
    if (typeof d.date === 'string' && d.month !== d.date.slice(0, 7)) F.monthFieldMismatch++;
  }
  report.freezes = F;

  const months = await read(db.collectionGroup('freezeMonths'));
  truncated('freezeMonths', months.length);
  const M = { count: months.length, overLimit: 0, idNotYearMonth: 0, counts: {} };
  for (const m of months) {
    const d = m.data();
    bump(M.counts, String(d.count));
    if (!(typeof d.count === 'number' && d.count <= 3)) M.overLimit++;
    if (!/^\d{4}-\d{2}$/.test(m.id)) M.idNotYearMonth++;
  }
  report.freezeMonths = M;

  report.verdict = {
    habitsThatWouldBlockAnUpdate: H.wouldFailAnUpdate,
    completionsThatWouldBlockAMergeWrite: C.wouldFailAMergeWrite,
    notesThatWouldBlockAMergeWrite: N.wouldFailAMergeWrite,
    ledgerEntriesWithAShapeTheRulesWouldRefuse: L.wouldBeRejectedIfWrittenToday,
    rewardRecordsWithAShapeTheRulesWouldRefuse: R.wouldBeRejectedIfWrittenToday,
    safeToPublishOnThisDataAlone: H.wouldFailAnUpdate + C.wouldFailAMergeWrite + N.wouldFailAMergeWrite + L.wouldBeRejectedIfWrittenToday + R.wouldBeRejectedIfWrittenToday === 0 && report.truncated.length === 0,
    note: 'Zero here means the data you read is compatible. It does not prove an old app version that has not written yet will use a known shape: see the ledger types above.',
  };
  return report;
}

// ── command line ────────────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  const args = process.argv.slice(2);
  const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const flag = (name) => args.includes(`--${name}`);
  const project = opt('project');
  if (!project || !flag('yes')) {
    console.error('Usage: node scripts/audit-existing-data.mjs --project <firebase-project-id> --yes [--limit N | --all] [--out file.json] [--show-paths]\n' +
      'It READS the project\'s Firestore data (billed per document read, at most --limit per collection group unless --all) and prints counts only.\n' +
      'It never writes. Pass --yes to confirm.');
    process.exit(2);
  }
  const limit = Number(opt('limit') ?? 5000);
  let admin;
  try {
    admin = (await import('firebase-admin')).default ?? (await import('firebase-admin'));
  } catch {
    console.error('firebase-admin is not installed. Run:  npm install --no-save firebase-admin');
    process.exit(2);
  }
  admin.initializeApp({ projectId: project });
  console.error(`Reading project ${project} (read-only), ${flag('all') ? 'all documents' : `up to ${limit} per collection group`} ...`);
  const report = await runAudit(admin.firestore(), { limit, all: flag('all'), showPaths: flag('show-paths') });
  const text = JSON.stringify(report, null, 2);
  if (opt('out')) { writeFileSync(opt('out'), text); console.error(`Report written to ${opt('out')}`); } else console.log(text);
  process.exit(0);
}
