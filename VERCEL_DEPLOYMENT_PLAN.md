# Consisto Web on Vercel: deployment plan (Phase 13A, preparation only)

Project: `D:\habbit_tracker_web\web` (Expo SDK 58, React Native Web, TypeScript, Firebase `habbit-tracker-12`).
**Status: prepared and verified locally. Nothing was deployed, no GitHub repository was connected, nothing was committed or pushed. Firestore rules, Firebase Hosting, Cloud Functions, Kotlin, wallet logic, guest import and production data were not touched.** Hosting moves to Vercel; Firebase stays the backend (Authentication and Firestore).

## 1. What was prepared in the project
| File | Purpose |
|---|---|
| **`vercel.json`** (new) | Install `npm ci`; build `npm run build:web && npm run verify:build`; output `dist`; single-page-app rewrite; the security and caching headers (identical to the Firebase ones) |
| `scripts/lib/hostingConfig.mjs` (+ `.d.mts`) (new) | One loader so the verification scripts test the real build with exactly Vercel's (or Firebase's) rewrites and headers |
| `scripts/verify-csp.mjs`, `scripts/verify-release.mjs`, `scripts/verify-production-build.mjs` (changed) | Now test `vercel.json` (default); `verify:build` also guards that every route file in `app/` is in the build and that the Vercel and Firebase security headers are identical |
| `tests/vercelConfig.test.ts` (new, 21 tests) | Pins the build settings, header parity with Firebase, SPA routing, 404 for missing assets, caching, no secrets in `vercel.json` |
| `package.json` (changed) | `engines.node` = `22.x`; script `verify:release` |
| `.gitignore` (changed) | `.vercel/` (Vercel CLI's local link) |
| `firebase.json` (kept) | No longer deployed; stays as the reference the Vercel headers must equal, and for the emulators |

## 2. Vercel project settings (enter exactly these)
| Setting | Value |
|---|---|
| Framework Preset | **Other** (there is no Expo preset; `vercel.json` sets `"framework": null`) |
| Root Directory | `./` (the repository root is the project folder) |
| Install Command | `npm ci` (from `vercel.json`) |
| Build Command | `npm run build:web && npm run verify:build` (from `vercel.json`; a failed verification **stops the deploy**) |
| Output Directory | `dist` (from `vercel.json`; Expo's export folder) |
| **Node.js Version** | **22.x** (also pinned by `engines`). **Required:** Expo SDK 58 needs `^22.13 \|\| ^24.3 \|\| ^26`; do not leave Vercel on 20.x |
| Production Branch | `main` |
| Preview deployments | see section 3 (recommended: off) |
| Deployment Protection | leave Vercel's default; the production domain is public |
| Vercel Web Analytics, Speed Insights, Toolbar | **off** (the privacy policy says no analytics; they would also add scripts) |

## 3. Environment variables (Production scope only)
Set them in Vercel > Project > Settings > Environment Variables **before the first deploy**. They are baked into the JavaScript at build time (Expo inlines `EXPO_PUBLIC_*`), so changing one means redeploying. They are **public identifiers, not secrets**; access is controlled by Firebase Authentication and the Firestore rules. Values come from Firebase Console > Project settings > Your apps > the Web app's config (your local `.env.local` holds the same six; **do not copy that file**).
| Variable | Value | Notes |
|---|---|---|
| `EXPO_PUBLIC_FIREBASE_API_KEY` | from the Web app config | public identifier |
| `EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN` | normally `habbit-tracker-12.firebaseapp.com` | keep the Firebase default; no redirect flow uses it |
| `EXPO_PUBLIC_FIREBASE_PROJECT_ID` | `habbit-tracker-12` | |
| `EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET` | from the config | |
| `EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID` | from the config | |
| `EXPO_PUBLIC_FIREBASE_APP_ID` | from the config | |
| **`EXPO_PUBLIC_GUEST_IMPORT_ENABLED`** | **`false`** | **must be `false`**; `verify:build` fails the deploy if it is `true`. Also the default when unset |
| `EXPO_PUBLIC_SUPPORT_EMAIL` | **leave empty** until a real address exists | shown in Settings > Help & Support; empty gives the honest "No support address yet" |
| `EXPO_PUBLIC_APPCHECK_SITE_KEY`, `_PROVIDER`, `_DEBUG_TOKEN` | **do not set** | App Check is not enforced and cannot be while the Android app has none; the debug token must never be set for production (`verify:build` checks) |
**Never put in Vercel (or anywhere in this project): a service-account key, a private key, an Admin SDK credential, a Firebase CLI token.** The app and the build use none; `verify:build` fails if the bundle contains a private key, service-account fields, an OAuth secret or a literal password.
**Production Firebase vs local:** local development uses `.env.local` (git-ignored, never uploaded). Vercel's Production environment holds the same project's public identifiers. There is only one Firebase project, so **leave Preview and Development empty**: a preview build then starts with "Firebase is not configured" instead of quietly using the production database. Recommended: also turn preview deployments for non-`main` branches off (Settings > Git).

## 4. Security configuration
**Headers** (`vercel.json`, every path; identical to `firebase.json`, enforced by a unit test and by `verify:build`): Content-Security-Policy (`default-src 'self'`; scripts from `'self'` and Google reCAPTCHA hosts only; `connect-src 'self' https://*.googleapis.com` for Authentication, Firestore and Installations; no `unsafe-eval`, no inline scripts; `frame-ancestors 'none'`; `object-src 'none'`; `base-uri 'self'`), Strict-Transport-Security (one year, includeSubDomains), X-Content-Type-Options `nosniff`, X-Frame-Options `DENY`, Referrer-Policy `strict-origin-when-cross-origin`, Permissions-Policy (camera, microphone, geolocation, payment, usb off), Cross-Origin-Opener-Policy `same-origin-allow-popups`.
**Caching:** `/_expo/static/*` and `/assets/*` immutable for a year (content-hashed names); `/` and `/index.html` `no-cache`; other routes use Vercel's default (revalidate). The caching rules never overlap the security-header rule, so they cannot override each other.
**Conflict with Firebase's headers:** none. Firebase Hosting is no longer used, so only Vercel's response carries headers. Vercel adds a few of its own (for example on `*.vercel.app` it may send its own HSTS); a rule in `vercel.json` for the same header name is expected to take precedence, but **confirm this with `curl -I` after the first deploy** (section 7).
**HTTPS:** Vercel serves HTTPS only and redirects HTTP. HSTS keeps `includeSubDomains`, as before: once a **custom domain** is attached, every subdomain of it must also work over HTTPS (decide before launch; drop `includeSubDomains` from `vercel.json` and `firebase.json` together if not).
**Routing:** every route is answered with the app (`/habits/<slug>/calendar` and every other deep link), **except** `/_expo/*`, `/assets/*`, `favicon.ico`, `metadata.json`, which return a real **404** when missing (a bad deploy cannot hide behind an HTML page).
**Firebase Authentication:** the app uses email and password only, with **no redirect or popup sign-in**, so nothing returns to the site after sign-in. Password-reset emails use Firebase's own hosted page. Still, in Firebase Console > Authentication > Settings > **Authorized domains** add the Vercel domain (`<project>.vercel.app`) and the custom domain when there is one (`habbit-tracker-12.firebaseapp.com`, `habbit-tracker-12.web.app` and `localhost` are there by default). Also check **Google Cloud Console > APIs & Services > Credentials > the Browser key**: if it has **HTTP referrer restrictions**, add `https://<project>.vercel.app/*` (and the custom domain); otherwise every Firebase request from the new site fails with "requests from this referer are blocked". I cannot see either setting from here.
**Firestore listeners:** they use `firestore.googleapis.com` over HTTPS (allowed by `connect-src`); `verify:csp` proves the policy allows the Authentication and Firestore requests (the Firebase answers are simulated); the real network path is exercised by the post-deploy smoke test.
**Production error handling:** an app-wide error boundary shows a recoverable error screen instead of a blank page; the build contains no source maps, no development hooks and no `console.log` from app code (`verify:build`); failed network calls surface as plain messages in the UI; a missing asset is a 404.

## 5. Git and GitHub checkpoint (nothing committed or pushed; the repository has no remote)
| Check | Result |
|---|---|
| Repository | `web/.git`, branch `main`, **one commit** ("Initial commit", the Expo template), **no remote** |
| `.env.local` | **ignored** (`.gitignore:46`, pattern `.env.*`); no env file is tracked; **only `.env.example`** (empty values) will be committed |
| Files a first commit would contain | **246 entries: 240 files + 6 deletions of the unused Expo template files** (`App.tsx`, `index.ts`, four template icons); **no** `dist`, `node_modules`, `.expo`, logs or scratch files (the scratch helper scripts I created were removed) |
| Credential scan | no real credential among the files; the real Firebase API key from `.env.local` appears in none of them; the pattern hits are placeholders and test fixtures (`correct-password`, "My Private Habit Name") and the scanner's own regex |
| Clean-checkout build | the committed file set, with **no** `.env.local`, built from `npm ci` (lockfile) with the Firebase values supplied only through the environment, and Vercel's **exact build command**: **passed**, producing **the same 52 files** as the normal build (an identical file list ignoring content hashes; the one hash I compared, the layout chunk, was identical) (it also exposed that my first copy had skipped the `[slug]` route files, which led to the new "every route is in the build" guard) |
| `package-lock.json` | present and **must be committed** (`npm ci` needs it) |
**Proposed first commits (not made; I will make them only when you say so):** (1) the app: `app/`, `components/`, `domain/`, `services/`, `store/`, `hooks/`, `theme/`, `constants/`, `utils/`, `types/`, `assets/`, `app.json`, `tsconfig.json`, `package.json`, `package-lock.json`, `.gitignore`, `.env.example`, the template deletions; (2) tests: `tests/`, `vitest*.config.ts`; (3) Firebase rules and config: `firebase/`, `firebase.json`; (4) scripts: `scripts/`; (5) Vercel: `vercel.json`; (6) documents: `*.md`, `LICENSE`, `AGENTS.md`.
**GitHub connection (you do these; I will not):**
1. Create a **private** repository on GitHub (empty: no README, no `.gitignore`).
2. After you approve the commits: `git remote add origin https://github.com/<you>/<repo>.git`, then `git push -u origin main`.
3. Vercel > Add New > Project > Import the repository (grant Vercel access to **that repository only**).
4. Enter the settings and variables from sections 2 and 3, then Deploy.
Never paste a Vercel or GitHub token into this session or into a file.

## 6. Verification done (local, sequential)
| Check | Result |
|---|---|
| Production build with guest import `false`, from the project and from a clean checkout | passed; same file list |
| `verify:build` | all checks pass, including the new route guard and Vercel-vs-Firebase header parity |
| `verify:csp` against the Vercel rules | **19 of 19** (headers, deep link, caching, no policy violation, Authentication and Firestore requests allowed, injected script refused, foreign frame refused) |
| `verify:release` against the Vercel rules, 5 widths, production bundle | **75 of 75**, no external request, every asset present |
| Unit tests / TypeScript | 856 passed / 0 errors |
| Firestore emulator rules tests | 1,123 passed (rules unchanged) |
| Browser suite | 721 passed, 0 failed (Phase 12A) |

## 7. Deployment, smoke test and rollback (for later; nothing here was run)
**Deploy:** Vercel builds on every push to `main`. The first deployment is the production build on the default `<project>.vercel.app` URL; add a custom domain only after it works.
**After the first deploy (a few minutes):**
1. `curl -I https://<project>.vercel.app/` and `curl -I https://<project>.vercel.app/habits/x/calendar`: both **200**, with the Content-Security-Policy, Strict-Transport-Security (your value), X-Frame-Options `DENY`, X-Content-Type-Options and Referrer-Policy exactly as in `vercel.json`. `curl -I https://<project>.vercel.app/_expo/static/js/web/nope.js` must be **404**.
2. Open the site: the login screen renders with no console error; **Continue as Guest** shows the sample habits; Settings shows no Feedback row, "Not available on the web yet", "No support address yet", and a Back Up sheet that mentions Firebase and no import.
3. With a **synthetic test account** (never a real one): register, log in, create and edit a habit, complete and undo, add a note, buy a freeze (20 coins) and apply one, sign out and in again, check it on Android. Then **Delete Account on that same synthetic account**: it must end on the login screen with the confirmation, and the account must be unable to sign in again. This is the first real run of Firebase re-authentication and `deleteUser`.
4. If any Firebase request fails with "referer blocked" or an authorization error: fix the API-key restriction or the authorized domain (section 4).
**Rollback:** Vercel > Deployments > pick the previous good deployment > **Instant Rollback** (or Promote to Production). Nothing in Firebase changes with a rollback. A wrong environment variable: fix it and **redeploy** (variables are baked in at build time). A bad configuration change: `git revert` and push. The Firestore rules (Combined) are independent of hosting and stay as they are.

## 8. Blockers and decisions (none is a code defect)
1. **Your approvals:** the first commits, creating the GitHub repository and pushing, and connecting Vercel. I will not do any of these on my own.
2. **Node 22 is not tested locally.** Everything above ran on Node 26 (what is installed here). Vercel will build on 22.x. Expo SDK 58 supports 22.13+ and the lockfile installs cleanly, so I expect it to work, but I could not prove it: my attempt to fetch a Node 22 binary was blocked by the environment's safety check and I did not work around it. Options: you install Node 22 (for example `winget install OpenJS.NodeJS.22`, or nvm) and I re-run the build and the checks on it; or accept that the first Vercel build is the test (a failed build does not affect anything live). Fallback if it fails on 22: set Vercel to Node 24.x (also supported).
3. **Vercel plan:** the free Hobby plan is for **personal, non-commercial** use; a public product may need Pro. Your call.
4. **Firebase Console checks** I cannot see: authorized domains; the Browser API key's HTTP-referrer restrictions (section 4).
5. **Support address** (Phase 12A): until you supply one the app honestly says there is none. Set `EXPO_PUBLIC_SUPPORT_EMAIL` in Vercel when it exists.
6. **Privacy policy:** recommended to add one line that the web app is hosted by Vercel (it receives visitors' addresses, like any host). Not applied; say so and I will add it with its test.
7. **Preview deployments** and **HSTS `includeSubDomains`** policy (sections 3 and 4).
8. **The real Firebase network path** and a real re-authentication/`deleteUser` can only be exercised after deployment (section 7), with a synthetic account.
9. **The old Firebase Hosting site** `habbit-tracker-12.web.app` (currently 404) is simply unused; no action needed, nothing deploys to it.

## 9. What I need from you to continue
Approve (or change) the settings above; tell me whether to install/test Node 22 first; say when I may make the local commits; and create the private GitHub repository yourself when you are ready. I will stop here until then.
