// Release check for the production web build (Phase 12):   npm run build:web && node scripts/verify-release.mjs
//
// Serves `dist` with the rewrites and headers of firebase.json (like verify-csp.mjs), then drives headless Chrome through every route at
// five viewport widths: 320, 390 (phones), 768 (tablet), 1280 (desktop), 1920 (large desktop). For each page it records
//   - console errors and warnings, uncaught exceptions, Content-Security-Policy violations
//   - same-origin requests that failed or answered 4xx/5xx (missing assets)
//   - horizontal overflow (the page, or an element, wider than the viewport)
//   - the "Something went wrong" error screen or an unmatched route
//   - the expected text for the screen
// Every request to another origin is BLOCKED and listed, so nothing here contacts Firebase or any other service.
// Screenshots go to SHOTS (default: a consisto-release-shots folder in the system temp directory). It reads and writes only local files and never touches production.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadHosting, resolveRequest } from './lib/hostingConfig.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hosting = loadHosting(root);
const publicDir = hosting.publicDir;
if (!existsSync(join(publicDir, 'index.html'))) throw new Error(`No build in ${publicDir}. Run "npm run build:web" first.`);
const SHOTS = process.env.SHOTS || join(tmpdir(), 'consisto-release-shots');
mkdirSync(SHOTS, { recursive: true });
console.log(`Hosting configuration under test: ${hosting.kind === 'vercel' ? 'vercel.json (Vercel)' : 'firebase.json (Firebase Hosting)'}`);

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };
const served = [];
const fileExists = (p) => {
  const f = normalize(join(publicDir, p));
  return f.startsWith(publicDir) && existsSync(f) && statSync(f).isFile();
};
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const r = resolveRequest(hosting, path, fileExists);
  served.push({ path, isFile: r.isFile, status: r.status });
  if (r.status === 404) {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...r.headers });
    return res.end('Not found');
  }
  const file = normalize(join(publicDir, r.file));
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', ...r.headers });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;
const PORT = 9300 + Math.floor(Math.random() * 400);
const CHROME =
  process.env.CHROME_PATH ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
if (!CHROME) throw new Error('Chrome not found. Set CHROME_PATH.');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmpRoot = process.env.E2E_TMP || join(dirname(fileURLToPath(import.meta.url)), '..', '_tmp');
mkdirSync(tmpRoot, { recursive: true });
const profile = mkdtempSync(join(tmpRoot, 'consisto-release-'));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });
let cleaned = false;
function cleanup() {
  if (cleaned) return;
  cleaned = true;
  try { server.close(); } catch {}
  // kill the whole Chrome tree: killing only the main process can leave helpers behind
  try { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); else chrome.kill('SIGKILL'); } catch {}
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 8, retryDelay: 400 }); } catch {}
}
process.on('exit', cleanup);
for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => { cleanup(); process.exit(130); });

async function connect() {
  for (let i = 0; i < 80; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome did not start');
}

let ws, nextId = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const id = ++nextId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
let current = null; // the page being measured
const external = new Map(); // blocked hosts -> count

async function main() {
  const page = await connect();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); return; }
    const p = msg.params ?? {};
    if (msg.method === 'Fetch.requestPaused') {
      const host = new URL(p.request.url).host;
      if (host === new URL(ORIGIN).host) return ws.send(JSON.stringify({ id: ++nextId, method: 'Fetch.continueRequest', params: { requestId: p.requestId } }));
      external.set(host, (external.get(host) ?? 0) + 1);
      return ws.send(JSON.stringify({ id: ++nextId, method: 'Fetch.failRequest', params: { requestId: p.requestId, errorReason: 'BlockedByClient' } }));
    }
    if (!current) return;
    if (msg.method === 'Runtime.exceptionThrown') current.exceptions.push((p.exceptionDetails.exception?.description || p.exceptionDetails.text || '').slice(0, 300));
    else if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(p.type)) current.console.push(`console.${p.type}: ` + p.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300));
    else if (msg.method === 'Log.entryAdded' && ['error', 'warning'].includes(p.entry.level)) current.console.push(`log.${p.entry.level}: ${p.entry.text} ${p.entry.url ?? ''}`.slice(0, 300));
    else if (msg.method === 'Network.responseReceived' && p.response.url.startsWith(ORIGIN) && p.response.status >= 400) current.badResponses.push(`${p.response.status} ${p.response.url.replace(ORIGIN, '')}`);
    else if (msg.method === 'Network.loadingFailed' && p.requestId && !p.blockedReason && p.errorText !== 'net::ERR_BLOCKED_BY_CLIENT') current.failed.push(`${p.errorText} ${p.requestId}`);
  };
  for (const d of ['Page', 'Runtime', 'Network', 'Log']) await send(`${d}.enable`);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });

  const VIEWPORTS = [
    ['320', 320, 568, true],
    ['390', 390, 844, true],
    ['tablet-768', 768, 1024, true],
    ['desktop-1280', 1280, 800, false],
    ['large-1920', 1920, 1080, false],
  ];
  // Each screen: a path, whether the "Continue as Guest" choice is already stored, optional steps, and the text it must show.
  const SCREENS = [
    { name: 'auth-login', path: '/', guest: false, expect: ['SIGN IN', 'Continue as Guest'] },
    { name: 'auth-register', path: '/', guest: false, steps: `[...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent === 'Create account')?.click()`, expect: ['CREATE ACCOUNT', 'Already have an account?'] },
    { name: 'auth-forgot', path: '/', guest: false, steps: `[...document.querySelectorAll('*')].find((e) => e.children.length === 0 && e.textContent === 'Forgot Password?')?.click()`, expect: ['Forgot Password?', 'Back'] },
    { name: 'home-root', path: '/', guest: true, expect: ['SQL Practice'] },
    { name: 'home-habits', path: '/habits', guest: true, expect: ['SQL Practice'] },
    { name: 'habit-details', path: '/habits/sql-practice', guest: true, expect: ['Day Streak', 'OVERVIEW'] },
    { name: 'habit-calendar', path: '/habits/sql-practice/calendar', guest: true, expect: ['Monthly Completion'] },
    { name: 'wallet', path: '/wallet', guest: true, expect: ['Streak Freeze'] },
    { name: 'settings', path: '/settings', guest: true, expect: ['Archived Habits'] },
    { name: 'archived-habits', path: '/settings/archived', guest: true, expect: [] },
    // Phase 12A, in the PRODUCTION bundle (guest import is off here): honest Settings, and a backup sheet that promises no import
    { name: 'settings-honest', path: '/settings', guest: true, expect: ['Reminders & Streak Alerts', 'Not available on the web yet', 'Help & Support', 'No support address yet', 'Privacy Policy'], forbid: ['Feedback', 'Blocked in system settings', 'Habit Reminders', 'Delete Account'], noSwitches: true },
    { name: 'settings-backup-sheet', path: '/settings', guest: true, steps: `document.querySelector('[aria-label="Sign in to back up your progress"]')?.click()`, expect: ['Back Up Your Progress', 'save your progress to Firebase', 'any device', 'stay here and are not moved to your account', 'Not Now'], forbid: ['choose which habits', 'which habits to import', 'can be saved to your account', 'their history'] },
    { name: 'settings-privacy-sheet', path: '/settings', guest: true, steps: `document.querySelector('[aria-label="Privacy Policy"]')?.click()`, expect: ['Continue as Guest', 'Settings → Delete Account', 'does not send reminders or notifications', 'Calendar notes'], forbid: ['Skip for Now', 'shown locally by Android'] },
    { name: 'habit-reminder-sheet', path: '/habits/sql-practice', guest: true, steps: `document.querySelector('[aria-label="Edit reminder"]')?.click()`, expect: ["Reminders aren't available on the web yet.", 'saved with this habit on this device'], forbid: ['Notifications are turned off for this app'] },
  ];

  const results = [];
  for (const [vname, w, h, mobile] of VIEWPORTS) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    for (const s of SCREENS) {
      current = { exceptions: [], console: [], badResponses: [], failed: [] };
      // a clean slate for every page: no stored data, then the guest choice if the screen needs it
      await send('Page.navigate', { url: `${ORIGIN}/habits/__blank__` });
      await sleep(250);
      await ev(`localStorage.clear(); sessionStorage.clear(); ${s.guest ? `localStorage.setItem('guest_mode','true');` : ''} indexedDB.databases ? indexedDB.databases().then((l) => l.forEach((d) => indexedDB.deleteDatabase(d.name))) : 0`);
      current = { exceptions: [], console: [], badResponses: [], failed: [] };
      await send('Page.navigate', { url: ORIGIN + s.path });
      const text = async () => (await ev('document.body ? document.body.innerText : ""')) ?? '';
      let t = '';
      for (let i = 0; i < 60; i++) { await sleep(250); t = await text(); if (t.length > 20 && !/^\s*Loading/.test(t)) break; }
      if (s.steps) { await ev(s.steps); await sleep(600); t = await text(); }
      if (process.env.SELFTEST === '1' && s.name === 'home-habits' && vname === '320') {
        // negative control: these three defects MUST be reported (proves the detectors work)
        await ev(`console.error('selftest error'); fetch('/definitely-missing-asset.png'); const d = document.createElement('div'); d.style.cssText = 'position:absolute;left:0;top:0;width:400px;height:20px'; d.textContent = 'selftest wide element'; document.body.appendChild(d); 0`);
        await sleep(600);
      }
      await sleep(500);
      t = await text();
      const m = await ev(`(() => {
        const iw = ${w}, de = document.documentElement, bad = [];
        for (const el of document.querySelectorAll('body *')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 || r.height === 0 || (r.right <= iw + 1 && r.left >= -1)) continue;
          let p = el.parentElement, scrolls = false;
          while (p && p !== document.body) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') { scrolls = true; break; } p = p.parentElement; }
          if (!scrolls) bad.push((el.getAttribute('aria-label') || el.textContent || el.tagName).trim().slice(0, 40) + ' [' + Math.round(r.left) + '..' + Math.round(r.right) + ']');
        }
        return { iw, scrollW: de.scrollWidth, bodyW: document.body.scrollWidth, bad: bad.slice(0, 4), badCount: bad.length };
      })()`);
      const problems = [];
      if (current.exceptions.length) problems.push(`exceptions: ${current.exceptions.join(' | ')}`);
      if (current.console.length) problems.push(`console: ${[...new Set(current.console)].join(' | ')}`);
      if (current.badResponses.length) problems.push(`missing or failing assets: ${[...new Set(current.badResponses)].join(', ')}`);
      if (current.failed.length) problems.push(`failed requests: ${current.failed.join(', ')}`);
      if (/Something went wrong|Unmatched Route|This screen doesn.t exist|404/i.test(t)) problems.push('an error or not-found screen is showing');
      for (const need of s.expect) if (!t.includes(need)) problems.push(`missing text "${need}"`);
      for (const bad of s.forbid ?? []) if (t.includes(bad)) problems.push(`text that must not be shown: "${bad}"`);
      if (s.noSwitches && (await ev(`document.querySelectorAll('[role=switch]').length`)) > 0) problems.push('a notification switch is shown (the web cannot deliver reminders)');
      if (t.trim().length < 15) problems.push('the page is (nearly) blank');
      if (m.scrollW > m.iw + 1 || m.bodyW > m.iw + 1) problems.push(`the page scrolls sideways (scrollWidth ${m.scrollW}, viewport ${m.iw})`);
      if (m.badCount > 0) problems.push(`${m.badCount} element(s) stick out past the viewport edge: ${m.bad.join('; ')}`);
      const shot = `${SHOTS}/${s.name}-${vname}.png`.replace(/\\/g, '/');
      const img = (await send('Page.captureScreenshot', { format: 'png' })).result?.data;
      if (img) writeFileSync(shot, Buffer.from(img, 'base64'));
      results.push({ viewport: vname, screen: s.name, ok: problems.length === 0, problems });
      console.log(`  ${problems.length ? 'FAIL' : 'PASS'}  ${vname.padEnd(13)} ${s.name.padEnd(16)}${problems.length ? ' - ' + problems.join(' ; ') : ''}`);
    }
    // the long-named habit: open it from Home and check it fits
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
    current = { exceptions: [], console: [], badResponses: [], failed: [] };
    await send('Page.navigate', { url: `${ORIGIN}/habits/__blank__` }); await sleep(250);
    await ev(`localStorage.clear(); localStorage.setItem('guest_mode','true')`);
    await send('Page.navigate', { url: `${ORIGIN}/habits` });
    for (let i = 0; i < 60; i++) { await sleep(250); if (await ev(`!!document.querySelector('[aria-label^="Open Drink Water"]')`)) break; }
    await ev(`document.querySelector('[aria-label^="Open Drink Water"]')?.click()`);
    await sleep(1200);
    const t = (await ev('document.body.innerText')) ?? '';
    const m = await ev(`({ iw: ${w}, sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth), path: location.pathname })`);
    const problems = [];
    if (!m.path.startsWith('/habits/drink')) problems.push(`did not open the long-named habit (path ${m.path})`);
    if (m.sw > m.iw + 1) problems.push(`the page scrolls sideways (${m.sw} > ${m.iw})`);
    if (current.console.length || current.exceptions.length) problems.push(`console: ${[...current.console, ...current.exceptions].join(' | ')}`);
    if (!/Day Streak/.test(t)) problems.push('missing "Day Streak"');
    const img = (await send('Page.captureScreenshot', { format: 'png' })).result?.data;
    if (img) writeFileSync(`${SHOTS}/habit-long-name-${vname}.png`, Buffer.from(img, 'base64'));
    results.push({ viewport: vname, screen: 'habit-long-name', ok: problems.length === 0, problems });
    console.log(`  ${problems.length ? 'FAIL' : 'PASS'}  ${vname.padEnd(13)} ${'habit-long-name'.padEnd(16)}${problems.length ? ' - ' + problems.join(' ; ') : ''}`);
  }

  // Firebase Hosting (like this server) answers an unknown path with index.html and a 200, so a missing asset is not a 4xx: any path that looks
  // like a file (it has an extension) but was answered by the fallback is a missing asset.
  const missingAssets = [...new Set(served.filter((x) => !x.isFile && /\.[a-z0-9]{2,5}$/i.test(x.path)).map((x) => x.path))];
  if (missingAssets.length) results.push({ viewport: 'all', screen: 'assets', ok: false, problems: [`asset path(s) not in the build: ${missingAssets.join(', ')}`] });
  console.log(missingAssets.length ? `  FAIL  assets: requested but not in the build: ${missingAssets.join(', ')}` : `  PASS  assets: every requested file exists in the build`);
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} page checks passed, ${failed.length} failed`);
  console.log(`Requests to other origins that were BLOCKED (nothing left this machine): ${[...external].map(([h, n]) => `${h} x${n}`).join(', ') || 'none'}`);
  console.log(`Local requests served: ${served.length}; of those answered by the SPA fallback instead of a file: ${[...new Set(served.filter((x) => !x.isFile).map((x) => x.path))].join(', ')}`);
  console.log(`Screenshots: ${SHOTS}`);
  process.exitCode = failed.length ? 1 : 0;
}

try {
  await main();
} catch (e) {
  console.error('verify-release crashed:', e);
  process.exitCode = 2;
} finally {
  cleanup();
}
