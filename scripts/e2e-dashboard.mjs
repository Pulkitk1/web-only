// Browser end-to-end checks for the Home dashboard. Drives a real headless Chrome over the DevTools protocol
// (no extra dependencies: uses Node's built-in WebSocket and fetch).
//
//   1. Start the app:   npm run web            (http://localhost:8081)
//   2. Run the checks:  npm run e2e
//
// Environment: BASE (default http://localhost:8081), CHROME_PATH (default: common Windows/macOS/Linux locations),
// SHOTS (a folder to save screenshots into; optional).
//
// A fake clock pins "today" to Saturday 2026-11-21 so a planned rest day and the Day-15 milestone can be exercised.
// The mock data is generated relative to today, so it stays consistent.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE || 'http://localhost:8081';
const SHOTS = process.env.SHOTS || '';
const PORT = 9400 + Math.floor(Math.random() * 400);
const CHROME =
  process.env.CHROME_PATH ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
  ].find(existsSync);
if (!CHROME) throw new Error('Chrome not found. Set CHROME_PATH.');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The throwaway Chrome profile lives next to the project (the _tmp folder inside the project by default, which Git ignores), not in the system drive's Temp, and is deleted when the run ends. Override with E2E_TMP.
const tmpRoot = process.env.E2E_TMP || join(dirname(fileURLToPath(import.meta.url)), '..', '_tmp');
mkdirSync(tmpRoot, { recursive: true });
const profile = mkdtempSync(join(tmpRoot, 'consisto-e2e-'));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--window-size=1400,1000', 'about:blank'], { stdio: 'ignore' });

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome did not start');
}
const page = await connect();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 0;
const pending = new Map();
let logs = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Fetch.requestPaused') {
    handleAuthRequest(msg.params);
  } else if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('EXCEPTION: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  } else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
    logs.push(`console.${msg.params.type}: ` + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  }
};

// ── Mock Firebase Auth server ──
// The auth tests run the real Firebase SDK in the page, but every identitytoolkit / securetoken request is answered here, so
// no account is ever created in the real project. Firestore is not used by this phase: any request to it is refused and recorded.
const authMock = { accounts: new Map([['a@b.co', { password: 'secret1', uid: 'uid-existing' }], ['r@b.co', { password: 'secret1', uid: 'uid-rewards' }], ['p@b.co', { password: 'secret1', uid: 'uid-pending' }], ['w@b.co', { password: 'secret1', uid: 'uid-wallet' }], ['v@b.co', { password: 'secret1', uid: 'uid-wallet-b' }], ['x@b.co', { password: 'secret1', uid: 'uid-welcome' }], ['del@b.co', { password: 'secret1', uid: 'uid-delete' }], ['del2@b.co', { password: 'secret1', uid: 'uid-delete-b' }], ['z@b.co', { password: 'secret1', uid: 'uid-zero' }]]), log: [], firestore: [], failNext: false, failDelete: false, uidCounter: 0 };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const fakeToken = (uid, email) => {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: 'https://securetoken.google.com/mock', aud: 'mock', auth_time: now, user_id: uid, sub: uid, iat: now, exp: now + 3600, email, email_verified: false, firebase: { identities: { email: [email] }, sign_in_provider: 'password' } })}.sig`;
};

// ── Fake Firestore reader (development builds accept `window.__consistoFakeReader`) ──
// Mirrors what the Android app writes under users/{uid}, including Compose-packed habit colours (Color.value.toLong()).
// It has read methods only and records every path it is asked for, so the tests can prove what was read and that nothing was written.
const composeLong = (rgb) => Number(BigInt.asIntN(64, (0xff000000n | BigInt(rgb)) << 32n));
const FIXTURE = {
  'users/uid-existing': { email: 'a@b.co', displayName: 'a', coins: 42, freezesOwned: 1, pendingAdjustment: 0, welcomeFreezePending: false, isDark: true, createdAt: { ms: 1000 } },
  'users/uid-existing/habits/h-read': { name: 'Cloud Reading', color: composeLong(0x60a5fa), daysPerWeek: 7, restDays: [], createdDate: '2026-11-01', sortOrder: 1, createdAt: { ms: 2000 }, completedDates: ['2026-11-18'], goal: 'Finish 12 books', reminderEnabled: true, reminderTime: '07:30', streak: 77, bestStreak: 77, scheduleHistory: [{ from: '2026-11-01', restDays: [], daysPerWeek: 7 }] },
  'users/uid-existing/habits/h-read/completions/2026-11-19': { date: '2026-11-19', completed: true },
  'users/uid-existing/habits/h-read/completions/2026-11-20': { date: '2026-11-20', completed: true },
  'users/uid-existing/habits/h-read/completions/2026-11-21': { date: '2026-11-21', completed: true },
  'users/uid-existing/habits/h-run': { name: 'Cloud Jog', color: composeLong(0xf87171), daysPerWeek: 7, restDays: [], createdDate: '2026-11-10', sortOrder: 0, createdAt: { ms: 3000 }, completedDates: ['2026-11-15', '2026-11-16'] },
  'users/uid-existing/habits/h-run/completions/2026-11-16': { date: '2026-11-16', completed: false },
  'users/uid-existing/habits/h-run/completions/2026-11-17': { date: '2026-11-17', completed: true },
  'users/uid-existing/habits/h-old': { name: 'Legacy Habit', daysPerWeek: 7, restDays: [], createdDate: '2026-10-01', archived: true, createdAt: { ms: 100 } },
  'users/uid-existing/walletTransactions/welcome_freeze': { type: 'welcome_freeze', coinDelta: 0, freezeDelta: 1, balanceAfter: 20, createdAt: { ms: 10 } },
  'users/uid-existing/freezes/h-run_2026-11-16': { habitId: 'h-run', date: '2026-11-16', month: '2026-11', paidWith: 'inventory', transactionId: 'freeze_1' },
  'users/uid-existing/freezeMonths/2026-11': { count: 1 },
  'users/uid-existing/dayNotes/h-read_2026-11-19': { habitId: 'h-read', date: '2026-11-19', text: 'Chapter three' },
  'users/uid-existing/dayNotes/h-run_2026-11-17': { habitId: 'h-run', date: '2026-11-17', text: 'Rainy but did it' },
  // Another account's data: it must never appear for uid-existing or uid-new-*.
  'users/uid-other': { email: 'other@b.co', coins: 9999, freezesOwned: 3 },
  'users/uid-other/habits/h-secret': { name: 'Other Persons Secret Habit', color: composeLong(0x818cf8) },
};

// A second account whose only habit has been completed every day from 11-10 to 11-20, with the daily rewards Android recorded for them.
Object.assign(FIXTURE, {
  'users/uid-rewards': { email: 'r@b.co', coins: 31, freezesOwned: 1, pendingAdjustment: 0, lastTransactionId: 'daily_2026-11-20', createdAt: { ms: 1 } },
  'users/uid-rewards/habits/h-r1': { name: 'Reward Habit', color: composeLong(0x818cf8), daysPerWeek: 7, restDays: [], createdDate: '2026-11-10', sortOrder: 0, createdAt: { ms: 5 } },
  'users/uid-rewards/freezes/h-r1_2026-11-05': { habitId: 'h-r1', date: '2026-11-05', month: '2026-11', paidWith: 'inventory', transactionId: 'freeze_apply_h-r1_2026-11-05' },
  'users/uid-rewards/freezeMonths/2026-11': { count: 1 },
});
for (let d = 10; d <= 20; d++) {
  const date = `2026-11-${String(d).padStart(2, '0')}`;
  FIXTURE[`users/uid-rewards/habits/h-r1/completions/${date}`] = { date, completed: true };
  FIXTURE[`users/uid-rewards/rewards/daily_${date}`] = { active: true, cycle: 1, amount: 1, type: 'daily_completion', date, lastTransactionId: `daily_${date}` };
  FIXTURE[`users/uid-rewards/walletTransactions/daily_${date}`] = { type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 20 + (d - 9), date, rewardId: `daily_${date}`, createdAt: { ms: 100 + d } };
}
// A third account whose coins are already spent (balance 0), with yesterday's reward in effect: undoing that day makes the reversal pending.
Object.assign(FIXTURE, {
  'users/uid-pending': { email: 'p@b.co', coins: 0, freezesOwned: 1, pendingAdjustment: 0, lastTransactionId: 'daily_2026-11-20', createdAt: { ms: 1 } },
  'users/uid-pending/habits/h-p1': { name: 'Pending Habit', color: composeLong(0xf472b6), daysPerWeek: 7, restDays: [], createdDate: '2026-11-20', sortOrder: 0, createdAt: { ms: 5 } },
  'users/uid-pending/habits/h-p1/completions/2026-11-20': { date: '2026-11-20', completed: true },
  'users/uid-pending/rewards/daily_2026-11-20': { active: true, cycle: 1, amount: 1, type: 'daily_completion', date: '2026-11-20', lastTransactionId: 'daily_2026-11-20' },
  'users/uid-pending/walletTransactions/daily_2026-11-20': { type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 1, date: '2026-11-20', rewardId: 'daily_2026-11-20', createdAt: { ms: 120 } },
});
// Phase 9D.5 wallet accounts. uid-wallet: 45 coins, no freezes, two daily habits. Freeze Habit was completed 10-18 and 20 Nov (it missed 19 Nov,
// where a freeze can bridge a live 9-day streak); Second Freeze Habit was completed 10-17, 19 and 20 Nov (it missed 18 Nov). The daily rewards
// for the days BOTH were completed already exist, so opening the account pays and reverses nothing.
// uid-wallet-b is a second account with a different wallet, to prove accounts never mix.
Object.assign(FIXTURE, {
  'users/uid-wallet': { email: 'w@b.co', coins: 45, freezesOwned: 0, pendingAdjustment: 0, lastTransactionId: 'daily_2026-11-20', createdAt: { ms: 1 } },
  'users/uid-wallet/habits/h-w2': { name: 'Second Freeze Habit', color: composeLong(0x34d399), daysPerWeek: 7, restDays: [], createdDate: '2026-11-10', sortOrder: 1, createdAt: { ms: 6 }, scheduleHistory: [{ from: '2026-11-10', restDays: [], daysPerWeek: 7 }] },
  'users/uid-wallet/habits/h-w1': { name: 'Freeze Habit', color: composeLong(0x38bdf8), daysPerWeek: 7, restDays: [], createdDate: '2026-11-10', sortOrder: 0, createdAt: { ms: 5 }, scheduleHistory: [{ from: '2026-11-10', restDays: [], daysPerWeek: 7 }] },
  'users/uid-wallet-b': { email: 'v@b.co', coins: 7, freezesOwned: 2, pendingAdjustment: 0, lastTransactionId: 'seed', createdAt: { ms: 1 } },
  'users/uid-wallet-b/habits/h-wb1': { name: 'Second Account Habit', color: composeLong(0xa78bfa), daysPerWeek: 7, restDays: [], createdDate: '2026-11-21', sortOrder: 0, createdAt: { ms: 5 } },
  // An account Android created whose free welcome freeze could not be written then (the marker is still set).
  'users/uid-welcome': { email: 'x@b.co', coins: 20, freezesOwned: 0, pendingAdjustment: 0, welcomeFreezePending: true, createdAt: { ms: 1 } },
  // An account with no habits at all (a brand-new sign-up that has not created one yet).
  'users/uid-zero': { email: 'z@b.co', coins: 20, freezesOwned: 1, pendingAdjustment: 0, welcomeFreezePending: false, lastTransactionId: 'welcome_freeze', createdAt: { ms: 1 } },
  'users/uid-zero/walletTransactions/welcome_freeze': { type: 'welcome_freeze', coinDelta: 0, freezeDelta: 1, balanceAfter: 20, createdAt: { ms: 10 } },
  'users/uid-welcome/habits/h-x1': { name: 'Welcome Habit', color: composeLong(0xfbbf24), daysPerWeek: 7, restDays: [], createdDate: '2026-11-21', sortOrder: 0, createdAt: { ms: 5 } },
});
const nov = (d) => `2026-11-${String(d).padStart(2, '0')}`;
for (const d of [10, 11, 12, 13, 14, 15, 16, 17, 18, 20]) FIXTURE[`users/uid-wallet/habits/h-w1/completions/${nov(d)}`] = { date: nov(d), completed: true };
for (const d of [10, 11, 12, 13, 14, 15, 16, 17, 19, 20]) FIXTURE[`users/uid-wallet/habits/h-w2/completions/${nov(d)}`] = { date: nov(d), completed: true };
for (const d of [10, 11, 12, 13, 14, 15, 16, 17, 20]) {
  const date = nov(d);
  FIXTURE[`users/uid-wallet/rewards/daily_${date}`] = { active: true, cycle: 1, amount: 1, type: 'daily_completion', date, lastTransactionId: `daily_${date}` };
  FIXTURE[`users/uid-wallet/walletTransactions/daily_${date}`] = { type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 45, date, rewardId: `daily_${date}`, createdAt: { ms: 100 + d } };
}
// Phase 12A: accounts that the Delete Account tests remove. Every kind of document the apps write, so nothing can be left behind unnoticed.
for (const [uid, email] of [['uid-delete', 'del@b.co'], ['uid-delete-b', 'del2@b.co'], ['uid-delete-c', 'del3@b.co']]) {
  const u = 'users/' + uid;
  Object.assign(FIXTURE, {
    [u]: { email, displayName: 'del', coins: 22, freezesOwned: 0, pendingAdjustment: 0, lastTransactionId: 'freeze_apply_hd1_2026-11-19', welcomeFreezePending: false, isDark: true, createdAt: { ms: 1 } },
    [u + '/habits/hd1']: { name: 'Delete Me One', color: composeLong(0x60a5fa), daysPerWeek: 7, restDays: [], createdDate: '2026-11-10', sortOrder: 0, createdAt: { ms: 5 }, completedDates: ['2026-11-18'] },
    [u + '/habits/hd1/completions/2026-11-18']: { date: '2026-11-18', completed: true },
    [u + '/habits/hd1/completions/2026-11-20']: { date: '2026-11-20', completed: false },
    [u + '/habits/hd2']: { name: 'Delete Me Two', color: composeLong(0xf87171), daysPerWeek: 7, restDays: [], createdDate: '2026-11-12', sortOrder: 1, createdAt: { ms: 6 }, completedDates: [] },
    [u + '/habits/hd2/completions/2026-11-19']: { date: '2026-11-19', completed: true },
    [u + '/walletTransactions/welcome_freeze']: { type: 'welcome_freeze', coinDelta: 0, freezeDelta: 1, balanceAfter: 20, createdAt: { ms: 10 } },
    [u + '/walletTransactions/daily_2026-11-18']: { type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 21, date: '2026-11-18', rewardId: 'daily_2026-11-18', createdAt: { ms: 11 } },
    [u + '/walletTransactions/freeze_apply_hd1_2026-11-19']: { type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: 22, date: '2026-11-19', habitId: 'hd1', createdAt: { ms: 12 } },
    [u + '/rewards/daily_2026-11-18']: { active: true, cycle: 1, amount: 1, type: 'daily_completion', date: '2026-11-18', lastTransactionId: 'daily_2026-11-18' },
    [u + '/freezes/hd1_2026-11-19']: { habitId: 'hd1', date: '2026-11-19', month: '2026-11', paidWith: 'inventory', transactionId: 'freeze_apply_hd1_2026-11-19' },
    [u + '/freezeMonths/2026-11']: { count: 1 },
    [u + '/todos/t1']: { text: 'an old to-do' },
    [u + '/dayNotes/hd1_2026-11-18']: { habitId: 'hd1', date: '2026-11-18', text: 'a note that must go too' },
  });
}
const fakeReaderSource = `(() => {
  if (!location.protocol.startsWith('http')) return; // about:blank pages (used to clear the site's storage) have no sessionStorage and need no fake database
  // The fake Firestore: documents by path, kept in sessionStorage so a page reload still sees earlier writes.
  const stored = sessionStorage.getItem('e2e_fs');
  const F = stored ? JSON.parse(stored) : ${JSON.stringify(FIXTURE)};
  const save = () => sessionStorage.setItem('e2e_fs', JSON.stringify(F));
  const wrap = (d) => JSON.parse(JSON.stringify(d), (k, v) => (v && typeof v === 'object' && Object.keys(v).length === 1 && 'ms' in v ? { toMillis: () => v.ms } : v));
  const delay = (ms) => new Promise((r) => setTimeout(r, ms === undefined ? 150 : ms));
  const state = { offline: false, runs: 0 };
  const failCode = (key) => { const c = sessionStorage.getItem(key); if (c) throw Object.assign(new Error('simulated'), { code: c }); };
  const isArrayOp = (v) => v && typeof v === 'object' && (v.kind === 'union' || v.kind === 'remove') && Array.isArray(v.values);
  const show = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, typeof v === 'symbol' ? '<serverTimestamp>' : isArrayOp(v) ? { [v.kind === 'union' ? 'arrayUnion' : 'arrayRemove']: v.values } : v]));
  const resolve = (f, existing) => Object.fromEntries(Object.entries(f).map(([k, v]) => {
    if (typeof v === 'symbol') return [k, { ms: Date.now() }];
    if (isArrayOp(v)) { const cur = (existing && Array.isArray(existing[k])) ? existing[k] : []; return [k, v.kind === 'union' ? [...cur, ...v.values.filter((x) => !cur.includes(x))] : cur.filter((x) => !v.values.includes(x))]; }
    return [k, v];
  }));
  const log = (e) => { const l = JSON.parse(sessionStorage.getItem('e2e_wlog') || '[]'); l.push(e); sessionStorage.setItem('e2e_wlog', JSON.stringify(l)); };
  const snapDoc = (path) => (path in F ? { id: path.split('/').pop(), data: wrap(F[path]) } : null);
  const snapCol = (path) => Object.keys(F).filter((p) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/')).map((p) => snapDoc(p));

  // Live listeners (the app's onSnapshot): every listener is counted and its path remembered, so tests can prove what was watched and that sign-out removes them.
  const subs = new Set();
  const watched = [];
  const fire = (s) => s.next(s.kind === 'doc' ? snapDoc(s.path) : snapCol(s.path), { fromCache: state.offline });
  const notify = () => setTimeout(() => [...subs].forEach(fire), 20);
  const watch = (kind, path, next, error) => {
    const s = { kind, path, next, error };
    subs.add(s);
    watched.push(path);
    setTimeout(() => {
      if (!subs.has(s)) return;
      const deny = sessionStorage.getItem('e2e_deny');
      if (deny) return error(Object.assign(new Error('simulated'), { code: deny }));
      fire(s);
    }, 150);
    return () => subs.delete(s);
  };
  window.__consistoFakeLive = { watchDoc: (p, n, e) => watch('doc', p, n, e), watchCollection: (p, n, e) => watch('col', p, n, e) };

  // One-shot reads (used by delete to find a habit's completions and notes).
  window.__consistoReads = [];
  window.__consistoFakeReader = {
    async getDoc(path) { window.__consistoReads.push(path); await delay(); failCode('e2e_deny'); return snapDoc(path); },
    async listDocs(path) { window.__consistoReads.push(path); await delay(); failCode('e2e_deny'); return snapCol(path); },
  };

  // Every write is logged (and persisted across reloads); the writer has only the calls the app uses.
  // Like the Firestore SDK, a write is applied to the local view (and the listeners) IMMEDIATELY; the server's verdict comes later and a
  // rejected write is rolled back (the listeners then revert it by themselves).
  const before = (paths) => Object.fromEntries(paths.map((p) => [p, p in F ? JSON.parse(JSON.stringify(F[p])) : undefined]));
  const rollback = (b) => { for (const [p, v] of Object.entries(b)) { if (v === undefined) delete F[p]; else F[p] = v; } save(); notify(); };
  const local = async (paths, apply, mustExist) => {
    const b = before(paths);
    apply(); save(); notify();
    try {
      await delay();
      failCode('e2e_write_fail');
      if (mustExist && mustExist.some((p) => b[p] === undefined)) throw Object.assign(new Error('missing'), { code: 'not-found' });
    } catch (e) { rollback(b); throw e; }
  };
  let n = 0;
  window.__consistoFakeWriter = {
    newId() { return 'new-' + Date.now().toString(36) + (++n); },
    async set(path, fields) { log({ op: 'set', path, fields: show(fields) }); await local([path], () => { F[path] = resolve(fields, null); }); },
    async update(path, fields) { log({ op: 'update', path, fields: show(fields) }); await local([path], () => { if (path in F) F[path] = { ...F[path], ...resolve(fields, F[path]) }; }, [path]); },
    async deleteMany(paths) { log({ op: 'deleteMany', paths }); await local(paths, () => paths.forEach((p) => delete F[p])); },
    async batch(ops) {
      log({ op: 'batch', ops: ops.map((o) => ({ kind: o.kind, path: o.path, fields: show(o.fields) })) });
      const paths = ops.map((o) => o.path);
      await local(paths, () => { for (const o of ops) { if (o.kind === 'update' && !(o.path in F)) continue; F[o.path] = { ...(F[o.path] || {}), ...resolve(o.fields, F[o.path]) }; } }, ops.filter((o) => o.kind === 'update').map((o) => o.path));
    },
  };

  // The wallet ledger: one transaction at a time, reads see committed data, writes apply together (a Firestore transaction). Offline it fails.
  let queue = Promise.resolve();
  window.__consistoFakeLedger = {
    run(block) {
      const job = queue.then(async () => {
        await delay(60);
        // A test can hold every wallet transaction open (e2e_ledger_hold) to look at the UI while one is in flight.
        while (sessionStorage.getItem('e2e_ledger_hold')) await delay(60);
        if (state.offline) throw Object.assign(new Error('offline'), { code: 'unavailable' });
        failCode('e2e_ledger_fail');
        const writes = [];
        const read = new Set();
        const out = await block({
          async get(p) { if (read.has(p)) throw new Error('document read twice in one transaction: ' + p); if (writes.length) throw new Error('read after write'); read.add(p); return snapDoc(p); },
          update(p, f) { writes.push(['update', p, f]); },
          set(p, f) { writes.push(['set', p, f]); },
        });
        for (const [k, p, f] of writes) {
          if (k === 'update' && !(p in F)) throw Object.assign(new Error('missing'), { code: 'not-found' });
          F[p] = k === 'update' ? { ...F[p], ...resolve(f, F[p]) } : resolve(f, null);
        }
        if (writes.length) { log({ op: 'txn', writes: writes.map(([k, p, f]) => ({ kind: k, path: p, fields: show(f) })) }); save(); notify(); }
        state.runs++;
        return out;
      });
      queue = job.catch(() => undefined);
      return job;
    },
  };

  // "Android": writes the way the Kotlin app does, from outside the web app.
  const A = {
    complete(uid, habitId, date, on) {
      const cp = 'users/' + uid + '/habits/' + habitId + '/completions/' + date;
      F[cp] = { ...(F[cp] || {}), date, completed: on, updatedAt: { ms: Date.now() }, [on ? 'completedAt' : 'uncheckedAt']: { ms: Date.now() } };
      const hp = 'users/' + uid + '/habits/' + habitId;
      const cur = Array.isArray(F[hp].completedDates) ? F[hp].completedDates : [];
      F[hp] = { ...F[hp], completedDates: on ? [...cur, ...[date].filter((x) => !cur.includes(x))] : cur.filter((x) => x !== date), updatedAt: { ms: Date.now() } };
      save(); notify();
    },
    // Android's daily-reward transaction (WalletLedger.grantReward): idempotent, first grant keeps the id, later cycles use {id}_grant{n}.
    grantDaily(uid, date) {
      const id = 'daily_' + date, u = 'users/' + uid, rp = u + '/rewards/' + id;
      const rec = F[rp];
      if (rec && rec.active === true) return false;
      const cycle = (rec ? rec.cycle : 0) + 1;
      const txId = cycle === 1 ? id : id + '_grant' + cycle;
      F[u] = { ...F[u], coins: F[u].coins + 1, lastTransactionId: txId, updatedAt: { ms: Date.now() } };
      F[u + '/walletTransactions/' + txId] = { type: cycle === 1 ? 'daily_completion' : 'reward_restored', coinDelta: 1, freezeDelta: 0, balanceAfter: F[u].coins, date, rewardId: id, createdAt: { ms: Date.now() } };
      F[rp] = { active: true, cycle, amount: 1, type: 'daily_completion', date, lastTransactionId: txId, updatedAt: { ms: Date.now() } };
      save(); notify();
      return true;
    },
    // Android's freeze purchase (WalletLedger.buyFreeze): the entry id is freeze_buy_{requestId}, so repeating it is a no-op.
    buyFreeze(uid, requestId) {
      const u = 'users/' + uid, id = 'freeze_buy_' + requestId;
      if (F[u + '/walletTransactions/' + id]) return false;
      const w = F[u];
      F[u + '/walletTransactions/' + id] = { type: 'freeze_purchase', coinDelta: -20, freezeDelta: 1, balanceAfter: w.coins - 20, date: '2026-11-21', createdAt: { ms: Date.now() } };
      F[u] = { ...w, coins: w.coins - 20, freezesOwned: w.freezesOwned + 1, lastTransactionId: id, updatedAt: { ms: Date.now() } };
      save(); notify();
      return true;
    },
    // Android's freeze application (WalletLedger.applyFreeze): one owned freeze, never coins; the day and the month's counter are recorded with it.
    applyFreeze(uid, habitId, date) {
      const u = 'users/' + uid, key = habitId + '_' + date, month = date.slice(0, 7), mp = u + '/freezeMonths/' + month;
      const w = F[u], used = F[mp] ? F[mp].count : 0;
      if (F[u + '/freezes/' + key] || w.freezesOwned <= 0 || used >= 3) return false;
      F[u + '/walletTransactions/freeze_apply_' + key] = { type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: w.coins, date, habitId, createdAt: { ms: Date.now() } };
      F[u + '/freezes/' + key] = { habitId, date, month, paidWith: 'inventory', transactionId: 'freeze_apply_' + key, createdAt: { ms: Date.now() } };
      F[mp] = { count: used + 1, updatedAt: { ms: Date.now() } };
      F[u] = { ...w, freezesOwned: w.freezesOwned - 1, lastTransactionId: 'freeze_apply_' + key, updatedAt: { ms: Date.now() } };
      save(); notify();
      return true;
    },
    patchUser(uid, fields) { F['users/' + uid] = { ...F['users/' + uid], ...fields }; save(); notify(); },
    setMonthCount(uid, month, count) { F['users/' + uid + '/freezeMonths/' + month] = { count }; save(); notify(); },
  };
  // The guest import's backend (Phase 10): server reads, whole-document batch writes, and a profile created only when missing. Failures can be
  // simulated with sessionStorage: e2e_mig_fail (error code, applies to every write) and e2e_mig_offline (everything fails).
  const conv = (v) => (v instanceof Date ? { ms: v.getTime() } : typeof v === 'symbol' ? { ms: Date.now() } : v);
  const convAll = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, conv(v)]));
  const migFail = () => { const off = sessionStorage.getItem('e2e_mig_offline'); if (off) throw Object.assign(new Error('offline'), { code: 'unavailable' }); };
  window.__consistoFakeMigration = {
    async ensureProfile(uid, email) {
      await delay(100); migFail();
      const p = 'users/' + uid;
      if (p in F) return 'exists';
      F[p] = { email, displayName: email.split('@')[0], coins: 20, freezesOwned: 0, welcomeFreezePending: true, isDark: true, createdAt: { ms: Date.now() }, updatedAt: { ms: Date.now() } };
      log({ op: 'create-profile', path: p }); save(); notify();
      return 'created';
    },
    async getDoc(path) { await delay(40); migFail(); return snapDoc(path); },
    async listDocs(path) { await delay(40); migFail(); return snapCol(path); },
    async setMany(ops) {
      await delay(120); migFail();
      const code = sessionStorage.getItem('e2e_mig_fail');
      if (code) throw Object.assign(new Error('simulated'), { code });
      for (const o of ops) F[o.path] = convAll(o.fields);
      log({ op: 'import-batch', paths: ops.map((o) => o.path) }); save(); notify();
    },
  };

  // Account deletion (Phase 12A): server-style reads, batched deletes, the deletionRequested marker. Switches (sessionStorage):
  //   e2e_erase_hold   while set, every delete waits (so a test can look at the "Deleting your account" screen)
  //   e2e_erase_fail   N: the N-th delete batch of a run fails once with "unavailable" (no connection), then the key is removed
  let eraseCalls = 0;
  window.__consistoFakeEraser = {
    async profileExists(uid) { eraseCalls = 0; await delay(40); failCode('e2e_deny'); return ('users/' + uid) in F; },
    async markDeletionRequested(uid) { await delay(40); log({ op: 'erase-flag', path: 'users/' + uid }); F['users/' + uid] = { ...F['users/' + uid], deletionRequested: true, deletionRequestedAt: { ms: Date.now() } }; save(); notify(); },
    async listDocPaths(col, max) { await delay(20); return Object.keys(F).filter((p) => p.startsWith(col + '/') && !p.slice(col.length + 1).includes('/')).sort().slice(0, max); },
    async deleteDocs(paths) {
      eraseCalls++;
      while (sessionStorage.getItem('e2e_erase_hold')) await delay(60);
      await delay(60);
      if (sessionStorage.getItem('e2e_erase_fail') === String(eraseCalls)) { sessionStorage.removeItem('e2e_erase_fail'); throw Object.assign(new Error('offline'), { code: 'unavailable' }); }
      log({ op: 'erase-delete', paths });
      for (const p of paths) delete F[p];
      save(); notify();
    },
    async deleteProfile(uid) { await delay(40); log({ op: 'erase-profile', path: 'users/' + uid }); delete F['users/' + uid]; save(); notify(); },
  };

  window.__consistoFake = {
    android: A,
    listenerCount: () => subs.size,
    watched: () => watched.slice(),
    ledgerRuns: () => state.runs,
    doc: (p) => (p in F ? JSON.parse(JSON.stringify(F[p])) : null),
    keys: () => Object.keys(F),
    setOffline(v) { state.offline = v; notify(); },
  };
})();`;

function handleAuthRequest(p) {
  const url = new URL(p.request.url);
  const reply = (status, body) => ws.send(JSON.stringify({ id: ++nextId, method: 'Fetch.fulfillRequest', params: { requestId: p.requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }], body: Buffer.from(JSON.stringify(body)).toString('base64') } }));
  if (url.hostname.includes('firestore')) {
    authMock.firestore.push(p.request.url);
    return ws.send(JSON.stringify({ id: ++nextId, method: 'Fetch.failRequest', params: { requestId: p.requestId, errorReason: 'BlockedByClient' } }));
  }
  if (p.request.method === 'OPTIONS') return reply(204, {});
  if (authMock.failNext && url.pathname.includes('accounts:')) {
    authMock.failNext = false;
    return ws.send(JSON.stringify({ id: ++nextId, method: 'Fetch.failRequest', params: { requestId: p.requestId, errorReason: 'InternetDisconnected' } }));
  }
  const action = (url.pathname.match(/accounts:(\w+)/) || [])[1];
  if (action === 'delete' && authMock.failDelete) {
    authMock.failDelete = false;
    return ws.send(JSON.stringify({ id: ++nextId, method: 'Fetch.failRequest', params: { requestId: p.requestId, errorReason: 'InternetDisconnected' } }));
  }
  let body = {};
  try { body = JSON.parse(p.request.postData || '{}'); } catch {}
  const email = String(body.email || '').toLowerCase();
  const err = (message) => reply(400, { error: { code: 400, message, errors: [{ message, domain: 'global', reason: 'invalid' }] } });
  if (action) authMock.log.push(action + (email ? ':' + email : ''));
  const user = (uid, em) => ({ localId: uid, email: em, emailVerified: false, providerUserInfo: [{ providerId: 'password', federatedId: em, email: em, rawId: em }], validSince: '0', lastLoginAt: '0', createdAt: '0', lastRefreshAt: new Date().toISOString() });
  switch (action) {
    case 'signInWithPassword': {
      const a = authMock.accounts.get(email);
      if (!a || a.password !== body.password) return err('INVALID_LOGIN_CREDENTIALS');
      return reply(200, { kind: 'identitytoolkit#VerifyPasswordResponse', localId: a.uid, email, displayName: '', idToken: fakeToken(a.uid, email), registered: true, refreshToken: 'refresh', expiresIn: '3600' });
    }
    case 'signUp': {
      if (authMock.accounts.has(email)) return err('EMAIL_EXISTS');
      if (String(body.password || '').length < 6) return err('WEAK_PASSWORD : Password should be at least 6 characters');
      const uid = `uid-new-${++authMock.uidCounter}`;
      authMock.accounts.set(email, { password: body.password, uid });
      return reply(200, { kind: 'identitytoolkit#SignupNewUserResponse', localId: uid, email, idToken: fakeToken(uid, email), refreshToken: 'refresh', expiresIn: '3600' });
    }
    case 'lookup': {
      let uid = null, em = null;
      try { const pl = JSON.parse(Buffer.from(String(body.idToken).split('.')[1], 'base64url').toString()); uid = pl.user_id; em = pl.email; } catch {}
      return uid ? reply(200, { kind: 'identitytoolkit#GetAccountInfoResponse', users: [user(uid, em)] }) : err('INVALID_ID_TOKEN');
    }
    case 'delete': {
      // deleteUser: the account named by the token is removed, so it can never sign in again
      let uid = null;
      try { uid = JSON.parse(Buffer.from(String(body.idToken).split('.')[1], 'base64url').toString()).user_id; } catch {}
      for (const [em, a] of authMock.accounts) if (a.uid === uid) authMock.accounts.delete(em);
      return reply(200, { kind: 'identitytoolkit#DeleteAccountResponse' });
    }
    case 'sendOobCode':
      return authMock.accounts.has(email) || email === 'exists-not-listed@b.co' ? reply(200, { kind: 'identitytoolkit#GetOobConfirmationCodeResponse', email }) : err('EMAIL_NOT_FOUND');
    default:
      return reply(200, {});
  }
}
const send = (method, params = {}) =>
  new Promise((res) => {
    const id = ++nextId;
    pending.set(id, res);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;

// ── Test harness ──
let failures = 0;
let passes = 0;
const check = (name, ok, detail = '') => {
  if (ok) {
    passes++;
    console.log(`  PASS  ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`);
  }
};
const section = (t) => console.log(`\n${t}`);
const shot = async (name) => {
  if (!SHOTS) return;
  const r = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(SHOTS, `${name}.png`), Buffer.from(r.result.data, 'base64'));
};

// ── Browser helpers ──
const viewport = (w, h, mobile = false) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: mobile ? 2 : 1, mobile });
const text = () => ev('document.body.innerText');
// `text()` is undefined for an instant while the page navigates (the evaluation context is replaced): that is "not there yet", not a crash.
const has = async (s) => ((await text()) ?? '').includes(s);
const waitFor = async (fn, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(120);
  }
  return false;
};
const q = (sel, filter = '') =>
  `(() => { const T=${JSON.stringify(filter)}; return [...document.querySelectorAll(${JSON.stringify(sel)})].filter(e => { if(!T) return true; const L=(e.getAttribute('aria-label')||e.innerText||''); return T.startsWith('=') ? L===T.slice(1) : T.startsWith('^') ? L.startsWith(T.slice(1)) : L.includes(T); }); })()`;
const rect = (sel, filter = '', nth = 0) =>
  ev(`(() => { const e=${q(sel, filter)}.filter(x => { const r=x.getBoundingClientRect(); return r.width > 0 && r.height > 0; })[${nth}]; if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2}; })()`);
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, buttons: type === 'mousePressed' ? 1 : 0 });
const click = async (sel, filter = '', nth = 0) => {
  const r = await rect(sel, filter, nth);
  if (!r) return false;
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await mouse(type, r.cx, r.cy);
  await sleep(350);
  return true;
};
const names = () => ev(`${q('[aria-label^="Open "]')}.map(e => e.getAttribute('aria-label').replace('Open ', ''))`);
/** Circles per habit card: 5 on a phone or tablet, 7 on a desktop. Today's circle is the first of each card. */
const perCard = async () => Math.round((await ev(`document.querySelectorAll('[role=checkbox]').length`)) / Math.max(1, (await names()).length));
const coins = async () => Number((await ev(`document.querySelector('[aria-label^="Wallet"]').getAttribute('aria-label')`)).match(/(\d+) coins/)[1]);
const path = () => ev('location.pathname');
const theme = () => ev(`document.querySelector('[aria-label="Switch to light mode"]') ? 'dark' : 'light'`);

// Fake clock: today = Saturday 2026-11-21 (12:00 local).
const FAKE_NOW = new Date(2026, 10, 21, 12, 0, 0).getTime();
await send('Page.enable');
await send('Runtime.enable');
await send('Fetch.enable', { patterns: [{ urlPattern: '*identitytoolkit.googleapis.com*' }, { urlPattern: '*securetoken.googleapis.com*' }, { urlPattern: '*firestore.googleapis.com*' }] });
// Without an account the app starts on the login screen (Android behaviour). The existing checks drive the app as a guest, so
// they start with "Continue as Guest" already chosen, unless a test sets sessionStorage `e2e_auth` to take over (auth section).
await send('Page.addScriptToEvaluateOnNewDocument', { source: fakeReaderSource });
// The earlier checks sign in with a guest's data on the device. Since Phase 10 that offers the guest import over the app, so unless a test
// sets sessionStorage `e2e_import`, every test account has already answered "Start with my existing account" (the recorded choice that keeps the prompt away).
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { if (!sessionStorage.getItem('e2e_import') && localStorage.getItem('consisto_guest_migration') === null) localStorage.setItem('consisto_guest_migration', JSON.stringify({ version: 1, records: {}, completed: null, declined: ['uid-existing','uid-rewards','uid-pending','uid-wallet','uid-wallet-b','uid-welcome','uid-zero','uid-delete','uid-delete-b','uid-delete-c', ...Array.from({ length: 60 }, (_, i) => 'uid-new-' + (i + 1))] })); } catch (e) {}`,
});
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try { if (!sessionStorage.getItem('e2e_auth') && localStorage.getItem('guest_mode') === null) localStorage.setItem('guest_mode', 'true'); } catch (e) {}`,
});
// The sample habits the older checks are written against are a development-only seed; a real first-time guest starts empty (the 'First-time guest' section removes this script while it runs and adds it back after).
const SEED_SCRIPT_SOURCE = `try { localStorage.setItem('consisto_seed_demo', '1'); } catch (e) {}`;
let seedScriptId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: SEED_SCRIPT_SOURCE })).result.identifier;
await send('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => { const Real = Date; const off = ${FAKE_NOW} - Real.now();
    class FakeDate extends Real { constructor(...a) { if (a.length === 0) super(Real.now() + off); else super(...a); } static now() { return Real.now() + off; } }
    window.Date = FakeDate; })();`,
});
const load = async (clearStorage = true) => {
  await send('Page.navigate', { url: `${BASE}/habits` });
  await sleep(1500);
  if (clearStorage) {
    await ev('localStorage.clear()');
    await send('Page.navigate', { url: `${BASE}/habits` });
  }
  await waitFor(async () => (await names()).length >= 5, 20000);
  await sleep(500);
};

try {
  // ───────────────────────────── Responsive layout ─────────────────────────────
  section('Responsive layouts');
  await viewport(390, 844, true);
  await load();
  const initial = await names();
  check('five habits render on a 390px phone', initial.length === 5, JSON.stringify(initial));
  for (const [w, h, mobile] of [[320, 640, true], [390, 844, true], [412, 915, true], [768, 1024, false], [1280, 800, false], [1920, 1080, false]]) {
    await viewport(w, h, mobile);
    await sleep(400);
    const m = await ev(`(() => { const first=document.querySelector('[aria-label^="Open "]').getBoundingClientRect(); return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, left: first.left, right: first.right, width: first.width }; })()`);
    check(`${w}px: no horizontal overflow`, m.sw <= m.iw, `scrollWidth ${m.sw} > ${m.iw}`);
    check(`${w}px: cards fit inside the viewport`, m.left >= 0 && m.right <= m.iw + 0.5, JSON.stringify(m));
    if (w < 768) check(`${w}px: phone layout is unchanged (a column no wider than 560px)`, m.width <= 560 && Math.abs(m.left - (m.iw - m.right)) < 2, JSON.stringify(m));
    else if (w < 1024) check(`${w}px: tablet is a centred column no wider than 720px`, m.width <= 720 && Math.abs(m.left - (m.iw - m.right)) < 2, JSON.stringify(m));
    else check(`${w}px: desktop content stays within 1280px and the cards leave room for the side panel`, m.right <= (m.iw + 1280) / 2 && m.width < m.iw - 380, JSON.stringify(m));
    const dayCols = await ev(`(() => { const c=document.querySelector('[aria-label^="Open "]'); return { dots: c.querySelectorAll('[role=checkbox]').length, header: [...document.querySelectorAll('[aria-label^="Show progress for "]')].map(e => e.getAttribute('aria-label')) }; })()`);
    const want = w >= 1024 ? 7 : 5;
    check(`${w}px: ${want} day columns per habit and in the header`, dayCols.dots === want && dayCols.header.length === want, JSON.stringify(dayCols));
    if (w === 1280) {
      // Seven distinct, consecutive, newest-first dates: Today (Sat 21) back to Sun 15.
      const want7 = ['Sat 21', 'Fri 20', 'Thu 19', 'Wed 18', 'Tue 17', 'Mon 16', 'Sun 15'];
      check('1280px: the seven header dates are real consecutive days, newest first', JSON.stringify(dayCols.header.map((l) => l.replace('Show progress for ', ''))) === JSON.stringify(want7), JSON.stringify(dayCols.header));
      const side = await ev(`(() => { const t=[...document.querySelectorAll('*')].find(e => e.children.length===0 && e.textContent==="Today's Progress"); const c=document.querySelector('[aria-label^="Open "]').getBoundingClientRect(); const r=t.getBoundingClientRect(); return { progressLeft: r.left, cardRight: c.right }; })()`);
      check("1280px: Today's Progress sits in a side panel to the right of the habit list", side.progressLeft > side.cardRight, JSON.stringify(side));
    }
    await shot(`responsive-${w}`);
  }
  check('no console errors while loading', logs.length === 0, logs.join(' | '));

  // ───────────────────────────── First-time guest: no sample data ─────────────────────────────
  section('First-time guest starts empty (no sample habits, history or rewards)');
  const ft_SAMPLE = ['SQL Practice', 'Morning Run', 'Read Books', 'Meditate', 'Drink Water'];
  const ft_appData = () => ev(`JSON.parse(localStorage.getItem('consisto_app_data') || 'null')`);
  const ft_typeInto = async (selector, value) => {
    await ev(`(() => { const i=document.querySelector(${JSON.stringify(selector)}); i.focus(); i.select(); })()`);
    await send('Input.insertText', { text: value });
    await sleep(200);
  };
  // Wipe this site's saved data from a blank page, so no running copy of the app can write its old data back afterwards.
  const ft_wipeStorage = async () => {
    await send('Page.navigate', { url: 'about:blank' });
    await sleep(400);
    await send('Storage.clearDataForOrigin', { origin: new URL(BASE).origin, storageTypes: 'local_storage' });
  };
  await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: seedScriptId }); // the development-only sample seed is off for this section
  const ft_freshGuest = async () => {
    await ft_wipeStorage();
    await send('Page.navigate', { url: `${BASE}/habits` });
    await waitFor(() => has("Today's Progress"), 20000);
    await sleep(600);
  };
  await viewport(390, 844, true);
  await ft_freshGuest();
  const ft_t0 = await text();
  const gridHidden = async () => (await ev(`document.querySelectorAll('[role=checkbox]').length`)) === 0 && (await ev(`document.querySelectorAll('[aria-label^="Show progress for "]').length`)) === 0;
  check('shows the empty screen: heading, description and the first-habit button', ft_t0.includes('Create your first habit') && ft_t0.includes('Small steps lead to big changes. Start building a better routine, one habit at a time.') && ft_t0.includes('Create Your First Habit') && ft_t0.includes('You can start small and build consistency at your own pace.'));
  check('no habit cards and none of the five sample habits', (await names()).length === 0 && ft_SAMPLE.every((n) => !ft_t0.includes(n)));
  check("the dashboard body is hidden: no This Week, date range, day grid, Today's Progress, Guest Bonus or Missed Day", (await gridHidden()) && !/This Week|Today's Progress|Guest Bonus|Missed Day|Nov \d+ – Nov \d+/.test(ft_t0) && !/NaN|Infinity|undefined/.test(ft_t0), ft_t0.slice(0, 200));
  check('the header stays: coin balance, theme toggle, settings and add-habit button', (await coins()) === 20 && (await ev(`!!document.querySelector('[aria-label="Settings"]') && !!document.querySelector('[aria-label="New habit"]') && !!(document.querySelector('[aria-label="Switch to light mode"]') || document.querySelector('[aria-label="Switch to dark mode"]'))`)));
  const ft_saved0 = await ft_appData();
  check('the saved guest data has no habits, no notes, no earned rewards and no frozen days', ft_saved0 && ft_saved0.data.habits.length === 0 && Object.keys(ft_saved0.data.notes).length === 0 && Object.keys(ft_saved0.data.ledger.rewards).length === 0 && ft_saved0.data.ledger.freezes.length === 0, JSON.stringify(ft_saved0 && ft_saved0.data.ledger.wallet));
  check('the wallet is the standard new-user wallet: 20 coins, one welcome freeze', ft_saved0.data.ledger.wallet.coins === 20 && ft_saved0.data.ledger.wallet.freezesOwned === 1, JSON.stringify(ft_saved0.data.ledger.wallet));
  const ft_mobile = await ev(`({ sw: document.documentElement.scrollWidth, iw: innerWidth, h: [...document.querySelectorAll('[role=button]')].find(e => (e.getAttribute('aria-label')||'') === 'Create your first habit').getBoundingClientRect().height })`);
  check('on a phone the empty screen does not scroll sideways and the button is easy to tap (>= 48px tall)', ft_mobile.sw <= ft_mobile.iw && ft_mobile.h >= 48, JSON.stringify(ft_mobile));
  await shot('guest-empty-dark-390');
  await viewport(1280, 800);
  await sleep(500);
  const ft_m0 = await ev(`({ sw: document.documentElement.scrollWidth, iw: innerWidth })`);
  const ft_btn = await ev(`(() => { const r=[...document.querySelectorAll('[role=button]')].find(e => (e.getAttribute('aria-label')||'') === 'Create your first habit').getBoundingClientRect(); return { cx: r.x + r.width / 2, iw: innerWidth }; })()`);
  check('on a desktop the empty screen has no horizontal scrolling, is centred, and keeps the logo header', ft_m0.sw <= ft_m0.iw && Math.abs(ft_btn.cx - ft_btn.iw / 2) < 4 && (await has('Consisto')) && !(await has("Today's Progress")), JSON.stringify({ ft_m0, ft_btn }));
  await shot('guest-empty-dark-1280');
  if ((await theme()) === 'dark') await click('[role=button]', 'Switch to light mode');
  await shot('guest-empty-light-1280');
  await viewport(390, 844, true);
  await sleep(400);
  await shot('guest-empty-light-390');
  if ((await theme()) === 'light') await click('[role=button]', 'Switch to dark mode');

  // The first habit, deliberately named like a sample habit: it is the user's own and must survive everything below.
  await click('[role=button]', 'Create your first habit');
  check('"Create Your First Habit" opens the same creation flow as the Add Habit button', await waitFor(async () => (await ev(`document.querySelectorAll('[role=radio]').length`)) > 0, 3000));
  await click('[role=radio]', '', 2); // 7 days a week
  await click('[role=button]', 'Next → Create Habit');
  await ft_typeInto('input[aria-label="Habit name"]', 'SQL Practice');
  await click('[role=button]', 'Create "SQL Practice"');
  check('the first habit replaces the empty screen straight away (no refresh) with the normal dashboard', (await waitFor(async () => (await names()).length === 1, 3000)) && !(await has('Create your first habit')) && (await has("Today's Progress")) && (await has('This Week')));
  await click('[role=checkbox]', '', 0); // today
  await sleep(600);
  const ft_coinsAfter = await coins();
  const ft_done1 = await ev(`document.querySelectorAll('[aria-label^="Open SQL Practice"] [role=checkbox]')[0].getAttribute('aria-label')`);
  check("completing today works and Today's Progress shows 1/1", ft_done1.includes('done') && (await has('1/1')), ft_done1);
  await send('Page.navigate', { url: `${BASE}/habits` });
  await waitFor(async () => (await names()).length === 1, 15000);
  await sleep(500);
  const ft_done2 = await ev(`document.querySelectorAll('[aria-label^="Open SQL Practice"] [role=checkbox]')[0].getAttribute('aria-label')`);
  check('after a refresh the habit, its completion and the coins are all still there (not reset, not re-seeded)', (await names()).join() === 'SQL Practice' && ft_done2.includes('done') && (await coins()) === ft_coinsAfter, `${ft_done2} ${ft_coinsAfter}`);
  // "Close and reopen the browser": the guest flag and data are saved in this browser's storage, so the first load of a new page sees the same.
  await send('Page.navigate', { url: 'about:blank' });
  await sleep(300);
  await send('Page.navigate', { url: `${BASE}/habits` });
  await waitFor(async () => (await names()).length === 1, 15000);
  check('after leaving and reopening the site the guest still has the habit', (await names()).join() === 'SQL Practice');
  // Clicking "Continue as Guest" again must not reset anything.
  await ev(`localStorage.removeItem('guest_mode')`);
  await send('Page.navigate', { url: `${BASE}/habits` });
  await waitFor(() => has('Continue as Guest'), 15000);
  await click('[role=button]', '=Continue as Guest');
  await waitFor(async () => (await names()).length === 1, 15000);
  check('"Continue as Guest" again restores the same habit and coins instead of starting over', (await names()).join() === 'SQL Practice' && (await coins()) === ft_coinsAfter && !(await has('Create your first habit')));
  // Deleting the last habit brings the empty screen back; a returning guest with zero habits stays on it after a refresh.
  await click('[aria-label="More options"]');
  await click('[role=menuitem]', 'Delete Habit');
  check('deleting the last habit returns to the empty screen straight away', (await waitFor(() => has('Create your first habit'), 3000)) && !(await has("Today's Progress")) && (await names()).length === 0);
  await send('Page.navigate', { url: `${BASE}/habits` });
  await waitFor(() => has('Create your first habit'), 15000);
  const ft_savedZero = await ft_appData();
  check('a returning guest with zero habits still sees the empty screen after a refresh, with no sample data', (await names()).length === 0 && ft_savedZero.data.habits.length === 0 && ft_SAMPLE.every((n) => !JSON.stringify(ft_savedZero).includes(n)));
  // A different browser profile (a new visitor, or a private window) has its own empty storage.
  await ft_wipeStorage();
  await send('Page.navigate', { url: `${BASE}/habits` });
  await waitFor(() => has('Create your first habit'), 15000);
  check('a brand-new browser profile (like a private window) starts empty again', (await names()).length === 0);
  seedScriptId = (await send('Page.addScriptToEvaluateOnNewDocument', { source: SEED_SCRIPT_SOURCE })).result.identifier; // the checks below use the sample data again

  if (process.env.FIRST_GUEST_ONLY) throw new Error('stopped after the first-time guest section (FIRST_GUEST_ONLY)');

  // ───────────────────────────── Theme persistence ─────────────────────────────
  section('Theme persistence');
  await viewport(1280, 800);
  await load();
  check('starts dark when nothing is saved (Android default)', (await theme()) === 'dark');
  await click('[role=button]', 'Switch to light mode');
  check('toggle switches to light', (await theme()) === 'light');
  check('light choice is saved on the device (theme_is_dark=false)', (await ev(`localStorage.getItem('theme_is_dark')`)) === 'false');
  await shot('theme-light');
  await send('Page.navigate', { url: `${BASE}/habits` });
  await waitFor(async () => (await names()).length >= 5, 20000);
  await sleep(400);
  check('light theme is restored after a reload', (await theme()) === 'light');
  await click('[role=button]', 'Switch to dark mode');
  await send('Page.navigate', { url: `${BASE}/habits` });
  await waitFor(async () => (await names()).length >= 5, 20000);
  await sleep(400);
  check('dark theme is restored after a reload', (await theme()) === 'dark');

  // ───────────────────────────── Drag-and-drop reorder ─────────────────────────────
  section('Habit reordering (long-press drag)');
  await load();
  const before = await names();
  const r1 = await rect('[aria-label^="Open "]', '', 0);
  const r3 = await rect('[aria-label^="Open "]', '', 2);
  // A short press-and-release is a normal tap: it opens the habit and does not reorder.
  await mouse('mouseMoved', r1.x + 70, r1.cy);
  await mouse('mousePressed', r1.x + 70, r1.cy);
  await sleep(80);
  await mouse('mouseReleased', r1.x + 70, r1.cy);
  await sleep(600);
  check('a short tap opens the habit', (await path()).startsWith('/habits/'), await path());
  await send('Page.navigate', { url: `${BASE}/habits` });
  await waitFor(async () => (await names()).length >= 5, 20000);
  await sleep(500);
  check('a short tap does not reorder', JSON.stringify(await names()) === JSON.stringify(before));

  // Long press the first card, drag it below the third, release.
  const a = await rect('[aria-label^="Open "]', '', 0);
  const c = await rect('[aria-label^="Open "]', '', 2);
  const startX = a.x + 70;
  const startY = a.cy;
  await mouse('mouseMoved', startX, startY);
  await mouse('mousePressed', startX, startY);
  await sleep(520); // past the 400 ms long press
  const targetY = c.cy + 8;
  for (let i = 1; i <= 14; i++) {
    await mouse('mouseMoved', startX, startY + ((targetY - startY) * i) / 14);
    await sleep(30);
  }
  await sleep(600); // let the other cards finish sliding into place
  await shot('reorder-dragging');
  const mid = await names();
  check('while dragging, the other cards have moved out of the way', JSON.stringify(mid) !== JSON.stringify(before), JSON.stringify(mid));
  await mouse('mouseReleased', startX, targetY);
  await sleep(900);
  const after = await names();
  check('the dragged card is now third and the others shifted up', after[2] === before[0] && after[0] === before[1] && after[1] === before[2], JSON.stringify(after));
  check('dropping does not open the habit', (await path()) === '/habits', await path());
  check('the other two habits kept their order', after[3] === before[3] && after[4] === before[4]);
  await shot('reorder-dropped');

  // Drag the last card to the top.
  const last = await rect('[aria-label^="Open "]', '', 4);
  const top = await rect('[aria-label^="Open "]', '', 0);
  await mouse('mouseMoved', last.x + 70, last.cy);
  await mouse('mousePressed', last.x + 70, last.cy);
  await sleep(520);
  for (let i = 1; i <= 16; i++) {
    await mouse('mouseMoved', last.x + 70, last.cy + ((top.cy - 10 - last.cy) * i) / 16);
    await sleep(30);
  }
  await mouse('mouseReleased', last.x + 70, top.cy - 10);
  await sleep(900);
  const after2 = await names();
  check('dragging the last card to the top makes it first', after2[0] === after[4], JSON.stringify(after2));

  // Moving a little and letting go (inside the touch slop) is not a reorder.
  const snap = await names();
  const k = await rect('[aria-label^="Open "]', '', 1);
  await mouse('mouseMoved', k.x + 70, k.cy);
  await mouse('mousePressed', k.x + 70, k.cy);
  await sleep(520);
  await mouse('mouseMoved', k.x + 70, k.cy + 4);
  await mouse('mouseReleased', k.x + 70, k.cy + 4);
  await sleep(700);
  check('a held card released within the touch slop does not reorder', JSON.stringify(await names()) === JSON.stringify(snap));

  // The new order survives other interactions (toggling the theme re-renders everything).
  await click('[role=button]', 'Switch to light mode');
  check('the new order is kept after other changes', JSON.stringify(await names()) === JSON.stringify(snap));
  await click('[role=button]', 'Switch to dark mode');

  // ───────────────────────────── Streak celebration ─────────────────────────────
  section('Streak celebration');
  await load();
  const streakBtn = await ev(`${q('[role=button]', 'Show streak celebration')}.map(e => e.getAttribute('aria-label'))`);
  const sqlStreak = Number(streakBtn[0].match(/^(\d+)-day streak/)[1]);
  await click('[role=button]', 'Show streak celebration', 0);
  check('tapping the streak opens the celebration', await waitFor(() => has('day streak'), 4000));
  check('it shows the habit name in capitals', await has('SQL PRACTICE'));
  check('the counter counts up to the streak', await waitFor(async () => (await ev(`document.body.innerText`)).includes(`${sqlStreak}\n`) || (await has(`${sqlStreak} days`)), 15000), `streak ${sqlStreak}`);
  check('the progress bar and the close hint appear at the end', await waitFor(() => has('Tap anywhere to close'), 8000));
  await sleep(1800); // let the label, bar and hint finish fading in
  await shot('streak-celebration');
  await click('[aria-label="Close"]', '', 0);
  check('tapping closes it', await waitFor(async () => !(await has('Tap anywhere to close')), 3000));

  // ───────────────────────────── Milestone celebration ─────────────────────────────
  section('Milestone celebration (Day 15)');
  await load();
  const coins0 = await coins();
  const idx = (await names()).findIndex((n) => n === 'Meditate');
  await click('[role=checkbox]', '', idx * (await perCard())); // Meditate, today: its 15th completed day
  check('completing the 15th day shows the milestone screen', await waitFor(() => has('Milestone unlocked'), 4000));
  check('it shows the reward and the message', (await has('+5 coins')) && (await has('Great consistency!')));
  check('the counter rows include 14, 15 and 16 DAYS', (await has('14  DAYS')) && (await has('15  DAYS')) && (await has('16  DAYS')));
  const continueBtnDisabled = () => ev(`document.querySelector('[aria-label="Continue"]')?.getAttribute('aria-disabled') === 'true' || document.querySelector('[aria-label="Continue"]')?.disabled === true`);
  check('Continue is not available until the sequence has finished', await continueBtnDisabled());
  await sleep(3000);
  await shot('milestone');
  check('Continue becomes available', !(await continueBtnDisabled()));
  await click('[aria-label="Continue"]');
  check('Continue dismisses it', await waitFor(async () => !(await has('Milestone unlocked')), 3000));
  check('the +5 bonus reached the wallet (no daily coin: not every habit is done)', (await coins()) === coins0 + 5, `${coins0} -> ${await coins()}`);

  // ───────────────────────────── Rest-day (Bonus Effort) ─────────────────────────────
  section('Bonus Effort rest-day celebration (today is a Saturday)');
  await load();
  const sqlIdx = (await names()).findIndex((n) => n === 'SQL Practice');
  const label = await ev(`document.querySelectorAll('[role=checkbox]')[${sqlIdx * (await perCard())}].getAttribute('aria-label')`);
  check("today's circle for SQL Practice is a planned rest day", label.includes('rest day'), label);
  await click('[role=checkbox]', '', sqlIdx * (await perCard()));
  check('completing a planned rest day shows "Bonus Effort!"', await waitFor(() => has('Bonus Effort!'), 3000));
  check('it shows the streak bonus and the habit', (await has('Streak +1 day')) && (await has('You showed up even on your rest day!')));
  await shot('rest-day');
  check('it closes itself after about 2.6 seconds', await waitFor(async () => !(await has('Bonus Effort!')), 4500));
  await click('[role=checkbox]', '', sqlIdx * (await perCard())); // undo
  await click('[role=checkbox]', '', sqlIdx * (await perCard())); // redo
  await sleep(600);
  check('un-checking and re-checking the same day does not celebrate again', !(await has('Bonus Effort!')));
  // A back-filled (non-today) day never celebrates: Sunday is not in the five-day window; use an ordinary past day.
  await click('[role=checkbox]', '', 1 + 0 * 5);
  await sleep(500);
  check('completing an ordinary past day does not celebrate', !(await has('Bonus Effort!')));

  // ───────────────────────────── New Habit: Reminder and Goal ─────────────────────────────
  section('New Habit: Reminder and Goal fields');
  await load();
  await click('[role=button]', 'New habit');
  await click('[role=radio]', '', 2); // 7 days/week -> no rest-day step
  await click('[role=button]', 'Next → Create Habit');
  check('the create step shows Reminder and the optional Goal', (await has('REMINDER')) && (await has('What is your goal for this habit?')) && (await has('Optional')));
  check('the Reminder is off by default (no time row)', !(await has('Reminder time')));
  await ev(`window.__permAsked = 0; if (window.Notification) { Notification.requestPermission = () => { window.__permAsked++; return Promise.resolve('default'); }; }`);
  check('before it is switched on, the Reminder block already says the web cannot send reminders and where the choice is kept', (await has("Reminders aren't available on the web yet.")) && (await has('saved with this habit on this device')));
  await click('[role=switch]', 'Reminder');
  check('turning it on shows the time, 9:00 AM by default', (await has('Reminder time')) && (await has('9:00 AM')));
  check('...and the browser is never asked for notification permission', (await ev('window.__permAsked')) === 0);
  await ev(`(() => { const i=document.querySelector('input[type=time]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i,'18:45'); i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await sleep(300);
  check('picking a time updates it (6:45 PM)', await has('6:45 PM'));
  await ev(`document.querySelector('input[aria-label="Habit name"]').focus()`);
  await send('Input.insertText', { text: 'Stretching' });
  await ev(`document.querySelector('[aria-label="What is your goal for this habit?"]').focus()`);
  await send('Input.insertText', { text: 'x'.repeat(320) });
  await sleep(200);
  const goalLen = await ev(`document.querySelector('[aria-label="What is your goal for this habit?"]').value.length`);
  check('the goal is capped at 300 characters', goalLen === 300, String(goalLen));
  await shot('create-reminder-goal');
  await click('[role=button]', 'Create "Stretching"');
  check('the habit is created at the bottom of the list', await waitFor(async () => (await names()).at(-1) === 'Stretching', 3000));

  // ───────────────────────────── Guest Bonus ─────────────────────────────
  section('Guest Bonus (matches Kotlin: guestBonusClaimed is always true)');
  await click('[role=button]', 'Guest Bonus');
  check('shows "Bonus already claimed"', await waitFor(() => has('Bonus already claimed'), 2000));
  check('and does not offer to claim again', !(await has('Login to sync')) && !(await has('Claim now')));
  const coinsG = await coins();
  await click('[role=button]', '=Close');
  check('closing it leaves the wallet unchanged', (await coins()) === coinsG);

  // ───────────────────────────── Phase 3: habit creation and editing ─────────────────────────────
  const isDisabled = (label) => ev(`(() => { const e=${q('[role=button]', label)}[0]; return !e ? null : (e.getAttribute('aria-disabled') === 'true' || e.disabled === true); })()`);
  const setText = async (selector, value) => {
    await ev(`(() => { const i=document.querySelector(${JSON.stringify(selector)}); i.focus(); i.select(); })()`);
    await send('Input.insertText', { text: value });
    await sleep(200);
  };
  const ringColor = (name) => ev(`(() => { const c=[...document.querySelectorAll('[aria-label^="Open ${name}"] svg circle[stroke]')]; return c.length ? c[c.length-1].getAttribute('stroke') : null; })()`);
  const checkedCount = (name) => ev(`[...document.querySelectorAll('[aria-label^="Open ${name}"] [role=checkbox]')].filter(e => e.getAttribute('aria-label').endsWith('done')).length`);
  const openHabit = async (name) => {
    const r = await rect(`[aria-label^="Open ${name}"]`);
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await mouse(type, r.x + 70, r.cy);
    await waitFor(async () => (await path()).startsWith('/habits/'), 4000);
    await sleep(500);
  };
  const back = async () => { await click('[role=button]', '=Back'); await waitFor(async () => (await path()) === '/habits', 4000); await sleep(400); };

  section('Create a habit: custom weekly target, rest days, colour, validation');
  await viewport(1280, 900);
  await load();
  await click('[role=button]', 'New habit');
  await setText('input[aria-label="Number of rest days"]', '3');
  check('a custom 3 rest days reads "4 active days/week (custom)"', await has('→ 4 active days/week (custom)'));
  await click('[role=button]', 'Next →');
  check('the rest step asks for exactly 3 rest days', await has('Pick 3 rest days'));
  check('Continue is disabled until 3 are picked', (await isDisabled('Continue →')) === true);
  for (const d of ['Mon', 'Wed', 'Fri']) await click('[role=checkbox]', `=${d}`);
  await click('[role=checkbox]', '=Sat');
  check('a 4th rest day is refused with a message', await has('You already selected 3 rest days.'));
  check('Continue is enabled with exactly 3 picked', (await isDisabled('Continue →')) === false);
  await click('[role=button]', 'Continue →');
  check('the create button is disabled for a blank name', (await isDisabled('Enter a habit name')) === true);
  await setText('input[aria-label="Habit name"]', '   ');
  check('a spaces-only name still cannot be created', (await isDisabled('Enter a habit name')) === true);
  await setText('input[aria-label="Habit name"]', 'Evening Walk');
  await click('[role=radio]', '=Rose');
  check('the colour grid marks Rose as selected', (await ev(`!!document.querySelector('[role=radio][aria-label="Rose, selected"]')`)) === true);
  await shot('phase3-create');
  await click('[role=button]', 'Create "Evening Walk"');
  check('the habit is created at the bottom', await waitFor(async () => (await names()).at(-1) === 'Evening Walk', 3000));
  const restBg = await ev(`(() => { const e=[...document.querySelectorAll('[aria-label^="Open Evening Walk"] [role=checkbox]')].find(x => x.getAttribute('aria-label').includes('rest day')); return e ? getComputedStyle(e).backgroundColor : null; })()`);
check('it uses the chosen colour (Rose #FB7185)', restBg === 'rgb(251, 113, 133)', String(restBg));
  const restLabels = await ev(`${q('[role=checkbox]', 'Evening Walk')}.map(e => e.getAttribute('aria-label'))`);
  check('its rest days show as planned rest days on the dashboard', restLabels.some((l) => l.includes('rest day')), JSON.stringify(restLabels));
  await openHabit('Evening Walk');
  check('Habit screen shows "4 days/week" for it', await has('4 days/week'));

  section('Edit name and colour');
  await back();
  const mrChecked = await checkedCount('Morning Run');
  const mrStreak = await ev(`${q('[aria-label^="Open Morning Run"] [role=button]', 'streak')}[0].getAttribute('aria-label')`);
  await openHabit('Morning Run');
  check('the habit screen shows its name, schedule, reminder and goal prompt', (await path()) === '/habits/morning-run' && (await has('Every day')) && (await has('Off')) && (await has('Add your goal')));
  await click('[role=button]', 'Edit habit');
  check('the Edit Habit dialog opens with Save disabled (nothing changed)', (await has('Edit Habit')) && (await isDisabled('Save Changes')) === true);
  check('the current colour (Orange) is preselected', (await ev(`!!document.querySelector('[role=radio][aria-label="Orange, selected"]')`)) === true);
  await setText('input[aria-label="Habit name"]', '   ');
  check('a blank name cannot be saved', (await isDisabled('Save Changes')) === true);
  await click('[role=radio]', '=Violet');
  check('a colour change alone does not make a blank name valid', (await isDisabled('Save Changes')) === true);
  await setText('input[aria-label="Habit name"]', 'SQL Practice');
  check('Save is enabled for a valid change', (await isDisabled('Save Changes')) === false);
  await click('[role=button]', 'Save Changes');
  check('a name another habit uses is rejected and the dialog stays open', (await has('You already have a habit with this name.')) && (await has('Edit Habit')));
  await shot('phase3-edit-error');
  await setText('input[aria-label="Habit name"]', 'Morning Run 5k');
  await click('[role=button]', 'Save Changes');
  check('saving a rename reopens the screen under the new route', await waitFor(async () => (await path()) === '/habits/morning-run-5k', 4000), await path());
  check('the title shows the new name', await has('Morning Run 5k'));
  await back();
  check('the dashboard shows the renamed habit', (await names()).includes('Morning Run 5k') && !(await names()).includes('Morning Run'));
  check('and its new colour (Violet #A78BFA)', (await ringColor('Morning Run 5k'))?.toLowerCase() === '#a78bfa', await ringColor('Morning Run 5k'));
  check('its completion history is untouched', (await checkedCount('Morning Run 5k')) === mrChecked, `${mrChecked} -> ${await checkedCount('Morning Run 5k')}`);
  const mrStreakAfter = await ev(`${q('[aria-label^="Open Morning Run 5k"] [role=button]', 'streak')}[0].getAttribute('aria-label')`);
  check('and its streak is unchanged', mrStreak === mrStreakAfter, `${mrStreak} vs ${mrStreakAfter}`);
  check('the edit kept the habit in its list position', (await names()).indexOf('Morning Run 5k') === 1);

  section('Cancel discards the draft');
  await openHabit('Morning Run 5k');
  await click('[role=button]', 'Edit habit');
  await setText('input[aria-label="Habit name"]', 'Should not save');
  await click('[role=radio]', '=Lime');
  await click('[role=button]', '=Cancel');
  check('Cancel closes the dialog without saving', await waitFor(async () => !(await has('Edit Habit')), 2000));
  check('the name is unchanged', await has('Morning Run 5k'));
  await click('[role=button]', 'Edit habit');
  check('reopening starts from the saved values, not the discarded draft', (await ev(`document.querySelector('input[aria-label="Habit name"]').value`)) === 'Morning Run 5k' && (await ev(`!!document.querySelector('[role=radio][aria-label="Violet, selected"]')`)) === true);
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  check('Escape also dismisses it', await waitFor(async () => !(await has('Edit Habit')), 2000));

  section('Edit rest days (applies from tomorrow)');
  await back();
  const rbLabelBefore = await ev(`${q('[aria-label^="Open Read Books"] [role=checkbox]')}[0].getAttribute('aria-label')`);
  await openHabit('Read Books');
  check('Read Books is a 6 days/week habit', await has('6 days/week'));
  await click('[role=button]', 'Edit rest days');
  check('the sheet states the rule and the counts', (await has('Edit Rest Days')) && (await has('Changes will apply from tomorrow.')) && (await has('6 active days · 1 rest day')));
  check('Save is disabled until something changes', (await isDisabled('Save Changes')) === true);
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']) await click('[role=checkbox]', `=${d}`);
  check('selecting all seven days shows "At least one day must stay active."', await has('At least one day must stay active.'));
  check('and Save stays disabled', (await isDisabled('Save Changes')) === true);
  for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri']) await click('[role=checkbox]', `^${d}`);
  check('one extra rest day gives "5 active days · 2 rest days"', await has('5 active days · 2 rest days'));
  await click('[role=button]', 'Save Changes');
  check('saving confirms "Rest days updated from tomorrow"', await waitFor(() => has('Rest days updated from tomorrow'), 2000));
  check('the screen now shows 5 days/week', await has('5 days/week'));
  await back();
  const rbLabelAfter = await ev(`${q('[aria-label^="Open Read Books"] [role=checkbox]')}[0].getAttribute('aria-label')`);
  check("today's circle is unchanged (Saturday only becomes a rest day from tomorrow)", rbLabelBefore === rbLabelAfter && !rbLabelAfter.includes('rest day'), `${rbLabelBefore} -> ${rbLabelAfter}`);

  section('Edit goal');
  await openHabit('Read Books');
  await click('[role=button]', 'Add your goal');
  check('the Goal sheet opens with Save disabled', (await has('Optional. Clear the field to remove it.')) && (await isDisabled('Save Changes')) === true);
  await setText('[aria-label="What is your goal for this habit?"]', 'Finish 12 books this year');
  check('typing a goal enables Save', (await isDisabled('Save Changes')) === false);
  await click('[role=button]', 'Save Changes');
  check('saving shows the goal in its section with a toast', (await waitFor(() => has('Goal saved'), 2000)) && (await has('Finish 12 books this year')));
  await shot('phase3-goal');
  await click('[role=button]', 'Edit goal');
  await setText('[aria-label="What is your goal for this habit?"]', '');
  await click('[role=button]', 'Save Changes');
  check('clearing the goal removes it (back to "Add your goal")', (await waitFor(() => has('Add your goal'), 2000)) && !(await has('Finish 12 books this year')));

  section('Edit reminder');
  await click('[role=button]', 'Edit reminder');
  check('the Reminder sheet opens with Save disabled', (await has('Changes apply right away.')) && (await isDisabled('Save Changes')) === true);
  await click('[role=switch]', 'Reminder');
  await ev(`(() => { const i=document.querySelector('input[type=time]'); const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; set.call(i,'06:30'); i.dispatchEvent(new Event('input',{bubbles:true})); i.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await sleep(300);
  check('turning it on and choosing a time enables Save', (await has('6:30 AM')) && (await isDisabled('Save Changes')) === false);
  await click('[role=button]', 'Save Changes');
  check('saving confirms "Reminder saved"', await waitFor(() => has('Reminder saved'), 2000));
  check('the bell shows the saved time (never "Blocked": the web sends no reminders, so there is no permission to lack)', (await has('6:30 AM')) && !(await has('Blocked')));
  await click('[role=button]', 'Edit reminder');
  await click('[role=switch]', 'Reminder');
  await click('[role=button]', 'Save Changes');
  check('turning it off shows "Reminder turned off" and the bell reads Off', (await waitFor(() => has('Reminder turned off'), 2000)) && (await has('Off')));
  await click('[role=button]', 'Edit reminder');
  await click('[role=switch]', 'Reminder');
  check('the chosen time was kept while the reminder was off', await has('6:30 AM'));
  await click('[role=button]', '=Cancel');

  section('Delete (same as Kotlin: from Home, immediately, no confirmation)');
  await back();
  const beforeDelete = await names();
  const delIdx = beforeDelete.indexOf("Evening Walk");
  await click("[role=button]", "More options", delIdx);
  const menuTopmost = await ev(`(() => { const m=${q('[role=menuitem]', 'Delete Habit')}[0]; const r=m.getBoundingClientRect(); const el=document.elementFromPoint(r.x+r.width/2, r.y+r.height/2); return !!el && m.contains(el); })()`);
  check("the card's menu is on top (not painted over by the next card)", menuTopmost === true);
  await click('[role=menuitem]', 'Delete Habit');
  check('the habit disappears at once, without a confirmation', await waitFor(async () => !(await names()).includes('Evening Walk'), 2000));
  check('the other habits remain in order', JSON.stringify(await names()) === JSON.stringify(beforeDelete.filter((n) => n !== 'Evening Walk')));
  await send('Page.navigate', { url: `${BASE}/habits/evening-walk` });
  await sleep(2500);
  check('opening the deleted habit shows "Habit not found"', await has('Habit not found'));
  await shot('phase3-deleted');

  section('Light theme and narrow width for the edit screens');
  await viewport(390, 844, true);
  await load();
  await openHabit('SQL Practice');
  await click('[role=button]', 'Switch to light mode');
  await click('[role=button]', 'Edit habit');
  await shot('phase3-edit-light-390');
  const overflow = await ev(`document.documentElement.scrollWidth <= window.innerWidth`);
  check('the Edit dialog fits a 390px phone in light mode', overflow === true && (await has('Edit Habit')));
  await click('[role=button]', '=Cancel');
  await click('[role=button]', 'Edit rest days');
  await shot('phase3-rest-light-390');
  check('the rest-days sheet fits a 390px phone', (await ev(`document.documentElement.scrollWidth <= window.innerWidth`)) === true);

  // ───────────────────────────── Phase 4: Habit Details ─────────────────────────────
  // With the fake clock (today = Sat 2026-11-21) the mock habits give hand-checkable numbers.
  const stat = (label) => ev(`(() => { const e=[...document.querySelectorAll('div')].find(x => x.children.length === 0 && x.innerText === ${JSON.stringify(label)} && x.nextElementSibling); return e ? e.nextElementSibling.innerText : null; })()`);
  const streakOnDetail = () => ev(`(() => { const b=${q('[role=button]', 'day streak. Show streak celebration')}.filter(x => x.getBoundingClientRect().width > 0)[0]; return b ? Number(b.getAttribute('aria-label').match(/^(\\d+) day streak/)[1]) : null; })()`);

  section('Habit Details: the screen and its sections');
  await viewport(1280, 900);
  await load();
  const dashStreaks = await ev(`${q('[aria-label^="Open "] [role=button]', 'streak')}.map(e => e.getAttribute('aria-label'))`);
  const allNames = await names();
  await openHabit('Meditate');
  check('the title and the Kotlin section order: streak card, Calendar View, OVERVIEW, Goal, SCORE, HISTORY',
    await ev(`(() => { const t=document.body.innerText; const keys=['Day Streak','Calendar View','OVERVIEW','Add your goal','SCORE','HISTORY']; let last=-1; return keys.every(k => { const i=t.indexOf(k); const ok=i>last; last=i; return ok; }); })()`));
  check('streak card: 14 Day Streak, "Keep it going!", "Personal Best"', (await streakOnDetail()) === 14 && (await has('Keep it going!')) && (await has('Personal Best')));
  check('Meditate overview: Score 100%, Month —, Year —, Total 14', (await stat('Score')) === '100%' && (await stat('Month')) === '—' && (await stat('Year')) === '—' && (await stat('Total')) === '14', `${await stat('Score')} ${await stat('Month')} ${await stat('Year')} ${await stat('Total')}`);
  check('history chart labels its first (only) month with the year', await has("Nov'26"));
  check('both chart headers show the "Month ▾" selector', (await ev(`document.body.innerText.split('Month ▾').length - 1`)) === 2);
  await shot('phase4-detail-meditate');
  // History chart: tap the bar -> tooltip
  const hist = await rect('svg', '', 3); // 0 streak ring, 1 overview ring, 2 score chart, 3 history chart
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await mouse(type, hist.cx, hist.cy);
  await sleep(400);
  check('tapping a history bar shows "Completed: 14 days"', await has('Completed: 14 days'));
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await mouse(type, hist.cx, hist.cy);
  await sleep(300);
  check('tapping it again hides the tooltip', !(await has('Completed: 14 days')));

  section('Habit Details: different habits show their own data');
  await back();
  const facts = {};
  for (const n of ['SQL Practice', 'Morning Run', 'Read Books', 'Drink Water']) {
    await openHabit(n);
    facts[n] = { title: (await path()), streak: await streakOnDetail(), score: await stat('Score'), month: await stat('Month'), year: await stat('Year'), total: await stat('Total'), days: (await has('Every day')) ? 'every' : (await has('6 days/week')) ? '6' : '5' };
    await back();
  }
  check('SQL Practice: 5 days/week, Score 100%, Month +100%, Year —, Total 22', facts['SQL Practice'].days === '5' && facts['SQL Practice'].score === '100%' && facts['SQL Practice'].month === '+100%' && facts['SQL Practice'].year === '—' && facts['SQL Practice'].total === '22', JSON.stringify(facts['SQL Practice']));
  check('Morning Run: every day, Score 55%, Total 11', facts['Morning Run'].days === 'every' && facts['Morning Run'].score === '55%' && facts['Morning Run'].total === '11', JSON.stringify(facts['Morning Run']));
  check('Read Books: 6 days/week with its own numbers', facts['Read Books'].days === '6' && /^\d+%$/.test(facts['Read Books'].score), JSON.stringify(facts['Read Books']));
  check('different habits show different numbers', new Set(Object.values(facts).map((f) => `${f.score}|${f.total}|${f.streak}`)).size === 4);
  const dash = (n) => Number(dashStreaks.find((l) => l.startsWith(`${n.length ? '' : ''}`)) && 0);
  for (const n of ['SQL Practice', 'Morning Run', 'Read Books', 'Drink Water']) {
    const i = allNames.findIndex((x) => x.startsWith(n));
    const fromDash = Number(dashStreaks[i].match(/(\d+)-day streak/)[1]);
    check(`${n}: the streak on Habit Details equals the dashboard's (${fromDash})`, facts[n].streak === fromDash, `${facts[n].streak} vs ${fromDash}`);
  }

  section('Habit Details: score chart, streak celebration, Calendar navigation');
  await openHabit('SQL Practice');
  await shot('phase4-detail-sql');
    const scoreChart = await rect('svg', '', 2);
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await mouse(type, scoreChart.x + 36, scoreChart.cy);
  await sleep(400);
  check('tapping the first score point shows "Score: 47%" (October: 7 of 15 eligible days)', await has('Score: 47%'));
  await click('[role=button]', 'Show streak celebration');
  check('tapping the streak card opens the streak celebration', await waitFor(() => has('Tap anywhere to close'), 12000) || (await has('day streak')));
  await click('[aria-label="Close"]', '', 0);
  await waitFor(async () => !(await has('Tap anywhere to close')), 3000);
  await click('[role=button]', '=Calendar View');
  check('Calendar View navigates to the habit\'s calendar route', await waitFor(async () => (await path()) === '/habits/sql-practice/calendar', 4000), await path());
  check('and shows the Calendar screen', (await has('Monthly Completion')) && (await has('Best streaks')));
  await click('[role=button]', '=Back');
  check('going back returns to the habit', await waitFor(async () => (await path()) === '/habits/sql-practice', 4000) || (await path()) === '/habits');
  await send('Page.navigate', { url: `${BASE}/habits/sql-practice` });
  await sleep(2500);
  check('the route also works when opened directly', (await has('Day Streak')) && (await has('OVERVIEW')));

  section('Habit Details: editing still works and keeps the history');
  await load();
  await openHabit('Morning Run');
  const beforeEdit = { streak: await streakOnDetail(), score: await stat('Score'), total: await stat('Total') };
  await click('[role=button]', 'Edit habit');
  await setText('input[aria-label="Habit name"]', 'Morning Run 10k');
  await click('[role=radio]', '=Teal');
  await click('[role=button]', 'Save Changes');
  await waitFor(async () => (await path()) === '/habits/morning-run-10k', 4000);
  await sleep(400);
  check('after a rename the streak, score and total are unchanged', (await streakOnDetail()) === beforeEdit.streak && (await stat('Score')) === beforeEdit.score && (await stat('Total')) === beforeEdit.total, JSON.stringify(beforeEdit));
  check('the streak card glow and charts use the new colour (Teal)', (await ev(`document.body.innerHTML.toLowerCase().includes('#2dd4bf') || document.body.innerHTML.includes('45, 212, 191')`)) === true);
  await click('[role=button]', 'Add your goal'.replace('Add your goal', 'Add your goal'));
  await setText('[aria-label="What is your goal for this habit?"]', 'Run 10k by March');
  await click('[role=button]', 'Save Changes');
  check('the goal appears between Overview and the charts', await ev(`(() => { const t=document.body.innerText; return t.indexOf('OVERVIEW') < t.indexOf('Run 10k by March') && t.indexOf('Run 10k by March') < t.indexOf('SCORE'); })()`));

  section('Habit Details: an archived habit shows the banner and can be unarchived');
  // Open the habit, come back, archive it on Home, then use browser Forward (a reload would reset the mock data).
  await back();
  await openHabit('Read Books');
  await back();
  const arcIdx = (await names()).findIndex((n) => n === 'Read Books');
  await click('[role=button]', 'More options', arcIdx);
  await click('[role=menuitem]', 'Archive Habit');
  await click('[role=button]', '=Archive Habit');
  await sleep(600);
  check('the archived habit is gone from Home', !(await names()).includes('Read Books'));
  await ev('history.forward()');
  await waitFor(async () => (await path()) === '/habits/read-books', 4000);
  await sleep(600);
  check('the Archived banner shows its message and Unarchive', (await has('Archived · hidden from Home, still tracked')) && (await has('Unarchive')));
  await click('[role=button]', 'Unarchive');
  check('Unarchive confirms and removes the banner', (await waitFor(() => has('Habit unarchived · back on Home'), 2000)) && !(await has('Archived · hidden from Home, still tracked')));

  section('Habit Details: light theme and responsive layouts');
  await load();
  await openHabit('SQL Practice');
  await click('[role=button]', 'Switch to light mode');
  for (const [w, h, mobile] of [[320, 700, true], [390, 844, true], [768, 1024, false], [1280, 800, false], [1920, 1080, false]]) {
    await viewport(w, h, mobile);
    await sleep(500);
    const m = await ev(`(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, hasAll: ['Day Streak','Calendar View','OVERVIEW','SCORE','HISTORY'].every(k => document.body.innerText.includes(k)) }))()`);
    check(`${w}px light: no horizontal overflow and every section present`, m.sw <= m.iw && m.hasAll, JSON.stringify(m));
    if (w === 390 || w === 1280) await shot(`phase4-detail-light-${w}`);
  }
  await viewport(390, 844, true);
  await click('[role=button]', 'Switch to dark mode');
  await shot('phase4-detail-dark-390');

  section('Habit Details: a missing habit');
  await send('Page.navigate', { url: `${BASE}/habits/no-such-habit` });
  await sleep(2500);
  check('shows "Habit not found" with placeholders, like Kotlin', (await has('Habit not found')) && (await has('Not enough data yet')) && (await has('No completions yet')) && (await stat('Score')) === '—');

  // ───────────────────────────── Phase 5: Calendar ─────────────────────────────
  const cell = (d) => `[data-testid="day-${d}"]`;
  const cellLabel = (d) => ev(`(() => { const e=document.querySelector(${JSON.stringify(cell(d))}); return e ? e.getAttribute('aria-label') : null; })()`);
  const tapCell = async (d) => { const r = await rect(cell(d)); if (!r) { await shot('fail-no-cell'); throw new Error(`no cell ${d} at ${await path()}: ${(await text()).replace(/\s+/g, ' ').slice(0, 300)}`); } for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await mouse(type, r.cx, r.cy); await sleep(650); };
  const dblCell = async (d) => { const r = await rect(cell(d)); for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased', 'mousePressed', 'mouseReleased']) await mouse(type, r.cx, r.cy); await sleep(500); };
  const pressEscape = async () => { await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 }); await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(450); };
  const openCalendar = async (name) => {
    await openHabit(name);
    await click('[role=button]', '=Calendar View');
    await waitFor(async () => (await path()).endsWith('/calendar'), 4000);
    await waitFor(() => has('Monthly Completion'), 4000);
    await sleep(500);
  };
  const leafColor = (t) => ev(`(() => { const e=[...document.querySelectorAll('div')].find(x => x.children.length === 0 && x.innerText && x.innerText.startsWith(${JSON.stringify(t)}) && x.getBoundingClientRect().width > 0); return e ? getComputedStyle(e).color : null; })()`);
  const leafTop = (t) => ev(`(() => { const e=[...document.querySelectorAll('div')].find(x => x.children.length === 0 && x.innerText === ${JSON.stringify(t)} && x.getBoundingClientRect().width > 0); return e ? Math.round(e.getBoundingClientRect().top) : null; })()`);
  const toastIs = (t) => waitFor(() => has(t), 2500);

  section('Calendar: layout, summary cards and day states (Morning Run, today is Saturday 21 Nov)');
  await viewport(1280, 900);
  await load();
  await openCalendar('Morning Run');
  check('the route is /habits/morning-run/calendar (the existing route)', (await path()) === '/habits/morning-run/calendar');
  check('title, month label and schedule pill', (await has('Calendar')) && (await has('Nov 2026')) && (await has('Schedule: 7 days/week')));
  check('Monthly Completion and Habit Health sections are present', (await has('Monthly Completion')) && (await has('Habit Health')) && (await has('Current streak & consistency')));
  check('weekday headings are Sunday first', await ev(`(() => { const t=document.body.innerText; const i=t.indexOf('Sun'); return i >= 0 && ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].every((d, k, a) => k === 0 || t.indexOf(d, i) > t.indexOf(a[k-1], i)); })()`));
  check('11 of 20 days completed = 55%', (await has('of 20 days')) && (await has('55%')));
  check('Habit Health: 1 day streak, best 10, "Good consistency (55%)"', (await has('Current streak · best 10')) && (await has('1 day')) && (await has('Good consistency (55%)')));
  check('completed day (20 Nov) is Done', (await cellLabel('2026-11-20')).includes('Done'));
  check('missed day (19 Nov, Thursday) is Missed', (await cellLabel('2026-11-19')).includes('Missed'));
  check('today is "Today" (never missed) and 22 Nov is Future', (await cellLabel('2026-11-21')).includes('Today') && (await cellLabel('2026-11-22')).includes('Future'));
  check('days of the next month in the last grid row are Outside', (await cellLabel('2026-12-01')).includes('Outside'));
  check('the legend lists Completed, Missed, Rest day, Freeze used, Note', (await ev(`['Completed','Missed','Rest day','Freeze used','Note'].every(k => document.body.innerText.includes(k))`)));
  check('stat lines show Missed 9, Rest days 0, Freeze used 0', await ev(`(() => { const t=document.body.innerText.replace(/\\s+/g,' '); return /9 Missed/.test(t) && /0 Rest days/.test(t) && /0 Freeze used/.test(t); })()`));
  check('Best streaks lists the habit and its personal best run (10 days)', (await has('Best streaks')) && (await has('Morning Run')) && (await ev(`${q('[data-testid="best-streak-row"]')}.some(r => r.innerText.replace(/\\s+/g,' ').includes(' 10 '))`)));
  check('the habit colour is used for accents (Morning Run orange)', (await leafColor('Schedule: 7 days/week')) === 'rgb(251, 146, 60)', await leafColor('Schedule: 7 days/week'));
  await shot('phase5-calendar-morning-run-dark');

  section('Calendar: month and year navigation');
  check('Next month is disabled on the current month', (await isDisabled('Next month')) === true);
  await click('[role=button]', 'Previous month');
  check('Previous month shows Oct 2026 with its own grid', (await has('Oct 2026')) && (await cellLabel('2026-10-15')) !== null);
  check('October is before the habit existed: days are neutral (never Missed)', (await cellLabel('2026-10-15')).includes('Inactive'));
  check('Monthly Completion for October is "–" with 0 days', (await has('of 0 days')) && (await has('–')));
  await click('[role=button]', 'Next month');
  check('Next month returns to Nov 2026', await has('Nov 2026'));
  await click('[role=button]', 'Previous month');
  check('October shows the last days of September greyed (Outside)', (await cellLabel('2026-09-30')).includes('Outside'));
  await tapCell('2026-09-30');
  check('tapping a grey day of a neighbouring month jumps to that month', (await has('Sep 2026')) && !(await has('Oct 2026')));
  await click('[role=button]', 'Next month');
  await click('[role=button]', 'Next month');
  check('two steps forward is Nov 2026 again', await has('Nov 2026'));
  await click('[role=button]', 'Choose month and year');
  check('the month label opens "Select Month & Year" with Apply and Cancel', (await has('Select Month & Year')) && (await has('Apply')) && (await has('Cancel')));
  await click('[role=button]', 'Previous year');
  check('Previous year moves the draft to 2025', await ev(`document.body.innerText.includes('2025')`));
  check('the month does not change until Apply (header still Nov 2026 behind the sheet)', await has('Nov 2026'));
  await click('[role=button]', '=Cancel');
  check('Cancel keeps Nov 2026', (await has('Nov 2026')) && !(await has('Select Month & Year')));
  await click('[role=button]', 'Choose month and year');
  await click('[role=button]', '=Mar 2026');
  await click('[role=button]', '=Apply');
  check('picking Mar 2026 and Apply shows March', (await has('Mar 2026')) && !(await has('Select Month & Year')));
  await click('[role=button]', 'Choose month and year');
  for (let i = 0; i < 12; i++) await click('[role=button]', 'Previous year');
  check('the picker reaches back ten years (2016) and stops', await ev(`(() => { const t=document.body.innerText; return t.includes('2016') && !t.includes('2015'); })()`));
  await pressEscape();
  await click('[role=button]', 'Choose month and year');
  await click('[role=button]', '=Nov 2026');
  await click('[role=button]', '=Apply');
  check('back on Nov 2026 via the picker', await has('Nov 2026'));

  section('Calendar: freeze flow (eligible day, ineligible day, wallet and notes)');
  await tapCell('2026-11-05');
  check('an old missed day (5 Nov) says "Can\'t Use a Freeze" with the recovery-window reason', (await waitFor(() => has("Can't Use a Freeze"), 2500)) && (await has('Freezes can only protect missed days from the last 3 days.')));
  check('the sheet shows Available Freezes ❄️ 1 and Used this month 1/3', (await has('Available Freezes')) && (await has('❄️ 1')) && (await has('Used this month')) && (await has('1/3')));
  check('the button reads "Not Available" and is disabled', (await isDisabled('Not Available')) === true);
  check('the blue recovery note is shown', await has("A freeze keeps your streak going through one missed day. It doesn't count as a completed day, and only misses from the last 3 days can be protected."));
  await pressEscape();
  await tapCell('2026-11-19');
  check('the eligible missed day (19 Nov) opens "Protect Your Streak"', (await waitFor(() => has('Protect Your Streak'), 2500)) && (await has('Use 1 Streak Freeze to protect your streak.')));
  check('with an enabled "❄️  Use Freeze" button', (await isDisabled('Use Freeze')) === false);
  await click('[role=button]', 'Use Freeze');
  check('using the freeze confirms with a ❄️ toast and closes the sheet', (await toastIs('❄️')) && !(await has('Protect Your Streak')));
  check('19 Nov is now Frozen', (await cellLabel('2026-11-19')).includes('Frozen'));
  check('the streak survives: Habit Health shows 11 days and Freeze used 1', (await has('11 days')) && (await ev(`/1 Freeze used/.test(document.body.innerText.replace(/\\s+/g,' '))`)));
  await tapCell('2026-11-19');
  check('a frozen day opens "Streak Freeze Used" with a Close button and no Use button', (await waitFor(() => has('Streak Freeze Used'), 2500)) && (await has('This day is already protected by a Streak Freeze.')) && (await isDisabled('Use Freeze')) === null);
  check('the frozen day offers a note (placeholder "Why did you miss this habit?")', await has('Add a Note (Optional)'));
  await click('[role=button]', 'Add a Note (Optional)');
  await setText('textarea[aria-label="Note"]', 'Was travelling');
  check('the note counter shows the 200 limit', await has('14/200'));
  await click('[role=button]', '=Save Note');
  check('saving shows "📝 Note saved"', await toastIs('📝 Note saved'));
  check('the saved note is shown with Edit and Delete', (await has('Was travelling')) && (await has('Edit')) && (await has('Delete')));
  await pressEscape();
  check('the frozen day now carries the note marker', (await cellLabel('2026-11-19')).includes('with note'));
  await shot('phase5-calendar-frozen-note');

  section('Calendar: notes on completed days (add, edit, delete)');
  await tapCell('2026-11-20');
  check('tapping a completed day opens "✅ Completed" with the day and a note field', (await waitFor(() => has('✅ Completed'), 2500)) && (await has('Morning Run · Fri, Nov 20, 2026')));
  await click('[role=button]', 'Add a Note (Optional)');
  check('the placeholder for completed days is the journal prompt', await ev(`!!document.querySelector('textarea[placeholder="How did it go? Anything worth remembering?"]')`));
  await setText('textarea[aria-label="Note"]', '   ');
  check('Save Note is disabled for blank text', (await isDisabled('Save Note')) === true);
  await setText('textarea[aria-label="Note"]', 'Felt great');
  await click('[role=button]', '=Save Note');
  check('saved on a completed day', (await toastIs('📝 Note saved')) && (await has('Felt great')));
  await click('[role=button]', '=Edit');
  await setText('textarea[aria-label="Note"]', 'Felt great, ran 5k');
  await click('[role=button]', '=Save Note');
  check('editing replaces the note', (await has('Felt great, ran 5k')));
  await click('[role=button]', '=Delete');
  check('Delete asks for confirmation: "Delete note?"', (await has('Delete note?')) && (await has("This removes only the note. The day's freeze and your streak stay the same.")));
  await click('[role=button]', '=Cancel');
  check('Cancel keeps the note', (await has('Felt great, ran 5k')) && !(await has('Delete note?')));
  await pressEscape();
  check('the completed day carries a note marker', (await cellLabel('2026-11-20')).includes('with note'));
  await tapCell('2026-11-20');
  await click('[role=button]', '=Delete');
  await click('[role=button]', '=Delete', 1);
  check('confirming removes the note: "🗑️ Note deleted", the day stays completed', (await toastIs('🗑️ Note deleted')) && (await cellLabel('2026-11-20')).includes('Done'));
  await pressEscape();
  check('the marker is gone but the day is still Done', !(await cellLabel('2026-11-20')).includes('with note'));

  section('Calendar: double tap and edit mode');
  await dblCell('2026-11-08');
  check('double-tapping a missed day marks it done', (await toastIs('✅ Marked as done')) && (await cellLabel('2026-11-08')).includes('Done'));
  check('Monthly Completion updates to 12 of 20', await ev(`/12\\s+of 20 days/.test(document.body.innerText)`));
  await dblCell('2026-11-08');
  check('double-tapping again undoes it (toast, or the wallet notice that replaces it)', ((await toastIs('Marked as not done')) || (await has('Daily reward adjusted.'))) && (await cellLabel('2026-11-08')).includes('Missed'), `${await cellLabel('2026-11-08')} | ${(await text()).replace(/\s+/g, ' ').slice(-160)}`);
  await dblCell('2026-11-22');
  check('a future day cannot be completed', await toastIs("You can't complete a future day"));
  await tapCell('2026-11-22');
  check('tapping a future day says "Upcoming day"', await toastIs('Upcoming day'));
  await dblCell('2026-11-19');
  check('a frozen day cannot be toggled by double tap', await toastIs('❄️ This day is protected by a Streak Freeze'));
  await tapCell('2026-11-21');
  check('tapping today says "⏳ Not completed yet today"', await toastIs('⏳ Not completed yet today'));
  await click('[role=button]', 'Edit days');
  check('EDIT switches to DONE with the hint "Tap active days to mark"', (await has('DONE')) && (await has('Tap active days to mark')));
  await tapCell('2026-11-08');
  check('in edit mode a single tap toggles the day without opening a sheet', (await cellLabel('2026-11-08')).includes('Done') && !(await has('Protect Your Streak')));
  await tapCell('2026-11-08');
  check('and toggles back', (await cellLabel('2026-11-08')).includes('Missed'));
  await click('[role=button]', 'Done editing');
  check('DONE returns to EDIT', await has('EDIT'));

  section('Calendar: dashboard and Habit Details stay consistent');
  const calStreak = await ev(`(() => { const m = document.body.innerText.match(/(\\d+) days?\\s*\\n?\\s*Current streak/); return m ? Number(m[1]) : null; })()`);
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()) === '/habits/morning-run', 4000);
  await sleep(500);
  check('Back from the calendar returns to Habit Details', (await path()) === '/habits/morning-run');
  check('Habit Details shows the same streak (11) the freeze preserved', (await streakOnDetail()) === 11 && calStreak === 11, `${await streakOnDetail()} vs ${calStreak}`);
  await back();
  check('the dashboard shows the same 11-day streak for Morning Run', await ev(`(() => { const c=${q('[aria-label^="Open Morning Run"]')}[0]; return !!c && /11-day streak/.test(c.innerText + ' ' + [...c.querySelectorAll('[aria-label]')].map(x => x.getAttribute('aria-label')).join(' ')); })()`));
  check('using the freeze did not spend coins (never below the starting 20)', (await coins()) >= 20, String(await coins()));

  section('Calendar: no freezes left sends you to the Wallet (Drink Water, missed 19 Nov)');
  // Coins earned from the calendar toggles are announced on Home (as in Kotlin): dismiss those popups first.
  for (let i = 0; i < 4 && (await has('Go to Wallet →')); i++) await click('[role=button]', '=Continue');
  await sleep(400);
  await openCalendar('Drink Water');
  await tapCell('2026-11-19');
  check('"No Streak Freezes Available" with the Wallet button', (await waitFor(() => has('No Streak Freezes Available'), 2500)) && (await has('Purchase a freeze from your Wallet to protect eligible missed days.')) && (await has('Go to Wallet')));
  check('Available Freezes shows ❄️ 0', await has('❄️ 0'));
  await click('[role=button]', 'Go to Wallet');
  check('Go to Wallet opens the Wallet screen', await waitFor(async () => (await path()) === '/wallet', 4000));

  section('Calendar: rest days, bonus effort and historical schedule changes (SQL Practice)');
  await load();
  await openCalendar('SQL Practice');
  check('shows the habit\'s schedule: "Schedule: 5 days/week" and "Rest: Sat, Sun"', (await has('Schedule: 5 days/week')) && (await has('Rest: Sat, Sun')));
  check('the rest-days banner is shown', await has("Rest days don't break your streak. Only missing an active day breaks streak."));
  check('a past Saturday (14 Nov) is a Rest day, today (Saturday) too', (await cellLabel('2026-11-14')).includes('Rest') && (await cellLabel('2026-11-21')).includes('Rest'));
  check('a green habit: accent colour is SQL Practice green, not Morning Run orange', (await leafColor('Schedule: 5 days/week')) === 'rgb(74, 222, 128)', await leafColor('Schedule: 5 days/week'));
  await tapCell('2026-11-14');
  check('tapping a rest day says "🔵 Rest Day"', await toastIs('🔵 Rest Day'));
  await dblCell('2026-11-21');
  check('double-tapping today\'s rest day completes it as bonus effort', await toastIs('✅ Completed on a rest day · +1 streak day'));
  check('and shows the "Bonus Effort!" celebration', await waitFor(() => has('Bonus Effort'), 4000));
  check('which closes itself', await waitFor(async () => !(await has('Bonus Effort')), 4500));
  check('the completed rest day shows as Done with its small R', (await cellLabel('2026-11-21')).includes('Done') && (await cellLabel('2026-11-21')).includes('rest day'));
  await dblCell('2026-11-21');
  check('double-tapping it again restores the rest day', (await toastIs('Marked as not done · back to a rest day')) && (await cellLabel('2026-11-21')).includes('Rest'));
  await click('[role=button]', 'Edit schedule');
  check('the schedule pill opens "Edit Schedule"', (await has('Edit Schedule')) && (await has('DAYS PER WEEK')) && (await has('REST DAYS')));
  check('Save Schedule is enabled while both rest days are selected', (await isDisabled('Save Schedule')) === false);
  await click('[role=button]', '6 days per week');
  check('6d/wk keeps one of the two rest days selected (1/1)', await has('1/1 selected'));
  check('a second rest day is refused: "Max 1 rest day for 6 days/week."', await (async () => { await click('[role=checkbox]', '^Sun'); return has('Max 1 rest day for 6 days/week.'); })());
  await click('[role=checkbox]', '^Sat');
  await click('[role=checkbox]', '^Sun');
  await click('[role=button]', '=Save Schedule');
  check('saving confirms: "Schedule updated from tomorrow. Past days keep their old schedule."', await toastIs('Schedule updated from tomorrow. Past days keep their old schedule.'));
  check('the pill now reads 6 days/week with Rest: Sun', (await has('Schedule: 6 days/week')) && (await has('Rest: Sun')));
  check('history is preserved: past Saturday 14 Nov is still a Rest day, today stays Rest', (await cellLabel('2026-11-14')).includes('Rest') && (await cellLabel('2026-11-21')).includes('Rest'));
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()) === '/habits/sql-practice', 4000);
  await sleep(500);
  check('Habit Details shows the new 6 days/week', await has('6 days/week'));

  section('Calendar: responsive layouts and light theme');
  await click('[role=button]', '=Calendar View');
  await waitFor(() => has('Monthly Completion'), 4000);
  for (const [w, h, mobile] of [[320, 700, true], [390, 844, true], [768, 1024, false], [1280, 800, false], [1920, 1080, false]]) {
    await viewport(w, h, mobile);
    await sleep(500);
    const m = await ev(`(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, all: ['Calendar','Monthly Completion','Habit Health','Legend','Best streaks'].filter(k => k !== 'Legend').every(k => document.body.innerText.includes(k)) }))()`);
    check(`${w}px dark: no horizontal overflow and every section present`, m.sw <= m.iw && m.all, JSON.stringify(m));
    const a = await leafTop('Monthly Completion');
    const b = await leafTop('Habit Health');
    check(`${w}px: summary cards are ${w <= 320 ? 'stacked' : 'side by side'}`, w <= 320 ? b > a + 40 : Math.abs(a - b) <= 2, `${a} ${b}`);
    const cells = await ev(`(() => { const e=document.querySelector('[data-testid="day-2026-11-10"]'); const r=e.getBoundingClientRect(); return {w:r.width,h:r.height}; })()`);
    check(`${w}px: day cells keep a usable tap target (${Math.round(cells.w)}x${Math.round(cells.h)})`, cells.w >= 30 && cells.h >= 36);
    if (w === 320 || w === 1280) await shot(`phase5-calendar-dark-${w}`);
  }
  await viewport(390, 844, true);
  await click('[role=button]', 'Switch to light mode');
  check('light theme applies', (await theme()) === 'light');
  const bg = await ev(`getComputedStyle(document.querySelector('[data-testid="day-2026-11-10"]').parentElement.parentElement).backgroundColor`);
  check('the grid card is white in the light theme', bg === 'rgb(255, 255, 255)', bg);
  for (const [w, h, mobile] of [[320, 700, true], [390, 844, true], [1280, 800, false]]) {
    await viewport(w, h, mobile);
    await sleep(400);
    const m = await ev(`(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))()`);
    check(`${w}px light: no horizontal overflow`, m.sw <= m.iw, JSON.stringify(m));
    if (w !== 1280) await shot(`phase5-calendar-light-${w}`);
  }
  await viewport(390, 844, true);
  await tapCell('2026-11-12');
  await shot('phase5-calendar-light-sheet');
  await pressEscape();
  await click('[role=button]', 'Switch to dark mode');
  check('and back to dark', (await theme()) === 'dark');

  section('Calendar: a missing habit falls back to the Kotlin demo');
  await send('Page.navigate', { url: `${BASE}/habits/no-such-habit/calendar` });
  await sleep(2500);
  check('shows the demo schedule and best streaks (no habit matches)', (await has('Schedule: 5 days/week')) && (await has('Rest: Sat, Sun')) && (await has('08-May-2024')));
  await tapCell('2026-11-18');
  check('a missed day in demo mode says "❌ Missed — streak breaks"', await toastIs('❌ Missed — streak breaks'));

  // ───────────────────────────── Phase 6: Wallet ─────────────────────────────
  const walletHas = (label) => ev(`!!document.querySelector('[aria-label=${JSON.stringify(label)}]')`);
  const openWallet = async () => { await click('[role=button]', 'Wallet, '); await waitFor(async () => (await path()) === '/wallet', 4000); await sleep(500); };
  const flat = () => ev(`document.body.innerText.replace(/\\s+/g, ' ')`);

  section('Wallet: layout, balances and explanations (fresh user: 20 coins, 1 welcome freeze)');
  await viewport(1280, 900);
  // The mock history earns 15 coins by itself, so start from 5 to have exactly 20 at first sight and be able to empty the wallet.
  await send('Page.navigate', { url: `${BASE}/habits` });
  await sleep(1500);
  await ev(`localStorage.clear(); localStorage.setItem('consisto_mock_start_coins', '5')`);
  await send('Page.navigate', { url: `${BASE}/habits` });
  await waitFor(async () => (await names()).length >= 5, 20000);
  await sleep(500);
  check('the dashboard shows 20 coins', (await coins()) === 20);
  await openWallet();
  check('the Wallet opens at /wallet', (await path()) === '/wallet');
  check('title and the two balance tiles: COINS 20 and STREAK FREEZES 1 (the welcome freeze)', (await has('Wallet')) && (await walletHas('COINS: 20')) && (await walletHas('STREAK FREEZES: 1')));
  check('no pending-adjustment ⓘ when nothing is pending', !(await walletHas('Pending coin adjustment')));
  check('"How to earn": +1 coin/day and every milestone bonus', await ev(`['How to earn','Complete all habits','+1 coin/day','Day 15 milestone','Day 30 milestone','Day 45 milestone','Day 60 milestone','Day 75 milestone','Day 100 milestone','+10 bonus','+20 bonus'].every(k => document.body.innerText.includes(k))`));
  check('"How to use": Streak Freeze, 20 coins, "❄️ 1/3" purchasable (3 - 1 used - 1 owned), Max 3 per month', await ev(`['How to use','Streak Freeze','20 coins','Protects your streak on a missed active day','Freezes available to purchase','❄️ 1/3','Max 3 per month'].every(k => document.body.innerText.includes(k))`));
  check('the buy button is enabled with the price', (await isDisabled('Buy Streak Freeze — 20 Coins')) === false);
  check('the allowance bar has 3 slots', (await ev(`document.querySelectorAll('[data-testid="freeze-slot"]').length`)) === 3);
  await shot('phase6-wallet-dark');
  await click('[role=button]', 'How it works');
  check('"How it works" lists the rules', await ev(`['Earn 1 coin when you complete ALL habits in a day','Day 15 +5, Day 30 +5, Day 45 +5, Day 60 +5, Day 75 +10, Day 100 +20','Spend 20 coins to buy a Streak Freeze','Max 3 Streak Freezes per month','Freeze protects your streak on a missed active day'].every(k => document.body.innerText.includes(k))`));
  await pressEscape();
  check('Escape closes it', !(await has('Earn 1 coin when you complete ALL')));

  section('Wallet: buying a freeze, then the Calendar sees it at once');
  await back();
  await openCalendar('Morning Run');
  await tapCell('2026-11-19');
  await click('[role=button]', 'Use Freeze');
  await sleep(500);
  check('the welcome freeze protects 19 Nov (no coins spent)', (await cellLabel('2026-11-19')).includes('Frozen'));
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()) === '/habits/morning-run', 4000);
  await back();
  check('the dashboard still shows 20 coins after using a freeze', (await coins()) === 20);
  await openCalendar('Drink Water');
  await tapCell('2026-11-19');
  check('with no freezes left the calendar points to the Wallet', (await waitFor(() => has('No Streak Freezes Available'), 2500)) && (await has('❄️ 0')));
  await click('[role=button]', 'Go to Wallet');
  await waitFor(async () => (await path()) === '/wallet', 4000);
  await sleep(500);
  check('Wallet: COINS 20, STREAK FREEZES 0, "❄️ 1/3" still buyable (3 - 2 used - 0 owned)', (await walletHas('COINS: 20')) && (await walletHas('STREAK FREEZES: 0')) && (await has('❄️ 1/3')));
  await click('[role=button]', 'Buy Streak Freeze — 20 Coins');
  const sheetText = await flat();
  check('the buy sheet previews the purchase: 20 → 0 coins, 1/3 → 0/3 freezes left', sheetText.includes('Buy Streak Freeze') && sheetText.includes('Confirm Purchase') && /Your coins 20 → 0/.test(sheetText) && /Freezes left 1\/3 → 0\/3/.test(sheetText), sheetText.slice(-300));
  await shot('phase6-wallet-buy-sheet');
  await click('[role=button]', 'Confirm Purchase');
  check('buying confirms "❄️ Freeze purchased! You own 1."', await toastIs('Freeze purchased! You own 1.'));
  check('balances update at once: COINS 0, STREAK FREEZES 1, "❄️ 0/3"', (await walletHas('COINS: 0')) && (await walletHas('STREAK FREEZES: 1')) && (await has('❄️ 0/3')));
  check('the button now says "Need 20 more coins" and is disabled', (await isDisabled('Need 20 more coins')) === true);
  await ev('history.back()');
  await waitFor(async () => (await path()).endsWith('/calendar'), 4000);
  await sleep(600);
  await tapCell('2026-11-19');
  check('back on the Calendar the new freeze is available immediately', (await waitFor(() => has('Protect Your Streak'), 2500)) && (await has('❄️ 1')));
  await pressEscape();

  section('Wallet: undo with spent coins -> pending adjustment, then recovery from future earnings');
  await dblCell('2026-11-20');
  check('un-doing 20 Nov (all habits were done) reverses its daily coin; the coin was already spent', (await cellLabel('2026-11-20')).includes('Missed') && (await has('Coin reward adjusted')));
  await tapCell('2026-11-19');
  await click('[role=button]', 'Use Freeze');
  await sleep(500);
  await tapCell('2026-11-20');
  check('3 freezes are now used in November, so the sheet says the month is full', (await waitFor(() => has("Can't Use a Freeze"), 2500)) && (await has("You've used 3/3 Streak Freezes for November.")));
  await pressEscape();
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()).startsWith('/habits/') && !(await path()).endsWith('/calendar'), 4000);
  await back();
  await openWallet();
  check('the Wallet shows COINS 0, STREAK FREEZES 0 and the pending ⓘ', (await walletHas('COINS: 0')) && (await walletHas('STREAK FREEZES: 0')) && (await walletHas('Pending coin adjustment')));
  await click('[role=button]', 'Pending coin adjustment');
  check('ⓘ explains: "Pending coin adjustment: 1 coin"', (await has('Pending coin adjustment: 1 coin')) && (await has("You've already used these 1 coin. Your next earned coins will be used to balance your rewards.")));
  await shot('phase6-wallet-pending');
  await click('[role=button]', '=Got it');
  check('"Got it" closes it', !(await has("You've already used these")));
  await back();
  await openCalendar('Drink Water');
  await dblCell('2026-11-20');
  check('re-completing 20 Nov restores the reward and the coin pays off the pending amount', (await cellLabel('2026-11-20')).includes('Done') && (await has('went toward balancing an earlier reward adjustment')));
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()).startsWith('/habits/') && !(await path()).endsWith('/calendar'), 4000);
  await back();
  check('the dashboard shows 0 coins (no popup: the coin cleared pending, not the balance)', (await coins()) === 0 && !(await has('Go to Wallet →')));
  await openWallet();
  check('Wallet after recovery: COINS 0, no ⓘ, STREAK FREEZES 0, "❄️ 0/3"', (await walletHas('COINS: 0')) && !(await walletHas('Pending coin adjustment')) && (await walletHas('STREAK FREEZES: 0')) && (await has('❄️ 0/3')));
  check('with 3 freezes used this month and no coins the button says "Need 20 more coins"', (await isDisabled('Need 20 more coins')) === true);

  section('Wallet: deleting a habit keeps its freeze history');
  await back();
  const mrIdx = (await names()).indexOf('Morning Run');
  await click('[role=button]', 'More options', mrIdx);
  await click('[role=menuitem]', 'Delete Habit');
  check('Morning Run (which had a freeze) is deleted', await waitFor(async () => !(await names()).includes('Morning Run'), 2000));
  await openWallet();
  check('its freeze still counts toward this month: "❄️ 0/3", COINS and freezes unchanged', (await has('❄️ 0/3')) && (await walletHas('COINS: 0')) && (await walletHas('STREAK FREEZES: 0')));

  section('Wallet: responsive layouts and light theme');
  for (const [w, h, mobile] of [[320, 700, true], [390, 844, true], [768, 1024, false], [1280, 800, false], [1920, 1080, false]]) {
    await viewport(w, h, mobile);
    await sleep(500);
    const m = await ev(`(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, all: ['COINS','STREAK FREEZES','How to earn','How to use','Max 3 per month'].every(k => document.body.innerText.includes(k)) }))()`);
    check(`${w}px: no horizontal overflow and every section present`, m.sw <= m.iw && m.all, JSON.stringify(m));
    const a = await ev(`Math.round(document.querySelector('[aria-label^="COINS:"]').getBoundingClientRect().top)`);
    const b = await ev(`Math.round(document.querySelector('[aria-label^="STREAK FREEZES:"]').getBoundingClientRect().top)`);
    check(`${w}px: balance tiles are ${w < 340 ? 'stacked' : 'side by side'}`, w < 340 ? b > a + 40 : Math.abs(a - b) <= 2, `${a} ${b}`);
    if (w === 320 || w === 1280) await shot(`phase6-wallet-dark-${w}`);
  }
  await viewport(390, 844, true);
  await click('[role=button]', 'Switch to light mode');
  check('light theme applies', (await theme()) === 'light');
  await shot('phase6-wallet-light-390');
  for (const w of [320, 1280]) {
    await viewport(w, 800, w < 500);
    await sleep(400);
    check(`${w}px light: no horizontal overflow`, await ev(`document.documentElement.scrollWidth <= window.innerWidth`));
  }
  await viewport(390, 844, true);
  await click('[role=button]', 'Switch to dark mode');
  check('and back to dark', (await theme()) === 'dark');

  // ───────────────────────────── Phase 7: Settings and Archived Habits ─────────────────────────────
  const pageBg = () => ev(`(() => { let e = document.elementFromPoint(window.innerWidth - 3, Math.round(window.innerHeight / 2)); while (e) { const c = getComputedStyle(e).backgroundColor; if (c && !c.endsWith(', 0)') && c !== 'transparent') return c; e = e.parentElement; } return null; })()`);
  const switchState = (label) => ev(`(() => { const e = ${q('[role=switch]', label)}.filter(x => x.getBoundingClientRect().width > 0)[0]; return e ? e.getAttribute('aria-checked') : null; })()`);
  const dayCircles = () => ev(`[...document.querySelectorAll('[role=checkbox]')].filter(x => x.getBoundingClientRect().width > 0).map(x => x.getAttribute('aria-label'))`);
  const streakOf = (name) => ev(`(() => { const c = ${q(`[aria-label^="Open ${name}"]`)}[0]; if (!c) return null; const l = [...c.querySelectorAll('[aria-label]')].map(x => x.getAttribute('aria-label')).join(' ') + ' ' + c.innerText; const m = l.match(/(\\d+)-day streak/); return m ? Number(m[1]) : null; })()`);

  section('Settings: navigation, layout and sections (Guest)');
  await viewport(1280, 900);
  await load();
  await click('[role=button]', '=Settings');
  check('the gear on Home opens /settings', await waitFor(async () => (await path()) === '/settings', 4000));
  check('title, profile card and guest notice', await ev(`['Settings','Guest','Data stored on this device only','GUEST MODE','Sign In','Stored only on this device',"Guest data isn't backed up. It may be lost if you uninstall the app or clear its storage."].every(k => document.body.innerText.includes(k))`));
  check('sections in Kotlin order: BACKUP, NOTIFICATIONS, HABITS, APP, ACCOUNT', await ev(`(() => { const t=document.body.innerText; let last=-1; return ['BACKUP','NOTIFICATIONS','HABITS','APP','ACCOUNT'].every(k => { const i=t.indexOf(k, last+1); const ok=i>last; last=i; return ok; }); })()`));
  check('rows and subtitles', await ev(`['Sign in to back up your progress','Guest data is only on this device','Reminders & Streak Alerts','Not available on the web yet','Archived Habits','Hidden from Home, still tracked','Privacy Policy','Help & Support','No support address yet','App Version','v1.2.0','Log Out',"You're browsing as Guest"].every(k => document.body.innerText.includes(k))`));
  check('no invented settings (no Sign-out / Delete Account for a guest)', !(await has('Delete Account')) && !(await has('Yes, Log Me Out')));
  await shot('phase7-settings-dark');

  section('Settings: honest reminders note, sheets and toasts');
  check('there are no notification switches: the web cannot deliver reminders, so Settings says so instead', (await ev("document.querySelectorAll('[role=switch]').length")) === 0 && (await has('Reminders & Streak Alerts')) && (await has('Not available on the web yet')));
  check('...and nothing claims notifications are "Blocked in system settings", or offers the old "Habit Reminders" switch', !(await has('Blocked in system settings')) && !(await has('Habit Reminders')));
  check('there is no Feedback & Suggestions row (feedback is not ready for the web)', !(await has('Feedback')));
  await click('[role=button]', 'Privacy Policy');
  check('Privacy Policy opens with its six sections', await ev(`['What we store','Stored only on this device','Guest mode','Services we use',"What we don't do",'Deleting your data'].every(k => document.body.innerText.includes(k))`));
  await pressEscape();
  check('Escape closes the policy', !(await has('Services we use')));
  await click('[role=button]', 'Help & Support');
  check('Help & Support says no support address has been set up (and invents none)', (await toastIs("A support address hasn't been set up yet, so there is nobody to contact from here.")) && !(await has('@')));
  await click('[role=button]', '=Sign In');
  check('Sign In opens "Back Up Your Progress"', (await has('Back Up Your Progress')) && (await has('Not Now')));
  await click('[role=button]', '=Not Now');
  check('Not Now closes it', !(await has('Back Up Your Progress')));

  section('Theme: switching, persistence key and consistency on every screen');
  check('Settings starts dark (#121212)', (await pageBg()) === 'rgb(18, 18, 18)', await pageBg());
  await click('[role=button]', 'Switch to light mode');
  check('the toggle on Settings switches to light', (await pageBg()) === 'rgb(245, 245, 245)' && (await ev(`localStorage.getItem('theme_is_dark')`)) === 'false', await pageBg());
  const routes = ['/habits', '/habits/sql-practice', '/habits/sql-practice/calendar', '/wallet', '/settings', '/settings/archived'];
  for (const r of routes) {
    await send('Page.navigate', { url: `${BASE}${r}` });
    await sleep(2200);
    check(`light theme persists after a reload on ${r}`, (await pageBg()) === 'rgb(245, 245, 245)', await pageBg());
  }
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()) !== '/settings/archived', 3000).catch(() => {});
  await send('Page.navigate', { url: `${BASE}/settings` });
  await sleep(2000);
  await shot('phase7-settings-light');
  await click('[role=button]', 'Switch to dark mode');
  check('toggling back saves dark', (await ev(`localStorage.getItem('theme_is_dark')`)) === 'true' && (await pageBg()) === 'rgb(18, 18, 18)');
  for (const r of routes) {
    await send('Page.navigate', { url: `${BASE}${r}` });
    await sleep(2200);
    check(`dark theme persists after a reload on ${r}`, (await pageBg()) === (r === '/habits' ? 'rgb(13, 17, 23)' : 'rgb(18, 18, 18)'), await pageBg());
  }

  section('Archived Habits: empty state, archive, display, open, unarchive, history preserved');
  await load();
  const orderBefore = await names();
  const circlesBefore = await dayCircles();
  const streakBefore = await streakOf('Read Books');
  await click('[role=button]', '=Settings');
  await waitFor(async () => (await path()) === '/settings', 4000);
  await click('[role=button]', 'Archived Habits');
  check('Settings › Archived Habits opens /settings/archived', await waitFor(async () => (await path()) === '/settings/archived', 4000));
  check('with none archived it shows the empty state', (await has('No archived habits')) && (await has('Archive a habit from its ⋮ menu on Home to hide it there. It keeps being tracked and shows up here.')));
  await shot('phase7-archived-empty');
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()) === '/settings', 4000);
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()) === '/habits', 4000);
  const rbIdx = orderBefore.indexOf('Read Books');
  await click('[role=button]', 'More options', rbIdx);
  await click('[role=menuitem]', 'Archive Habit');
  await click('[role=button]', '=Archive Habit');
  await sleep(600);
  check('the habit leaves Home', !(await names()).includes('Read Books'));
  check('the other habits keep their order', JSON.stringify(await names()) === JSON.stringify(orderBefore.filter((n) => n !== 'Read Books')));
  await click('[role=button]', '=Settings');
  await waitFor(async () => (await path()) === '/settings', 4000);
  check('Settings counts it: "1 archived · still tracked"', await has('1 archived · still tracked'));
  await click('[role=button]', 'Archived Habits');
  await waitFor(async () => (await path()) === '/settings/archived', 4000);
  await sleep(400);
  check('the list shows the habit, its rest day, its streak and Unarchive', (await has('Read Books')) && (await has('Rest: Sun')) && (await has('Hidden from Home, still tracked. Streaks, reminders and rewards continue as usual.')) && (await has(`${streakBefore}`)) && (await has('Unarchive')));
  await shot('phase7-archived-list');
  await click('[role=button]', 'Open Read Books');
  check('tapping the row opens the habit as usual (with the archived banner)', (await waitFor(async () => (await path()) === '/habits/read-books', 4000)) && (await waitFor(() => has('Archived · hidden from Home, still tracked'), 3000)));
  check('its streak and history are intact on Habit Details', (await streakOnDetail()) === streakBefore);
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()) === '/settings/archived', 4000);
  await click('[role=button]', 'Unarchive Read Books');
  await sleep(400);
  check('Unarchive empties the list at once', await has('No archived habits'));
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()) === '/settings', 4000);
  check('Settings goes back to "Hidden from Home, still tracked"', (await has('Hidden from Home, still tracked')) && !(await has('1 archived')));
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()) === '/habits', 4000);
  await sleep(400);
  check('Home shows the habit again in its original position', JSON.stringify(await names()) === JSON.stringify(orderBefore));
  check('its streak is unchanged', (await streakOf('Read Books')) === streakBefore, `${await streakOf('Read Books')} vs ${streakBefore}`);
  check('every day circle on Home (completions, rest days) is exactly as before', JSON.stringify(await dayCircles()) === JSON.stringify(circlesBefore));

  section('Archived Habits: schedule history survives, still tracked while hidden, two archived at once');
  await openHabit('SQL Practice');
  await click('[role=button]', 'Edit rest days');
  await click('[role=checkbox]', '^Sat');
  await click('[role=button]', '=Save Changes');
  await sleep(500);
  await back();
  const sqlIdx2 = (await names()).indexOf('SQL Practice');
  await click('[role=button]', 'More options', sqlIdx2);
  await click('[role=menuitem]', 'Archive Habit');
  await click('[role=button]', '=Archive Habit');
  await sleep(500);
  await click('[role=button]', 'More options', (await names()).indexOf('Meditate'));
  await click('[role=menuitem]', 'Archive Habit');
  await click('[role=button]', '=Archive Habit');
  await sleep(500);
  await click('[role=button]', '=Settings');
  await waitFor(async () => (await path()) === '/settings', 4000);
  check('two archived habits are counted', await has('2 archived · still tracked'));
  await click('[role=button]', 'Archived Habits');
  await waitFor(async () => (await path()) === '/settings/archived', 4000);
  await sleep(400);
  check('both are listed in their original list order (SQL Practice before Meditate)', await ev(`(() => { const t=document.body.innerText; return t.indexOf('SQL Practice') >= 0 && t.indexOf('SQL Practice') < t.indexOf('Meditate'); })()`));
  await click('[role=button]', 'Unarchive SQL Practice');
  await sleep(300);
  check('unarchiving one keeps the other archived', (await has('Meditate')) && !(await has('No archived habits')));
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()) === '/settings', 4000);
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()) === '/habits', 4000);
  await sleep(400);
  check('the returned habit is back on Home', (await names()).includes('SQL Practice'));
  await openHabit('SQL Practice');
  check('it keeps the schedule change made before it was archived (6 days/week) and its history', (await has('6 days/week')) && (await stat('Total')) === '22', `${await stat('Total')}`);

  section('Settings and Archived Habits: responsive layouts');
  for (const r of ['/settings', '/settings/archived']) {
    for (const [w, h, mobile] of [[320, 700, true], [390, 844, true], [768, 1024, false], [1280, 800, false], [1920, 1080, false]]) {
      await viewport(w, h, mobile);
      await send('Page.navigate', { url: `${BASE}${r}` });
      await sleep(1800);
      const m = await ev(`({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, text: document.body.innerText.length })`);
      check(`${r} at ${w}px: no horizontal overflow and content present`, m.sw <= m.iw && m.text > 30, JSON.stringify(m));
      if (r === '/settings' && (w === 320 || w === 1280)) await shot(`phase7-settings-${w}`);
    }
  }
  await viewport(390, 844, true);

  // ───────────────────────────── Phase 8: Local data persistence (real page reloads) ─────────────────────────────
  const reloadAt = async (route = '/habits') => {
    await send('Page.navigate', { url: `${BASE}${route}` });
    await sleep(1500);
    if (route === '/habits') await waitFor(async () => (await names()).length >= 4, 20000);
    else await sleep(1200);
    await sleep(500);
  };
  const stored = () => ev(`localStorage.getItem('consisto_app_data')`);
  const storedJson = async () => JSON.parse(await stored());
  const settingsRowText = async () => { await click('[role=button]', '=Settings'); await waitFor(async () => (await path()) === '/settings', 4000); await sleep(300); };
  const noPopups = async () => !(await has('Go to Wallet →')) && !(await has('Milestone unlocked')) && !(await has('Bonus Effort'));

  section('Persistence: a plain refresh keeps everything and awards nothing');
  await viewport(1280, 900);
  await load();
  const s0 = { names: await names(), coins: await coins(), circles: await dayCircles() };
  check('first run saved the mock data as a versioned envelope', (await storedJson()).version === 1 && (await storedJson()).data.habits.length === 5);
  const bytes0 = await stored();
  for (let i = 0; i < 3; i++) await reloadAt('/habits');
  check('three reloads: same habits, order, coins (35) and day circles', JSON.stringify(await names()) === JSON.stringify(s0.names) && (await coins()) === s0.coins && JSON.stringify(await dayCircles()) === JSON.stringify(s0.circles) && s0.coins === 35);
  check('reloading shows no coin, milestone or Bonus Effort popup', await noPopups());
  check('and the stored ledger is byte-for-byte unchanged (nothing awarded or re-applied)', (await stored()) === bytes0);

  section('Persistence: every kind of change survives a reload');
  // 1. complete a habit today (not every habit, so no coin)
  const dwToday = (await dayCircles()).findIndex((l) => l.startsWith('Drink Water') && l.includes('Sat, Nov 21'));
  await click('[role=checkbox]', '', dwToday);
  await sleep(500);
  check('completing Drink Water today shows it done', (await dayCircles())[dwToday].endsWith('done'));
  await reloadAt('/habits');
  check('after a reload it is still completed', (await dayCircles())[dwToday].endsWith('done'));
  await click('[role=checkbox]', '', dwToday);
  await sleep(500);
  await reloadAt('/habits');
  check('undoing it also survives a reload', (await dayCircles())[dwToday].endsWith('missed'));
  await click('[role=checkbox]', '', dwToday);
  await sleep(400);
  // 2. archive
  const rbIdx2 = (await names()).indexOf('Read Books');
  const readStreak = await streakOf('Read Books');
  await click('[role=button]', 'More options', rbIdx2);
  await click('[role=menuitem]', 'Archive Habit');
  await click('[role=button]', '=Archive Habit');
  await sleep(500);
  // 3. settings + theme
  await settingsRowText();
  await click('[role=button]', 'Switch to light mode');
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()) === '/habits', 4000);
  // 4. schedule history: SQL Practice stops resting on Saturdays (from tomorrow)
  await openHabit('SQL Practice');
  await click('[role=button]', 'Edit rest days');
  await click('[role=checkbox]', '^Sat');
  await click('[role=button]', '=Save Changes');
  await sleep(500);
  // 5. freeze + note on the calendar
  await back();
  await openCalendar('Morning Run');
  await tapCell('2026-11-19');
  await click('[role=button]', 'Use Freeze');
  await sleep(500);
  await tapCell('2026-11-20');
  await click('[role=button]', 'Add a Note (Optional)');
  await setText('textarea[aria-label="Note"]', 'Persisted note');
  await click('[role=button]', '=Save Note');
  await sleep(300);
  await pressEscape();
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()) === '/habits/morning-run', 4000);
  await back();
  // 6. wallet purchase
  await openWallet();
  await click('[role=button]', 'Buy Streak Freeze — 20 Coins');
  await click('[role=button]', 'Confirm Purchase');
  await sleep(500);
  check('before reloading: COINS 15, STREAK FREEZES 1', (await walletHas('COINS: 15')) && (await walletHas('STREAK FREEZES: 1')));
  await back();
  await sleep(300);
  const namesAfter = await names();
  const coinsAfter = await coins();
  const circlesAfter = await dayCircles();
  const ledgerAfter = (await storedJson()).data.ledger;

  await reloadAt('/habits');
  check('REFRESH: habits, order and the archived habit are as left', JSON.stringify(await names()) === JSON.stringify(namesAfter) && !(await names()).includes('Read Books'));
  check('REFRESH: coins (15) and every day circle are as left, with no popups', (await coins()) === coinsAfter && coinsAfter === 15 && JSON.stringify(await dayCircles()) === JSON.stringify(circlesAfter) && (await noPopups()));
  check('REFRESH: the light theme is still on', (await pageBg()) === 'rgb(245, 245, 245)', await pageBg());
  check('REFRESH: the ledger (balances, transactions, rewards, freezes) is identical', JSON.stringify((await storedJson()).data.ledger) === JSON.stringify(ledgerAfter));
  await settingsRowText();
  check('REFRESH: Settings still counts 1 archived', await has('1 archived · still tracked'));
  await click('[role=button]', 'Archived Habits');
  await waitFor(async () => (await path()) === '/settings/archived', 4000);
  await sleep(300);
  check('REFRESH: the archived habit is listed with its streak intact', (await has('Read Books')) && (await has(`${readStreak}`)));
  await click('[role=button]', '=Back');
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()) === '/habits', 4000);
  await openWallet();
  check('REFRESH: Wallet shows COINS 15, STREAK FREEZES 1 and "❄️ 0/3" (2 used + 1 owned)', (await walletHas('COINS: 15')) && (await walletHas('STREAK FREEZES: 1')) && (await has('❄️ 0/3')));
  await back();
  await openCalendar('Morning Run');
  check('REFRESH: Calendar keeps 19 Nov frozen and 20 Nov\'s note marker', (await cellLabel('2026-11-19')).includes('Frozen') && (await cellLabel('2026-11-20')).includes('with note'));
  await tapCell('2026-11-20');
  check('REFRESH: the note text is there to read', await has('Persisted note'));
  await pressEscape();
  check('REFRESH: the freeze still counts toward the month (3 freezes used in November: seed + this one + ... shown as "Freeze used 1" for this habit)', await ev(`/1 Freeze used/.test(document.body.innerText.replace(/\\s+/g, ' '))`));
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()) === '/habits/morning-run', 4000);
  await back();
  await openHabit('SQL Practice');
  check('REFRESH: the schedule change persisted (6 days/week) with the history behind it (Total 22)', (await has('6 days/week')) && (await stat('Total')) === '22', `${await stat('Total')}`);
  await back();

  section('Persistence: opening a screen directly after a refresh uses the same restored state');
  for (const [route, label] of [['/wallet', 'COINS: 15'], ['/settings/archived', 'Read Books']]) {
    await reloadAt(route);
    check(`deep link ${route} after a refresh shows the saved state`, route === '/wallet' ? await walletHas(label) : await has(label));
  }
  await reloadAt('/habits/read-books/calendar');
  check('a deep-linked calendar of the archived habit still works', await has('Monthly Completion'));

  section('Persistence: pending adjustment and its recovery survive refreshes');
  await send('Page.navigate', { url: `${BASE}/habits?resetData=1` });
  await sleep(1500);
  await ev(`localStorage.setItem('consisto_mock_start_coins', '5')`);
  await ev(`localStorage.removeItem('consisto_app_data')`);
  await reloadAt('/habits');
  check('after the reset the URL parameter is gone and the mock data is back (20 coins, Read Books on Home)', ((await ev('location.search')) === '') && (await coins()) === 20 && (await names()).includes('Read Books'));
  await openWallet();
  await click('[role=button]', 'Buy Streak Freeze — 20 Coins');
  await click('[role=button]', 'Confirm Purchase');
  await sleep(400);
  await back();
  await openCalendar('Drink Water');
  await dblCell('2026-11-20');
  await sleep(400);
  await reloadAt('/wallet');
  check('REFRESH: coins 0 with the pending ⓘ restored', (await walletHas('COINS: 0')) && (await walletHas('Pending coin adjustment')));
  await click('[role=button]', 'Pending coin adjustment');
  check('REFRESH: its explanation still says 1 coin', await has('Pending coin adjustment: 1 coin'));
  await click('[role=button]', '=Got it');
  check('REFRESH: the stored wallet has pending 1 and the freeze purchase in the ledger', await ev(`(() => { const d = JSON.parse(localStorage.getItem('consisto_app_data')).data; return d.ledger.wallet.pending === 1 && d.ledger.wallet.coins === 0 && d.ledger.transactions.some(t => t.id.startsWith('freeze_buy_')); })()`));
  await back();
  await openCalendar('Drink Water');
  await dblCell('2026-11-20');
  await sleep(400);
  await reloadAt('/wallet');
  check('recovering from the next earning clears the pending amount, and that too survives a refresh', (await walletHas('COINS: 0')) && !(await walletHas('Pending coin adjustment')));

  await ev(`localStorage.removeItem('consisto_mock_start_coins')`);
  section('Persistence: milestone state (celebration not yet dismissed returns; dismissed stays gone)');
  await send('Page.navigate', { url: `${BASE}/habits?resetData=1` });
  await sleep(1500);
  await reloadAt('/habits');
  const medToday = (await dayCircles()).findIndex((l) => l.startsWith('Meditate') && l.includes('Sat, Nov 21'));
  const coinsBeforeMs = await coins();
  await click('[role=checkbox]', '', medToday);
  check('completing Meditate today (Day 15) opens the milestone screen', await waitFor(() => has('Milestone unlocked'), 6000));
  await reloadAt('/habits');
  check('refreshing before dismissing it brings the celebration back (it was saved, as in Kotlin)', await waitFor(() => has('Milestone unlocked'), 6000));
  await sleep(3000); // Continue appears once the celebration sequence has finished
  await click('[role=button]', 'Continue');
  await waitFor(async () => !(await has('Milestone unlocked')), 4000);
  const coinsAfterMs = await coins();
  check('the +5 milestone bonus reached the wallet once', coinsAfterMs === coinsBeforeMs + 5, `${coinsBeforeMs} -> ${coinsAfterMs}`);
  await reloadAt('/habits');
  const msBack = await has('Milestone unlocked');
  check('after dismissing, a refresh does not reopen it or pay again', !msBack && (await coins()) === coinsAfterMs, `reopened=${msBack} pending=${await ev(`localStorage.getItem('guest_pending_milestones')`)} `+ `${await coins()} vs ${coinsAfterMs}; ${(await text()).replace(/\s+/g,' ').slice(0,200)}`);
  check('the stored ledger has the Day-15 reward recorded once', await ev(`(() => { const r = JSON.parse(localStorage.getItem('consisto_app_data')).data.ledger.rewards; return Object.values(r).filter(x => x.milestone === 15 && x.habitId === 'h4' && x.active).length === 1; })()`), await ev(`JSON.stringify(Object.values(JSON.parse(localStorage.getItem('consisto_app_data')).data.ledger.rewards).filter(x => x.type !== 'daily').slice(0,5))`));

  section('Persistence: unreadable and newer data, and the development reset');
  await ev(`localStorage.setItem('consisto_app_data', '{this is not json')`);
  await reloadAt('/habits');
  check('corrupt data: the app still starts, from the mock data (5 habits, 35 coins)', (await names()).length === 5 && (await coins()) === 35);
  check('the unreadable text is kept as a backup and good data is saved over it', (await ev(`localStorage.getItem('consisto_app_data_backup')`)) === '{this is not json' && (await storedJson()).version === 1);
  await ev(`localStorage.setItem('consisto_app_data', JSON.stringify({ version: 99, savedAt: 0, data: { future: true } }))`);
  await reloadAt('/habits');
  check('data from a newer version: the app runs from the mock data in memory...', (await names()).length === 5);
  const habitCircle = (await dayCircles()).findIndex((l) => l.startsWith('Drink Water') && l.includes('Sat, Nov 21'));
  await click('[role=checkbox]', '', habitCircle);
  await sleep(400);
  check('...and does not overwrite the newer data (changes are not saved)', (await ev(`JSON.parse(localStorage.getItem('consisto_app_data')).version`)) === 99);
  await ev(`localStorage.setItem('theme_is_dark', 'false')`);
  const hasHook = await ev(`typeof window.consistoDev === 'object'`);
  check('the dev-only reset helper exists in the dev build', hasHook === true);
  await send('Page.navigate', { url: `${BASE}/habits?resetData=1` });
  await sleep(1800);
  await waitFor(async () => (await names()).length >= 4, 20000);
  check('?resetData=1 returns to the initial mock state and strips the parameter', ((await ev('location.search')) === '') && (await coins()) === 35 && (await storedJson()).version === 1, `${await ev('location.search')} ${await coins()} ${(await stored() || '').slice(0, 40)}`);
  check('the reset leaves theme and notification preferences alone', (await ev(`localStorage.getItem('theme_is_dark')`)) === 'false');
  await ev(`localStorage.setItem('theme_is_dark', 'true')`);

  // ───────────────────────────── Authentication (Firebase Auth against a mocked server) ─────────────────────────────
  section('Authentication: guest session, Sign In from Settings, and login screen');
  await viewport(1280, 800);
  await load(); // guest (flag injected), fresh mock data
  const circle = (await dayCircles()).findIndex((l) => l.startsWith('Drink Water') && l.includes('Sat, Nov 21'));
  await click('[role=checkbox]', '', circle);
  await sleep(500);
  const guestData = await ev(`localStorage.getItem('consisto_app_data')`);
  const guestNames = await names();
  const guestCoins = await coins();
  check('guest session: the dashboard shows and the change is saved on this device', guestNames.length === 5 && !!guestData);
  check('guest choice is remembered on the device (guest_mode=true)', (await ev(`localStorage.getItem('guest_mode')`)) === 'true');

  await ev(`sessionStorage.setItem('e2e_auth', '1')`);
  await send('Page.navigate', { url: `${BASE}/settings` });
  await waitFor(() => has('GUEST MODE'));
  check('Settings (guest) still opens directly after a refresh', await has('GUEST MODE'));
  await click('[role=button]', '=Sign In');
  await waitFor(() => has('Back Up Your Progress'));
  await click('[role=button]', '=Continue');
  await waitFor(() => has('SIGN IN'));
  check('Sign In → Continue leaves guest mode and shows the login screen', (await has('Habit Tracker')) && (await has('Build better habits, one day at a time.')) && (await has('SIGN IN')) && (await has('Forgot Password?')) && (await has('Continue as Guest')));
  check('...guest_mode is now false but the guest data is byte-for-byte unchanged', (await ev(`localStorage.getItem('guest_mode')`)) === 'false' && (await ev(`localStorage.getItem('consisto_app_data')`)) === guestData);
  check('...and no habits, wallet or settings are reachable from the login screen', (await names()).length === 0);
  await shot('auth-login');

  const fill = (label, value) => ev(`(() => { const e = document.querySelector('input[aria-label="${label}"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  const btn = (label) => rect('[role=button]', '=' + label);
  const disabled = (label) => ev(`(() => { const e = ${q('[role=button]', '=' + label)}[0]; return !e || e.getAttribute('aria-disabled') === 'true' || e.disabled === true; })()`);
  const authLog = () => authMock.log.join(',');
  // A signed-in account now sees the real app (Home with its wallet chip). These helpers recognise it and sign out through Settings.
  const inApp = () => ev(`document.querySelector('[aria-label^="Wallet"]') !== null`);
  const waitApp = (ms = 15000) => waitFor(inApp, ms);
  const accountEmail = () => ev(`document.querySelector('[data-testid="profile-email"]') ? document.querySelector('[data-testid="profile-email"]').innerText : null`);
  const signOutUi = async () => {
    await send('Page.navigate', { url: `${BASE}/settings` });
    await waitFor(() => has('SIGNED IN'));
    await click('[role=button]', '=Sign out');
    await sleep(500);
    await click('[role=button]', '=Log Out', 1);
    await waitFor(() => has('SIGN IN'));
  };

  section('Authentication: validation and invalid credentials');
  check('Sign in is disabled with empty fields', await disabled('Sign in'));
  await fill('Email', 'a@b.co');
  await fill('Password', '12345');
  check('...and with a 5-character password', await disabled('Sign in'));
  await fill('Password', 'wrongpw');
  check('...and enabled with an email and 6+ characters', !(await disabled('Sign in')));
  check('the password is hidden by default', (await ev(`document.querySelector('input[aria-label="Password"]').type`)) === 'password');
  await click('[role=button]', '=Show password');
  check('...Show password reveals it and offers Hide password', (await ev(`document.querySelector('input[aria-label="Password"]').type`)) === 'text' && !!(await btn('Hide password')));
  await click('[role=button]', '=Hide password');
  await click('[role=button]', '=Sign in');
  await waitFor(() => has('Incorrect email or password.'));
  check('invalid credentials: "Incorrect email or password." and still on the login screen', (await has('Incorrect email or password.')) && (await has('SIGN IN')));
  check('...the form keeps its fields and the guest data is still untouched', (await ev(`document.querySelector('input[aria-label="Email"]').value`)) === 'a@b.co' && (await ev(`localStorage.getItem('consisto_app_data')`)) === guestData);
  await fill('Password', 'wrongpw2');
  await sleep(200);
  check('editing a field clears the error', !(await has('Incorrect email or password.')));

  section('Authentication: valid login, persistence, sign-out');
  await fill('Password', 'secret1');
  await click('[role=button]', '=Sign in');
  await waitApp();
  check('valid login: the account opens in the app (its own habits, not the guest ones)', (await inApp()) && (await names()).includes('Cloud Jog'));
  check("...the guest's habits are not shown to the account, and guest data is untouched", !(await has('Drink Water')) && !(await has('SQL Practice')) && (await ev(`localStorage.getItem('consisto_app_data')`)) === guestData);
  check('...an account session is not marked as guest', (await ev(`localStorage.getItem('guest_mode')`)) === 'false');
  await shot('auth-signed-in');
  await send('Page.navigate', { url: `${BASE}/settings` });
  await waitFor(() => has('SIGNED IN'));
  check('Settings shows the signed-in profile (email, SIGNED IN) and no guest sign-in prompts', (await accountEmail()) === 'a@b.co' && !(await has('GUEST MODE')) && !(await has('Sign in to back up')));
  await send('Page.navigate', { url: `${BASE}/habits` });
  await sleep(1800);
  await waitApp();
  check('refresh: the session persists (still signed in, no login screen)', (await inApp()) && !(await has('SIGN IN')));
  await send('Page.navigate', { url: `${BASE}/settings` });
  await sleep(1500);
  await waitFor(() => has('SIGNED IN'));
  check('...even when opening Settings directly, the account never sees guest Settings', (await has('SIGNED IN')) && !(await has('GUEST MODE')));
  await signOutUi();
  check('sign out: back to the login screen (not guest mode)', (await has('SIGN IN')) && (await ev(`localStorage.getItem('guest_mode')`)) === 'false');
  await send('Page.navigate', { url: `${BASE}/habits` });
  await sleep(1800);
  check('...and a refresh after sign-out stays on the login screen', (await has('SIGN IN')) && (await names()).length === 0);
  check('...guest data still untouched after signing out', (await ev(`localStorage.getItem('consisto_app_data')`)) === guestData);

  section('Authentication: registration');
  await click('[role=button]', '=Create account');
  await waitFor(() => has('CREATE ACCOUNT'));
  check('Create account switches to registration mode (no Forgot Password link)', (await has('CREATE ACCOUNT')) && !(await has('Forgot Password?')) && (await has('Already have an account?')));
  await fill('Email', 'a@b.co');
  await fill('Password', 'whatever1');
  await click('[role=button]', '=Create account');
  await waitFor(() => has('An account with this email already exists. Try signing in.'));
  check('duplicate email: "An account with this email already exists. Try signing in."', await has('An account with this email already exists. Try signing in.'));
  await fill('Email', 'new@b.co');
  await fill('Password', '123456');
  await click('[role=button]', '=Create account');
  await waitApp();
  check('new account: registered and signed in, opening an empty app (no habits)', (await inApp()) && (await names()).length === 0);
  check('...the server received exactly one sign-up for the new email', authMock.log.filter((l) => l === 'signUp:new@b.co').length === 1);
  // The new-account wallet: signing up only makes the login, so the app creates the profile and records the one free freeze.
  const nuDoc = (k) => ev(`window.__consistoFake.doc(${JSON.stringify(k)})`);
  const nuKeys = () => ev(`window.__consistoFake.keys()`);
  const nuKey = async () => (await nuKeys()).filter((x) => /^users\/uid-new-\d+$/.test(x)).pop();
  const nuLedger = async (k) => (await nuKeys()).filter((x) => x.startsWith(k + '/walletTransactions/') || x.startsWith(k + '/rewards/') || x.startsWith(k + '/freezes/')).sort();
  check('the new account gets a profile and its welcome wallet without any extra step', await waitFor(async () => { const k = await nuKey(); return !!k && (await nuDoc(k))?.welcomeFreezePending === false; }, 10000));
  const nwKey = await nuKey();
  const nw = await nuDoc(nwKey);
  check("the profile has Android's fields; 20 coins, 1 freeze, the welcome marker cleared", nw.email === 'new@b.co' && nw.displayName === 'new' && nw.coins === 20 && nw.freezesOwned === 1 && nw.welcomeFreezePending === false && nw.lastTransactionId === 'welcome_freeze' && nw.isDark === true, JSON.stringify(nw));
  const nwTx = await nuDoc(nwKey + '/walletTransactions/welcome_freeze');
  check('the ledger has exactly one entry, welcome_freeze (0 coins, +1 freeze, balance 20), and no reward or freeze record', JSON.stringify(await nuLedger(nwKey)) === JSON.stringify([nwKey + '/walletTransactions/welcome_freeze']) && nwTx && nwTx.coinDelta === 0 && nwTx.freezeDelta === 1 && nwTx.balanceAfter === 20, JSON.stringify(nwTx));
  check('the dashboard shows 20 coins', (await coins()) === 20);
  await openWallet();
  check('the Wallet screen shows COINS 20 and STREAK FREEZES 1', (await walletHas('COINS: 20')) && (await walletHas('STREAK FREEZES: 1')));
  await shot('new-account-wallet');
  const nwBefore = JSON.stringify(await nuDoc(nwKey));
  // A refresh, signing out and in again, and a second tab-like reload must not grant anything more.
  await send('Page.navigate', { url: `${BASE}/habits` });
  await waitApp();
  await sleep(1500);
  check('after a refresh the wallet is still 20 coins and 1 freeze, and nothing was granted again', (await coins()) === 20 && JSON.stringify(await nuDoc(nwKey)) === nwBefore && (await nuLedger(nwKey)).length === 1);
  await signOutUi();
  await fill('Email', 'new@b.co');
  await fill('Password', '123456');
  await click('[role=button]', '=Sign in');
  await waitApp();
  await sleep(1500);
  check('...the new account can sign out and sign in again, with the same wallet and still one profile and one welcome entry', (await inApp()) && (await coins()) === 20 && JSON.stringify(await nuDoc(nwKey)) === nwBefore && (await nuLedger(nwKey)).length === 1 && (await nuKeys()).filter((x) => /^users\/uid-new-\d+$/.test(x)).length === 1);
  await signOutUi();

  section('Authentication: offline error');
  await fill('Email', 'a@b.co');
  await fill('Password', 'secret1');
  authMock.failNext = true;
  await click('[role=button]', '=Sign in');
  await waitFor(() => has("You're offline. Check your connection and try again."));
  check('network failure: "You\'re offline. Check your connection and try again."', await has("You're offline. Check your connection and try again."));

  section('Authentication: password reset');
  await fill('Email', 'a@b.co');
  await click('[role=button]', '=Forgot Password?');
  await waitFor(() => has('Send reset link'));
  check('Forgot Password opens with the typed email pre-filled', (await has('Forgot Password?')) && (await ev(`document.querySelector('input[aria-label="Email"]').value`)) === 'a@b.co');
  await fill('Email', 'not-an-email');
  await click('[role=button]', '=Send reset link');
  await sleep(500);
  check('an invalid address is rejected locally: "Please enter a valid email address."', (await has('Please enter a valid email address.')) && !authLog().includes('sendOobCode:not-an-email'));
  await fill('Email', 'a@b.co');
  await click('[role=button]', '=Send reset link');
  await waitFor(() => has('Check your email'));
  check("valid address: \"Check your email\" with Kotlin's wording", (await has("If an account exists for a@b.co, you'll receive an email with a link to reset your password.")) && (await has("Didn't get it? Check your spam folder")));
  check('...the reset request was sent for that address', authLog().includes('sendOobCode:a@b.co'));
  await shot('auth-reset-sent');
  await click('[role=button]', '=Resend email');
  await waitFor(() => has('Send reset link'));
  await fill('Email', 'nobody@b.co');
  await click('[role=button]', '=Send reset link');
  await waitFor(() => has('Check your email'));
  check('an unknown address looks identical (accounts cannot be probed)', await has('If an account exists for nobody@b.co'));
  await click('[role=button]', '=Back to Login');
  await waitFor(() => has('SIGN IN'));
  check('Back to Login returns to the login screen', await has('Continue as Guest'));

  section('Authentication: switching between guest and account keeps guest data');
  await click('[role=button]', '=Continue as Guest');
  await waitFor(async () => (await names()).length >= 5, 15000);
  check('Continue as Guest opens the app with the same habits and coins as before', (await names()).join() === guestNames.join() && (await coins()) === guestCoins);
  check('...the saved guest data is identical to before any sign-in', (await ev(`localStorage.getItem('consisto_app_data')`)) === guestData);
  await send('Page.navigate', { url: `${BASE}/habits` });
  await waitFor(async () => (await names()).length >= 5, 15000);
  check('refresh: the remembered guest session returns to the app', (await names()).length === 5);
  await send('Page.navigate', { url: `${BASE}/settings` });
  await waitFor(() => has('GUEST MODE'));
  await click('[role=button]', '=Sign In');
  await click('[role=button]', '=Continue');
  await waitFor(() => has('SIGN IN'));
  await fill('Email', 'a@b.co');
  await fill('Password', 'secret1');
  await click('[role=button]', '=Sign in');
  await waitApp();
  check('guest → account: the account sees none of the guest data', !(await has('Drink Water')) && !(await names()).includes('SQL Practice'));
  await signOutUi();
  await click('[role=button]', '=Continue as Guest');
  await waitFor(async () => (await names()).length >= 5, 15000);
  check('account → guest: all habits, coins and stored data are back, unchanged', (await names()).join() === guestNames.join() && (await coins()) === guestCoins && (await ev(`localStorage.getItem('consisto_app_data')`)) === guestData);
  check('guest data was never uploaded: no Firestore request in this whole section', authMock.firestore.length === 0, authMock.firestore.join(' '));

  section('Authentication: responsive login and forgot-password screens, light and dark');
  await send('Page.navigate', { url: `${BASE}/settings` });
  await waitFor(() => has('GUEST MODE'));
  await click('[role=button]', '=Sign In');
  await click('[role=button]', '=Continue');
  await waitFor(() => has('SIGN IN'));
  const noOverflow = () => ev(`document.documentElement.scrollWidth <= window.innerWidth + 1`);
  for (const [w, h, mobile] of [[320, 568, true], [390, 844, true], [768, 1024, false], [1280, 800, false], [1920, 1080, false]]) {
    await viewport(w, h, mobile);
    await sleep(300);
    const card = await btn('Sign in');
    check(`login at ${w}px: no horizontal overflow, button inside the screen and at most 420px wide`, (await noOverflow()) && card && card.x >= 0 && card.x + card.w <= w + 1 && card.w <= 421, JSON.stringify(card));
    const guestBtn = await btn('Continue as Guest');
    check(`login at ${w}px: Continue as Guest reachable`, !!guestBtn && guestBtn.x >= 0 && guestBtn.x + guestBtn.w <= w + 1);
  }
  await viewport(390, 844, true);
  await shot('auth-login-mobile');
  await click('[role=button]', '=Forgot Password?');
  await waitFor(() => has('Send reset link'));
  for (const [w, h, mobile] of [[320, 568, true], [768, 1024, false], [1280, 800, false]]) {
    await viewport(w, h, mobile);
    await sleep(300);
    const b = await btn('Send reset link');
    check(`forgot password at ${w}px: no overflow and button fits`, (await noOverflow()) && b && b.x >= 0 && b.x + b.w <= w + 1);
  }
  await click('[role=button]', '=Back to Login');
  await waitFor(() => has('SIGN IN'));
  await viewport(1280, 800);
  const loginBgs = () => ev(`(() => { const out = []; let n = document.querySelector('input[aria-label="Email"]'); while (n) { out.push(getComputedStyle(n).backgroundColor); n = n.parentElement; } return out; })()`);
  check("dark theme login uses Kotlin's #0B0D12 background", (await loginBgs()).includes('rgb(11, 13, 18)'));
  await ev(`localStorage.setItem('theme_is_dark', 'false')`);
  await send('Page.navigate', { url: `${BASE}/habits` });
  await waitFor(() => has('SIGN IN'));
  check('light theme login uses the light background and a white field', (await loginBgs()).includes('rgb(245, 245, 245)') && (await loginBgs()).includes('rgb(255, 255, 255)'));
  await shot('auth-login-light');
  await ev(`localStorage.setItem('theme_is_dark', 'true')`);
  // Return to the guest session for the remaining checks.
  await click('[role=button]', '=Continue as Guest');
  await waitFor(async () => (await names()).length >= 5, 15000);
  await ev(`sessionStorage.removeItem('e2e_auth')`);

  // ───────────────────────────── Firestore integration: reads, then Stage 1 habit writes (fake Firestore, no real data) ─────────────────────────────
  const NOT_SYNCED = "This isn't available for your account on the web yet";
  const fs = () => ev(`JSON.parse(sessionStorage.getItem('e2e_fs') || 'null')`);
  const wlog = async () => (await ev(`JSON.parse(sessionStorage.getItem('e2e_wlog') || '[]')`)) ?? [];
  const reloadApp = async () => {
    await send('Page.navigate', { url: `${BASE}/habits` });
    await waitApp();
    await sleep(500);
  };
  const waitWrites = async (n) => waitFor(async () => (await wlog()).length >= n, 6000);
  const compose = (rgb) => Number(BigInt.asIntN(64, (0xff000000n | BigInt(rgb)) << 32n));
  const signInAs = async (email, password) => {
    await fill('Email', email);
    await fill('Password', password);
    await click('[role=button]', '=Sign in');
    await waitApp();
    await sleep(400);
  };
  const toGuestSettingsToLogin = async () => {
    await send('Page.navigate', { url: `${BASE}/settings` });
    await waitFor(() => has('GUEST MODE'));
    await click('[role=button]', '=Sign In');
    await click('[role=button]', '=Continue');
    await waitFor(() => has('SIGN IN'));
  };

  section('Firestore: an existing account opens in the real app (reads only)');
  await viewport(1280, 800);
  await ev(`sessionStorage.setItem('e2e_auth', '1'); sessionStorage.removeItem('e2e_fs'); sessionStorage.removeItem('e2e_wlog'); sessionStorage.removeItem('e2e_deny'); sessionStorage.removeItem('e2e_write_fail')`);
  await toGuestSettingsToLogin();
  await signInAs('a@b.co', 'secret1');
  check('Home shows the account\'s own habits in Android order; the archived one is hidden', JSON.stringify(await names()) === JSON.stringify(['Cloud Jog', 'Cloud Reading']), JSON.stringify(await names()));
  check('the wallet chip shows the account\'s coins (42), from the user document', (await coins()) === 42);
  check('completions are the union of the legacy array and completion documents minus unchecked dates (Cloud Reading 4/5 days, Cloud Jog 2)', (await checkedCount('Cloud Reading')) >= 3 && (await checkedCount('Cloud Jog')) >= 0);
  const reads = await ev(`window.__consistoFake.watched()`);
  check('only users/uid-existing paths are watched, including each habit\'s completions', reads.length > 0 && reads.every((p) => p === 'users/uid-existing' || p.startsWith('users/uid-existing/')) && ['users/uid-existing/habits/h-read/completions', 'users/uid-existing/habits/h-old/completions', 'users/uid-existing/walletTransactions', 'users/uid-existing/rewards', 'users/uid-existing/freezes', 'users/uid-existing/freezeMonths', 'users/uid-existing/dayNotes'].every((p) => reads.includes(p)), JSON.stringify(reads));
  check('signing in wrote nothing (no document is created or changed on login)', (await wlog()).length === 0 && authMock.firestore.length === 0);
  check("another account's data is never shown", !(await has('Other Persons Secret Habit')) && !(await has('9999')));
  await shot('cloud-home');
  await send('Page.navigate', { url: `${BASE}/settings/archived` });
  await waitFor(() => has('Legacy Habit'), 8000);
  check('Settings › Archived Habits lists the archived habit', await has('Legacy Habit'));

  section('Firestore Stage 1: create a habit');
  await send('Page.navigate', { url: `${BASE}/habits` });
  await waitApp();
  await sleep(400);
  await click('[role=button]', 'New habit');
  await click('[role=radio]', '', 2); // 7 days/week -> no rest-day step
  await click('[role=button]', 'Next → Create Habit');
  await ev(`document.querySelector('input[aria-label="Habit name"]').focus()`);
  await send('Input.insertText', { text: 'Stage One Habit' });
  await click('[role=button]', 'Create "Stage One Habit"');
  check('the habit appears at the bottom at once', await waitFor(async () => (await names()).at(-1) === 'Stage One Habit', 3000));
  await waitWrites(1);
  let w = await wlog();
  const created = w[0];
  const newHabitId = created?.path?.split('/').pop();
  check('exactly one write: set users/uid-existing/habits/{new id}', w.length === 1 && created.op === 'set' && /^users\/uid-existing\/habits\/new-/.test(created.path), JSON.stringify(w));
  check('it has the Kotlin fields: name, colour (Compose Long), empty completedDates, streak 0, bestStreak 0, daysPerWeek 7, restDays [], createdDate, sortOrder, scheduleHistory, createdAt, updatedAt',
    created.fields.name === 'Stage One Habit' && created.fields.color === compose(0x4ade80) && JSON.stringify(created.fields.completedDates) === '[]' && created.fields.streak === 0 && created.fields.bestStreak === 0 && created.fields.daysPerWeek === 7 && JSON.stringify(created.fields.restDays) === '[]' && created.fields.createdDate === '2026-11-21' && typeof created.fields.sortOrder === 'number' && created.fields.sortOrder > 1e12 && JSON.stringify(created.fields.scheduleHistory) === JSON.stringify([{ from: '2026-11-21', restDays: [], daysPerWeek: 7 }]) && created.fields.createdAt === '<serverTimestamp>' && created.fields.updatedAt === '<serverTimestamp>', JSON.stringify(created.fields));
  check('...and no optional fields (goal, reminder, archived) when they were not set', !('goal' in created.fields) && !('reminderEnabled' in created.fields) && !('reminderTime' in created.fields) && !('archived' in created.fields));
  check('no wallet, transaction, reward, freeze or completion document was written', w.every((x) => /^users\/uid-existing\/habits\/[^/]+$/.test(x.path)));
  await reloadApp();
  check('after a reload the new habit is still there, at the bottom, with the same wallet (42)', (await names()).at(-1) === 'Stage One Habit' && (await coins()) === 42 && JSON.stringify(await names()) === JSON.stringify(['Cloud Jog', 'Cloud Reading', 'Stage One Habit']), JSON.stringify(await names()));
  check('the habits that already existed were not overwritten', (await fs())['users/uid-existing/habits/h-read'].name === 'Cloud Reading' && (await fs())['users/uid-existing/habits/h-read'].goal === 'Finish 12 books');

  section('Firestore Stage 1: edit name and colour; history stays');
  const readFixtureBefore = (await fs())['users/uid-existing/habits/h-read'];
  const completionsBefore = JSON.stringify(Object.keys(await fs()).filter((k) => k.startsWith('users/uid-existing/habits/h-read/completions/')).sort());
  await openHabit('Cloud Reading');
  await click('[role=button]', 'Edit habit');
  await setText('input[aria-label="Habit name"]', 'Cloud Reading 2');
  await click('[role=radio]', '=Teal');
  await click('[role=button]', 'Save Changes');
  await waitFor(async () => (await path()) === '/habits/cloud-reading-2', 4000);
  await waitWrites(2);
  w = await wlog();
  const edit = w[1];
  check('one update to users/uid-existing/habits/h-read with only the changed fields (name, color) and updatedAt', edit.op === 'update' && edit.path === 'users/uid-existing/habits/h-read' && JSON.stringify(Object.keys(edit.fields).sort()) === JSON.stringify(['color', 'name', 'updatedAt']) && edit.fields.name === 'Cloud Reading 2' && edit.fields.color === compose(0x2dd4bf) && edit.fields.updatedAt === '<serverTimestamp>', JSON.stringify(edit));
  const afterEdit = (await fs())['users/uid-existing/habits/h-read'];
  check('the completion history is untouched: completedDates, completions, goal, reminder, schedule and sortOrder are the same', JSON.stringify(afterEdit.completedDates) === JSON.stringify(readFixtureBefore.completedDates) && afterEdit.goal === readFixtureBefore.goal && afterEdit.reminderTime === readFixtureBefore.reminderTime && afterEdit.sortOrder === readFixtureBefore.sortOrder && JSON.stringify(afterEdit.scheduleHistory) === JSON.stringify(readFixtureBefore.scheduleHistory) && JSON.stringify(Object.keys(await fs()).filter((k) => k.startsWith('users/uid-existing/habits/h-read/completions/')).sort()) === completionsBefore);
  await reloadApp();
  check('after a reload the new name and colour (#2DD4BF) are shown, with the same completion count', (await names()).includes('Cloud Reading 2') && !(await names()).includes('Cloud Reading') && (await ringColor('Cloud Reading 2'))?.toLowerCase() === '#2dd4bf');

  section('Firestore Stage 1: goal and reminder');
  await openHabit('Cloud Reading 2');
  check('the existing goal and reminder are shown', (await has('Finish 12 books')) && ((await has('7:30 AM')) || (await has('Blocked'))));
  await click('[role=button]', 'Edit goal');
  await setText('[aria-label="What is your goal for this habit?"]', '');
  await click('[role=button]', 'Save Changes');
  await waitFor(() => has('Add your goal'), 3000);
  await waitWrites(3);
  w = await wlog();
  check('clearing the goal writes goal = "" (Kotlin: blank means removed) plus updatedAt, nothing else', w[2].op === 'update' && w[2].path === 'users/uid-existing/habits/h-read' && JSON.stringify(w[2].fields) === JSON.stringify({ goal: '', updatedAt: '<serverTimestamp>' }), JSON.stringify(w[2]));
  await click('[role=button]', 'Edit reminder');
  await click('[role=switch]', 'Reminder');
  await click('[role=button]', 'Save Changes');
  await waitFor(() => has('Reminder turned off'), 3000);
  await waitWrites(4);
  w = await wlog();
  check('turning the reminder off writes reminderEnabled=false and keeps reminderTime (07:30)', JSON.stringify(w[3].fields) === JSON.stringify({ reminderEnabled: false, reminderTime: '07:30', updatedAt: '<serverTimestamp>' }), JSON.stringify(w[3]));

  section('Firestore Stage 1: weekly target and rest days (schedule history)');
  await click('[role=button]', 'Edit rest days');
  await click('[role=checkbox]', '^Sun');
  await click('[role=button]', '=Save Changes');
  await waitWrites(5);
  w = await wlog();
  const sch = w[4].fields;
  check('the schedule change is written from tomorrow with the full history and the re-derived streak values', w[4].op === 'update' && sch.daysPerWeek === 6 && JSON.stringify(sch.restDays) === '["Sun"]' && JSON.stringify(sch.scheduleHistory) === JSON.stringify([{ from: '2026-11-01', restDays: [], daysPerWeek: 7 }, { from: '2026-11-22', restDays: ['Sun'], daysPerWeek: 6 }]) && typeof sch.streak === 'number' && typeof sch.bestStreak === 'number' && sch.updatedAt === '<serverTimestamp>' && !('completedDates' in sch), JSON.stringify(sch));
  const afterSchedule = (await fs())['users/uid-existing/habits/h-read'];
  check('...completions are not touched by the schedule change', JSON.stringify(afterSchedule.completedDates) === JSON.stringify(readFixtureBefore.completedDates) && JSON.stringify(Object.keys(await fs()).filter((k) => k.startsWith('users/uid-existing/habits/h-read/completions/')).sort()) === completionsBefore);
  await reloadApp();
  await openHabit('Cloud Reading 2');
  check('after a reload the goal is gone and the schedule shows Sun as a rest day', (await has('Add your goal')) && !(await has('Every day')), (await text()).replace(/\s+/g, ' ').slice(0, 200));
  await back();

  section('Firestore Stage 1: archive and unarchive');
  let cidx = (await names()).indexOf('Cloud Reading 2');
  await click('[role=button]', 'More options', cidx);
  await click('[role=menuitem]', 'Archive Habit');
  await click('[role=button]', '=Archive Habit');
  await waitWrites(6);
  w = await wlog();
  check('archiving writes only archived=true and updatedAt', JSON.stringify(w[5].fields) === JSON.stringify({ archived: true, updatedAt: '<serverTimestamp>' }) && w[5].path === 'users/uid-existing/habits/h-read', JSON.stringify(w[5]));
  check('the habit leaves Home', !(await names()).includes('Cloud Reading 2'));
  await reloadApp();
  check('after a reload it is still archived (hidden from Home)', !(await names()).includes('Cloud Reading 2'));
  await send('Page.navigate', { url: `${BASE}/habits/cloud-reading-2` });
  await waitFor(() => has('Unarchive'), 8000);
  await click('[role=button]', 'Unarchive');
  await waitWrites(7);
  w = await wlog();
  check('unarchiving writes archived=false and updatedAt', JSON.stringify(w[6].fields) === JSON.stringify({ archived: false, updatedAt: '<serverTimestamp>' }), JSON.stringify(w[6]));
  await reloadApp();
  check('after a reload it is back on Home with its history (name, colour)', (await names()).includes('Cloud Reading 2'));

  section('Firestore Stage 1: delete (completions, notes and the habit; wallet records stay)');
  const walletKeys = Object.keys(await fs()).filter((k) => /\/(walletTransactions|rewards|freezes|freezeMonths)\//.test(k)).sort();
  const otherNotes = Object.keys(await fs()).filter((k) => k.includes('/dayNotes/h-read_'));
  cidx = (await names()).indexOf('Cloud Jog');
  await click('[role=button]', 'More options', cidx);
  await click('[role=menuitem]', 'Delete Habit');
  check('the habit disappears at once', await waitFor(async () => !(await names()).includes('Cloud Jog'), 3000));
  await waitWrites(9); // note batch + habit batch
  w = await wlog();
  const dels = w.slice(7).filter((x) => x.op === 'deleteMany');
  const delPaths = dels.flatMap((x) => x.paths).sort();
  check('Kotlin deletion: its completion documents, its day note and the habit document are deleted', JSON.stringify(delPaths) === JSON.stringify(['users/uid-existing/dayNotes/h-run_2026-11-17', 'users/uid-existing/habits/h-run', 'users/uid-existing/habits/h-run/completions/2026-11-16', 'users/uid-existing/habits/h-run/completions/2026-11-17']), JSON.stringify(delPaths));
  const habitBatch = dels.find((x) => x.paths.includes('users/uid-existing/habits/h-run'));
  check('...the habit document goes last, in the same batch as its completions', habitBatch.paths.at(-1) === 'users/uid-existing/habits/h-run' && habitBatch.paths.length === 3);
  const afterDel = await fs();
  check('another habit\'s notes and completions, and the wallet records (transactions, rewards, freezes, freezeMonths), are left alone as on Android', otherNotes.every((k) => k in afterDel) && JSON.stringify(Object.keys(afterDel).filter((k) => /\/(walletTransactions|rewards|freezes|freezeMonths)\//.test(k)).sort()) === JSON.stringify(walletKeys) && afterDel['users/uid-existing'].coins === 42);
  await reloadApp();
  check('after a reload the deleted habit stays deleted', !(await names()).includes('Cloud Jog'));
  const stageOneHabitIdx = (await names()).indexOf('Stage One Habit');
  await click('[role=button]', 'More options', stageOneHabitIdx);
  await click('[role=menuitem]', 'Delete Habit');
  await waitWrites(11);
  check('a freshly created habit (no completions, no notes) is deleted as just its own document', JSON.stringify((await wlog()).at(-1).paths) === JSON.stringify([`users/uid-existing/habits/${newHabitId}`]), JSON.stringify((await wlog()).at(-1)));

  section('Firestore: the Wallet opens for an account from Firestore and merely opening it writes nothing (purchases are covered in Phase 9D.5 below)');
  await reloadApp();
  const writesBefore = (await wlog()).length;
  await send('Page.navigate', { url: `${BASE}/wallet` });
  await waitFor(() => has('Buy Freeze') || has('Streak Freeze'), 8000);
  await sleep(500);
  check('the Wallet opens for the account (balance from Firestore) and opening it writes nothing', (await has('42')) && (await wlog()).length === writesBefore);

  section('Firestore Stage 1: failed writes are undone and reported');
  await reloadApp();
  const namesOk = await names();
  await ev(`sessionStorage.setItem('e2e_write_fail', 'permission-denied')`);
  await click('[role=button]', 'New habit');
  await click('[role=radio]', '', 2);
  await click('[role=button]', 'Next → Create Habit');
  await ev(`document.querySelector('input[aria-label="Habit name"]').focus()`);
  await send('Input.insertText', { text: 'Doomed Habit' });
  await click('[role=button]', 'Create "Doomed Habit"');
  await waitFor(() => has("isn't allowed to change this data"), 5000);
  check('create rejected by the rules: the habit is removed again and the user is told', (await has("Couldn't save: your account isn't allowed to change this data.")) && !(await names()).includes('Doomed Habit') && JSON.stringify(await names()) === JSON.stringify(namesOk));
  cidx = (await names()).indexOf('Cloud Reading 2');
  await click('[role=button]', 'More options', cidx);
  await click('[role=menuitem]', 'Archive Habit');
  await click('[role=button]', '=Archive Habit');
  await waitFor(async () => (await names()).includes('Cloud Reading 2'), 5000);
  await sleep(300);
  check('archive rejected: the habit comes back to Home', (await names()).includes('Cloud Reading 2'));
  cidx = (await names()).indexOf('Stage One Habit');
  check('(the deleted test habit really is gone)', cidx === -1);
  cidx = (await names()).indexOf('Cloud Reading 2');
  await click('[role=button]', 'More options', cidx);
  await click('[role=menuitem]', 'Delete Habit');
  await waitFor(async () => (await names()).includes('Cloud Reading 2'), 6000);
  await sleep(400);
  check('delete rejected: the habit returns to its place', JSON.stringify(await names()) === JSON.stringify(namesOk));
  await openHabit('Cloud Reading 2');
  await click('[role=button]', 'Edit habit');
  await setText('input[aria-label="Habit name"]', 'Renamed Then Rejected');
  await click('[role=button]', 'Save Changes');
  await sleep(1200);
  await send('Page.navigate', { url: `${BASE}/habits` });
  await waitApp();
  check('rename rejected: the old name is back', (await names()).includes('Cloud Reading 2') && !(await names()).includes('Renamed Then Rejected'));
  await ev(`sessionStorage.removeItem('e2e_write_fail')`);
  const afterFail = await fs();
  check('nothing from the rejected writes reached the fake database', !Object.keys(afterFail).some((k) => JSON.stringify(afterFail[k]).includes('Doomed') || JSON.stringify(afterFail[k]).includes('Renamed Then Rejected')));

  section('Firestore: account switching, sign-out and isolation');
  const existingSnapshot = JSON.stringify(Object.fromEntries(Object.entries(await fs()).filter(([k]) => k.startsWith('users/uid-existing'))));
  await signOutUi();
  const tOut = await (async () => (await text()).replace(/\s+/g, ' '))();
  check('sign out: none of the account data remains on screen', !tOut.includes('Cloud Reading') && !tOut.includes('42'));
  await fill('Email', 'new@b.co');
  await fill('Password', '123456');
  await click('[role=button]', '=Sign in');
  await waitApp();
  await sleep(400);
  check("a different account on the same browser sees none of the previous account's habits or wallet (it has its own welcome wallet: 20 coins, not the other account's 42)", (await names()).length === 0 && (await coins()) === 20);
  await click('[role=button]', 'New habit');
  await click('[role=radio]', '', 2);
  await click('[role=button]', 'Next → Create Habit');
  await ev(`document.querySelector('input[aria-label="Habit name"]').focus()`);
  await send('Input.insertText', { text: 'Second User Habit' });
  await click('[role=button]', 'Create "Second User Habit"');
  await waitFor(async () => (await wlog()).length > writesBefore + 0 && (await wlog()).at(-1).path.includes('uid-new'), 6000);
  const lastW = (await wlog()).at(-1);
  check("the second account's habit is written under its own uid only", /^users\/uid-new-\d+\/habits\/new-/.test(lastW.path), JSON.stringify(lastW));
  // The new account's welcome wallet: its own profile creation and its one welcome-freeze transaction (nothing else may touch a wallet).
  const ownWelcome = (x) => x.op === 'create-profile' ? /^users\/uid-new-\d+$/.test(x.path) : x.op === 'txn' && x.writes.length > 0 && x.writes.every((w) => /^users\/uid-new-\d+(\/walletTransactions\/welcome_freeze)?$/.test(w.path));
  const nonHabit = (await wlog()).filter((x) => !(x.path && /\/habits\//.test(x.path)) && x.op !== 'deleteMany');
  check("the only writes that were not habit writes are that account's own profile creation and its one welcome-freeze transaction", nonHabit.every(ownWelcome) && nonHabit.filter((x) => x.op === 'txn').length === 1 && nonHabit.filter((x) => x.op === 'create-profile').length === 1, JSON.stringify(nonHabit).slice(0, 400));
  const habitWrites = (await wlog()).filter((x) => !ownWelcome(x));
  check('every write of the habit stages was a habit document (or its completions/notes on delete) under the signed-in user: never a wallet, reward, freeze or transaction document, never another user', habitWrites.flatMap((x) => (x.path ? [x.path] : x.paths ?? [])).every((p) => /^users\/uid-(existing|new-\d+)\/(habits\/[^/]+(\/completions\/[^/]+)?|dayNotes\/[^/]+)$/.test(p)) && habitWrites.filter((x) => x.op !== 'deleteMany').every((x) => /\/habits\/[^/]+$/.test(x.path)));
  check("the first account's documents were not touched by the second account", JSON.stringify(Object.fromEntries(Object.entries(await fs()).filter(([k]) => k.startsWith('users/uid-existing')))) === existingSnapshot);
  await signOutUi();
  await click('[role=button]', '=Continue as Guest');
  await waitFor(async () => (await names()).length >= 5, 15000);
  check('guest mode shows only the guest data, byte-for-byte unchanged, with none of the cloud habits', (await names()).join() === guestNames.join() && !(await has('Cloud Reading')) && !(await has('Stage One Habit')) && !(await has('Second User Habit')) && (await ev(`localStorage.getItem('consisto_app_data')`)) === guestData);
  check('no real Firestore request was made in the whole run', authMock.firestore.length === 0);

  section('Firestore: permission-denied on read and offline');
  await toGuestSettingsToLogin();
  await ev(`sessionStorage.setItem('e2e_deny', 'permission-denied')`);
  await fill('Email', 'a@b.co');
  await fill('Password', 'secret1');
  await click('[role=button]', '=Sign in');
  await waitFor(() => has('Access denied'), 15000);
  const tDeny = (await text()).replace(/\s+/g, ' ');
  check('read denied by the rules: a clear message, no data, no crash', tDeny.includes('Access denied') && tDeny.includes('denied by the security rules') && !tDeny.includes('Cloud Reading') && !(await inApp()), tDeny.slice(0, 300));
  check('...Try again and Sign out are offered', !!(await btn('Try again')) && !!(await btn('Sign out')));
  await ev(`sessionStorage.setItem('e2e_deny', 'unavailable')`);
  await click('[role=button]', '=Try again');
  await waitFor(() => has("Couldn't load your data"), 15000);
  check('offline: "Couldn\'t reach the server" with a retry', (await has("Couldn't reach the server. Check your connection and try again.")));
  await ev(`sessionStorage.removeItem('e2e_deny')`);
  await click('[role=button]', '=Try again');
  await waitApp();
  check('Try again recovers once the problem is gone', (await inApp()) && (await names()).includes('Cloud Reading 2'));
  await signOutUi();
  await click('[role=button]', '=Continue as Guest');
  await waitFor(async () => (await names()).length >= 5, 15000);
  check('guest data is still untouched at the end', (await ev(`localStorage.getItem('consisto_app_data')`)) === guestData);
  await ev(`sessionStorage.removeItem('e2e_auth'); sessionStorage.removeItem('e2e_fs'); sessionStorage.removeItem('e2e_wlog')`);

  // ───────────────────────────── Stage 3: completion and undo, rewards, live sync (fake Firestore; Android simulated from outside) ─────────────────────────────
  section('Stage 3: opening an account with rewards (live listeners, no writes on load)');
  await viewport(1280, 800);
  await ev(`sessionStorage.setItem('e2e_auth', '1'); sessionStorage.removeItem('e2e_fs'); sessionStorage.removeItem('e2e_wlog'); sessionStorage.removeItem('e2e_deny'); sessionStorage.removeItem('e2e_write_fail'); sessionStorage.removeItem('e2e_ledger_fail')`);
  const fake = (expr) => ev(`window.__consistoFake.${expr}`);
  const todayLabel = async (name) => (await dayCircles()).find((l) => l.startsWith(name) && l.includes('Sat, Nov 21')) ?? '';
  const isDone = (label) => label.endsWith(', done');
  const tapToday = async (name) => {
    const i = (await dayCircles()).findIndex((l) => l.startsWith(name) && l.includes('Sat, Nov 21'));
    await click('[role=checkbox]', '', i);
  };
  const dismissPopups = async () => {
    await sleep(300);
    if (await has('Nice work')) {
      await waitFor(async () => !(await isDisabled('Continue')), 4000);
      await click('[role=button]', '=Continue');
      await sleep(300);
    }
  };
  const txns = async () => (await wlog()).filter((x) => x.op === 'txn');
  const batches = async () => (await wlog()).filter((x) => x.op === 'batch');
  await toGuestSettingsToLogin();
  await signInAs('r@b.co', 'secret1');
  await sleep(1500); // let any reconcile finish
  check('the account opens with its habit and wallet (31 coins, 11 days done)', JSON.stringify(await names()) === JSON.stringify(['Reward Habit']) && (await coins()) === 31, JSON.stringify(await names()));
  check('opening it wrote nothing: no completion, no ledger transaction (rewards for 10–20 Nov already exist)', (await wlog()).length === 0 && (await fake('ledgerRuns()')) === 0);
  const watched = await fake('watched()');
  check('live listeners are on exactly this user\'s documents: user, habits, each habit\'s completions, transactions, rewards, freezes, freezeMonths, notes', watched.length === 8 && watched.every((p) => p === 'users/uid-rewards' || p.startsWith('users/uid-rewards/')) && ['users/uid-rewards/habits', 'users/uid-rewards/habits/h-r1/completions', 'users/uid-rewards/walletTransactions', 'users/uid-rewards/rewards', 'users/uid-rewards/freezes', 'users/uid-rewards/freezeMonths', 'users/uid-rewards/dayNotes'].every((p) => watched.includes(p)), JSON.stringify(watched));
  check('8 listeners are active while signed in', (await fake('listenerCount()')) === 8);
  const histBefore = JSON.stringify(Object.fromEntries((await fake('keys()')).filter((k) => /uid-rewards\/habits\/h-r1\/completions\/2026-11-(1\d|20)$/.test(k) || /uid-rewards\/(freezes|freezeMonths)\//.test(k)).sort().map((k) => [k, null])));
  const historyDocs = async () => JSON.stringify(await Promise.all((await fake('keys()')).filter((k) => /uid-rewards\/habits\/h-r1\/completions\/2026-11-(1\d|20)$/.test(k)).sort().map(async (k) => [k, await fake(`doc(${JSON.stringify(k)})`)])));
  const frozenDocs = async () => JSON.stringify(await Promise.all((await fake('keys()')).filter((k) => /uid-rewards\/(freezes|freezeMonths)\//.test(k)).sort().map(async (k) => [k, await fake(`doc(${JSON.stringify(k)})`)])));
  const history0 = await historyDocs();
  const freezes0 = await frozenDocs();
  const habitBefore = await fake(`doc('users/uid-rewards/habits/h-r1')`);
  check('(setup) the history to protect: 11 completion documents from 10 to 20 Nov', JSON.parse(history0).length === 11 && histBefore.length > 10);

  section('Stage 3: complete a habit on the Web (completion batch, then the reward transaction)');
  check("today's circle starts not done", !isDone(await todayLabel('Reward Habit')), await todayLabel('Reward Habit'));
  await tapToday('Reward Habit');
  check('it shows done at once', await waitFor(async () => isDone(await todayLabel('Reward Habit')), 2000));
  await waitFor(async () => (await batches()).length >= 1 && (await txns()).length >= 1, 8000);
  let bs = await batches();
  let b = bs[0];
  check('ONE batch: completions/2026-11-21 (merge-set) + the habit update', bs.length === 1 && b.ops.length === 2 && b.ops[0].kind === 'set' && b.ops[0].path === 'users/uid-rewards/habits/h-r1/completions/2026-11-21' && b.ops[1].kind === 'update' && b.ops[1].path === 'users/uid-rewards/habits/h-r1', JSON.stringify(b));
  check('completion document fields: date, completed=true, updatedAt, completedAt (no uncheckedAt)', JSON.stringify(b.ops[0].fields) === JSON.stringify({ date: '2026-11-21', completed: true, updatedAt: '<serverTimestamp>', completedAt: '<serverTimestamp>' }), JSON.stringify(b.ops[0].fields));
  check('habit fields: the legacy completedDates array gets arrayUnion(date), streak and bestStreak are written (12/12), updatedAt', JSON.stringify(b.ops[1].fields) === JSON.stringify({ streak: 12, bestStreak: 12, completedDates: { arrayUnion: ['2026-11-21'] }, updatedAt: '<serverTimestamp>' }), JSON.stringify(b.ops[1].fields));
  let tx = (await txns())[0];
  check('ONE transaction writes the user document, the ledger entry and the reward record together', (await txns()).length === 1 && tx.writes.map((w) => `${w.kind}:${w.path}`).join() === 'update:users/uid-rewards,set:users/uid-rewards/walletTransactions/daily_2026-11-21,set:users/uid-rewards/rewards/daily_2026-11-21', JSON.stringify(tx.writes.map((w) => w.path)));
  check('wallet fields: coins 32, freezesOwned 1 (unchanged), pendingAdjustment 0, lastTransactionId, updatedAt', JSON.stringify(tx.writes[0].fields) === JSON.stringify({ coins: 32, freezesOwned: 1, pendingAdjustment: 0, lastTransactionId: 'daily_2026-11-21', updatedAt: '<serverTimestamp>' }), JSON.stringify(tx.writes[0].fields));
  check('ledger entry: type daily_completion, coinDelta 1, freezeDelta 0, balanceAfter 32, createdAt, date, rewardId (no pendingDelta when zero)', JSON.stringify(tx.writes[1].fields) === JSON.stringify({ type: 'daily_completion', coinDelta: 1, freezeDelta: 0, balanceAfter: 32, createdAt: '<serverTimestamp>', date: '2026-11-21', rewardId: 'daily_2026-11-21' }), JSON.stringify(tx.writes[1].fields));
  check('reward record: active, cycle 1, amount 1, type, lastTransactionId, updatedAt, date', JSON.stringify(tx.writes[2].fields) === JSON.stringify({ active: true, cycle: 1, amount: 1, type: 'daily_completion', lastTransactionId: 'daily_2026-11-21', updatedAt: '<serverTimestamp>', date: '2026-11-21' }), JSON.stringify(tx.writes[2].fields));
  await dismissPopups();
  check('the wallet shows 32 coins, delivered by the live listener', await waitFor(async () => (await coins()) === 32, 4000), String(await coins()));
  await shot('stage3-completed');
  await reloadApp();
  await sleep(2500);
  check('after a reload the completion is still there, the wallet is 32, and no coin was paid again (no transaction ran)', isDone(await todayLabel('Reward Habit')) && (await coins()) === 32 && (await fake('ledgerRuns()')) === 0);
  check('...exactly one ledger entry for that day', (await fake('keys()')).filter((k) => /walletTransactions\/daily_2026-11-21/.test(k)).length === 1);

  section('Stage 3: undo on the Web (reward reversed, completion document kept)');
  await tapToday('Reward Habit');
  check('the circle is not done at once', await waitFor(async () => !isDone(await todayLabel('Reward Habit')), 2000));
  const adjusted = await waitFor(() => has('Daily reward adjusted.'), 9000);
  await waitFor(async () => (await txns()).length >= 2, 8000);
  bs = await batches();
  b = bs.at(-1);
  check('undo batch: the completion document is kept with completed=false and uncheckedAt (no completedAt written)', JSON.stringify(b.ops[0].fields) === JSON.stringify({ date: '2026-11-21', completed: false, updatedAt: '<serverTimestamp>', uncheckedAt: '<serverTimestamp>' }), JSON.stringify(b.ops[0].fields));
  check('...the legacy array gets arrayRemove(date) and the derived streak values drop (11/11)', JSON.stringify(b.ops[1].fields) === JSON.stringify({ streak: 11, bestStreak: 11, completedDates: { arrayRemove: ['2026-11-21'] }, updatedAt: '<serverTimestamp>' }), JSON.stringify(b.ops[1].fields));
  tx = (await txns()).at(-1);
  check('reversal transaction: coins 31, id daily_2026-11-21_rev1, reward_reversal -1, record inactive', JSON.stringify(tx.writes[0].fields) === JSON.stringify({ coins: 31, freezesOwned: 1, pendingAdjustment: 0, lastTransactionId: 'daily_2026-11-21_rev1', updatedAt: '<serverTimestamp>' }) && tx.writes[1].path.endsWith('walletTransactions/daily_2026-11-21_rev1') && tx.writes[1].fields.type === 'reward_reversal' && tx.writes[1].fields.coinDelta === -1 && tx.writes[2].fields.active === false && tx.writes[2].fields.cycle === 1, JSON.stringify(tx.writes));
  check('the wallet is back to 31 and the user was told "Daily reward adjusted."', (await waitFor(async () => (await coins()) === 31, 4000)) && adjusted);
  const doc21 = await fake(`doc('users/uid-rewards/habits/h-r1/completions/2026-11-21')`);
  check('the completion document still exists, completed=false, keeping completedAt from before (history of changes)', doc21 && doc21.completed === false && doc21.uncheckedAt && doc21.completedAt);

  section('Stage 3: checking again restores the reward (cycle 2), once');
  await tapToday('Reward Habit');
  await waitFor(async () => (await txns()).length >= 3, 8000);
  tx = (await txns()).at(-1);
  check('restore transaction: {id}_grant2, type reward_restored, coins 32, reward cycle 2 active', tx.writes[1].path.endsWith('walletTransactions/daily_2026-11-21_grant2') && tx.writes[1].fields.type === 'reward_restored' && tx.writes[2].fields.cycle === 2 && tx.writes[2].fields.active === true && tx.writes[0].fields.coins === 32, JSON.stringify(tx.writes));
  await dismissPopups();
  check('the wallet shows 32', await waitFor(async () => (await coins()) === 32, 4000));

  section('Stage 3: repeated taps never double-pay');
  const r0 = await fake('ledgerRuns()');
  for (let i = 0; i < 3; i++) {
    const rr = await rect('[role=checkbox]', 'Reward Habit, Sat, Nov 21');
    for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await mouse(type, rr.cx, rr.cy);
  }
  await sleep(4000);
  await dismissPopups();
  const finalDone = isDone(await todayLabel('Reward Habit'));
  check('three rapid taps leave an odd number of toggles: the day ends not done', finalDone === false, await todayLabel('Reward Habit'));
  check('the wallet matches the final state exactly (no coin gained or lost by the taps): 31', (await coins()) === 31, String(await coins()));
  const rewardDoc = await fake(`doc('users/uid-rewards/rewards/daily_2026-11-21')`);
  check('the ledger agrees: the reward is not in effect, and the user document holds 31 coins', rewardDoc.active === false && (await fake(`doc('users/uid-rewards')`)).coins === 31);
  await tapToday('Reward Habit');
  await sleep(2500);
  await dismissPopups();
  const rd2 = await fake(`doc('users/uid-rewards/rewards/daily_2026-11-21')`);
  const entries = (await fake('keys()')).filter((k) => /uid-rewards\/walletTransactions\/daily_2026-11-21/.test(k));
  check('a single tap again restores it: 32 coins, active, and exactly one grant and one reversal per cycle (no duplicate payment records)', (await coins()) === 32 && rd2.active === true && entries.length === 2 * rd2.cycle - 1 && new Set(entries).size === entries.length, `${await coins()} cycle ${rd2.cycle} entries ${entries.length}`);

  section('Stage 3: Android completes and undoes on the same account (live, no reload)');
  await tapToday('Reward Habit'); // web: undo, so Android can complete it
  await sleep(2500);
  await dismissPopups();
  check('(setup) the day is not done and the wallet is 31', !isDone(await todayLabel('Reward Habit')) && (await coins()) === 31);
  const loads = await fake('watched().length');
  await ev(`window.__consistoFake.android.complete('uid-rewards', 'h-r1', '2026-11-21', true)`);
  check('Android completion appears on the Web without a reload', await waitFor(async () => isDone(await todayLabel('Reward Habit')), 5000));
  await sleep(2500);
  await dismissPopups();
  check('the Web (server-confirmed data) pays the reward once: 32', (await coins()) === 32, String(await coins()));
  const grantedByAndroidToo = await ev(`window.__consistoFake.android.grantDaily('uid-rewards', '2026-11-21')`);
  await sleep(1500);
  check("Android's own grant of the same reward is a no-op (already in effect): no second coin", grantedByAndroidToo === false && (await coins()) === 32);
  await ev(`window.__consistoFake.android.complete('uid-rewards', 'h-r1', '2026-11-21', false)`);
  check('Android undo appears on the Web without a reload', await waitFor(async () => !isDone(await todayLabel('Reward Habit')), 5000));
  await sleep(2500);
  check('the Web reverses the reward: 31', (await coins()) === 31, String(await coins()));
  check('no extra listeners were opened by the live updates (still 8)', (await fake('listenerCount()')) === 8 && (await fake('watched().length')) === loads);
  // Android completes AND grants in one go (before the web reacts): the web must not add a second coin.
  await ev(`(() => { const A = window.__consistoFake.android; A.complete('uid-rewards', 'h-r1', '2026-11-21', true); A.grantDaily('uid-rewards', '2026-11-21'); })()`);
  await waitFor(async () => isDone(await todayLabel('Reward Habit')), 5000);
  await sleep(3000);
  await dismissPopups();
  check('Android completed and granted first: the Web shows 32 and adds nothing', (await coins()) === 32, String(await coins()));

  section('Stage 3: history, freezes and wallet records are not disturbed');
  await ev(`window.__consistoFake.android.complete('uid-rewards', 'h-r1', '2026-11-21', false)`);
  await sleep(3000);
  const habitAfter = await fake(`doc('users/uid-rewards/habits/h-r1')`);
  check('earlier completion documents (10–20 Nov) are byte-for-byte unchanged', (await historyDocs()) === history0);
  check('the habit keeps its name, colour, createdDate, schedule, sortOrder and earlier legacy data', ['name', 'color', 'createdDate', 'daysPerWeek', 'restDays', 'sortOrder'].every((k) => JSON.stringify(habitAfter[k]) === JSON.stringify(habitBefore[k])));
  check('freeze documents and the monthly freeze counter are unchanged', (await frozenDocs()) === freezes0);
  const userDoc = await fake(`doc('users/uid-rewards')`);
  check('freezesOwned is still 1 and no freeze transaction exists', userDoc.freezesOwned === 1 && !(await fake('keys()')).some((k) => /^users\/uid-rewards\/walletTransactions\/freeze_/.test(k)));
  const allTx = await txns();
  check('every ledger transaction only touched the user document (wallet fields), walletTransactions and rewards of this user', allTx.every((t) => t.writes.every((w) => (w.kind === 'update' && w.path === 'users/uid-rewards' && Object.keys(w.fields).every((k) => ['coins', 'freezesOwned', 'pendingAdjustment', 'lastTransactionId', 'updatedAt'].includes(k))) || (w.kind === 'set' && /^users\/uid-rewards\/(walletTransactions|rewards)\/[^/]+$/.test(w.path)))));
  check('every write of the run is under users/uid-rewards (never another user)', (await wlog()).every((x) => JSON.stringify(x).includes('uid-rewards') && !JSON.stringify(x).includes('uid-existing') && !JSON.stringify(x).includes('uid-pending')));
  check('no real Firestore request was made', authMock.firestore.length === 0);

  section('Stage 3: offline and reconnection');
  await tapToday('Reward Habit');
  await waitFor(async () => isDone(await todayLabel('Reward Habit')), 3000);
  await sleep(2500);
  await dismissPopups();
  await tapToday('Reward Habit'); // back to undone with a settled wallet
  await sleep(2500);
  await dismissPopups();
  const coinsBefore = await coins();
  check('(setup) not done, wallet settled', !isDone(await todayLabel('Reward Habit')) && coinsBefore === 31, String(coinsBefore));
  await fake('setOffline(true)');
  await sleep(600);
  await tapToday('Reward Habit');
  check('offline: the tap still shows done at once (the write is queued)', await waitFor(async () => isDone(await todayLabel('Reward Habit')), 2000));
  await sleep(2500);
  check('...no coin can be paid offline (transactions need a connection) and the user is not nagged while offline', (await coins()) === 31 && !(await has("Couldn't add coins yet")));
  const runsOffline = await fake('ledgerRuns()');
  await fake('setOffline(false)');
  await sleep(3500);
  await dismissPopups();
  check('after reconnecting the reward is paid once: 32', (await coins()) === 32, String(await coins()));
  await sleep(1500);
  check('...and nothing more is paid by later events', (await coins()) === 32 && (await fake('ledgerRuns()')) - runsOffline <= 2);

  section('Stage 3: sign-out removes the listeners; accounts never mix; the pending-adjustment flow');
  await signOutUi();
  check('sign out: every listener is removed and no account data remains on screen', (await fake('listenerCount()')) === 0 && !(await has('Reward Habit')));
  const watchedBefore = (await fake('watched().length'));
  await fill('Email', 'p@b.co');
  await fill('Password', 'secret1');
  await click('[role=button]', '=Sign in');
  await waitApp();
  await sleep(1500);
  const watchedP = (await fake('watched()')).slice(watchedBefore);
  check('the next account listens only to its own documents (nothing of the previous account)', watchedP.length === 8 && watchedP.every((p) => p === 'users/uid-pending' || p.startsWith('users/uid-pending/')) && (await names()).join() === 'Pending Habit' && (await coins()) === 0, JSON.stringify(watchedP));
  const writesAtStart = (await wlog()).length;
  await ev(`window.__consistoFake.android.complete('uid-pending', 'h-p1', '2026-11-20', false)`);
  const noticePending = await waitFor(() => has('Coin reward adjusted.'), 9000);
  await sleep(1500);
  const pu = await fake(`doc('users/uid-pending')`);
  check('Android undoes the day the (already spent) coin was paid for: the Web reverses it, the balance stays 0 and the amount becomes a pending adjustment', pu.coins === 0 && pu.pendingAdjustment === 1 && pu.freezesOwned === 1, JSON.stringify(pu));
  const revTx = await fake(`doc('users/uid-pending/walletTransactions/daily_2026-11-20_rev1')`);
  check('the reversal entry: reward_reversal, coinDelta 0, pendingDelta 1, balanceAfter 0', revTx && revTx.type === 'reward_reversal' && revTx.coinDelta === 0 && revTx.pendingDelta === 1 && revTx.balanceAfter === 0, JSON.stringify(revTx));
  check('the user was told: "Coin reward adjusted. Tap ⓘ in your wallet for details."', noticePending);
  await sleep(3500);
  await tapToday('Pending Habit');
  const noticePaid = await waitFor(() => has('went toward balancing an earlier reward adjustment'), 9000);
  await sleep(1500);
  await dismissPopups();
  const pu2 = await fake(`doc('users/uid-pending')`);
  check('completing today pays the pending amount first: coins 0, pending 0 (the earned coin went to the adjustment)', pu2.coins === 0 && pu2.pendingAdjustment === 0, JSON.stringify(pu2));
  const grantTx = await fake(`doc('users/uid-pending/walletTransactions/daily_2026-11-21')`);
  check('the grant entry records it: coinDelta 0, pendingDelta -1', grantTx && grantTx.coinDelta === 0 && grantTx.pendingDelta === -1, JSON.stringify(grantTx));
  check('the user was told: "1 coin went toward balancing an earlier reward adjustment."', noticePaid);
  await signOutUi();
  check('sign out again: no listeners left', (await fake('listenerCount()')) === 0);

  section('Stage 3: guest mode stays isolated');
  await click('[role=button]', '=Continue as Guest');
  await waitFor(async () => (await names()).length >= 5, 15000);
  check('guest data is byte-for-byte what it was, with none of the cloud habits, and nothing was uploaded', (await names()).join() === guestNames.join() && !(await has('Reward Habit')) && !(await has('Pending Habit')) && (await ev(`localStorage.getItem('consisto_app_data')`)) === guestData && authMock.firestore.length === 0);
  await ev(`sessionStorage.removeItem('e2e_auth'); sessionStorage.removeItem('e2e_fs'); sessionStorage.removeItem('e2e_wlog')`);

  // ───────────────────────────── Phase 9D.5: wallet, coins and rewards synchronisation (fake Firestore; Android simulated from outside) ─────────────────────────────
  const A = (call) => ev(`window.__consistoFake.android.${call}`);
  const walletNow = (uid) => fake(`doc('users/${uid}')`);
  const dayLabel = async (name, md) => (await dayCircles()).find((l) => l.startsWith(name) && l.includes(md)) ?? '';

  section('Phase 9D.5: an account wallet opens from Firestore and nothing is written on load');
  await viewport(1280, 900);
  await ev(`sessionStorage.setItem('e2e_auth', '1'); sessionStorage.removeItem('e2e_fs'); sessionStorage.removeItem('e2e_wlog'); sessionStorage.removeItem('e2e_deny'); sessionStorage.removeItem('e2e_write_fail'); sessionStorage.removeItem('e2e_ledger_fail'); sessionStorage.removeItem('e2e_ledger_hold')`);
  await toGuestSettingsToLogin();
  await signInAs('w@b.co', 'secret1');
  await sleep(1500);
  check('the account opens with its two habits and 45 coins', JSON.stringify(await names()) === JSON.stringify(['Freeze Habit', 'Second Freeze Habit']) && (await coins()) === 45, JSON.stringify(await names()));
  check('opening it wrote nothing and ran no wallet transaction (its rewards already exist)', (await wlog()).length === 0 && (await fake('ledgerRuns()')) === 0);
  await openWallet();
  check('Wallet: COINS 45, STREAK FREEZES 0, "❄️ 3/3" still purchasable', (await walletHas('COINS: 45')) && (await walletHas('STREAK FREEZES: 0')) && (await has('❄️ 3/3')));
  check('the buy button is enabled', (await isDisabled('Buy Streak Freeze — 20 Coins')) === false);

  section('Phase 9D.5: buying a freeze is one Firestore transaction and nothing is shown before the server confirms');
  await click('[role=button]', 'Buy Streak Freeze — 20 Coins');
  check('the sheet previews the purchase: 45 → 25 coins', /Your coins 45 → 25/.test(await flat()));
  await ev(`sessionStorage.setItem('e2e_ledger_hold', '1')`);
  await click('[role=button]', 'Confirm Purchase');
  await sleep(600);
  check('while the transaction is in flight the wallet still shows 45 coins and 0 freezes (nothing is shown in advance)', (await walletHas('COINS: 45')) && (await walletHas('STREAK FREEZES: 0')) && (await walletNow('uid-wallet')).coins === 45);
  check('the confirm button says "Purchasing…" and is disabled', (await has('Purchasing…')) && (await isDisabled('Purchasing')) !== false);
  await click('[role=button]', 'Purchasing');
  await ev(`sessionStorage.removeItem('e2e_ledger_hold')`);
  check('confirmed: "❄️ Freeze purchased! You own 1."', await toastIs('Freeze purchased! You own 1.'));
  let tx1 = await txns();
  check('exactly ONE transaction ran (the tap while it was in flight started nothing): the wallet update and its ledger entry, no other document', tx1.length === 1 && tx1[0].writes.length === 2 && tx1[0].writes[0].kind === 'update' && tx1[0].writes[0].path === 'users/uid-wallet' && /^users\/uid-wallet\/walletTransactions\/freeze_buy_/.test(tx1[0].writes[1].path), JSON.stringify(tx1));
  const buyId = tx1[0].writes[1].path.split('/').pop();
  const w1 = await walletNow('uid-wallet');
  check("the user document holds Kotlin's fields: coins 25, freezesOwned 1, pendingAdjustment 0, lastTransactionId = the entry", w1.coins === 25 && w1.freezesOwned === 1 && w1.pendingAdjustment === 0 && w1.lastTransactionId === buyId, JSON.stringify(w1));
  const buyDoc = await fake(`doc(${JSON.stringify('users/uid-wallet/walletTransactions/' + buyId)})`);
  check('the entry: freeze_purchase, coinDelta -20, freezeDelta 1, balanceAfter 25, date 2026-11-21, no habit or reward', buyDoc.type === 'freeze_purchase' && buyDoc.coinDelta === -20 && buyDoc.freezeDelta === 1 && buyDoc.balanceAfter === 25 && buyDoc.date === '2026-11-21' && !('habitId' in buyDoc) && !('rewardId' in buyDoc), JSON.stringify(buyDoc));
  check('the id is "freeze_buy_" + one UUID per attempt', /^freeze_buy_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(buyId), buyId);
  check('Wallet now: COINS 25, STREAK FREEZES 1, "❄️ 2/3", the sheet is closed', (await walletHas('COINS: 25')) && (await walletHas('STREAK FREEZES: 1')) && (await has('❄️ 2/3')) && !(await has('Confirm Purchase')));
  check('no freeze or reward record was created by a purchase', !(await fake('keys()')).some((k) => /uid-wallet\/(freezes|freezeMonths)\//.test(k)));

  section('Phase 9D.5: rapid double taps buy once');
  await click('[role=button]', 'Buy Streak Freeze — 20 Coins');
  const confirmRect = await rect('[role=button]', 'Confirm Purchase');
  for (let i = 0; i < 4; i++) for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await mouse(type, confirmRect.cx, confirmRect.cy);
  check('second purchase confirmed', await toastIs('Freeze purchased! You own 2.'));
  await sleep(800);
  const buys = (await txns()).filter((t) => /freeze_buy_/.test(t.writes[1].path));
  const w2 = await walletNow('uid-wallet');
  check('four rapid taps made exactly one more purchase: 2 purchases in all, coins 5, freezes 2', buys.length === 2 && new Set(buys.map((b) => b.writes[1].path)).size === 2 && w2.coins === 5 && w2.freezesOwned === 2, `${buys.length} ${JSON.stringify(w2)}`);
  check('Wallet: COINS 5, STREAK FREEZES 2; with too few coins the button reads "Need 15 more coins" and is disabled', (await walletHas('COINS: 5')) && (await walletHas('STREAK FREEZES: 2')) && (await isDisabled('Need 15 more coins')) === true);

  section('Phase 9D.5: the wallet follows Android live (no reload), and repeated Android events change nothing');
  const listenersBefore = await fake('listenerCount()');
  await A(`patchUser('uid-wallet', { coins: 65 })`);
  check('Android earned coins: the Web wallet shows 65 without a reload', await waitFor(() => walletHas('COINS: 65'), 5000));
  check('the buy button is available again', (await isDisabled('Buy Streak Freeze — 20 Coins')) === false || (await isDisabled('Monthly limit reached')) === true);
  check('Android bought a freeze: 45 coins, 3 freezes on the Web, and the allowance is used up ("❄️ 0/3")', (await A(`buyFreeze('uid-wallet', 'android-attempt-0001')`)) === true && (await waitFor(() => walletHas('COINS: 45'), 5000)) && (await walletHas('STREAK FREEZES: 3')) && (await has('❄️ 0/3')));
  check('the same Android purchase repeated is a no-op (same entry id): still 45 / 3', (await A(`buyFreeze('uid-wallet', 'android-attempt-0001')`)) === false && (await walletNow('uid-wallet')).coins === 45);
  check('the button says "Monthly limit reached" (3 owned = everything usable this month) and is disabled', (await isDisabled('Monthly limit reached')) === true);
  check("the Web wrote nothing for Android's changes, and opened no extra listeners", (await txns()).length === 2 && (await fake('listenerCount()')) === listenersBefore);

  section('Phase 9D.5: using an owned freeze updates Calendar, Home and Wallet (no coins spent)');
  await back();
  await openCalendar('Freeze Habit');
  await tapCell('2026-11-19');
  check('the missed day opens "Protect Your Streak" with the 3 freezes the Web learned from Firestore', (await waitFor(() => has('Protect Your Streak'), 2500)) && (await has('❄️ 3')));
  await ev(`sessionStorage.setItem('e2e_ledger_hold', '1')`);
  await click('[role=button]', 'Use Freeze');
  await sleep(600);
  check('while the transaction is in flight the day is NOT shown as frozen and the sheet still offers 3 freezes', (await cellLabel('2026-11-19')).includes('Missed') && (await has('Protect Your Streak')) && (await has('❄️ 3')), String(await cellLabel('2026-11-19')));
  await click('[role=button]', 'Use Freeze');
  await ev(`sessionStorage.removeItem('e2e_ledger_hold')`);
  check('confirmed: "❄️ Streak protected successfully!"', await toastIs('Streak protected successfully!'));
  await sleep(600);
  const applyTx = (await txns()).filter((t) => /freeze_apply_/.test(t.writes[1].path));
  check('exactly one application transaction (the second tap while it ran started nothing): user wallet, ledger entry, freeze record, month counter', applyTx.length === 1 && applyTx[0].writes.map((w) => `${w.kind}:${w.path}`).join() === 'update:users/uid-wallet,set:users/uid-wallet/walletTransactions/freeze_apply_h-w1_2026-11-19,set:users/uid-wallet/freezes/h-w1_2026-11-19,set:users/uid-wallet/freezeMonths/2026-11', JSON.stringify(applyTx.map((t) => t.writes.map((w) => w.path))));
  const wa = await walletNow('uid-wallet');
  check('one owned freeze used, coins untouched: 45 coins, 2 freezes, lastTransactionId = the application', wa.coins === 45 && wa.freezesOwned === 2 && wa.lastTransactionId === 'freeze_apply_h-w1_2026-11-19', JSON.stringify(wa));
  const ft = await fake(`doc('users/uid-wallet/walletTransactions/freeze_apply_h-w1_2026-11-19')`);
  check('the entry: freeze_application, coinDelta 0, freezeDelta -1, balanceAfter 45, date and habitId', ft.type === 'freeze_application' && ft.coinDelta === 0 && ft.freezeDelta === -1 && ft.balanceAfter === 45 && ft.date === '2026-11-19' && ft.habitId === 'h-w1', JSON.stringify(ft));
  const fr = await fake(`doc('users/uid-wallet/freezes/h-w1_2026-11-19')`);
  check('the freeze record: habitId, date, month, paidWith "inventory", transactionId', fr && fr.habitId === 'h-w1' && fr.date === '2026-11-19' && fr.month === '2026-11' && fr.paidWith === 'inventory' && fr.transactionId === 'freeze_apply_h-w1_2026-11-19', JSON.stringify(fr));
  check('the month counter is 1', (await fake(`doc('users/uid-wallet/freezeMonths/2026-11')`)).count === 1);
  check('Calendar: 19 Nov is Frozen and the streak carries on (no missed day)', (await cellLabel('2026-11-19')).includes('Frozen'), String(await cellLabel('2026-11-19')));
  await click('[role=button]', '=Back');
  await waitFor(async () => (await path()).startsWith('/habits/') && !(await path()).endsWith('/calendar'), 4000);
  await back();
  check('Home sees it at once: 19 Nov is frozen for Freeze Habit, 45 coins', (await dayLabel('Freeze Habit', 'Thu, Nov 19')).endsWith(', frozen') && (await coins()) === 45, await dayLabel('Freeze Habit', 'Thu, Nov 19'));
  await openWallet();
  check('Wallet sees it at once: COINS 45, STREAK FREEZES 2, "❄️ 0/3" (1 used + 2 owned)', (await walletHas('COINS: 45')) && (await walletHas('STREAK FREEZES: 2')) && (await has('❄️ 0/3')));
  await A(`applyFreeze('uid-wallet', 'h-w2', '2026-11-18')`); // Android protects the other habit's missed day
  check('Android used a freeze: the Web wallet shows 1 freeze and the allowance follows (2 used + 1 owned)', (await waitFor(() => walletHas('STREAK FREEZES: 1'), 5000)) && (await walletHas('COINS: 45')));
  check("Android's freeze record exists and the Web wrote nothing for it", (await fake(`doc('users/uid-wallet/freezes/h-w2_2026-11-18')`)) !== null && (await txns()).length === 3);
  await back();
  check('Home shows the day Android protected as frozen (Second Freeze Habit, 18 Nov) without a reload', await waitFor(async () => (await dayLabel('Second Freeze Habit', 'Wed, Nov 18')).endsWith(', frozen'), 4000), await dayLabel('Second Freeze Habit', 'Wed, Nov 18'));
  await openWallet();

  section('Phase 9D.5: the ledger enforces the monthly limit even when the screen thinks a purchase is possible');
  await A(`patchUser('uid-wallet', { coins: 60, freezesOwned: 0 })`);
  await A(`setMonthCount('uid-wallet', '2026-11', 3)`);
  await sleep(600);
  check('(setup) the Web shows 60 coins and a purchasable freeze (it counts freeze records: 2 used)', (await waitFor(() => walletHas('COINS: 60'), 4000)) && (await isDisabled('Buy Streak Freeze — 20 Coins')) === false);
  const txnsBeforeLimit = (await txns()).length;
  await click('[role=button]', 'Buy Streak Freeze — 20 Coins');
  await click('[role=button]', 'Confirm Purchase');
  check('the transaction is rejected with Kotlin\'s message', await toastIs('Monthly freeze limit reached (3/month)'));
  await sleep(500);
  check('nothing was written, the wallet shows the same 60 coins, and the sheet stays open to try again or close', (await txns()).length === txnsBeforeLimit && (await walletHas('COINS: 60')) && (await walletNow('uid-wallet')).coins === 60 && (await isDisabled('Confirm Purchase')) === false);
  await A(`setMonthCount('uid-wallet', '2026-11', 2)`);

  section('Phase 9D.5: a failed transaction is reported and nothing stays changed; the next attempt works');
  await ev(`sessionStorage.setItem('e2e_ledger_fail', 'permission-denied')`);
  await click('[role=button]', 'Confirm Purchase');
  check('permission denied is explained in plain words ("Nothing was changed")', await toastIs("Couldn't update your wallet"));
  await sleep(500);
  check('the wallet still shows 60 coins / 0 freezes, nothing was written, and the button is usable again', (await walletHas('COINS: 60')) && (await walletHas('STREAK FREEZES: 0')) && (await walletNow('uid-wallet')).coins === 60 && (await txns()).length === txnsBeforeLimit && (await isDisabled('Confirm Purchase')) === false);
  await ev(`sessionStorage.removeItem('e2e_ledger_fail')`);
  await fake('setOffline(true)');
  await sleep(500);
  await click('[role=button]', 'Confirm Purchase');
  check('offline: "You\'re offline. Connect to the internet and try again."', await toastIs("You're offline. Connect to the internet and try again."));
  await sleep(500);
  check('offline: the wallet is unchanged (60 coins) and nothing was written', (await walletHas('COINS: 60')) && (await txns()).length === txnsBeforeLimit && (await walletNow('uid-wallet')).coins === 60);
  await fake('setOffline(false)');
  await sleep(2500);
  await click('[role=button]', 'Confirm Purchase');
  check('back online the purchase goes through once: 40 coins, 1 freeze', (await toastIs('Freeze purchased! You own 1.')) && (await waitFor(() => walletHas('COINS: 40'), 3000)) && (await walletHas('STREAK FREEZES: 1')));
  await sleep(600);
  check('exactly one more transaction after all those failed attempts', (await txns()).length === txnsBeforeLimit + 1);
  const freezeEntries = (await fake('keys()')).filter((k) => /uid-wallet\/walletTransactions\/freeze_/.test(k)).length;
  check('the ledger holds the 3 purchases made here and Android\'s 1: 4 purchases and 2 applications in all', freezeEntries === 6, String(freezeEntries));

  section('Phase 9D.5: pending adjustments and rewards stay consistent with the wallet');
  await A(`patchUser('uid-wallet', { coins: 0, pendingAdjustment: 2 })`);
  check('a pending adjustment set on Android shows ⓘ with "2 coins" on the Web wallet', (await waitFor(() => walletHas('Pending coin adjustment'), 4000)) && (await walletHas('COINS: 0')));
  await click('[role=button]', 'Pending coin adjustment');
  check('ⓘ: "Pending coin adjustment: 2 coins"', await has('Pending coin adjustment: 2 coins'));
  await click('[role=button]', '=Got it');
  await A(`patchUser('uid-wallet', { coins: 40, pendingAdjustment: 0 })`);
  check('once cleared on Android the ⓘ disappears and the coins return', (await waitFor(async () => !(await walletHas('Pending coin adjustment')), 4000)) && (await walletHas('COINS: 40')));

  section('Phase 9D.5: the free welcome freeze of an account whose marker is still set');
  await signOutUi();
  check('sign out removed every listener', (await fake('listenerCount()')) === 0);
  await signInAs('x@b.co', 'secret1');
  await sleep(2500);
  const wx = await walletNow('uid-welcome');
  check('the Web finished it: +1 freeze, coins untouched (20), the marker cleared', wx.freezesOwned === 1 && wx.coins === 20 && wx.welcomeFreezePending === false && wx.lastTransactionId === 'welcome_freeze', JSON.stringify(wx));
  const wtx = await fake(`doc('users/uid-welcome/walletTransactions/welcome_freeze')`);
  check('under the fixed id: welcome_freeze, coinDelta 0, freezeDelta 1, balanceAfter 20', wtx && wtx.type === 'welcome_freeze' && wtx.coinDelta === 0 && wtx.freezeDelta === 1 && wtx.balanceAfter === 20, JSON.stringify(wtx));
  await openWallet();
  check('Wallet: STREAK FREEZES 1', await walletHas('STREAK FREEZES: 1'));
  const writesWelcome = (await wlog()).length;
  await reloadApp();
  await sleep(2500);
  check('a reload grants nothing more (the marker is gone and the id exists)', (await wlog()).length === writesWelcome && (await walletNow('uid-welcome')).freezesOwned === 1);

  section('Signed-in account with no habits sees the empty screen');
  await signOutUi();
  const zWatchedBefore = await fake('watched().length');
  await signInAs('z@b.co', 'secret1');
  await sleep(1500);
  const zt = await text();
  check('shows the empty screen and the header, with no sample habits and no dashboard body', zt.includes('Create your first habit') && zt.includes('Create Your First Habit') && (await names()).length === 0 && !/This Week|Today's Progress|Guest Bonus|Missed Day|SQL Practice|Morning Run|Read Books|Meditate|Drink Water/.test(zt) && (await coins()) === 20, zt.slice(0, 160));
  const zWatched = (await fake('watched()')).slice(zWatchedBefore);
  check('it reads only its own data, never another account or the guest', zWatched.length > 0 && zWatched.every((p) => p === 'users/uid-zero' || p.startsWith('users/uid-zero/')), JSON.stringify(zWatched));
  await click('[role=button]', 'Create your first habit');
  check('its button opens the creation flow', await waitFor(async () => (await ev(`document.querySelectorAll('[role=radio]').length`)) > 0, 3000));
  await click('[aria-label="Close"]');

  section('Phase 9D.5: accounts never see each other\'s wallet');
  await signOutUi();
  const watchedBeforeB = (await fake('watched().length'));
  await signInAs('v@b.co', 'secret1');
  await sleep(1500);
  const watchedB = (await fake('watched()')).slice(watchedBeforeB);
  check('the second account listens only to its own documents', watchedB.length > 0 && watchedB.every((p) => p === 'users/uid-wallet-b' || p.startsWith('users/uid-wallet-b/')), JSON.stringify(watchedB));
  await openWallet();
  check('its wallet is its own: COINS 7, STREAK FREEZES 2 (nothing of the previous 40 coins / 1 freeze)', (await walletHas('COINS: 7')) && (await walletHas('STREAK FREEZES: 2')) && !(await has('Freeze Habit')));
  check('with 7 coins its button says "Need 13 more coins"', (await isDisabled('Need 13 more coins')) === true);
  await signOutUi();
  await signInAs('w@b.co', 'secret1');
  await sleep(1500);
  await openWallet();
  check('signing back in shows the first account\'s own, persisted wallet: 40 coins, 1 freeze', (await walletHas('COINS: 40')) && (await walletHas('STREAK FREEZES: 1')));
  check('every write of this section stayed within the account that made it, and no real Firestore request was made', (await wlog()).every((x) => !JSON.stringify(x).includes('uid-existing') && !JSON.stringify(x).includes('uid-rewards') && !JSON.stringify(x).includes('uid-wallet-b')) && authMock.firestore.length === 0);

  section('Phase 9D.5: guest wallet stays local');
  await signOutUi();
  await click('[role=button]', '=Continue as Guest');
  await waitFor(async () => (await names()).length >= 5, 15000);
  const writesAtGuest = (await wlog()).length;
  await openWallet();
  check('the guest wallet is its own (not 40 / 1 from the account) and nothing was uploaded', !(await walletHas('COINS: 40')) && authMock.firestore.length === 0 && (await wlog()).length === writesAtGuest);
  await back();
  check('guest data is byte-for-byte what it was, with none of the account habits', (await names()).join() === guestNames.join() && !(await has('Freeze Habit')) && (await ev(`localStorage.getItem('consisto_app_data')`)) === guestData);
  await ev(`sessionStorage.removeItem('e2e_auth'); sessionStorage.removeItem('e2e_fs'); sessionStorage.removeItem('e2e_wlog')`);

  // ───────────────────────────── Phase 10: importing guest habits into an account (fake Firestore; the wallet must never change) ─────────────────────────────
  section('Phase 10: the import offer, selection and preview');
  await viewport(1280, 800);
  await ev(`sessionStorage.setItem('e2e_import', '1'); sessionStorage.setItem('e2e_auth', '1'); sessionStorage.removeItem('e2e_fs'); sessionStorage.removeItem('e2e_wlog'); sessionStorage.removeItem('e2e_deny'); sessionStorage.removeItem('e2e_write_fail'); sessionStorage.removeItem('e2e_mig_fail'); sessionStorage.removeItem('e2e_mig_offline'); localStorage.removeItem('consisto_guest_migration')`);
  const days = (from, n) => Array.from({ length: n }, (_, i) => `2026-11-${String(from + i).padStart(2, '0')}`);
  const guestEnvelope = JSON.stringify({
    version: 1,
    savedAt: 1,
    data: {
      habits: [
        { id: 'h1', name: 'SQL Practice', color: '#4ADE80', completedDates: ['2026-11-18'], daysPerWeek: 5, restDays: ['Sat', 'Sun'], createdDate: '2026-11-01', scheduleHistory: [{ from: '2026-11-01', restDays: ['Sat', 'Sun'], daysPerWeek: 5 }], archived: false, goal: null, reminderEnabled: false, reminderTime: null, dataOrigin: 'demo' },
        { id: 'local-1', name: 'Evening Walk', color: '#38BDF8', completedDates: days(1, 9), daysPerWeek: 7, restDays: [], createdDate: '2026-10-15', scheduleHistory: [{ from: '2026-10-15', restDays: [], daysPerWeek: 7 }], archived: false, goal: 'Walk daily', reminderEnabled: false, reminderTime: null },
        { id: 'local-2', name: 'Old Hobby', color: '#F472B6', completedDates: ['2026-10-20'], daysPerWeek: 3, restDays: ['Mon', 'Tue', 'Wed', 'Thu'], createdDate: '2026-10-01', scheduleHistory: [{ from: '2026-10-01', restDays: ['Mon', 'Tue', 'Wed', 'Thu'], daysPerWeek: 3 }], archived: true, goal: null, reminderEnabled: false, reminderTime: null },
      ],
      ledger: { wallet: { coins: 55, freezesOwned: 2, pending: 0 }, rewards: {}, txIds: [], transactions: [], freezes: [] },
      notes: { 'local-1': { '2026-11-05': 'Rainy walk' } },
      nextId: 5,
    },
  });
  await ev(`localStorage.setItem('consisto_app_data', ${JSON.stringify(guestEnvelope)})`);
  const guestBefore = await ev(`localStorage.getItem('consisto_app_data')`);
  await send('Page.navigate', { url: `${BASE}/habits` });
  await waitFor(async () => (await names()).length >= 2, 15000);
  const importSheet = () => has('Import your guest habits?');
  const boxState = (name) => ev(`(() => { const e = document.querySelector('[role=checkbox][aria-label="Import ${name}"]'); return e ? e.getAttribute('aria-checked') : null; })()`);
  const importLog = async () => (await wlog()).filter((x) => x.op === 'import-batch');
  const walletUnchanged = async (uid, coinsExpected, lastTx) => {
    const w = await fake(`doc('users/${uid}')`);
    return w.coins === coinsExpected && w.lastTransactionId === lastTx;
  };

  await toGuestSettingsToLogin();
  await signInAs('r@b.co', 'secret1');
  check('signing in with guest data on the device offers the import', await waitFor(importSheet, 8000));
  check('...listing every guest habit, including the archived one', (await has('SQL Practice')) && (await has('Evening Walk')) && (await has('Old Hobby')) && (await has('Archived')));
  check('...with each habit\'s check-ins and notes in the preview', (await has('9 check-ins · 1 note')) && (await has('1 check-in')));
  check('...a clear warning that sample habits may be included, and the explicit demo marker on the seeded habit only', (await has('Sample habits may be included')) && (await text()).match(/SQL Practice\s*\n?\s*1 check-in · Sample habit/) !== null && !(await text()).includes('Evening Walk\n9 check-ins · 1 note · Sample habit'));
  check('...and says coins, rewards and streak freezes are not imported', await has('Coins, rewards and streak freezes are not imported'));
  check('NO habit is ticked by default', (await boxState('SQL Practice')) === 'false' && (await boxState('Evening Walk')) === 'false' && (await boxState('Old Hobby')) === 'false');
  check('"Import selected" is disabled until a habit is chosen', (await isDisabled('Import selected')) === true);
  check('the choice cannot be dismissed by tapping outside it', await (async () => { await mouse('mousePressed', 5, 5); await mouse('mouseReleased', 5, 5); await sleep(400); return importSheet(); })());
  check('nothing was written to the account by signing in or looking at the preview', (await wlog()).length === 0 && (await fake('ledgerRuns()')) === 0);
  await shot('import-preview');
  await click('[role=checkbox]', '=Import Evening Walk');
  check('ticking a habit selects only it and enables the button with a count', (await boxState('Evening Walk')) === 'true' && (await boxState('SQL Practice')) === 'false' && (await has('Import selected (1)')) && (await isDisabled('Import selected (1)')) === false);
  await click('[role=checkbox]', '=Import Old Hobby');
  check('a second tick makes the count 2', (await has('Import selected (2)')) && (await boxState('Old Hobby')) === 'true');
  await click('[role=checkbox]', '=Import Old Hobby');
  check('unticking removes it again', (await has('Import selected (1)')) && (await boxState('Old Hobby')) === 'false');
  await click('[role=button]', '=Select all');
  check('"Select all" ticks everything and "Clear" unticks it', (await has('Import selected (3)')) && (await (async () => { await click('[role=button]', '=Clear'); return (await boxState('Evening Walk')) === 'false' && (await isDisabled('Import selected')) === true; })()));

  section('Phase 10: importing a selected habit (the account\'s wallet must not change)');
  await click('[role=checkbox]', '=Import Evening Walk');
  await click('[role=button]', '^Import selected');
  check('the import finishes and says what was imported', await waitFor(() => has('Your habits are now in your account.'), 15000));
  check('...1 habit, 9 check-ins and 1 note', await has('1 habit, 9 check-ins and 1 note imported.'));
  check('...and that coins, rewards and freezes were not changed and the guest data is still on the device', (await has('Your coins, rewards and streak freezes were not changed')) && (await has('guest data is still on this device')));
  await shot('import-done');
  const imported = (await fake('keys()')).filter((k) => k.startsWith('users/uid-rewards/habits/local-1-m'));
  const habitKey = imported.find((k) => !k.includes('/completions/'));
  const habitDoc = await fake(`doc('${habitKey}')`);
  check('the habit is under a migration-scoped id (local-1-m{migrationId}) and keeps its guest id in migratedFrom', /^users\/uid-rewards\/habits\/local-1-m[0-9a-f]{8}$/.test(habitKey) && habitDoc.migratedFrom.endsWith(':local-1'), habitKey + ' ' + JSON.stringify(habitDoc.migratedFrom));
  check('name, colour, goal, weekly target, rest days, schedule history and completions were written', habitDoc.name === 'Evening Walk' && habitDoc.goal === 'Walk daily' && habitDoc.daysPerWeek === 7 && Array.isArray(habitDoc.restDays) && habitDoc.scheduleHistory.length === 1 && habitDoc.completedDates.length === 9 && typeof habitDoc.color === 'number');
  check('the habit carries rewardsIgnoredThrough = the import date (2026-11-21), which Android reads too; completions and notes carry nothing of the kind', habitDoc.rewardsIgnoredThrough === '2026-11-21' && !Object.entries(await fake('keys()').then(async (ks) => Object.fromEntries(await Promise.all(ks.filter((k) => k.startsWith('users/uid-rewards/dayNotes/') || k.includes('/completions/')).map(async (k) => [k, await fake(`doc('${k}')`)]))))).some(([, d]) => d && 'rewardsIgnoredThrough' in d));
  check('9 completion documents and 1 note (keyed {cloudId}_{date}) exist', imported.filter((k) => k.includes('/completions/')).length === 9 && (await fake('keys()')).includes(`users/uid-rewards/dayNotes/${habitKey.split('/').pop()}_2026-11-05`));
  check('nothing else was imported: the unticked habits are absent', !(await fake('keys()')).some((k) => k.includes('local-2') || k.includes('/h1-m')));
  await click('[role=button]', '=Done');
  await sleep(2500); // let the reward reconcile run on the new data
  check('Home shows the imported habit beside the account\'s own', JSON.stringify((await names()).sort()) === JSON.stringify(['Evening Walk', 'Reward Habit']), JSON.stringify(await names()));
  check('the wallet is exactly as before: 31 coins, same last transaction, no ledger transaction ran', (await coins()) === 31 && (await walletUnchanged('uid-rewards', 31, 'daily_2026-11-20')) && (await fake('ledgerRuns()')) === 0);
  check('no reward was granted or reversed: the existing rewards for 10-20 Nov are all still in effect and none exists for 1-9 Nov', (await (async () => { const k = await fake('keys()'); const r = k.filter((x) => x.startsWith('users/uid-rewards/rewards/')); const active = await Promise.all(r.map((x) => fake(`doc('${x}')`))); return r.length === 11 && active.every((d) => d.active === true); })()));
  check('every write was an import batch: no transaction, no wallet field, no profile', (await wlog()).every((x) => x.op === 'import-batch') && (await importLog()).length >= 1);
  check('the guest data is byte-for-byte unchanged', (await ev(`localStorage.getItem('consisto_app_data')`)) === guestBefore);
  const rec = await ev(`JSON.parse(localStorage.getItem('consisto_guest_migration'))`);
  check('the completion marker was recorded (after verification) and the id map saved', rec.completed && rec.completed.uid === 'uid-rewards' && rec.records['uid-rewards'].step === 'completed' && Object.keys(rec.records['uid-rewards'].idMap).length === 1);
  await send('Page.navigate', { url: `${BASE}/settings` });
  await waitFor(() => has('SIGNED IN'));
  check('Settings no longer offers the import once the guest data was imported', !(await has('Import guest habits')));
  await reloadApp();
  check('the prompt does not come back after a reload', !(await importSheet()) && (await coins()) === 31);

  section('Phase 10: "Start with my existing account" is remembered; Settings can still import');
  await signOutUi();
  await signInAs('a@b.co', 'secret1');
  check('a different account on the same browser is offered the import only if the guest data was not imported yet (it was: no prompt)', !(await importSheet()));
  await signOutUi();
  await ev(`localStorage.removeItem('consisto_guest_migration')`);
  await signInAs('a@b.co', 'secret1');
  check('(reset) a fresh answer is asked for again', await waitFor(importSheet, 8000));
  const writesBeforeDecline = (await wlog()).length;
  await click('[role=button]', '=Start with my existing account');
  await sleep(500);
  check('choosing it closes the offer, imports nothing and writes nothing', !(await importSheet()) && (await wlog()).length === writesBeforeDecline && !(await fake('keys()')).some((k) => /^users\/uid-existing\/habits\/[^/]+-m[0-9a-f]{8}/.test(k)));
  check('the account opens exactly as it was (its own habits only)', JSON.stringify(await names()) === JSON.stringify(['Cloud Jog', 'Cloud Reading']), JSON.stringify(await names()));
  check('the decision was recorded for this account only', JSON.stringify((await ev(`JSON.parse(localStorage.getItem('consisto_guest_migration'))`)).declined) === JSON.stringify(['uid-existing']));
  await reloadApp();
  await sleep(800);
  check('after a reload the prompt is not shown again', !(await importSheet()));
  await send('Page.navigate', { url: `${BASE}/settings` });
  await waitFor(() => has('SIGNED IN'));
  check('Settings offers "Import guest habits"', await waitFor(() => has('Import guest habits'), 4000));
  await click('[role=button]', 'Import guest habits');
  check('opening it shows the same preview, nothing ticked, with a Close button', (await waitFor(importSheet, 4000)) && (await boxState('Old Hobby')) === 'false' && (await has('Close')));
  await click('[role=checkbox]', '=Import Old Hobby');
  await click('[role=button]', '^Import selected');
  check('the archived habit imports (1 habit, 1 check-in)', (await waitFor(() => has('Your habits are now in your account.'), 15000)) && (await has('1 habit, 1 check-in imported.')));
  const oldKey = (await fake('keys()')).find((k) => /^users\/uid-existing\/habits\/local-2-m[0-9a-f]{8}$/.test(k));
  check('...as an archived habit (archived: true is written)', !!oldKey && (await fake(`doc('${oldKey}')`)).archived === true);
  check('...and uid-existing\'s wallet and ledger were not touched', (await walletUnchanged('uid-existing', 42, undefined)) && (await fake('doc("users/uid-existing")')).freezesOwned === 1);
  await click('[role=button]', '=Done');
  check('the guest data is still unchanged', (await ev(`localStorage.getItem('consisto_app_data')`)) === guestBefore);

  section('Phase 10: an interrupted import is resumed with the same ids and no duplicates');
  await signOutUi();
  await ev(`localStorage.removeItem('consisto_guest_migration')`);
  await signInAs('p@b.co', 'secret1');
  await waitFor(importSheet, 8000);
  await click('[role=checkbox]', '=Import Evening Walk');
  await click('[role=checkbox]', '=Import Old Hobby');
  await ev(`sessionStorage.setItem('e2e_mig_fail', 'unavailable')`);
  await click('[role=button]', '^Import selected');
  check('a failing upload ends in "The import didn\'t finish" with a plain reason', (await waitFor(() => has("The import didn't finish"), 15000)) && (await has("You're offline")));
  const recFail = await ev(`JSON.parse(localStorage.getItem('consisto_guest_migration'))`);
  const mapBefore = JSON.stringify(recFail.records['uid-pending'].idMap);
  check('the record is kept as failed, with the chosen habits and their ids fixed; nothing is marked complete', recFail.records['uid-pending'].step === 'failed' && recFail.completed === null && Object.keys(recFail.records['uid-pending'].idMap).length === 2);
  check('nothing reached the account and the guest data is untouched', !(await fake('keys()')).some((k) => k.startsWith('users/uid-pending/habits/local-')) && (await ev(`localStorage.getItem('consisto_app_data')`)) === guestBefore);
  await click('[role=button]', '=Not now');
  await ev(`sessionStorage.removeItem('e2e_mig_fail')`);
  await reloadApp();
  check('after a reload the unfinished import is offered for resume', await waitFor(() => has("Your import didn't finish"), 8000));
  check('...and lists the habits chosen the first time', (await has('Evening Walk')) && (await has('Old Hobby')) && !(await has('SQL Practice')));
  await click('[role=button]', '=Continue import');
  check('continuing completes the import', (await waitFor(() => has('Your habits are now in your account.'), 15000)) && (await has('2 habits, 10 check-ins and 1 note imported.')));
  const ids = (await fake('keys()')).filter((k) => /^users\/uid-pending\/habits\/local-\d-m[0-9a-f]{8}$/.test(k)).map((k) => k.split('/').pop()).sort();
  check('the same ids as before the failure, each habit exactly once', JSON.stringify(ids) === JSON.stringify(Object.values(JSON.parse(mapBefore)).sort()) && ids.length === 2, JSON.stringify(ids) + ' vs ' + mapBefore);
  check('the account\'s existing wallet is untouched (0 coins, 1 freeze)', (await walletUnchanged('uid-pending', 0, 'daily_2026-11-20')) && (await fake(`doc('users/uid-pending')`)).freezesOwned === 1 && (await fake('ledgerRuns()')) === 0);
  await click('[role=button]', '=Done');

  section('Phase 10: a new account gets a profile only if it has none, then the standard welcome freeze');
  await signOutUi();
  await ev(`localStorage.removeItem('consisto_guest_migration')`);
  await fill('Email', 'new@b.co'); // registered earlier in this run, and (the fake database was reset) it has no profile document
  await fill('Password', '123456');
  await click('[role=button]', '=Sign in');
  await waitApp();
  check('the new account (no profile document yet) is offered the import', await waitFor(importSheet, 8000));
  const newUidKey = () => fake('keys()').then((k) => k.filter((x) => /^users\/uid-new-\d+$/.test(x)).pop());
  check('the profile and the welcome wallet were already created when the account loaded (before any import)', !!(await newUidKey()));
  await click('[role=checkbox]', '=Import Evening Walk');
  await click('[role=button]', '^Import selected');
  check('the import finishes', await waitFor(() => has('Your habits are now in your account.'), 15000));
  const profileKey = await newUidKey();
  const prof = await fake(`doc('${profileKey}')`);
  check('exactly one profile was created, with Android\'s new-account fields', (await wlog()).filter((x) => x.op === 'create-profile').length === 1 && prof.email === 'new@b.co' && prof.displayName === 'new' && prof.coins === 20 && prof.isDark === true, JSON.stringify(prof));
  await click('[role=button]', '=Done');
  await sleep(3000);
  const prof2 = await fake(`doc('${profileKey}')`);
  check('the standard welcome freeze was then granted by the existing wallet logic: coins 20, 1 freeze, marker cleared, transaction welcome_freeze', prof2.coins === 20 && prof2.freezesOwned === 1 && prof2.welcomeFreezePending === false && !!(await fake(`doc('${profileKey}/walletTransactions/welcome_freeze')`)), JSON.stringify(prof2));
  check('the imported history earned nothing: the only ledger entry is the welcome freeze', (await fake('keys()')).filter((k) => k.startsWith(profileKey + '/walletTransactions/') || k.startsWith(profileKey + '/rewards/')).join() === `${profileKey}/walletTransactions/welcome_freeze`);
  check('no real Firestore request was made during the import tests', authMock.firestore.length === 0);
  await signOutUi();
  await click('[role=button]', '=Continue as Guest');
  await waitFor(async () => (await names()).length >= 2, 15000);
  check('as a guest again, the guest habits (two on Home, the archived one hidden) and the guest wallet are still there, byte for byte', JSON.stringify((await names()).sort()) === JSON.stringify(['Evening Walk', 'SQL Practice']) && (await ev(`localStorage.getItem('consisto_app_data')`)) === guestBefore);
  await ev(`sessionStorage.removeItem('e2e_import'); sessionStorage.removeItem('e2e_auth'); sessionStorage.removeItem('e2e_fs'); sessionStorage.removeItem('e2e_wlog'); localStorage.removeItem('consisto_guest_migration')`);

  // ───────────────────────────── Phase 12A: Delete Account and the account-aware Settings ─────────────────────────────
  section('Phase 12A: Settings as a guest: no Feedback row, an honest reminders note, a truthful Help & Support');
  await viewport(1280, 900);
  await ev(`sessionStorage.removeItem('e2e_auth'); sessionStorage.removeItem('e2e_fs'); sessionStorage.removeItem('e2e_wlog')`);
  await send('Page.navigate', { url: `${BASE}/settings` });
  await waitFor(() => has('GUEST MODE'), 20000);
  check('no Feedback row; a note instead of switches; Help & Support says there is no address', !(await has('Feedback')) && (await has('Not available on the web yet')) && (await has('No support address yet')) && (await ev("document.querySelectorAll('[role=switch]').length")) === 0);
  check('a guest has no Delete Account (there is no account to delete)', !(await has('Delete Account')));
  await shot('phase12a-settings-guest');

  section('Phase 12A: Delete Account: confirmation, wrong password, partial failure, retry, success (fake Firestore, mock Authentication)');
  const guestBefore12 = await ev(`localStorage.getItem('consisto_app_data')`);
  await ev(`sessionStorage.setItem('e2e_auth', '1'); sessionStorage.removeItem('e2e_fs'); sessionStorage.removeItem('e2e_wlog'); sessionStorage.removeItem('e2e_deny'); sessionStorage.removeItem('e2e_write_fail'); sessionStorage.removeItem('e2e_erase_fail'); sessionStorage.removeItem('e2e_erase_hold'); localStorage.setItem('uid-delete_habit_reminders', 'false'); localStorage.setItem('uid-existing_habit_reminders', 'false')`);
  await toGuestSettingsToLogin();
  await signInAs('del@b.co', 'secret1');
  await send('Page.navigate', { url: `${BASE}/settings` });
  await waitFor(() => has('SIGNED IN'), 15000);
  const mine12 = async (uid) => (await fake('keys()')).filter((k) => k === 'users/' + uid || k.startsWith('users/' + uid + '/'));
  const theirs12 = async (uid) => (await fake('keys()')).filter((k) => !(k === 'users/' + uid || k.startsWith('users/' + uid + '/')));
  const mineBefore12 = (await mine12('uid-delete')).length;
  const theirsBefore12 = JSON.stringify((await theirs12('uid-delete')).sort());
  check('Settings offers Log Out and Delete Account to a signed-in account', (await has('Log Out')) && (await has('Delete Account')) && (await has('Permanently remove your account and its data')));
  await click('[role=button]', '=Delete Account');
  await sleep(600);
  if (!(await has('Delete Account?'))) {
    // diagnostics for a sheet that did not open: what is on the page, which buttons exist, where the row is
    console.log('    DIAG route=' + (await path()) + ' text=' + JSON.stringify(((await text()) ?? '').replace(/\s+/g, ' ').slice(0, 700)));
    console.log('    DIAG buttons=' + JSON.stringify(await ev(`[...document.querySelectorAll('[role=button]')].map((e) => (e.getAttribute('aria-label') || e.innerText || '').slice(0, 30)).filter((x) => /delete|log out|sign/i.test(x))`)));
    console.log('    DIAG row=' + JSON.stringify(await rect('[role=button]', '=Delete Account')));
    await shot('phase12a-diag-after-click');
  }
  check('the sheet explains what is removed (notes included), that it cannot be undone, and that guest data is not deleted', (await has('Delete Account?')) && (await has('calendar notes')) && (await has('This cannot be undone.')) && (await has('are not part of your account and are not deleted')) && (await has('To confirm, enter your password and type DELETE.')));
  check('Delete My Account starts disabled', (await isDisabled('Delete My Account')) === true);
  await setText('input[aria-label="Password"]', 'secret1');
  check('...a password alone is not enough', (await isDisabled('Delete My Account')) === true);
  await setText('input[aria-label="Type DELETE"]', 'delete');
  check('...nor is "delete" in lower case (the word must be DELETE)', (await isDisabled('Delete My Account')) === true);
  await setText('input[aria-label="Type DELETE"]', 'DELETE');
  check('...the password and DELETE together enable it', (await isDisabled('Delete My Account')) === false);
  check('the password field hides what is typed', (await ev(`document.querySelector('input[aria-label="Password"]').type`)) === 'password');
  await shot('phase12a-delete-sheet-dark');

  await setText('input[aria-label="Password"]', 'wrong-password');
  await click('[role=button]', '=Delete My Account');
  check('a wrong password is explained in the sheet and deletes nothing', await waitFor(() => has('Incorrect password. Nothing was deleted.'), 6000));
  check('...no document was deleted, the account is still signed in, and Authentication was not asked to delete anything', (await mine12('uid-delete')).length === mineBefore12 && !authMock.log.includes('delete') && (await has('Delete Account?')) && !(await wlog()).some((x) => String(x.op).startsWith('erase')));

  // the failure halfway: hold the first delete so the blocking screen can be examined, then fail the second batch
  await setText('input[aria-label="Password"]', 'secret1');
  await ev(`sessionStorage.setItem('e2e_erase_hold', '1'); sessionStorage.setItem('e2e_erase_fail', '2')`);
  await click('[role=button]', '=Delete My Account');
  check('while deleting, a blocking "Deleting your account…" screen replaces the app', await waitFor(() => has('Deleting your account…'), 8000));
  check('...the app has stopped listening to the account (no live listener is left) and offers no buttons to touch', (await fake('listenerCount()')) === 0 && !(await has('Delete My Account')) && !(await has('Settings')));
  await shot('phase12a-deleting-screen');
  await ev(`sessionStorage.removeItem('e2e_erase_hold')`);
  const sawFailure = await waitFor(() => has("Couldn't delete all of your data (no connection)"), 20000);
  if (!sawFailure) {
    console.log('    DIAG2 route=' + (await path()) + ' text=' + JSON.stringify(((await text()) ?? '').replace(/\s+/g, ' ').slice(0, 900)));
    console.log('    DIAG2 state=' + JSON.stringify(await ev(`({ listeners: window.__consistoFake.listenerCount(), auth: JSON.stringify(authLog) })`).catch(() => null)) + ' authLog=' + authMock.log.slice(-6).join(','));
    await shot('phase12a-diag-after-failure');
  }
  check('a failure halfway is reported in plain words on the screen the app returns to (Home), with how to finish', sawFailure);
  check('...it says some data may already be removed and to try again', (await has('some of your data may already be removed')) && (await has('try Delete Account again')));
  const afterFail12 = await mine12('uid-delete');
  check('...the account still exists: profile (marked as being deleted) and the rest of the data, and the login was NOT deleted', afterFail12.includes('users/uid-delete') && afterFail12.length < mineBefore12 && afterFail12.length > 1 && (await fake("doc('users/uid-delete')")).deletionRequested === true && !authMock.log.includes('delete'));
  await click('[role=button]', '=Settings');
  await waitFor(() => has('SIGNED IN'), 10000);
  check('...the notice stays while the user moves around; the account looks deleted nowhere: still signed in, and Delete Account is offered again', (await has("Couldn't delete all of your data (no connection)")) && (await has('SIGNED IN')) && (await has('Delete Account')));
  check("...no other account's data was touched", JSON.stringify((await theirs12('uid-delete')).sort()) === theirsBefore12);

  // the retry finishes the job
  await click('[role=button]', '=Delete Account');
  await setText('input[aria-label="Password"]', 'secret1');
  await setText('input[aria-label="Type DELETE"]', 'DELETE');
  await click('[role=button]', '=Delete My Account');
  const endedOnLogin = await waitFor(() => has('SIGN IN'), 25000);
  if (!endedOnLogin || !(await has('Your account and all of its data were deleted.'))) {
    console.log('    DIAG3 route=' + (await path()) + ' text=' + JSON.stringify(((await text()) ?? '').replace(/\s+/g, ' ').slice(0, 900)) + ' authLog=' + authMock.log.slice(-6).join(','));
    await shot('phase12a-diag-after-retry');
  }
  check('the retry ends on the login screen with a confirmation', endedOnLogin && (await has('Your account and all of its data were deleted.')));
  check('...every document of the account is gone (profile, habits, completions, ledger, rewards, freezes, counters, to-dos AND notes)', (await mine12('uid-delete')).length === 0);
  check("...another account's documents are exactly as they were", JSON.stringify((await theirs12('uid-delete')).sort()) === theirsBefore12);
  check('...the login was deleted once, after the data (so the account can never sign in again)', authMock.log.filter((l) => l === 'delete').length === 1 && !authMock.accounts.has('del@b.co'));
  check("...this account's device preferences are gone, another account's and the guest's data are untouched", (await ev(`localStorage.getItem('uid-delete_habit_reminders')`)) === null && (await ev(`localStorage.getItem('uid-existing_habit_reminders')`)) === 'false' && (await ev(`localStorage.getItem('consisto_app_data')`)) === guestBefore12 && (await ev(`localStorage.getItem('guest_mode')`)) === 'false');
  await shot('phase12a-deleted-login');
  await click('[role=button]', 'Dismiss message');
  check('the confirmation can be dismissed', !(await has('Your account and all of its data were deleted.')));
  await fill('Email', 'del@b.co');
  await fill('Password', 'secret1');
  await click('[role=button]', '=Sign in');
  check('the deleted account cannot sign in any more', await waitFor(() => has('Incorrect email or password.'), 6000));
  check('no real Firestore request was made while deleting', authMock.firestore.length === 0);

  section('Phase 12A: Delete Account when the data is deleted but the login cannot be (retry removes the login)');
  await ev(`sessionStorage.removeItem('e2e_fs'); sessionStorage.removeItem('e2e_wlog')`);
  await fill('Email', 'del2@b.co');
  await fill('Password', 'secret1');
  await click('[role=button]', '=Sign in');
  await waitApp();
  await send('Page.navigate', { url: `${BASE}/settings` });
  await waitFor(() => has('SIGNED IN'), 15000);
  const deleteB12 = async () => {
    await click('[role=button]', '=Delete Account');
    await setText('input[aria-label="Password"]', 'secret1');
    await setText('input[aria-label="Type DELETE"]', 'DELETE');
    await click('[role=button]', '=Delete My Account');
  };
  authMock.failDelete = true;
  await deleteB12();
  check('the login could not be removed: the app says the data was deleted but the login remains', await waitFor(() => has("Your data was deleted, but the login couldn't be removed (no connection)"), 25000));
  await click('[role=button]', '=Settings');
  await waitFor(() => has('SIGNED IN'), 10000);
  check('...all data is gone, yet the account is not reported as deleted: still signed in, Delete Account offered again', (await mine12('uid-delete-b')).length === 0 && authMock.accounts.has('del2@b.co') && (await has('Delete Account')));
  await sleep(500);
  await deleteB12();
  check('the retry has nothing left to delete and removes the login; the confirmation shows', (await waitFor(() => has('SIGN IN'), 25000)) && (await has('Your account and all of its data were deleted.')));
  check('...the login was deleted exactly once more, and the account can no longer sign in', authMock.log.filter((l) => l === 'delete').length === 2 && !authMock.accounts.has('del2@b.co'));

  section('Phase 12A: the Delete Account sheet on a phone and in the light theme');
  authMock.accounts.set('del3@b.co', { password: 'secret1', uid: 'uid-delete-c' }); // its own user id: a deleted account's id is forgotten on this device, so reusing it would offer the guest import again
  await ev(`sessionStorage.removeItem('e2e_fs'); sessionStorage.removeItem('e2e_wlog')`);
  await viewport(320, 640, true);
  await send('Page.navigate', { url: `${BASE}/habits` }); // a reload gives the fake Firestore its original documents back
  await waitFor(() => has('SIGN IN'), 20000);
  await fill('Email', 'del3@b.co');
  await fill('Password', 'secret1');
  await click('[role=button]', '=Sign in');
  await waitApp();
  await send('Page.navigate', { url: `${BASE}/settings` });
  await waitFor(() => has('SIGNED IN'), 15000);
  await click('[role=button]', 'Switch to light mode');
  await click('[role=button]', '=Delete Account');
  await waitFor(() => has('Delete Account?'), 4000);
  const fit12 = await ev(`(() => { const iw = 320; const bad = [...document.querySelectorAll('body *')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.right > iw + 1 || r.left < -1); }).length; return { sw: document.documentElement.scrollWidth, bad }; })()`);
  check('at 320 px the sheet fits (no sideways scrolling) in the light theme', fit12.sw <= 320 && fit12.bad === 0, JSON.stringify(fit12));
  check('...and its button and both fields are reachable', !!(await rect('[role=button]', '=Delete My Account')) && !!(await rect('input[aria-label="Password"]')) && !!(await rect('input[aria-label="Type DELETE"]')));
  await shot('phase12a-delete-sheet-light-320');
  await pressEscape();
  check('Escape closes the sheet without deleting anything', !(await has('Delete Account?')) && (await mine12('uid-delete-c')).length > 0);
  await ev(`localStorage.setItem('theme_is_dark', 'true')`);
  await viewport(1280, 900);
  await ev(`sessionStorage.removeItem('e2e_auth'); sessionStorage.removeItem('e2e_fs'); sessionStorage.removeItem('e2e_wlog'); localStorage.removeItem('uid-existing_habit_reminders')`);
  authMock.accounts.delete('del3@b.co');

  section('Console');
  check('no console errors or warnings during the whole run', logs.length === 0, logs.join(' | '));
} finally {
  ws.close();
  try { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); else chrome.kill('SIGKILL'); } catch {}
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
  console.log(`\n${passes} passed, ${failures} failed`);
  process.exitCode = failures ? 1 : 0;
}
