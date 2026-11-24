# Consisto Web: production security audit (Phase 11A)

Status: **audit only. No fix has been implemented.** No Kotlin file, Firestore rule, Cloud Function, App Check setting, wallet balance or Firebase data was changed. Nothing was committed.

Scope: the Web app in `D:\habbit_tracker_web\web` (Expo + React Native Web + TypeScript + Firebase) against Firebase project `habbit-tracker-12`, for a **Web-only** public release. The Android app stays unchanged, but it uses the **same Firebase project, the same users and the same rules**, so every recommendation below is checked against that constraint.

## 0. How this audit was done, and what it could not check

Done: a read of the Web source (auth, session, Firestore reads and writes, ledger, migration), the rules file in the repository (`android/firestore.rules`), the Kotlin wallet types (read only), the environment and ignore files (key names only, no values printed), and a **fresh production export** (`expo export --platform web`) whose bundle was scanned for secrets and test hooks. The earlier phases' unit and browser tests (688 browser checks, 677 Web unit tests, 379 Android unit tests) cover behaviour, not attacks.

Could not check, and therefore marked "needs verification" where it matters:
1. **The deployed rules.** There is no `firebase.json`, `.firebaserc` or Firebase CLI configuration in the project, and I have no access to the Firebase Console. The audit assumes the deployed rules equal `android/firestore.rules`. Someone with Console access must confirm that (Section 8).
2. **Console settings:** API key restrictions, authorized domains, enumeration protection, password policy, billing alerts, quotas.
3. **Live behaviour against the real project.** No live request was made.
4. *(Corrected in Phase 11B.)* The first version of this audit said there was no git repository. **That was wrong:** `web/` is a git repository (branch `main`, one commit, "Initial commit", no remote). I had run the check from the parent folder. The repository's state is covered in Section 6 (S-10).

## 1. Summary

**No way for one user to read or change another user's data was found.** Every rule on user data is scoped to the signed-in owner, unauthenticated access is denied, and the Web code keys all state by uid and removes listeners on sign-out.

**The real weakness is the wallet.** The rules only check that a wallet change matches a ledger entry written in the same transaction. They do not check that the entry is legitimate, so any signed-in user can mint coins, get free Streak Freezes, apply freezes anywhere, and erase pending adjustments with a few lines in the browser console. This was documented as a known limitation since Phase 9; this audit shows it is wider than "forged rewards of up to +20".

The Web bundle is clean: no secrets, no test hooks, no source maps. The remaining production work is mostly **configuration** (Console, hosting headers, App Check in monitor mode) and **process** (version control, rules in the repository, rules tests).

### Severity table

| ID | Finding | Severity |
|---|---|---|
| S-01 | Wallet is client-forgeable: unlimited coins, free freezes, no type or price checks | **High** |
| S-02 | Freezes can be applied with no freeze owned, on any date, with no monthly limit | **High** |
| S-03 | Pending adjustments (debt from reversals) can be erased at will | Medium |
| S-04 | The `deletionRequested` flag can be set by the owner, which locks the wallet for good and opens ledger deletion and a full wallet reset | Medium |
| S-05 | No schema, size or count validation on habits; arbitrary nested paths are allowed (cost and abuse) | Medium |
| S-06 | No App Check; open sign-up with no email verification | Medium |
| S-07 | No hosting configuration, security headers or CSP | Medium |
| S-08 | API key restrictions and authorized domains are unverified | Medium (verify) |
| S-09 | Deployed rules unverified; rules are not in the Web project; no rules tests | Medium (process) |
| S-10 | *(Corrected)* The repository holds only the Expo template commit; all real work is untracked (so no history, no review, no backup). `.env.local` is ignored and was never committed | Low (process) |
| S-11 | `rewardsIgnoredThrough` protects rewards only on builds that read it (Web, and the unreleased Android change) | Medium (only if the import is enabled) |
| S-12 | Password policy of 6 characters; sign-up reveals an existing email | Low |
| S-13 | Legacy `todos` path is open to any owner write | Low |
| S-14 | Profile creation accepts arbitrary extra fields | Low |
| S-15 | Test knob `consisto_mock_start_coins` is in the production bundle | Low |
| S-16 | Guest import: no size caps; per-browser duplicate marker; the next user on a shared browser sees the guest's habit names | Low |
| S-17 | JVM crash logs (with environment dumps) sit in project folders | Low |
| S-18 | Dependencies not audited (`npm audit` not run) | Info |

No finding is Critical.

## 2. Web authentication (audited)

What exists: Firebase email and password only (`services/auth.ts`), a session controller that is framework free and unit tested (`services/sessionController.ts`), and a gate that shows the app only for a signed-in account or a remembered guest (`app/_layout.tsx`).

| Area | Result |
|---|---|
| Email and password | Standard Firebase calls. Client check of 6 characters and a basic email format (parity with Android). |
| Session persistence | Firebase default (IndexedDB, with a localStorage fallback); a refresh or new tab restores the session. Tokens live in browser storage, so an XSS would expose the session, which is why headers and CSP matter (S-07). No dangerous sinks were found: no `innerHTML`, `dangerouslySetInnerHTML`, `eval`, `new Function`, `document.write`, `postMessage` or `window.open` in the app source. |
| Sign-out | `signOut(auth)` and the controller drops the user. The browser tests show listeners removed and no account data on screen afterwards. Guest data deliberately stays on the device. |
| Password reset | `sendPasswordResetEmail`. An unknown address is reported as success, so accounts cannot be probed. Rate limited by Firebase. |
| Account switching | Store, listeners and device preferences are keyed by uid; the browser tests prove no habit, coin or freeze leaks between accounts. |
| Unauthorized access | Signed-out users see only the login screen on every URL (the router stack is not mounted). Data access is enforced by the rules, not by the UI. |
| Credential errors | Generic ("Incorrect email or password."). |

Findings:
- **S-06 (Medium): open sign-up with no email verification and no App Check.** Anyone can create unlimited accounts from a script. Each account can write data (S-05). Recommended: App Check in monitor mode now, enforcement later (Section 5); send a verification email at sign-up and show a banner (do not block sign-in, to keep Android parity).
- **S-12 (Low): password policy.** Firebase's default minimum is 6 and the app enforces 6. Recommended: raise the policy in the Console (Identity Platform password policy, minimum 8) and change `MIN_PASSWORD_LENGTH` to match for the Web. Android users with shorter passwords keep working; only new passwords are affected.
- **S-12 (Low): sign-up reveals that an email is registered** (`auth/email-already-in-use` is shown as "An account with this email already exists"). This is standard and also what Android does. Turn on **email enumeration protection** in the Console; it hides existence on sign-in and reset, and the sign-up message remains acceptable.
- Guest sessions: guest data is plain JSON in `localStorage`, readable by any script on the origin and editable by the user. It holds no credentials, and the guest wallet is never imported, so editing it gains nothing.

## 3. Firestore security (audited against `android/firestore.rules`)

Collection by collection, with the rule lines that matter:

| Path | Rule (line) | Assessment |
|---|---|---|
| `users/{uid}` | read owner (33); create owner with `coins == 20` and `freezesOwned == 0` (34); update owner if wallet unchanged or backed by a ledger entry (36-37); delete only after `deletionRequested` (38) | Owner scoped. See S-01 to S-04, S-14. |
| `habits/{id}` and `habits/{id}/{rest=**}` | owner read and write (40-45) | Owner scoped, but **no validation** (S-05). |
| `dayNotes/{id}` | id must be `habitId_date`, text 1 to 200 characters (52-59) | Good. The `habitId` is not checked against an existing habit (harmless). |
| `walletTransactions/{id}` | create when it is the user's `lastTransactionId`; `coinDelta` and `pendingDelta` integers within +/-20; `freezeDelta` in {0, 1, -1}; no update; delete only when deleting (62-75) | Does not check type, id format, date, amount per type, or any link to completions. **S-01.** |
| `rewards/{id}` | create or update when tied to the same ledger entry; `active` is a boolean (78-85) | No amount, date or eligibility check. |
| `freezes/{id}` | id must equal `habitId_date` and a ledger entry `freeze_apply_{id}` must exist (88-95) | The entry's amounts are not checked. **S-02.** |
| `freezeMonths/{month}` | count must be previous + 1 and at most 3 (98-104) | Not tied to creating a freeze. **S-02.** |
| `todos/{id}` | owner read and write (46-48) | Legacy, unvalidated (S-13). |
| `feedback/{id}` | authenticated create with a strict key set; `createdAt == request.time`; `userId == auth.uid`; no list, update or delete (110-126) | Well constrained. No rate limit (not used by the Web). |
| anything else | no match, so denied by default | Good. |

### Attack paths found (all by an authenticated user acting on their own account, using their own ID token against the Firestore REST or SDK API)

**S-01: unlimited coins.** Write a ledger entry with any new id, `coinDelta: 20`, `balanceAfter` equal to the new balance, and update the user document's `coins` and `lastTransactionId` in the same transaction. The rules accept it. Repeat with new ids. There is no check on the entry's `type`, its id pattern, a date, a habit, or a daily or milestone amount. Coins buy freezes, so this feeds S-02.

**S-02: free and unlimited freezes.**
- A freeze can be obtained for free: an entry with `coinDelta: 0, freezeDelta: 1` is accepted (the price is not enforced).
- A freeze can be applied without owning one: write `freezes/{habit}_{date}` plus a ledger entry `freeze_apply_{habit}_{date}` with `freezeDelta: 0`. The rules only require that the entry exists, not that it removes a freeze.
- Any habit id and any date are accepted: the 3-day recovery window, the streak requirement and the "not already completed" check exist only in client code.
- The monthly limit of 3 lives only in `freezeMonths`, and creating a freeze does not require writing that counter, so skipping it bypasses the limit.
This lets a user repair any streak. The streak is the product's main number.

**S-03: erasing debt.** A reversal that cannot be paid from the balance becomes a pending adjustment. An entry with `pendingDelta: -N, coinDelta: 0` is accepted and reduces `pendingAdjustment` to zero.

**S-04: the `deletionRequested` flag.** `walletUnchanged()` compares only coins, freezes and pending, so the owner can set `deletionRequested: true` with a plain update. Consequences: wallet changes are then refused for good (the flag cannot be cleared), so a script injected through any future XSS could lock a victim's wallet forever. The ledger collections become deletable, and then the user document, which can be recreated with 20 coins. That is a full wallet reset, and it frees every ledger id for reuse. Account deletion is an Android flow today; the Web has none.

**S-05: no validation or caps on habits.** `habits/{id}/{rest=**}` allows any nested path and any field. A script can create millions of documents (storage and read cost) or malformed documents. Only the account's own data and bill are affected, but billing is shared across all users.

**S-13 and S-14 (Low).** `todos` has no validation. The profile can be created with any extra fields (for example a large `pendingAdjustment` or a forged `lastTransactionId`).

What the rules do get right: ledger entries cannot be edited, an id cannot be reused while it exists, balances cannot go negative, and every wallet change must match a same-transaction entry. That stops accidental or casual changes. It does not stop a deliberate user.

### Recommended fixes (see Section 6 for the plan)

Rules that stay compatible with the unchanged Android app (tighten, never loosen). The Android write shapes were read from `WalletLedger.kt`: types `daily_completion`, `streak_milestone`, `reward_restored`, `reward_reversal`, `welcome_freeze`, `freeze_purchase`, `freeze_application`; price 20 (earlier 10); milestone bonuses 5, 5, 5, 5, 10, 20; at most 3 applications per month.
1. **Entry shape per type:** id pattern per type (`daily_YYYY-MM-DD[_grantN|_revN]`, `milestone_...`, `freeze_buy_...`, `freeze_apply_...`, `welcome_freeze`); `daily`: `coinDelta - pendingDelta == 1`, `freezeDelta == 0`; milestone: `coinDelta - pendingDelta` in {5, 10, 20}; reversal: `coinDelta <= 0`, `pendingDelta >= 0`; purchase: `freezeDelta == 1`, `coinDelta` in {-20, -10}; application: `coinDelta == 0`, `freezeDelta == -1`; welcome: `coinDelta == 0`, `freezeDelta == 1`.
2. **Freeze application:** require the freeze document and the entry together, with `freezeDelta == -1` (which already forces `freezesOwned >= 1`), and require the `freezeMonths` counter to be written in the same commit with `count <= 3`.
3. **Habits:** restrict to `habits/{id}` and `habits/{id}/completions/{date}`, validate field types, name length and list sizes, and check `completions` ids are dates.
4. **User document:** restrict updates to non-wallet fields with `diff().affectedKeys()`; remove `deletionRequested` from owner control (make deletion a function, Section 4); constrain profile creation to the exact field set.
5. **Remove or lock `todos`.**
These cut S-01 from "any amount" to "+1 per distinct date id" and "+5/10/20 per milestone id", end S-02 and S-03, and reduce S-04 and S-05. They **cannot** prove a reward is earned, because eligibility depends on many completion documents and rules can read only a few documents per request. Full protection needs Section 4. Every rule change must be tested in the **Firestore emulator against both the Web and the Android write shapes** before deploying, because the same project serves the unchanged Android app. There are no rules tests today (S-09).

## 4. Wallet security: recommended trusted architecture

Goal: protect coin earning, reward reversals, milestones, freeze purchases and applications, pending adjustments, duplicates and concurrency, **without changing the existing reward rules**.

**The constraint that shapes everything.** The wallet can only be made server-authoritative when the rules deny client writes to wallet fields and collections. The unchanged Android app writes them directly from the client, so that final switch **breaks Android** until Android also calls the server. For a Web-only release the wallet therefore stays client-trusted at the rules level. The plan below is staged so each step is safe on its own.

### Recommended backend (Firebase Cloud Functions, 2nd generation, TypeScript)

Key idea: **reuse the existing pure domain code.** The Web's reward, ledger, freeze and streak rules are already framework-free TypeScript (`domain/rewards.ts`, `ledger.ts`, `freeze.ts`, `streak.ts`, `schedule.ts`). Extract them into a shared package imported by both the Web and the functions, so the server uses **exactly the same rules** as today and no reward rule changes.

| Function | Trigger | What it does |
|---|---|---|
| `onCompletionWritten` | Firestore write of `habits/{id}/completions/{date}` | Debounced reconcile for that user: recompute eligible rewards from the stored completions (current-month window, `rewardsIgnoredThrough` honoured), then grant and reverse with the same deterministic ids (`daily_{date}`, `{id}_grantN`, `{id}_revN`, `milestone_...`) in Firestore transactions via the Admin SDK. Pending adjustments are handled by the same ledger code. |
| `buyFreeze` | HTTPS callable | Checks price, coins, hold limit and monthly limit in one transaction. The client sends a request id (a UUID), which becomes `freeze_buy_{requestId}`. |
| `applyFreeze` | HTTPS callable | Checks owned freezes, the 3-day window, eligibility, the monthly counter and "already frozen", writes the freeze, the counter and the entry together. |
| `onUserCreated` | Auth user created (or a blocking function) | Creates the profile (20 coins, welcome freeze under `welcome_freeze`), replacing client-side profile creation. |
| `deleteAccount` | callable, re-authenticated | The only path that sets deletion and removes data; the client can no longer set `deletionRequested`. |
| `auditLedger` (detective) | Firestore create of `walletTransactions/{id}` | Re-derives whether the entry is legitimate; if not, writes a compensating entry and records an alert in an admin-only collection. |

Properties:
- **Idempotency and duplicates:** unchanged deterministic ids, checked inside a transaction.
- **Concurrency:** each operation is a transaction on the user document and the documents it touches; Firestore retries on contention. Functions use `maxInstances` and a per-user operation counter (for example at most N operations per minute) held in the transaction, to bound abuse.
- **Time:** rewards depend on the user's local date. The server needs a trusted way to know it (a callable argument validated to within +/- 1 day of server time, or a stored time zone, which is a schema addition needing your approval).
- **Rewards from stored data, not from client claims:** the client never sends "I earned 1 coin". It writes completions (it already does), and the server decides.
- **Billing:** Cloud Functions need the **Blaze (pay as you go) plan**. Cost is small at launch but needs a budget alert.

### Staged rollout (each stage safe on its own)

1. **Now, no Android impact:** keep the wallet client-trusted but ship the Section 3 rules tightening (after emulator tests with both clients' write shapes), App Check in monitor mode, and budget alerts. This ends the cheapest abuse.
2. **Detective control (still no Android impact):** deploy `auditLedger` and an alert. It catches forged entries from either client without blocking anyone.
3. **Web moves to the callables and the reconcile function.** App Check can be enforced **per function** (`enforceAppCheck: true`) without touching Firestore enforcement, so Android is unaffected. The rules still allow client writes (for Android), so this stage adds a trusted path but does not yet remove the untrusted one.
4. **Android moves to the same functions** (a separate Android task and release). Then deny client wallet writes in the rules, which is the step that actually ends forging.
Until step 4, a determined signed-in user can still forge entries within the Section 3 limits. That residual risk is the cost of keeping Android unchanged.

## 5. App Check (audited)

Current state: **not present.** The Web code has no `firebase/app-check` import, no site key and no debug token handling (`services/firebase.ts` only creates the app, auth and Firestore). The Android Gradle files have no App Check or Play Integrity dependency either. Enforcement is off (the Firebase default).

**Critical consequence:** App Check enforcement is **per product for the whole project, not per app.** Turning on enforcement for Firestore or Authentication would immediately reject every request from the unchanged Android app, which cannot present a token. **Do not enforce Firestore or Authentication while Android lacks App Check.**

Recommended Web-only rollout:
1. Register the Web app in Firebase App Check with **reCAPTCHA Enterprise** (or reCAPTCHA v3) and create the site key for the production domain. Add the domain to the key.
2. In `services/firebase.ts`, call `initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(SITE_KEY), isTokenAutoRefreshEnabled: true })` **before** `getAuth` and `getFirestore` are first used. Read the site key from an `EXPO_PUBLIC_` variable (a public identifier).
3. For development, use the debug provider with a token from an environment variable that is **never** set in the production build, and register that token in the Console.
4. Leave enforcement **off** and watch the App Check metrics for at least 1 to 2 weeks (verified versus unverified requests by product).
5. Enforce only where Android is not affected: **per-function enforcement** on the new callables (Section 4, stage 3). Revisit Firestore and Authentication enforcement only after Android ships App Check.
6. Know the limits: App Check proves the request comes from your app, not that a signed-in user is honest. It reduces bots, scripted sign-ups and quota abuse (S-05, S-06). It does not stop a real user from forging wallet entries (S-01).

## 6. Environment and deployment configuration (audited)

| Item | Result |
|---|---|
| `.env.local` | Exists, 6 variables, **names only checked**: `EXPO_PUBLIC_FIREBASE_API_KEY`, `..._AUTH_DOMAIN`, `..._PROJECT_ID`, `..._STORAGE_BUCKET`, `..._MESSAGING_SENDER_ID`, `..._APP_ID`. All are public identifiers by design. No service account, private key, token or password. |
| `.gitignore` | Ignores `.env*.local`, `node_modules`, `dist`, `.expo`, keys and certificates. Adequate. |
| Version control | **Corrected: a repository exists** (S-10): `web/.git`, branch `main`, one "Initial commit" (the Expo template, 15 tracked files, no remote). `git check-ignore` confirms `.env.local` is ignored and `git log --all -- .env.local` shows it was never committed. All the real work (about 30 paths) is untracked, so there is no history to review and no backup. Commit the work once reviewed, and confirm with `git status` that `.env.local`, `dist/`, `_tmp/` and logs are untracked. |
| Firebase config in the bundle | Present once (project id, auth domain and the web API key). Expected and not a secret. Protection comes from API key restrictions, App Check, Auth and the rules. |
| Production bundle (fresh export, 11 JavaScript files, 3.0 MB) | **No source maps. No `__consistoFake*` test hooks (0 matches). No `consistoDev` (0). No service-account or private-key patterns (0). No test credentials (0).** The development tools and fake backends are stripped because they are gated by `__DEV__`. |
| Debug and test hooks | `installDevTools` and every `window.__consistoFake*` hook are gated by `__DEV__` and are absent from the production bundle (verified in the built output). |
| Left in production | `consisto_mock_start_coins` (S-15): a test knob that sets the starting coins of the local guest wallet. Harmless (guest wallets are never imported) but should be removed. The word `resetData` in the bundle is React Native's internal frame-metrics code, not the app's. |
| Guest import | Off in production unless `EXPO_PUBLIC_GUEST_IMPORT_ENABLED=true` is set at build time. The export confirms the flag was not set, so the import UI is unreachable. |
| Expo build | `app.json`: Metro bundler, `output: single` (a single-page app). No `firebase.json`, no hosting rewrites, no headers (S-07). There is no `build` script in `package.json` (`expo export --platform web` works). |
| Page security | `index.html` has no Content-Security-Policy or other security meta. Headers must come from the host. |
| Stray files | Crash logs (`hs_err_pid*.log`, `replay_pid*.log`) record environment variables and paths. Six created by my own failed Gradle runs today were deleted; one older log (`android/hs_err_pid13668.log`, 16 Oct) remains. `android/.gitignore` does not ignore `hs_err*` or `replay_pid*` (S-17). The folder above `web/` also holds an unrelated Vite project; deploy only from `web/`. |
| Android signing | `android/keystore.properties` and `android/local.properties` exist and **are** ignored by `android/.gitignore`. Not read. |
| Dependencies | `npm audit` was not run (S-18). |

## 7. Guest migration (audited)

| Item | Result |
|---|---|
| `rewardsIgnoredThrough` | Written by the client on imported habits only (the habit document), fixed by the migration record so retries write the same date. It is validated on read (a malformed value reads as absent). Because it is client written, a user can set it on any habit to exclude that habit from reward decisions. That only affects their own rewards, and S-01 already allows far more, but a **server-side reward engine must not trust it blindly**: accept it only when `migratedFrom` is present and the date is not after the document's server update time. It protects rewards only on builds that read it: the Web, and the Android change that exists in the working tree but is **not released**. For a Web-only release **keep the import off** (S-11). |
| Migration ids | `crypto.randomUUID()` (a CSPRNG) with 8 hex characters in each cloud id, checked against the server for collisions and fixed in the record. Collisions are not realistic. `randomUUID` needs a **secure context**, so the site must be served over HTTPS (localhost also works). |
| Import verification | Reads from the server (`getDocFromServer`, `getDocsFromServer`) before writing the completion marker. It checks presence, not values, by design. |
| Retry | Idempotent; an uploaded habit is not rewritten; ids are stable across retries and days; behaviour is covered by unit and browser tests. |
| Profile creation | One Firestore transaction, only when the document is missing, Android's exact fields. The rule only checks `coins == 20` and `freezesOwned == 0` (S-14). A server-created profile (Section 4) would replace this. |
| Duplicate prevention | A per-browser marker. Two browsers (or a cleared storage) can import the same guest data twice under different migration ids; this is by design but it creates duplicate habits and is unbounded (S-16). |
| Guest data preservation | Verified: the guest data is read only and never changed or deleted. |
| Input limits | None on the number of habits, completions or text lengths in the guest data (it is user editable). Recommended caps before enabling: for example 200 habits, 20,000 completions per habit, names of at most 100 characters. Notes are already capped at 200 by the rules. |
| Shared browsers | The import offer shows the guest's habit names to whichever account signs in next on that browser (S-16). Same on Android. Acceptable, but worth a line in the privacy text. |

## 8. Required Firebase Console changes

None of these have been made, and none can be verified from the code.
1. **Firestore rules:** confirm that the deployed rules equal `android/firestore.rules`. Download them from the Console (Firestore > Rules) and diff.
2. **API key** (Google Cloud Console > APIs & Services > Credentials, the Browser key): set HTTP referrer restrictions to the production domain (plus `localhost` only for a separate development key if you want one), and restrict the key to the APIs the Web uses: Identity Toolkit, Token Service (Secure Token), and Cloud Firestore.
3. **Authentication > Settings > Authorized domains:** list only the production domain(s) and `localhost` (remove anything else).
4. **Authentication > Settings:** enable **email enumeration protection**; set the **password policy** (minimum 8) if you upgrade to Identity Platform; keep sign-in methods to email and password only; customise the email templates and the action URL domain.
5. **App Check:** register the Web app and create the reCAPTCHA Enterprise key (Section 5). **Do not enforce.**
6. **Billing:** set a budget with alerts (and consider a Firestore usage alert) before launch; this is also the practical defence against S-05.
7. **Cloud Functions (later):** the Blaze plan is required (Section 4).
8. **Android:** nothing to change for this release.

## 9. Production deployment requirements (checklist)

- Serve over **HTTPS only**, with HSTS. (`crypto.randomUUID` and Firebase Auth both require a secure context.)
- Build with `expo export --platform web` from a clean checkout, with `.env.local` supplied by the build environment, **without** `EXPO_PUBLIC_GUEST_IMPORT_ENABLED`.
- Host as a single-page app: rewrite every route to `index.html`; cache hashed assets as immutable and `index.html` as no-cache.
- Send security headers: `Content-Security-Policy` (allow `'self'`, `https://*.googleapis.com`, `https://identitytoolkit.googleapis.com`, `https://securetoken.googleapis.com`, `https://firestore.googleapis.com`, `https://www.google.com/recaptcha/` and `https://www.gstatic.com/recaptcha/` once App Check is added; React Native Web injects styles, so `style-src 'unsafe-inline'` is needed; no inline scripts), `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and `frame-ancestors 'none'` (click-jacking). Test the policy in report-only mode first.
- Do not publish source maps, `_tmp`, test files or the `tests/live` folder.
- Put the rules, indexes and hosting configuration in the repository (`firebase.json`, `firestore.rules`), and add **Firestore emulator rules tests** that run both the Web and the Android write shapes, plus the attack cases in Section 3.
- Review `git status` before the first real commit (the repository exists but holds only the Expo template commit).
- Run `npm audit` and pin versions; re-run the full test suites (TypeScript, 677 unit, 688 browser) against the production build before release.
- Add error and abuse monitoring: Firebase Authentication and Firestore usage dashboards, App Check metrics, and alerts.
- Publish a privacy policy that covers guest data in the browser, accounts, and what the Web stores.

## 10. Remaining risks after the recommended fixes

1. **The wallet stays forgeable within limits until Android also uses the server.** With Android unchanged, the rules cannot deny client wallet writes. The tightened rules and the detective function reduce and detect abuse; they do not remove it. Decide whether coins and streaks have any value outside the app (rewards, rankings, prizes). If they do, Android's migration must be scheduled.
2. **App Check cannot be enforced on Firestore or Authentication** for the same reason; it will run in monitor mode only.
3. **Guest import** must stay off until an Android build that reads `rewardsIgnoredThrough` is the one in use, or until you accept that older Android builds can pay or reverse rewards for imported history.
4. **Rules cannot verify earning.** Even with strict shapes, "+1 per date" can be claimed for dates the user did not complete until the server computes rewards.
5. **Residual cost abuse:** a signed-in user can still create many documents (within the rules) until caps, App Check and budget alerts are in place.
6. **Verification gaps:** the deployed rules, API key settings, authorized domains, and live behaviour were not checked (Section 0).

## 11. Proposed order of work (for your approval; none of it is started)

1. Console checks and settings (Section 8), a first reviewed commit, and the hosting configuration with headers.
2. Rules tests in the emulator, then the compatible rules tightening (Section 3), then deploy.
3. App Check in monitor mode (Web).
4. Remove the production test knob; add import size caps (only needed before the import is enabled).
5. `auditLedger` and alerts; then the shared domain package, `onCompletionWritten`, `buyFreeze` and `applyFreeze`, `onUserCreated`, `deleteAccount`, and per-function App Check enforcement.
6. Android migration to the same functions, then the rules switch that denies client wallet writes.

Wait for approval before implementing any of these.
