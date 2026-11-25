// Verifies a production web build before it is deployed:   npm run build:web && npm run verify:build
//   node scripts/verify-production-build.mjs [dir]         (default dir: dist)
//
// It fails (exit code 1) if the build contains anything that must never ship: development hooks, test knobs, source maps, secret-looking
// material, inline scripts (which the Content-Security-Policy forbids), or if the guest import is switched on, or if the hosting config is
// missing its security headers or could publish Firestore rules by accident. It reads files only; it never contacts Firebase.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(root, 'dist');
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${!ok && detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
};

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
if (!existsSync(join(dir, 'index.html'))) {
  console.error(`No build found in ${dir}. Run "npm run build:web" first.`);
  process.exit(1);
}
const files = walk(dir);
const js = files.filter((f) => f.endsWith('.js'));
const bundle = js.map((f) => readFileSync(f, 'utf8')).join('\n');
const html = readFileSync(join(dir, 'index.html'), 'utf8');
const count = (s) => bundle.split(s).length - 1;

console.log(`Checking ${relative(process.cwd(), dir) || '.'} (${files.length} files, ${js.length} JavaScript files, ${(bundle.length / 1048576).toFixed(1)} MB of script)`);

console.log('\nNothing development-only is shipped');
for (const needle of ['__consistoFake', 'consistoDev', 'consisto_mock_start_coins', 'consisto_seed_demo', 'EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN', 'LIVE_TEST_', 'e2e_auth', 'e2e_fs']) {
  check(`no "${needle}" in the bundle`, count(needle) === 0, `${count(needle)} occurrence(s)`);
}
// The Firebase SDK itself mentions FIREBASE_APPCHECK_DEBUG_TOKEN, so check the VALUE instead: a debug token set in the environment must not be inlined.
const debugTokens = ['.env', '.env.local', '.env.production', '.env.production.local']
  .map((f) => join(root, f))
  .filter(existsSync)
  .map((f) => (readFileSync(f, 'utf8').match(/^\s*EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN\s*=\s*"?([^"\r\n]+)"?\s*$/m) ?? [])[1])
  .concat(process.env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN)
  .filter((v) => v && v.trim());
check('an App Check debug token set in the environment is not in the bundle', debugTokens.every((t) => !bundle.includes(t)), 'a debug token was inlined');
check('no source maps are published', !files.some((f) => f.endsWith('.map')));
check('no environment or credential file is part of the output', !files.some((f) => /(^|[\\/])(\.env|.*serviceAccount.*|.*credentials.*|.*\.pem|.*\.key|.*\.jks)([^\\/]*)$/i.test(f)));

console.log('\nEvery route of the app is in the build');
// Expo builds without complaint when a route file is missing (for example from a checkout that left out a file), so the build is compared
// with app/: every route file there must have its chunk (named after the file, plus a content hash).
const routeNames = walk(join(root, 'app'))
  .filter((f) => /\.(tsx|ts)$/.test(f))
  .map((f) => f.split(/[\\/]/).pop().replace(/\.(tsx|ts)$/, ''))
  .filter((n) => n !== '_layout' && !n.startsWith('+'));
const chunkNames = js.map((f) => f.split(/[\\/]/).pop().replace(/-[0-9a-f]{32}\.js$/, ''));
for (const n of [...new Set(routeNames)].sort()) {
  const want = routeNames.filter((x) => x === n).length;
  const got = chunkNames.filter((c) => c === n).length;
  check(`route "${n}" is in the build${want > 1 ? ` (${want} route files share this name)` : ''}`, got >= want, `${got} chunk(s) for ${want} route file(s)`);
}
check('the app layout is in the build', chunkNames.includes('_layout'));

console.log('\nNo secrets');
for (const [name, re] of [
  ['private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/],
  ['service account fields', /"private_key"|"client_email"|"private_key_id"/],
  ['OAuth client secret', /client_secret/i],
  ['AWS access key', /AKIA[0-9A-Z]{16}/],
  // A literal credential assigned to a key named secret/password (case sensitive, so the SDK's error-code tables such as INVALID_PASSWORD:'auth/wrong-password' do not match).
  ['literal secret or password assignment', /(?<![A-Za-z_])(?:secret|password|passwd|apiSecret)["']?\s*[:=]\s*["'](?=[^"']*\d)(?=[^"']*[A-Za-z])[A-Za-z0-9+/_=-]{12,}["']/],
]) {
  const m = bundle.match(re);
  check(`no ${name}`, !m, m ? m[0].slice(0, 80) : '');
}
const apiKeys = bundle.match(/AIza[0-9A-Za-z_-]{35}/g) ?? [];
check('exactly one Google API key (the Firebase web key, public by design) is present', new Set(apiKeys).size === 1, `${new Set(apiKeys).size} distinct key(s)`);

console.log('\nThe page can run under the Content-Security-Policy');
const inline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/\bsrc=/.test(m[1]) && m[2].trim() !== '');
check('index.html has no inline script', inline.length === 0, `${inline.length} inline script(s)`);
check('index.html has no inline event handlers', !/\son[a-z]+\s*=\s*["']/i.test(html));
check('index.html loads scripts from this origin only', [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)].every((m) => m[1].startsWith('/') || m[1].startsWith('./')));

console.log('\nGuest import stays off');
const envFiles = ['.env', '.env.local', '.env.production', '.env.production.local'].map((f) => join(root, f)).filter(existsSync);
const flagOn = envFiles.some((f) => /^\s*EXPO_PUBLIC_GUEST_IMPORT_ENABLED\s*=\s*"?true"?\s*$/m.test(readFileSync(f, 'utf8')));
check('EXPO_PUBLIC_GUEST_IMPORT_ENABLED is not "true" in any env file', !flagOn);
check('...nor in the build environment', process.env.EXPO_PUBLIC_GUEST_IMPORT_ENABLED !== 'true');

const REQUIRED = ['content-security-policy', 'strict-transport-security', 'x-content-type-options', 'referrer-policy', 'permissions-policy', 'x-frame-options'];
const checkHeaders = (headers, label) => {
  for (const k of REQUIRED) check(`${label}: header ${k} is set`, !!headers[k]);
  const csp = headers['content-security-policy'] ?? '';
  check(`${label}: CSP forbids framing, plugins and base-tag injection`, /frame-ancestors 'none'/.test(csp) && /object-src 'none'/.test(csp) && /base-uri 'self'/.test(csp));
  check(`${label}: CSP allows no 'unsafe-eval' and no 'unsafe-inline' for scripts`, !/script-src[^;]*'unsafe-(eval|inline)'/.test(csp));
};
const flat = (rules) => Object.fromEntries((rules ?? []).flatMap((r) => r.headers.map((x) => [x.key.toLowerCase(), x.value])));

console.log('\nHosting configuration: Vercel (vercel.json)');
const vercelPath = join(root, 'vercel.json');
let vercelHeaders = null;
if (!existsSync(vercelPath)) check('vercel.json exists', false);
else {
  const v = JSON.parse(readFileSync(vercelPath, 'utf8'));
  check('Vercel serves the build folder (outputDirectory dist)', v.outputDirectory === 'dist');
  check('Vercel builds with the project script and verifies the build before it can deploy', /npm run build:web/.test(v.buildCommand ?? '') && /npm run verify:build/.test(v.buildCommand ?? ''));
  check('Vercel installs exactly what the lockfile says (npm ci)', v.installCommand === 'npm ci');
  check('every route is rewritten to index.html (single-page app) except the asset folders, so a missing script is a 404, not HTML', (v.rewrites ?? []).some((r) => r.destination === '/index.html' && /_expo\//.test(r.source) && /assets\//.test(r.source)));
  check('vercel.json holds no secrets: no env, no functions, no crons', !('env' in v) && !('build' in v) && !('functions' in v) && !('crons' in v));
  vercelHeaders = flat((v.headers ?? []).filter((r) => r.source === '/(.*)'));
  checkHeaders(vercelHeaders, 'vercel.json');
}

console.log('\nHosting configuration: Firebase Hosting (firebase.json, kept for reference)');
const cfgPath = join(root, 'firebase.json');
if (!existsSync(cfgPath)) console.log('  (no firebase.json)');
else {
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  const h = [].concat(cfg.hosting ?? [])[0] ?? {};
  const headers = flat(h.headers);
  check('hosting serves the build folder', h.public === 'dist');
  check('hosting rewrites every route to index.html (single-page app)', (h.rewrites ?? []).some((r) => r.source === '**' && r.destination === '/index.html'));
  checkHeaders(headers, 'firebase.json');
  check('firebase.json cannot publish Firestore rules or functions by accident (hosting only)', !('firestore' in cfg) && !('functions' in cfg));
  if (vercelHeaders) {
    // the security headers are the rule that covers every path (`**` in Firebase, `/(.*)` in Vercel); the caching rules are separate and compared in the unit tests
    const fbSecurity = flat((h.headers ?? []).filter((r) => r.source === '**'));
    const same = Object.keys(fbSecurity).every((k) => vercelHeaders[k] === fbSecurity[k]) && Object.keys(vercelHeaders).every((k) => fbSecurity[k] === vercelHeaders[k]);
    check('the Vercel and Firebase security headers are identical (no drift between the two configurations)', same);
  }
}

console.log(failures ? `\n${failures} check(s) FAILED. Do not deploy this build.` : '\nAll production checks passed.');
process.exit(failures ? 1 : 0);
