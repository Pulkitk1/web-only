// The hosting configuration the verification scripts test: Vercel (vercel.json, the deployment target since Phase 13A) or Firebase Hosting
// (firebase.json, kept for reference and as the source the Vercel headers must equal). One loader, so verify-csp.mjs and verify-release.mjs can
// serve the real build with exactly the rewrites and headers the chosen host would apply:
//   HOSTING_CONFIG=vercel (default when vercel.json exists) | firebase
// Read-only: it only reads configuration files.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Firebase Hosting glob: `**` matches anything (slashes included), `*` matches within one path segment.
const globToRegExp = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*') + '$');
// Vercel sources are path-to-regexp patterns whose groups are regular expressions: "/(.*)", "/_expo/static/(.*)", "/((?!_expo/).*)".
const vercelToRegExp = (s) => new RegExp('^' + s + '$');

export const hostingKind = (root) => process.env.HOSTING_CONFIG || (existsSync(join(root, 'vercel.json')) ? 'vercel' : 'firebase');

export function loadHosting(root, kind = hostingKind(root)) {
  if (kind === 'vercel') {
    const config = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'));
    return {
      kind,
      config,
      publicDir: join(root, config.outputDirectory ?? 'dist'),
      headerRules: (config.headers ?? []).map((r) => ({ re: vercelToRegExp(r.source), source: r.source, headers: r.headers })),
      rewrites: (config.rewrites ?? []).map((r) => ({ re: vercelToRegExp(r.source), source: r.source, destination: r.destination })),
      // Vercel matches header sources against the URL that was requested.
      headerPath: (path) => path,
    };
  }
  const config = JSON.parse(readFileSync(join(root, 'firebase.json'), 'utf8'));
  const hosting = [].concat(config.hosting)[0];
  return {
    kind: 'firebase',
    config,
    publicDir: join(root, hosting.public),
    headerRules: (hosting.headers ?? []).map((r) => ({ re: globToRegExp(r.source), source: r.source, headers: r.headers })),
    rewrites: (hosting.rewrites ?? []).map((r) => ({ re: globToRegExp(r.source), source: r.source, destination: r.destination })),
    // The existing Firebase check models a rewritten route as the file it is rewritten to.
    headerPath: (path, isFile) => (isFile ? path : '/index.html'),
  };
}

/**
 * What the host does with a request: a real file wins (the directory index too: "/" is "/index.html"); otherwise the first rewrite whose
 * source matches names the file to serve; otherwise 404 (so a missing script or image is a 404, not the app's HTML).
 * `exists(path)` says whether the build folder has that file. Returns { status, file, isFile, headers }.
 */
export function resolveRequest(h, path, exists) {
  let file = path;
  let isFile = exists(path);
  if (!isFile && path.endsWith('/') && exists(path + 'index.html')) { file = path + 'index.html'; isFile = true; }
  let status = 200;
  if (!isFile) {
    const rule = h.rewrites.find((r) => r.re.test(path));
    if (rule) file = rule.destination;
    else status = 404;
  }
  const headers = {};
  for (const r of h.headerRules) if (r.re.test(h.headerPath(path, isFile))) for (const x of r.headers) headers[x.key] = x.value;
  return { status, file, isFile, headers };
}
