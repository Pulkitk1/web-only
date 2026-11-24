// Proves the hosting configuration (firebase.json) works with the real production build:   npm run verify:csp
//   (builds nothing: run "npm run build:web" first.) The Firebase Hosting emulator does not apply custom headers, so this script serves `dist`
//   itself, applying the `rewrites` and `headers` rules of firebase.json the way Firebase Hosting documents them (glob `source`, later rules
//   override earlier ones, `**` rewrite to /index.html for paths that are not files), then drives headless Chrome against it. What it proves is
//   that the POLICY VALUES work with the real app; that Firebase Hosting sends them is its documented behaviour (check with curl after a deploy).
//
// Checks: the security headers arrive; the app renders under the Content-Security-Policy with no violation; the login request reaches Firebase
// Authentication and the data requests reach Firestore (Firebase endpoints are answered by this script, so nothing touches the real project);
// the policy is really enforced (an injected inline script is refused); a deep link is served by the single-page-app rewrite.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadHosting, resolveRequest } from './lib/hostingConfig.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hosting = loadHosting(root);
const publicDir = hosting.publicDir;
if (!existsSync(join(publicDir, 'index.html'))) throw new Error(`No build in ${publicDir}. Run "npm run build:web" first.`);
console.log(`Hosting configuration under test: ${hosting.kind === 'vercel' ? 'vercel.json (Vercel)' : 'firebase.json (Firebase Hosting)'}`);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.ico': 'image/x-icon', '.ttf': 'font/ttf', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };
const fileExists = (p) => {
  const f = normalize(join(publicDir, p));
  return f.startsWith(publicDir) && existsSync(f) && statSync(f).isFile();
};
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const r = resolveRequest(hosting, path, fileExists);
  if (r.status === 404) {
    res.writeHead(404, { 'Content-Type': 'text/plain', ...r.headers });
    return res.end('Not found');
  }
  const file = normalize(join(publicDir, r.file));
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', ...r.headers });
  res.end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const PORT = 9800 + Math.floor(Math.random() * 150);
const CHROME =
  process.env.CHROME_PATH ||
  ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
if (!CHROME) throw new Error('Chrome not found. Set CHROME_PATH.');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const tmpRoot = process.env.E2E_TMP || join(dirname(fileURLToPath(import.meta.url)), '..', '_tmp');
mkdirSync(tmpRoot, { recursive: true });
const profile = mkdtempSync(join(tmpRoot, 'consisto-csp-'));
const chrome = spawn(CHROME, [`--remote-debugging-port=${PORT}`, '--headless=new', '--disable-gpu', `--user-data-dir=${profile}`, '--window-size=1280,900', 'about:blank'], { stdio: 'ignore' });

async function connect() {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find((t) => t.type === 'page');
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error('Chrome did not start');
}

const seen = { identity: [], firestore: [], violations: [], exceptions: [] };
let ws;
let nextId = 0;
const pending = new Map();
const send = (method, params = {}) => new Promise((res) => { const id = ++nextId; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result?.result?.value;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = (uid, email) => {
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ iss: 'https://securetoken.google.com/mock', aud: 'mock', auth_time: now, user_id: uid, sub: uid, iat: now, exp: now + 3600, email, firebase: { sign_in_provider: 'password' } })}.sig`;
};

function onPaused(p) {
  const url = new URL(p.request.url);
  const reply = (status, body) =>
    ws.send(JSON.stringify({ id: ++nextId, method: 'Fetch.fulfillRequest', params: { requestId: p.requestId, responseCode: status, responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Access-Control-Allow-Headers', value: '*' }], body: Buffer.from(JSON.stringify(body)).toString('base64') } }));
  if (url.hostname.includes('firestore')) {
    seen.firestore.push(url.pathname);
    return ws.send(JSON.stringify({ id: ++nextId, method: 'Fetch.failRequest', params: { requestId: p.requestId, errorReason: 'BlockedByClient' } }));
  }
  if (p.request.method === 'OPTIONS') return reply(204, {});
  const action = (url.pathname.match(/accounts:(\w+)/) || [])[1];
  if (action) seen.identity.push(action);
  let body = {};
  try { body = JSON.parse(p.request.postData || '{}'); } catch {}
  const email = String(body.email || '').toLowerCase();
  if (action === 'signInWithPassword') return reply(200, { localId: 'uid-csp', email, idToken: token('uid-csp', email), registered: true, refreshToken: 'refresh', expiresIn: '3600' });
  if (action === 'lookup') return reply(200, { users: [{ localId: 'uid-csp', email, emailVerified: false, providerUserInfo: [{ providerId: 'password', federatedId: email, email, rawId: email }], validSince: '0', lastLoginAt: '0', createdAt: '0' }] });
  return reply(200, {});
}

try {
  console.log(`Checking ${BASE}`);
  console.log('\nHeaders and routing (what the host sends)');
  const home = await fetch(BASE + '/');
  const deep = await fetch(BASE + '/habits/some-deep-link');
  const h = (r, k) => r.headers.get(k) ?? '';
  const required = { 'content-security-policy': /default-src 'self'/, 'strict-transport-security': /max-age=\d{7,}/, 'x-content-type-options': /nosniff/, 'x-frame-options': /DENY/, 'referrer-policy': /strict-origin/, 'permissions-policy': /camera=\(\)/, 'cross-origin-opener-policy': /same-origin/ };
  for (const [k, re] of Object.entries(required)) check(`${k} is sent`, re.test(h(home, k)), h(home, k) || 'missing');
  check('a deep link is answered with the app (single-page-app rewrite), with the same headers', deep.status === 200 && (await deep.text()).includes('<div id="root">') && /default-src 'self'/.test(h(deep, 'content-security-policy')));
  const script = (await home.text()).match(/src="(\/_expo\/static\/js\/web\/[^"]+)"/)?.[1];
  const asset = script ? await fetch(BASE + script) : null;
  check('hashed scripts are cached for a year (immutable); index.html is not cached', !!asset && /immutable/.test(h(asset, 'cache-control')) && /no-cache/.test(h(await fetch(BASE + '/index.html'), 'cache-control')));

  const page = await connect();
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method === 'Fetch.requestPaused') onPaused(msg.params);
    else if (msg.method === 'Log.entryAdded') { const e = msg.params.entry; if (e.source === 'security' || /Content Security Policy|Refused to/i.test(e.text)) seen.violations.push(e.text.slice(0, 200)); }
    else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') { const t = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '); if (/Content Security Policy|Refused to/i.test(t)) seen.violations.push(t.slice(0, 200)); }
    else if (msg.method === 'Runtime.exceptionThrown') seen.exceptions.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
  };
  for (const d of ['Page', 'Runtime', 'Log']) await send(`${d}.enable`);
  await send('Fetch.enable', { patterns: [{ urlPattern: '*identitytoolkit.googleapis.com*' }, { urlPattern: '*securetoken.googleapis.com*' }, { urlPattern: '*firestore.googleapis.com*' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `try { localStorage.setItem('guest_mode', 'false'); } catch (e) {}` });

  console.log('\nThe app runs under the policy');
  await send('Page.navigate', { url: BASE + '/' });
  const waitText = async (s, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if ((((await ev('document.body.innerText')) ?? '')).includes(s)) return true; await sleep(200); } return false; };
  check('the login screen renders', await waitText('SIGN IN'));
  check('no policy violation while loading', seen.violations.length === 0, seen.violations.join(' | '));

  const fill = (label, value) => ev(`(() => { const e = document.querySelector('input[aria-label="${label}"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(e, ${JSON.stringify(value)}); e.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
  await fill('Email', 'csp@example.test');
  await fill('Password', 'secret1');
  await ev(`(() => { const b = [...document.querySelectorAll('[role=button]')].find((e) => (e.innerText || '').trim() === 'Sign in'); b && b.click(); return !!b; })()`);
  const t0 = Date.now();
  while (Date.now() - t0 < 20000 && !seen.firestore.length) await sleep(200);
  check('the sign-in request reaches Firebase Authentication (connect-src allows it)', seen.identity.includes('signInWithPassword'), JSON.stringify(seen.identity));
  check('the account lookup reaches Firebase Authentication', seen.identity.includes('lookup'));
  check('the data requests reach Firestore (connect-src allows them)', seen.firestore.length > 0, 'no Firestore request seen');
  await sleep(1500);
  check('still no policy violation after sign-in and the first Firestore requests', seen.violations.length === 0, seen.violations.join(' | '));
  check('no uncaught script error', seen.exceptions.length === 0, seen.exceptions.join(' | ').slice(0, 300));

  console.log('\nThe policy is really enforced');
  await ev(`(() => { const s = document.createElement('script'); s.textContent = 'window.__csp_probe = 1'; document.body.appendChild(s); })()`);
  await sleep(500);
  check('an injected inline script does not run', (await ev('typeof window.__csp_probe')) === 'undefined');
  check('...and the browser reported the violation', seen.violations.some((v) => /script-src|Content Security Policy/i.test(v)), JSON.stringify(seen.violations).slice(0, 200));
  const before = seen.violations.length;
  await ev(`(() => { const f = document.createElement('iframe'); f.src = 'https://example.com/'; document.body.appendChild(f); return true; })()`);
  await sleep(1500);
  check('a foreign page cannot be framed by the app (frame-src refuses it and the browser reports it)', seen.violations.slice(before).some((v) => /Refused to frame|Framing .* violates/i.test(v)), JSON.stringify(seen.violations.slice(before)).slice(0, 200));
} catch (e) {
  failures++;
  console.log('  FAIL  the check itself crashed: ' + (e instanceof Error ? e.message : e));
} finally {
  try { ws?.close(); } catch {}
  try { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); else chrome.kill('SIGKILL'); } catch {}
  server.close();
  await sleep(800);
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {}
  console.log(failures ? `\n${failures} check(s) FAILED.` : '\nThe hosting configuration works with the production build.');
  process.exitCode = failures ? 1 : 0;
}
