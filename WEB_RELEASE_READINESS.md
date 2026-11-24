# Consisto Web: release readiness (Phase 12 preparation)

Project: `D:\habbit_tracker_web\web` (Expo + React Native Web + TypeScript + Firebase `habbit-tracker-12`).
Status: **preparation only. Nothing was deployed (no Hosting, no Functions, no rules), nothing was committed or pushed, `.env.local` was not touched, no production data or Kotlin file was touched, App Check is not enforced, and guest import stays off.** The Firestore Combined rules deployed earlier are unchanged.

## 1. Verdict
**Technically ready to deploy; not ready to launch publicly.** Every build, route, security-header and test check passes. The blockers are **product and policy content**, not code defects: five user-facing items in Settings and the privacy policy would mislead or fail a public user (section 8). They need your decision before Hosting is deployed.

## 2. Production build
| Check | Result |
|---|---|
| Build (`npm run build:web`, guest import set to `false` in the shell, `.env.local` untouched) | **succeeded** in 16 s: 52 files, 6.9 MB (11 JavaScript files, 3.0 MB), output `dist` |
| `npm run verify:build` | **all 31 checks passed**: no `__consistoFake`, `consistoDev`, mock-coin knob, App Check debug token or `LIVE_TEST_` in the bundle; no source maps; no env or credential files; no private key, service-account field, OAuth secret, AWS key or literal password; exactly one Google API key (the public Firebase web key); no inline scripts or event handlers; guest import not `true` in any env file or the build environment; hosting config serves `dist`, rewrites to `index.html`, sends all security headers, and cannot publish rules or functions |
| `npm run verify:csp` | **all 19 checks passed**: headers sent; deep link served by the SPA rewrite; hashed scripts cached immutable, `index.html` not cached; login screen renders under the Content-Security-Policy with no violation; the sign-in and lookup requests reach Firebase Authentication and the data requests reach Firestore (Firebase answered by the script, nothing contacted the real project); an injected inline script is refused; a foreign frame is refused |
| Firebase production configuration (in the bundle; the key is not printed) | project id `habbit-tracker-12` present, auth domain `habbit-tracker-12.firebaseapp.com`, storage bucket `...firebasestorage.app`, one API key; **no** `localhost`, `127.0.0.1`, `demo-consisto` or emulator hostname; `connectFirestoreEmulator` and `connectAuthEmulator` appear only as Firebase SDK library code: the app source never calls any emulator function |
| Development-only tools excluded | yes (verify:build, plus: no `console.log`, `TODO`, `FIXME`, `HACK` or `debugger` in app source) |
| Guest import | **off**: `EXPO_PUBLIC_GUEST_IMPORT_ENABLED` is not set in `.env.local`; the flag defaults to off in a production build; this build was made with it set to `false`; verified |

## 3. Route verification and responsive testing
New script `scripts/verify-release.mjs` (read-only; `npm run build:web` first): serves `dist` with the rewrites and headers of `firebase.json`, loads **every route directly** in headless Chrome at **320, 390, 768 (tablet), 1280 (desktop) and 1920 (large desktop)**, and blocks every request to another origin (none was attempted). For each page it checks console errors and warnings, uncaught exceptions, CSP violations, failed or missing assets, an error or not-found screen, expected text, a blank page, and horizontal overflow of the page or any element measured against the **intended** width.
| Result | Detail |
|---|---|
| **55 of 55 page checks passed, 0 failed** | 11 screens x 5 widths: login, register, forgot password, Home (`/` and `/habits`), Habit Details, Calendar, Wallet, Settings, Archived Habits, and a habit with a very long name |
| Console | no errors, no warnings, no exceptions, no CSP violations on any page |
| Assets | every requested file exists in the build (a path that looks like a file but is answered by the SPA fallback counts as missing; none); 125 local requests; **no request left this machine** |
| Routes | `/`, `/habits`, `/habits/<slug>`, `/habits/<slug>/calendar`, `/wallet`, `/settings`, `/settings/archived` all load by direct URL (SPA rewrite) |
| Did the checker work? | A negative control injected a console error, a 400 px element on a 320 px phone and a missing asset: **all three were reported**. It also exposed two weaknesses in my first version, now fixed: Chrome's mobile zoom-out can hide overflow if measured against `innerWidth`, and a missing asset is not a 4xx on a host that falls back to `index.html` |
| Screenshots | `D:\claude-data\tmp\release-shots` (one per screen and width; Chrome processes and profile are cleaned up after each run, also when interrupted) |
**Visual review of the screenshots (the checks cannot judge appearance):** layouts hold at every width (a fixed, centred column on 768, 1280 and 1920; nothing clipped sideways). At **320 px** only cosmetic text truncation appears: the Home title reads "Ha…", "This Week" reads "This W…", streak captions and the Details header of a long habit name are ellipsised, and the Settings subtitle "Data stored …" is cut. Calendar, Wallet, Settings and login are clean at 320.

## 4. Authentication review
All run in the browser suite against the real Firebase SDK with the sign-in endpoints answered by a local mock (no real account is created and the real project is not contacted); the suite is **688 of 688 passed on a fresh server** this phase.
| Area | Covered by | Result |
|---|---|---|
| Registration | "Authentication: registration" (the server receives exactly one sign-up; the new account can sign out and in again) | pass |
| Login, validation, wrong credentials | "validation and invalid credentials", "valid login, persistence, sign-out" | pass |
| Logout | same | pass |
| Password reset | "Authentication: password reset" (the reset request is sent; the email itself is sent by Firebase) | pass |
| Session persistence | login persistence and reload checks | pass |
| Guest mode | "guest session, Sign In from Settings, and login screen"; "guest mode stays isolated" | pass |
| Account switching and isolation | "switching between guest and account keeps guest data"; "Firestore: account switching, sign-out and isolation"; "sign-out removes the listeners; accounts never mix" | pass |
| Offline | "Authentication: offline error" | pass |
| Responsive auth screens, light and dark | in the suite and in the new 55-page check | pass |
**Not verified in this phase:** a real sign-up, login or reset against the production Firebase project (you tested Web and Android manually and reported them working). Console-side items to confirm yourself: the **authorized domains** in Authentication > Settings include the Hosting domain (`habbit-tracker-12.web.app` and `habbit-tracker-12.firebaseapp.com` are included by default; a custom domain must be added), the password-reset email template and sender name, and the Email/Password provider settings.

## 5. Application review
| Area | Evidence | Result |
|---|---|---|
| Habit creation, editing, archive, delete | browser suite (create and edit screens, archived habits, delete), 759 unit tests, emulator rules tests | pass |
| Completion and undo | browser suite (completion batches, undo with reward reversal, rapid taps, offline), unit and emulator tests | pass |
| Calendar notes | suite (create, edit, delete, 200-character limit), emulator tests | pass |
| Streak freezes | suite (purchase at 20, application, 3-day window, monthly limit), unit tests | pass |
| Wallet and rewards | suite (daily, milestone, reversal, pending adjustment), unit and emulator tests | pass |
| Theme persistence | "Theme: switching, persistence key and consistency on every screen" | pass |
| Data persistence | the "Persistence: ..." sections (refresh, every change type, direct URL after refresh, pending adjustments, milestones, unreadable or newer data) | pass |
| Loading and error states | error boundary, failed-write rollback messages, offline messages, "unreadable data" handling (suite) | pass |
| Business rules and UI design | **unchanged**: no application code was changed in this phase | |

## 6. Hosting configuration (`firebase.json`; Hosting NOT deployed)
| Item | State |
|---|---|
| Public directory | `dist` (Expo's export folder): correct |
| SPA routing | `**` rewrites to `/index.html`: verified |
| Security headers | CSP (self only; Google reCAPTCHA hosts for a future App Check; `https://*.googleapis.com` for Auth, Firestore and Installations; no `unsafe-eval`, no inline scripts; frames and plugins denied), HSTS (one year, includeSubDomains), `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`: all verified under the real build |
| Caching | `index.html` no-cache; `/_expo/static/**` and `/assets/**` immutable for a year (hashed names) |
| What Hosting would publish over | `https://habbit-tracker-12.web.app/` currently answers **404** (a live release from 2026-10-12 exists but serves no page), so no working site is replaced |
| Services | `firebase.json` is Hosting and emulators only: it cannot publish rules or functions |
| Auth domains | see section 4 (Console check) |
**Prepared command, NOT run** (after the blockers are decided; from `D:\habbit_tracker_web\web`):
```
$env:EXPO_PUBLIC_GUEST_IMPORT_ENABLED = 'false'
npm run build:web
npm run verify:build
npm run verify:csp
node scripts/verify-release.mjs
npx firebase-tools@15.37.0 deploy --only hosting --project habbit-tracker-12
```
Rollback for Hosting: Console > Hosting > release history > roll back to the previous release (the current live release serves nothing, so "rollback" means disabling the site or deploying the previous build). After deploying, check the real headers with `curl -I https://habbit-tracker-12.web.app/` and run the smoke checks on the live URL.

## 7. Git checkpoint (review only; nothing staged, committed or pushed)
| Item | Finding |
|---|---|
| Repository | `web/.git`, branch `main`, **one commit** (`5f64c1a Initial commit`, the Expo template) |
| Working tree | 6 modified (`.gitignore`, `app.json`, `package.json`, `tsconfig.json`, two icons), 6 deleted (template files: `App.tsx`, `index.ts`, four template icons), **216 untracked files = the whole application** (components, domain, services, store, tests, scripts, firebase rules, documents, `package-lock.json`, `firebase.json`) |
| `.env.local` | **ignored** (`.gitignore:46`, pattern `.env.*`); no env file is tracked; only `.env.example` (empty values and booleans) can be committed |
| Credentials | scanned all 220 candidate files for Google API keys, private keys, OAuth and refresh tokens, JWTs, service-account fields, AWS keys and password literals: **no real credential**; five pattern hits were all false positives (placeholder text in `STAGING_SETUP.md` and `seed-staging-data.mjs`, the detector's own regex in `verify-production-build.mjs`, and test fixtures such as `My Private Habit Name`) |
| Temporary and generated files | none to be committed: `dist/`, `.expo/`, `_tmp/`, logs, `firebase/rollback/firestore.rules` are ignored; no file over 1 MB; no backup, dump or report file among the candidates |
| `app.json` | references only `icon.png` and `favicon.png`, both present (the deleted template icons are no longer referenced) |
| Suggested checkpoint | commit in logical groups (app source; tests; rules and Firebase config; scripts; documents) after you review `git status`; I will not commit or push without your instruction |
Note: `/android` in `.gitignore` is the generated native folder inside `web/`, not the separate Android app directory.

## 8. Remaining issues and deployment blockers
### Blockers for a public launch (decisions needed; none is a code defect in the build)
| # | Issue | Where | Why it matters | Suggested fix |
|---|---|---|---|---|
| B1 | **The privacy policy promises "Settings → Delete Account", but the Web app has no account deletion.** The policy text is also the Android wording ("Skip for Now", "reminders are scheduled and shown locally by Android") | `domain/settingsContent.ts` | A false statement in a policy, and no way for a Web user to delete their account or data | Implement Web account deletion (Android's flow exists; the rules already support it through the deletion marker; it needs re-authentication), or at minimum rewrite the policy for the Web and give a working deletion route |
| B2 | **Help & Support says "Support contact isn't configured yet."** (`SUPPORT_EMAIL` is blank) | `domain/settingsContent.ts` | A public app with no contact | Set a support address |
| B3 | **"Feedback & Suggestions" shows the developer message "Feedback is migrated in a later phase."** (and Firestore denies feedback anyway) | `components/settings/SettingsScreen.tsx` | Placeholder text in production | Hide the row, or implement it together with a feedback rule |
| B4 | **The "Back Up Your Progress" sheet (guest Settings) promises "choose which habits to import" and "Your habits and their history can be saved to your account", but guest import is off for the first release** | `SettingsScreen.tsx` | Misleading promise | Hide the row, or change the copy while the flag is off |
| B5 | **Habit Reminders and Streak Alerts toggles do nothing on the Web**: the app has no service worker and never creates a notification; the switch only stores a preference, asks for permission, and shows "Blocked in system settings" | `SettingsScreen.tsx` | Users would expect reminders | Hide or label them for the Web; the per-habit reminder fields still sync to Android |
### Non-blocking
1. At 320 px the Home title and week label are truncated ("Ha…", "This W…"); long habit names are ellipsised in headers (cosmetic).
2. Brand inconsistency: the browser tab says "Consisto", the login screen and Settings text say "Habit Tracker".
3. `index.html` has no meta description, theme colour, web manifest or touch icon (the favicon is `.ico` only): no installable app, weak link previews.
4. On large desktops the app is a fixed, centred column (a design choice).
5. A real sign-up, login and password-reset email against production were not run here (mocked in tests; you tested manually).
6. Firebase Console settings to check: authorized domains, password-reset template, email-enumeration protection, budget alerts (App Check cannot be enforced while the Android app has none).
7. The browser suite was flaky in an earlier stretch (cause unproven); it has passed 688 of 688 on fresh servers since, including this phase. A dev server running for many hours should be restarted before a release run.
8. Firestore limitations from the final rules report (earning not verified by rules, 3-day freeze window app-enforced, owner can set `deletionRequested`) are unchanged.
### Technical blockers
**None.** The build, verification scripts, routes, responsive checks, security headers, CSP and tests all pass.

## 9. Test totals this phase (run sequentially)
| Step | Result |
|---|---|
| TypeScript | 0 errors |
| Unit tests | 759 passed (30 files) |
| Production build | succeeded |
| `verify:build` / `verify:csp` | 31 of 31 / 19 of 19 passed |
| Release page checks (`verify-release.mjs`) | 55 of 55 passed (negative control proved the detectors) |
| Browser suite (dev server, fresh) | **688 passed, 0 failed** |
Not re-run (no relevant change this phase): Firestore emulator rules tests (1,091 passed in Phase 11G) and Kotlin tests.

## 10. Files changed in this phase
Added: `scripts/verify-release.mjs`, this report. Nothing else changed: no application, rules, Kotlin or configuration file. `dist/` was rebuilt (ignored by git). The development server on port 8085 (pid 27348) is still running; stop it when no longer needed.

## 11. What I need from you
Decide B1 to B5 (fix before launch, or accept), confirm the Hosting domain handling (default `web.app` domain or a custom domain), and tell me whether to proceed with fixes. I will not deploy Hosting until you explicitly approve.


---

# Phase 12A: final user-facing improvements (completion report)

Status: **implemented and tested. Nothing was deployed, committed or pushed. Firestore rules, Kotlin, wallet logic and guest import are unchanged** (the Combined rules still hash to `7582DEF7…4213`; `EXPO_PUBLIC_GUEST_IMPORT_ENABLED` stays `false`; `.env.local` was not modified).

## Result per issue
| # | Issue | Result |
|---|---|---|
| 1 | Privacy Policy promises Delete Account, which the Web did not have | **Fixed** |
| 2 | Help & Support: "Support contact isn't configured yet." | **Prepared, and truthful until an address exists**: the row shows a real address and opens a mail link as soon as one is configured; with none it says so plainly. **Still blocked on one thing only: a real support address (not invented)** |
| 3 | Feedback & Suggestions row | **Fixed** (the row is removed; no new Firestore permission; Android untouched) |
| 4 | "Back Up Your Progress" promised a guest import | **Fixed** (new wording, guest import stays off) |
| 5 | Reminder and streak-alert switches stored a preference but delivered nothing | **Intentionally unavailable, with updated wording** (investigated; reliable delivery needs a server) |

## 1. Delete Account (fixed)
**Where:** Settings > ACCOUNT, below Log Out, for signed-in accounts only (a guest has no account, so the row is not shown).
**Flow (a port of Android's protocol, plus the notes Android leaves behind):**
1. The sheet explains what is removed and that it cannot be undone (habits, completion history, calendar notes, streaks, coins, wallet history, streak freezes), and that **guest data on the device is not part of the account and is not deleted**.
2. **Explicit confirmation:** the password **and** typing `DELETE` (upper case; "delete" is refused). The button stays disabled until both are right.
3. **Re-authentication:** Firebase re-checks the password first. A wrong or unconfirmed password changes nothing and is explained in the sheet.
4. A blocking "Deleting your account…" screen replaces the app, **stops every live listener on the account**, and guards against closing the page. Nothing can write to the account while it runs.
5. Data deletion, the same order as Android: set the `deletionRequested` marker (the only way the rules allow the ledger to be deleted), empty each habit's completions, the habits, then walletTransactions, freezes, freezeMonths, rewards, todos and **dayNotes**, in batches of 400; check from the server that nothing is left (up to 3 passes, so a document written from another device meanwhile is caught); delete the profile **last**; then confirm the profile is gone.
6. **Only then** delete the Firebase Authentication login.
7. On success the user lands on the login screen with a confirmation, this account's device preferences are removed, and nothing is left that could sign in again.
**Partial failures and retries:** every outcome is reported, never a silent one. A password failure: "Incorrect password. Nothing was deleted." A failure halfway: the login is **not** deleted, the account still exists (its profile, carrying the marker, is deleted last), and a message on the screen the app returns to says some data may already be removed and to try Delete Account again; the retry continues from what is left. Data gone but the login not: "Your data was deleted, but the login couldn't be removed… try again"; the retry removes just the login. **An account is never shown as deleted while any data remains** (a persistent leftover or a profile that will not go is a failure).
**Ownership and security:** every step is built from the signed-in user's own id (validated; a bad id is refused before any request); both the re-authentication and the login deletion refuse to act unless the signed-in Firebase user **is** that id; the only source file that writes the `deletionRequested` marker is the eraser, reached only through this flow (a source scan pins it). Against the **real rules in the emulator**: another signed-in user, a signed-out client, and this user's eraser pointed at another account are all refused and delete nothing; without the marker the ledger cannot be deleted.
**Things I found and fixed while testing (real bugs, not test problems):** after a failed deletion the app returns to Home, so the message was moved to a banner above every screen (first placed at the top where it covered the header buttons, then moved into the page layout so it never covers a control); a "mounted" flag was cleared by React's development StrictMode and would have hidden the wrong-password message; and the Habit Details bell could say "Blocked" because of a browser permission that no longer matters.
**Tests:** 36 unit tests for the protocol (order, batching beyond 400, mid-way failure and retry, a late document, a delete that silently does nothing, unsafe ids, messages); 11 session tests (guest refusal, the blocking state, notices, retries, other accounts' device preferences untouched); **32 emulator tests of the real deletion against the real rules under all four rule sets, the deployed Combined rules included** (full deletion with notes, 450 completions across several batches, failure and retry, wallet untouched by the marker, cross-user and signed-out refusals); and 28 browser checks (sheet and confirmation rules, wrong password, the blocking screen with no listener left, failure notice and retry, success and the deleted account unable to sign in, login-delete failure and retry, 320 px and light theme, no console errors). **Firebase Authentication is mocked** in the browser and unit tests (a real re-authentication and `deleteUser` were not run; do that once with a synthetic account after deployment, never a real one).
**Limits:** a deletion that fails halfway and is never retried leaves the account flagged (its wallet is frozen by the rules until the deletion completes, as on Android); documents created under a habit that was deleted concurrently from another device cannot be found afterwards (Firestore has no per-user group query); a user who closes the page in the middle must run Delete Account again.

## 2. Help & Support (prepared)
`EXPO_PUBLIC_SUPPORT_EMAIL` (a Vercel or `.env` build variable, in `.env.example`, empty) supplies the address. It is shown only if it looks like an email address; the row then shows it and opens `mailto:`. With nothing configured: subtitle **"No support address yet"** and, when tapped, "A support address hasn't been set up yet, so there is nobody to contact from here." No address is invented anywhere (a test forbids an `@` in the fallback and in the policy).

## 3. Feedback (fixed)
The Feedback & Suggestions row is gone from Settings. No rule, permission or Android behaviour changed (feedback stays denied by the deployed rules).

## 4. Back Up Your Progress (fixed)
With guest import off, the sheet says: "Create an account to save your progress to Firebase and open it on any device you sign in on." and "Sign in or create an account on the next screen. Habits you create while signed in are saved to your account. Habits already on this device stay here and are not moved to your account." It never mentions importing or backing up the guest habits (a test forbids those words); existing guest data is untouched. Development builds (import on) keep the Android wording. Verified **in the production bundle** (the release check opens the sheet).

## 5. Habit Reminders and Streak Alerts (intentionally unavailable, with updated wording)
**Investigation:** a web page can show a notification (Notifications API, service worker) but **cannot schedule one to fire later while the site is closed**. The scheduled-notification trigger API was abandoned and removed from browsers; timers only run while a tab is open (not a reminder service); Periodic Background Sync exists only in Chromium, only for installed apps, at times the browser chooses (not at 07:30). Reliable reminders need **Web Push**: a push service plus a **server that sends each reminder at the right time** (for example Firebase Cloud Messaging with Cloud Functions and Cloud Scheduler: new infrastructure, the Blaze plan, and your approval). So I did not fake it.
**What the Web shows now:** Settings > NOTIFICATIONS is a non-interactive row "Reminders & Streak Alerts: Not available on the web yet" (no switches, no "Blocked in system settings", no permission prompt); the habit Reminder block says "Reminders aren't available on the web yet. Your choice is saved with this habit for the Android app" (or "on this device" for a guest), never asks for notification permission, and the Habit Details bell shows the saved time instead of "Blocked". The reminder fields still sync, so the Android app can use them. The privacy policy says the web app sends no reminders.

## Privacy policy (updated for the Web, same six sections)
It now describes the Web: Continue as Guest (not "Skip for Now"), browser storage, no reminders from the web app, calendar notes among the stored data, and a Delete Account promise that is true (password required, notes included, guest data separate). **Recommended before launch (not applied): add that the web app is served by the hosting provider (Vercel), which receives visitors' addresses like any host.**

## Test results this phase (sequential)
| Step | Result |
|---|---|
| TypeScript | **0 errors** |
| Unit tests | **856 passed** (34 files) |
| Firestore emulator rules tests | **1,123 passed** (7 files; 32 are the new real-deletion tests under four rule sets); rules unchanged, generator up to date |
| Browser suite (fresh server) | **721 passed, 0 failed**, no console errors, no leftover Chrome |
| Production build (guest import `false`) | **succeeded**, 52 files |
| `verify:build` | **all checks pass** (now also: every route file in `app/` is in the build) |
| `verify:csp` | **19 of 19** |
| `verify:release` (production bundle, 5 widths, new Settings, backup, privacy and reminder checks) | **75 of 75** (negative control still catches injected defects) |
Notes on the browser suite: the earlier unexplained flaky checks (rapid taps) did not recur in the last three runs; two failures that appeared and were fixed this phase were **my own test setup** (a fixture whose freeze transaction tripped an unscoped check, and a re-used user id that brought back the development-only import dialog). The browser harness now kills Chrome's whole process tree on exit.

## Files (Phase 12A, project only)
Added: `domain/accountDeletion.ts`, `services/firestoreEraser.ts`, `services/accountEraser.ts`, `components/settings/DeleteAccountSheet.tsx`, `components/auth/AccountNotice.tsx`, and tests (`accountDeletion`, `accountSession`, `settingsCopy`, `fakeEraser`, `rules/accountDeletion.rules`). Changed: `services/sessionController.ts`, `services/auth.ts`, `services/devicePrefs.ts`, `services/guestMigrationStore.ts`, `components/auth/CloudGate.tsx`, `components/auth/AuthScreens.tsx`, `components/settings/SettingsScreen.tsx`, `components/dashboard/ReminderSection.tsx`, `components/habit/HabitDetailScreen.tsx`, `domain/settingsContent.ts`, `.env.example`, `tests/accountSafety.test.ts` (narrowed: exactly one reviewed file may write the marker), `scripts/e2e-dashboard.mjs`, `scripts/verify-release.mjs`. **Untouched: Firestore rules, Kotlin, wallet logic, `.env.local`.**

## Updated launch status
Blockers B1 (Delete Account), B3 (Feedback), B4 (backup wording) and B5 (reminders) are **resolved**; B2 (support address) is **prepared and waiting for a real address**. Remaining launch decisions: the support address, the hosting-provider line in the privacy policy, and the checks in `VERCEL_DEPLOYMENT_PLAN.md`.
