/**
 * Firebase App Check for the Web app (Phase 11B). App Check attaches a short-lived attestation token to every request to Firebase
 * (Authentication, Firestore, ...), so the backend can tell requests from this app from scripted ones.
 *
 * SAFE BY DEFAULT: with no site key (the current state) nothing is started and nothing changes. With a site key the Web sends tokens, but
 * ENFORCEMENT is a Firebase Console setting, never done here. Do not enforce Firestore or Authentication while the Android app (which has no
 * App Check) shares the project: it would be locked out. See APPCHECK_SETUP.md.
 *
 * Provider: reCAPTCHA Enterprise (default, recommended: scores requests and has no per-month cap that matters here); reCAPTCHA v3 is supported
 * for projects that already have a v3 key. Development: the debug provider, via `EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN` (or an auto-generated token
 * printed in the browser console, to be registered in the Console). The debug token is read in development builds only (`__DEV__` is a
 * literal, so the value is removed from a production bundle), and it is ignored there even if set.
 */
import type { FirebaseApp } from 'firebase/app';
import { initializeAppCheck, ReCaptchaEnterpriseProvider, ReCaptchaV3Provider, type AppCheck } from 'firebase/app-check';

export type AppCheckEnv = { siteKey?: string; provider?: string; debugToken?: string; dev: boolean };

export type AppCheckPlan =
  | { enabled: false; reason: string }
  | { enabled: true; provider: 'enterprise' | 'v3'; siteKey: string; /** null: no debug provider (always the case in production). `true`: let the SDK generate one. */ debugToken: string | true | null };

/** Pure decision: what to start for this environment. */
export function planAppCheck(env: AppCheckEnv): AppCheckPlan {
  const siteKey = env.siteKey?.trim();
  if (!siteKey) return { enabled: false, reason: 'no site key configured' };
  const raw = (env.provider ?? 'enterprise').trim().toLowerCase();
  if (raw !== 'enterprise' && raw !== 'v3') return { enabled: false, reason: `unknown provider "${raw}" (use "enterprise" or "v3")` };
  // The debug provider exists in development builds only.
  const debugToken = env.dev ? env.debugToken?.trim() || true : null;
  return { enabled: true, provider: raw, siteKey, debugToken };
}

/** Expo inlines `process.env.EXPO_PUBLIC_*` only for literal property access, so each variable is spelled out. */
export const appCheckEnv = (): AppCheckEnv => ({
  siteKey: process.env.EXPO_PUBLIC_APPCHECK_SITE_KEY,
  provider: process.env.EXPO_PUBLIC_APPCHECK_PROVIDER,
  debugToken: typeof __DEV__ !== 'undefined' && __DEV__ ? process.env.EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN : undefined,
  dev: typeof __DEV__ !== 'undefined' && __DEV__,
});

/**
 * Starts App Check right after the Firebase app is created (before Authentication or Firestore are used). Never throws: while enforcement is
 * off, a failure to start App Check must not stop anyone from signing in. Returns null when it is not started.
 */
export function startAppCheck(app: FirebaseApp, env: AppCheckEnv = appCheckEnv(), win: { FIREBASE_APPCHECK_DEBUG_TOKEN?: string | boolean } | undefined = typeof self === 'undefined' ? undefined : (self as never)): AppCheck | null {
  const plan = planAppCheck(env);
  if (!plan.enabled || !win) return null;
  try {
    if (plan.debugToken !== null) win.FIREBASE_APPCHECK_DEBUG_TOKEN = plan.debugToken;
    return initializeAppCheck(app, {
      provider: plan.provider === 'v3' ? new ReCaptchaV3Provider(plan.siteKey) : new ReCaptchaEnterpriseProvider(plan.siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    return null;
  }
}
