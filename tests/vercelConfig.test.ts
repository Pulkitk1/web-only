/**
 * Phase 13A: the Vercel deployment configuration (vercel.json). It must behave like the Firebase Hosting configuration it replaces
 * (same security headers, same single-page-app routing) and must hold no secrets and nothing that deploys Firebase or functions.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { loadHosting, resolveRequest } from '../scripts/lib/hostingConfig.mjs';

const root = join(__dirname, '..');
const read = (f: string) => readFileSync(join(root, f), 'utf8');
const vercel = JSON.parse(read('vercel.json'));
const firebase = JSON.parse(read('firebase.json')).hosting;
const pkg = JSON.parse(read('package.json'));
const flat = (rules: { headers: { key: string; value: string }[] }[]) => Object.fromEntries(rules.flatMap((r) => r.headers.map((h) => [h.key.toLowerCase(), h.value])));

const files = new Set(['/index.html', '/favicon.ico', '/metadata.json', '/_expo/static/js/web/entry-abc123.js', '/assets/img/logo-abc123.png']);
const exists = (p: string) => files.has(p);
const v = loadHosting(root, 'vercel');
const at = (path: string) => resolveRequest(v, path, exists);

describe('vercel.json: build settings', () => {
  it('uses the project scripts and the Expo export folder', () => {
    expect(vercel.outputDirectory).toBe('dist');
    expect(vercel.installCommand).toBe('npm ci');
    expect(vercel.buildCommand).toBe('npm run build:web && npm run verify:build'); // the deploy is gated by the build verification
    expect(vercel.framework).toBeNull();
  });
  it('the scripts it names exist, and the Node version matches what Expo SDK 58 needs (22.13+ on the 22 line)', () => {
    expect(pkg.scripts['build:web']).toBe('expo export --platform web');
    expect(pkg.scripts['verify:build']).toBeTruthy();
    expect(pkg.engines.node).toBe('22.x');
  });
  it('holds no secrets and deploys nothing else: no env, functions, crons, build env or Firebase config', () => {
    for (const k of ['env', 'build', 'functions', 'crons', 'firebase', 'regions']) expect(vercel, k).not.toHaveProperty(k);
    expect(JSON.stringify(vercel)).not.toMatch(/AIza|private_key|client_secret|EXPO_PUBLIC_|apiKey/i);
  });
});

describe('vercel.json: the security headers are the Firebase ones, exactly', () => {
  const all = vercel.headers.find((r: { source: string }) => r.source === '/(.*)');
  const fb = firebase.headers.find((r: { source: string }) => r.source === '**');
  it('every header, same key and same value, in both directions (so the two configurations cannot drift)', () => {
    expect(flat([all])).toEqual(flat([fb]));
  });
  it('the Content-Security-Policy is strict: self only, no inline or eval scripts, no framing, no plugins', () => {
    const csp = flat([all])['content-security-policy'];
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-(eval|inline)'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
    expect(csp).toMatch(/base-uri 'self'/);
    expect(csp).toMatch(/connect-src[^;]*https:\/\/\*\.googleapis\.com/); // Firebase Authentication, Firestore, Installations
  });
  it('HSTS, nosniff, DENY framing, referrer and permissions policies are all set', () => {
    const h = flat([all]);
    expect(h['strict-transport-security']).toMatch(/max-age=31536000/);
    expect(h['x-content-type-options']).toBe('nosniff');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['permissions-policy']).toMatch(/camera=\(\)/);
    expect(h['cross-origin-opener-policy']).toBe('same-origin-allow-popups');
  });
  it('caching rules equal the Firebase ones, and never overlap the rule that sets the security headers', () => {
    const cache = (rules: { source: string; headers: { key: string; value: string }[] }[]) => rules.filter((r) => r.headers.some((h) => h.key === 'Cache-Control')).map((r) => r.headers.find((h) => h.key === 'Cache-Control')!.value).sort();
    expect(cache(vercel.headers)).toEqual(cache(firebase.headers));
    expect(all.headers.some((h: { key: string }) => h.key === 'Cache-Control')).toBe(false);
  });
});

describe('vercel.json: routing (single-page app, deep links, missing assets)', () => {
  it.each(['/', '/habits', '/wallet', '/settings', '/settings/archived', '/habits/sql-practice', '/habits/sql-practice/calendar', '/habits/some-new-habit/calendar'])(
    'the route %s is answered with the app (index.html)',
    (p) => {
      const r = at(p);
      expect(r.status).toBe(200);
      expect(r.file === '/index.html' || r.file === p + 'index.html').toBe(true);
    },
  );
  it('a real file is served as itself', () => {
    expect(at('/favicon.ico')).toMatchObject({ status: 200, file: '/favicon.ico', isFile: true });
    expect(at('/_expo/static/js/web/entry-abc123.js')).toMatchObject({ status: 200, isFile: true });
  });
  it('a MISSING script, style, font or image is a 404, never the app page (so a bad deploy cannot hide behind HTML)', () => {
    expect(at('/_expo/static/js/web/entry-missing.js').status).toBe(404);
    expect(at('/assets/img/missing.png').status).toBe(404);
    expect(at('/assets/fonts/x.ttf').status).toBe(404);
  });
  it('every answer, a 404 included, carries the security headers', () => {
    for (const p of ['/habits', '/', '/_expo/static/js/web/entry-missing.js', '/favicon.ico']) {
      const h = at(p).headers;
      expect(h['Content-Security-Policy'], p).toMatch(/default-src 'self'/);
      expect(h['Strict-Transport-Security'], p).toBeTruthy();
      expect(h['X-Frame-Options'], p).toBe('DENY');
    }
  });
  it('caching: hashed files are immutable for a year; the page itself is never cached', () => {
    expect(at('/_expo/static/js/web/entry-abc123.js').headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
    expect(at('/assets/img/logo-abc123.png').headers['Cache-Control']).toBe('public, max-age=31536000, immutable');
    expect(at('/index.html').headers['Cache-Control']).toBe('no-cache');
    expect(at('/').headers['Cache-Control']).toBe('no-cache');
    expect(at('/habits').headers['Cache-Control']).toBeUndefined(); // a route is the page too: Vercel's default (must-revalidate) applies
  });
});

describe('the repository settings Vercel relies on', () => {
  const ignore = read('.gitignore');
  it('env files stay out of Git (only .env.example is committed) and so does Vercel\'s local link', () => {
    expect(ignore).toMatch(/^\.env\.\*$/m);
    expect(ignore).toMatch(/^!\.env\.example$/m);
    expect(ignore).toMatch(/^\.vercel\/$/m);
  });
  it('the example env file lists every variable the build reads, with no values for secrets and guest import off', () => {
    const ex = read('.env.example');
    for (const k of ['EXPO_PUBLIC_FIREBASE_API_KEY', 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET', 'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', 'EXPO_PUBLIC_FIREBASE_APP_ID', 'EXPO_PUBLIC_GUEST_IMPORT_ENABLED', 'EXPO_PUBLIC_SUPPORT_EMAIL', 'EXPO_PUBLIC_APPCHECK_SITE_KEY']) expect(ex, k).toContain(k + '=');
    expect(ex).toMatch(/^EXPO_PUBLIC_GUEST_IMPORT_ENABLED=false\s*$/m);
    expect(ex).not.toMatch(/AIza/);
  });
});
