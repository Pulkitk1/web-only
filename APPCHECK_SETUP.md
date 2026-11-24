# Firebase App Check for Consisto Web: setup

Status: **the code is in place and does nothing until you provide a site key. Enforcement is not enabled and must not be enabled yet** (see "Why not enforce").

What App Check does: the Web app attaches a short-lived token, proving the request comes from your real app, to every request to Firebase (Authentication, Firestore, and later Cloud Functions). The Console can then count, and later refuse, requests without a valid token. It reduces scripted sign-ups, scraping and quota abuse. It does **not** stop a real, signed-in user from sending wrong data from their own browser (that is the wallet limitation in `WEB_SECURITY_AUDIT.md`).

## What was added to the code
- `services/appCheck.ts`: `planAppCheck` (a pure decision, unit tested in `tests/appCheck.test.ts`) and `startAppCheck` (never throws).
- `services/firebase.ts`: starts App Check right after the Firebase app is created, before Authentication and Firestore are used.
- `firebase.json`: the Content-Security-Policy already allows the reCAPTCHA script, frames and requests.
- Nothing changes for any user while `EXPO_PUBLIC_APPCHECK_SITE_KEY` is empty (the current state).
- The Android app is not touched and has no App Check.

## Provider: reCAPTCHA Enterprise (recommended)
It is Google's current provider for the Web, scores each request, and works with Firebase App Check directly. reCAPTCHA v3 is also supported (set `EXPO_PUBLIC_APPCHECK_PROVIDER=v3`) for a project that already has a v3 key. Check the current free tier and pricing of reCAPTCHA Enterprise before launch (the free monthly allowance is large compared with one token refresh per client per hour, but confirm it on Google's pricing page).

## Production setup (Console steps, in order)
1. **Google Cloud Console > reCAPTCHA Enterprise** (project `habbit-tracker-12`): enable the API, **Create key**, platform *Website*, add **only the production domain(s)** (do not add `localhost`; local development uses the debug provider below). Copy the **site key**.
2. **Firebase Console > App Check > Apps > your Web app > reCAPTCHA Enterprise**: paste the site key and register. Leave the token time-to-live at the default (1 hour).
3. **Do not press Enforce on any product.**
4. Put the site key in the **production build environment** (not in a committed file):
   `EXPO_PUBLIC_APPCHECK_SITE_KEY=<site key>` and `EXPO_PUBLIC_APPCHECK_PROVIDER=enterprise`. The site key is a public identifier, like the Firebase web config.
5. `npm run build:web`, then `npm run verify:build` and `npm run verify:csp`, then deploy.
6. Open the deployed site, sign in, and confirm in the browser's network tab that requests to `firestore.googleapis.com` carry an `X-Firebase-AppCheck` header.

## Local development (debug provider)
1. In `.env.local`, set `EXPO_PUBLIC_APPCHECK_SITE_KEY` to the same site key (the debug provider does not call reCAPTCHA, but the SDK needs a key to start).
2. Either leave `EXPO_PUBLIC_APPCHECK_DEBUG_TOKEN` empty (the SDK then prints a new token in the browser console on first run: `App Check debug token: ...`) or set it to a UUID you generate.
3. **Firebase Console > App Check > Apps > your Web app > Manage debug tokens > Add**, and paste that token.
4. Treat debug tokens like passwords: anyone who has one can get App Check tokens. **They are read in development builds only** (`__DEV__` is a literal, so the value is removed from a production bundle) and `npm run verify:build` fails if a configured debug token appears in the built bundle.

## Monitoring (the only thing to do after step 6)
Firebase Console > App Check > **APIs** > Cloud Firestore and Authentication show verified and unverified requests. Watch for **1 to 2 weeks**. Expect:
- Web requests: verified (once the site key is deployed).
- Android requests: **unverified, permanently**, until Android adds App Check. That is normal.
- A scripted client: unverified.

## Why not enforce
Enforcement is a **per-product, whole-project** switch, not per app. Turning it on for Firestore or Authentication immediately rejects every request that has no token, which includes the **unchanged Android app** and all its users. Do not enforce Firestore or Authentication while Android has no App Check.

When enforcement becomes possible:
1. Android ships App Check (Play Integrity provider) and most users have updated. Check the Console metrics: unverified Android traffic should be near zero.
2. Enforce Firestore first, then Authentication, one at a time, watching error rates for a day each.
3. For Cloud Functions (`CLOUD_FUNCTIONS_PROPOSAL.md`), enforcement is **per function** (`enforceAppCheck: true`) and can be used earlier without affecting Android.

## Rollback
Remove `EXPO_PUBLIC_APPCHECK_SITE_KEY` from the build environment and redeploy: the Web stops sending tokens. While enforcement is off, nothing else changes.

## Checklist
- [ ] reCAPTCHA Enterprise key created for the production domain only
- [ ] Web app registered in App Check with that key
- [ ] Site key set in the production build environment only
- [ ] `verify:build` and `verify:csp` pass on the production build
- [ ] Network tab shows `X-Firebase-AppCheck` on Firestore requests
- [ ] Metrics watched for 1 to 2 weeks
- [ ] Enforcement left **off**
