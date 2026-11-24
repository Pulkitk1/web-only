# Consisto — Backend Migration Plan (Phase 9A: Firebase audit)

Status: **audit only.** Nothing in this document has been executed. No Firebase project was created, no web app was registered, no Firestore
collection or rule was touched, no Kotlin file was changed, and the web app is not connected to Firebase. No credentials are reproduced here.

How to read it: every statement is tagged.

- **[V]** Verified by reading the file named next to it (repository state as of this audit).
- **[A]** Assumption or inference. Needs confirmation before it is relied on.
- **[?]** Unknown: not determinable from the repository (needs the Firebase console or the owner).

Sources: `D:\habbit_tracker_web\android` (Kotlin, read-only), `D:\habbit_tracker_web\web` (this project).

---

## 1. The existing Firebase project

| Item | Value | |
|---|---|---|
| Firebase project id | `habbit-tracker-12` | [V] `app/google-services.json` |
| Project number | `112045327207` | [V] same |
| Android app id / package | `1:112045327207:android:…` / `com.habittracker.app` | [V] same |
| Storage bucket name present | `habbit-tracker-12.firebasestorage.app` | [V] same; the app does not use Storage [V] (no Storage dependency in `app/build.gradle.kts`) |
| OAuth clients in the config | one Android client and one web-type client are listed | [V] `google-services.json` (types 1 and 3). Whether Google sign-in is enabled in the console is [?]; the app does not use it [V] |
| Firebase SDKs | BoM 34.4.0: `firebase-auth`, `firebase-firestore` only; Google Services plugin 4.4.4 | [V] `app/build.gradle.kts`, `build.gradle.kts` |
| Firestore database id / location / mode | default database; location and edition not in the repo | [?] |
| Cloud Functions | **none**: no `functions/` folder, no `firebase.json`, no `.firebaserc` | [V] directory search of `android/` |
| Security rules | `android/firestore.rules` exists; whether the deployed rules equal this file | [?] (no `firebase.json`, so deployment is manual or via console) |
| Firestore indexes | no `firestore.indexes.json`; all queries are single-field, which need no composite index | [V] (queries: `whereEqualTo("active", true)`, `whereEqualTo("habitId", …)`, `limit`) |
| App Check, billing plan, authorized domains, email-enumeration protection | not in the repo | [?] |

Secrets present in the Android folder that must never be copied into the web repo or shared: `keystore.properties`, `local.properties`,
`app/google-services.json` (contains an API key; Firebase API keys are not secret in the cryptographic sense but are restricted by console
settings) [V that the files exist].

---

## 2. Authentication architecture (Android)

[V] unless noted. Files: `AppViewModel.kt`, `ui/screens/LoginScreen.kt`, `data/Session.kt`, `data/AccountRepository.kt`.

- **Provider in use: Email + password only.** `createUserWithEmailAndPassword` / `signInWithEmailAndPassword` (`AppViewModel.authenticate`). The login screen has
  an email field, a password field, Sign In / Create Account, "Forgot Password?" and "Skip for Now". No Google, phone or anonymous login for accounts.
  (The Settings screen still carries legacy `AuthMethod.Google/Phone` display code, kept "only for legacy Settings UI paths"; it is not a login path.)
- **Password reset:** `sendPasswordResetEmail(email)`; Firebase's hosted page sets the new password. An unknown address is reported as success (no account
  probing). Only Auth is involved.
- **Sign-in errors:** weak password (min 6 chars), email collision, invalid credentials (generic message), offline, too many requests.
- **Session model** (`SessionResolver`): a Firebase login always wins; otherwise a remembered **guest** flag (`guest_mode` in DataStore); otherwise show login.
  Guest data lives in a local Room database (`consisto-local.db`, version 7), uid constant `"guest"`; accounts live in Firestore. The two are never mixed.
- **Sign-out:** `auth.signOut()`, stop listeners and reminders, clear in-memory state and Firestore's local cache; **no Firestore data is touched**.
- **Delete account:** re-authenticate with the password → mark `users/{uid}.deletionRequested=true` → delete `completions` under each habit, then `habits`, then
  `walletTransactions`, `freezes`, `freezeMonths`, `rewards`, `todos` → delete the profile document → `user.delete()`. Idempotent and resumable.
- **Feedback uses a second identity:** guests send feedback through an **anonymous** sign-in on a separate named `FirebaseApp` (so the default Auth stays signed out)
  [V `FeedbackRepository.kt`]. This means the **Anonymous provider is enabled** in the project [A, strongly implied].
- **Profile document creation** (`loadUser`): if `users/{uid}` does not exist, it is created with
  `{email, displayName(email before @), coins: 20, freezesOwned: 0, welcomeFreezePending: true, isDark: true, createdAt, updatedAt}`; then the welcome freeze is granted
  through the ledger (`welcome_freeze`) and `welcomeFreezePending` is set to false.

---

## 3. Firestore structure (as written by Android)

All user data is under `users/{uid}` where `uid` is the Firebase Auth uid [V `HabitRepository`, `WalletRepository`, `DayNotes.kt`, `AccountRepository`].

### 3.1 `users/{uid}` (profile + the only copy of the wallet)
`email`, `displayName`, `coins` (int), `freezesOwned` (int), `pendingAdjustment` (int, optional, default 0), `lastTransactionId` (string),
`welcomeFreezePending` (bool, new accounts only), `isDark` (bool, legacy theme copy; adopted once if the device has no saved theme),
`freezeDates` (array of "yyyy-MM-dd", **legacy**: read by `isFreezeDate`, never written now), `deletionRequested`, `deletionRequestedAt`, `createdAt`, `updatedAt`.

### 3.2 `users/{uid}/habits/{habitId}` (id = Firestore auto-id for habits created in the app)
Written on create [V `AppViewModel.addHabit`]: `name`, `color` (**Long**, Compose `Color.value.toLong()`; see risk R3), `completedDates` (array, legacy mirror), `streak`, `bestStreak`
(stored but always recomputed on read), `daysPerWeek`, `restDays` (["Mon".."Sun"]), `createdDate` ("yyyy-MM-dd"), `sortOrder` (Long: `currentTimeMillis` on create, `0..n-1` after a reorder),
`scheduleHistory` (array of `{from: "yyyy-MM-dd", restDays: [...], daysPerWeek}`), optional `goal`, `reminderEnabled`, `reminderTime` ("HH:mm"), `archived` (bool), plus
`createdAt`/`updatedAt` (server timestamps). `why` is read if present (older habits), no longer written. `migratedFrom` is added by guest migration.
Field semantics worth keeping exact: removing a goal writes `goal: ""`; unarchive writes `archived: false`; `sortOrder` missing sorts first, then by `createdAt`.

- `…/habits/{habitId}/completions/{yyyy-MM-dd}` : `{date, completed (bool), updatedAt, completedAt | uncheckedAt}`. Unchecking **keeps** the document with `completed=false`.
  **Source of truth** for completion; the habit's `completedDates` array is the legacy fallback: `completed = (legacy − unchecked dates) ∪ checked dates` [V `HabitRecordParsing.kt`].
  A check/uncheck is one batch: set the completion doc (merge) + update the habit (`arrayUnion`/`arrayRemove` on `completedDates`, optional `streak`/`bestStreak`, `updatedAt`).
- Deleting a habit removes its completion docs, the habit, and its day notes (no cascade in Firestore). **Freezes, rewards and ledger entries are not removed.**

### 3.3 `users/{uid}/walletTransactions/{txId}` (immutable ledger; id = idempotency key)
`type` (`daily_completion`, `streak_milestone`, `reward_restored`, `reward_reversal`, `welcome_freeze`, `freeze_purchase`, `freeze_application`), `coinDelta`, `freezeDelta`,
`balanceAfter`, `createdAt`, optional `date`, `habitId`, `milestone`, `pendingDelta` (only when non-zero), `rewardId`.
Id patterns [V `WalletLedger.kt`]: `daily_{date}`, `milestone_{habitId}_{n}_{date}` (see `RewardRules`), `{id}_rev{cycle}`, `{id}_grant{cycle}`, `welcome_freeze`,
`freeze_buy_{requestId}`, `freeze_apply_{habitId}_{date}`.

### 3.4 `users/{uid}/rewards/{rewardId}`
`active`, `cycle`, `amount`, `type`, `lastTransactionId`, `updatedAt`, optional `date`, `habitId`, `milestone`. Rewards granted before this collection existed are recognised by their ledger entry.

### 3.5 `users/{uid}/freezes/{habitId}_{yyyy-MM-dd}` and `freezeMonths/{yyyy-MM}`
`freezes`: `habitId`, `date`, `month`, `paidWith` ("inventory", legacy "coins"), `transactionId`, `createdAt`. `freezeMonths`: `{count, updatedAt}`, counts applications by the month of the protected date, max 3.

### 3.6 `users/{uid}/dayNotes/{habitId}_{yyyy-MM-dd}`
`habitId`, `date`, `text` (1–200 chars), `updatedAt`; `createdAt` set at first save (merge keeps it).

### 3.7 Other
`users/{uid}/todos/{id}`: legacy (removed Daily To-Do); only cleaned up on account deletion. `feedback/{id}`: top-level, create-only, written with an account or anonymous identity.

### 3.8 Wallet write protocol (important for the web)
Every balance change is a **Firestore transaction** (`runTransaction`, needs a connection; offline it fails rather than queues) that does together: update `users/{uid}`
(`coins`, `freezesOwned`, `pendingAdjustment`, `lastTransactionId`, `updatedAt`) + create `walletTransactions/{txId}` (+ `rewards/{id}` and/or `freezes/{id}` + `freezeMonths/{month}`).
Reads are done once per document before writing. The rules (below) reject any wallet change that is not backed by a matching ledger entry in the same transaction.

### 3.9 Device-only data on Android (not in Firestore)
Theme, notification switches (`{uid}_habit_reminders`, `{uid}_streak_alerts`), pending milestone celebrations, rest-day-celebration markers, last-reminder markers (DataStore).
The web equivalents are already in `devicePrefs` with the same key names [V `web/services/devicePrefs.ts`].

---

## 4. Security rules assessment (`android/firestore.rules`) [V]

What they enforce:
- Everything is owner-only: `request.auth.uid == userId`; default is deny (no catch-all). Sign-in method is irrelevant, so the same rules protect web sessions.
- `users/{uid}`: create only with `coins == 20` and `freezesOwned == 0`; update allowed if the wallet fields are unchanged **or** backed by a ledger entry created in the same transaction
  whose `coinDelta`, `freezeDelta`, `balanceAfter` and `pendingDelta` match the change, with non-negative balances and a fresh `lastTransactionId`; the `deletionRequested` flag cannot be cleared;
  delete only after `deletionRequested`.
- `walletTransactions`: append-only (`update` false), `coinDelta`/`pendingDelta` within ±20, `freezeDelta ∈ {-1,0,1}`, must be the entry the user doc points to; delete only during account deletion.
- `rewards`, `freezes` (id must equal `{habitId}_{date}`, and the `freeze_apply_…` ledger entry must exist after the write), `freezeMonths` (count may only go up by 1, max 3).
- `dayNotes`: id must equal `{habitId}_{date}`, text 1–200 chars.
- `habits/**`, `todos`: owner read/write with **no field validation**.
- `feedback`: create-only with a strict key set; no list/update/delete.

Assessment:
1. **Suitable for a second client as-is.** Nothing in the rules is Android-specific, so a web client signed in as the same uid is authorised identically. **No rule change is required to start** [A: assuming the deployed rules equal this file, see R1].
2. **The wallet is client-trusted.** The rules themselves say so: a determined owner can write a fake reward entry (≤ +20 coins each, repeatable). This is an existing property of the Android app, not new risk from the web, but a web client (inspectable in dev tools) makes it easier to exploit. Real protection needs server-side logic (Cloud Functions) — a product decision, not part of this migration.
3. **Habit documents are unvalidated** (any shape, any size). A buggy web write could corrupt a habit that Android then misparses. Mitigation is in the web repository layer (write only known fields, same types), not rules.
4. **The web must follow the transaction protocol exactly**, or the rules will reject writes (e.g. updating `coins` without the ledger entry, or reusing `lastTransactionId`).
5. **Deployed state unknown [?]:** the file may be out of date relative to the console. Compare before relying on it (`firebase firestore:rules get` or the console's Rules tab).
6. No `get`/`list` restriction concerns for the web: queries are all within `users/{uid}/…` for the signed-in uid.

---

## 5. The web project today (verified)

- No Firebase dependency; no authentication code; the Settings screen is the signed-out "Guest" view with sign-in actions that only explain [V `package.json`, `components/settings/SettingsScreen.tsx`].
- Data layer: `store/AppStore.tsx` (single React context; synchronous commits), `store/initialState.ts` (restore or seed once), `services/appStorage.ts` (versioned envelope in localStorage, key `consisto_app_data`, version 1, validation, migrations, quarantine of corrupt data), `services/devicePrefs.ts` (theme, notification switches, milestone queue, rest-day markers) [V].
- Domain modules are pure TypeScript ports of the Kotlin rules (`streak`, `schedule`, `freeze`, `rewards`, `ledger`, `analytics`, `notes`, …) and are the same logic Android runs [V, covered by ported tests].
- Seeded **mock data** (SQL Practice, Morning Run, …, ids `h1`–`h5`, a seeded frozen day, 35 coins) is created for every new local installation [V `store/initialState.ts`].

### 5.1 Model mapping: web ↔ Firestore

| Concept | Web today | Firestore (Android) | Gap / action |
|---|---|---|---|
| Habit id | `h1…`, `local-N` (counter) | Firestore auto-id | Use Firestore auto-ids for cloud habits; local ids collide across browsers |
| Colour | `"#RRGGBB"` | Long = Compose `Color.value` | Need a converter (R3) |
| Completions | `completedDates: string[]` | `completions/{date}` docs **+** legacy array | Write both exactly like `setCompletion`; read the union rule above |
| Schedule history | `{from, restDays, daysPerWeek}[]` | same shape | Compatible |
| Order | array order | `sortOrder` Long + `createdAt` | Map order ↔ `sortOrder` (new habit = `Date.now()`, reorder = `0..n-1`) |
| Archive, goal, reminder | `archived`, `goal: string\|null`, `reminderEnabled`, `reminderTime` | same names; goal removal = `""` | Map `null` ↔ `""`; keep `why` and unknown fields untouched (merge/`update` only known fields) |
| Streaks | derived | stored but derived on read | Web may skip writing them; Android recomputes |
| Notes | `{habitId: {date: text}}` | `dayNotes/{habitId}_{date}` | Compatible (200-char cap identical) |
| Wallet | `ledger.wallet {coins, freezesOwned, pending}` | `users/{uid}` fields | Compatible; must be written only inside ledger transactions |
| Ledger entries | `{id,type,coinDelta,freezeDelta,balanceAfter,pendingDelta}` | also `date`, `habitId`, `milestone`, `rewardId`, `createdAt` | Fill the extra fields from the reward record when writing |
| Rewards | `rewards[id] {active,cycle,amount,type,date,habitId,milestone}` | `rewards/{id}` + `lastTransactionId` | Compatible |
| Freezes | `freezes[] {habitId,date,paidWith}` | `freezes/{habitId}_{date}` + `freezeMonths/{month}.count` | Web derives the count; cloud needs the counter doc for the rules |
| Legacy freezes | not modelled | profile `freezeDates` (read-only legacy) | Honour on read (`isFreezeDate`) |
| `welcomeFreezePending` | n/a | profile flag, grant welcome freeze once | Replicate `loadUser` exactly |
| Theme/notification switches | `devicePrefs` | device-local (profile `isDark` is a legacy copy) | Keep device-local; optionally adopt `isDark` once like Android |

---

## 6. Recommended shared-Firebase architecture for the web

Principle: **same project, same uid-scoped documents, no schema change.** The web becomes a second client of `users/{uid}`; Android is untouched.

### 6.1 Which existing pieces are reused
Auth users, the `users/{uid}` tree (all collections in §3), the security rules, and the Firestore database. **No collection needs to be created, renamed or migrated.**
Whether any change is needed to the Firebase *console* settings (a new Web app registration, authorised domains, API-key restrictions, optional App Check) is covered in §9; none touches data.

### 6.2 Layering (so UI stays unchanged and local-only remains possible)
```
UI screens ──► AppStore (same public API as today)
                 └─► DataRepository interface  (habits, completions, notes, wallet ledger, profile)
                        ├─ LocalRepository   (today: appStorage / localStorage)      ← guest
                        └─ FirestoreRepository (new, behind the same interface)       ← signed-in
SessionProvider: Firebase Auth state decides which repository is active
```
- Mirror Android's `SessionResolver` (**Firebase login wins → remembered guest → login**) and `HabitStore`/`WalletStore`/`NoteStore` split; the interfaces already exist in Kotlin and are a template.
- Keep the TypeScript domain modules as the single rules engine; the repository only persists. Reward reconciliation and ledger calls stay in domain code.
- Preserve Android's write semantics: optimistic local update + background sync for habits/completions/notes; **transactions that require a connection** for the wallet.
- Real-time: `onSnapshot` listeners mirroring `observeHabits` (habits + a completions listener per habit), `observeWallet`, `observeFreezes`, `observeActiveRewards`, notes. This keeps Android and web in sync live.
- Firestore client: modular JS SDK with a persistent local cache (multi-tab) so reloads and short offline spells behave like Android's cache [A: confirm the API for the Expo SDK 58 / React Native Web target in the SDK docs before coding].

### 6.3 Authentication on the web
- **Email + password only**, to match Android: sign in, create account, forgot password (`sendPasswordResetEmail`), sign out, delete account (re-authenticate → delete data in the same order as `AccountRepository` → delete the Auth user). Same error-message mapping as `signInErrorMessage`.
- **Existing Android users sign in on the web with the same email and password.** Firebase Auth accounts belong to the project, not the app, so no import or linking is needed [V by design of Firebase Auth; [A] that no account uses a provider other than email/password, which the Android code supports].
- **Session handling:** Firebase Auth persists the session in the browser (IndexedDB/localStorage) and restores it via `onAuthStateChanged`; show a loading state until it fires (Android's `AuthState.Loading`). The web and Android sessions are independent; signing out on one does not sign out the other.
- Routes: add a login route and guard like Android's startup (`Routes.destinationFor`): no session and not guest → login; "Skip for Now" → guest mode (existing local persistence).
- Keep `guest_mode` as a device flag (same key name as Android's DataStore key).

### 6.4 Access to the same data
Both clients read/write `users/{uid}/…` with identical field names and types (§3, §5.1). Concurrent use is safe for the wallet (transactions + idempotent ids) and for completions (per-day documents). Two things to engineer deliberately:
- **Reward reconciliation runs on both clients.** Reward ids are deterministic and the ledger ignores duplicates, so both converging is safe [V ledger design]; the web must use the same ids and cycle suffixes (it does, being a port).
- **"Today" is each device's local date** (`LocalDate.now()` / browser clock). Users who use Android and the web in different time zones can see different "today" values (R8).

### 6.5 Security rules (web)
Reuse the existing rules unchanged for the first release. Follow-ups (separate decisions): add field validation for `habits`, and decide on Cloud Functions for server-verified rewards (R5). Never put admin credentials in the web bundle.

---

## 7. Guest-data migration (web)

Android's design [V `GuestMigration.kt`, `FirestoreMigrationCloud.kt`, `GuestMigrationTest.kt`] is the model; the web should reproduce it, because both apps then behave identically for users:

1. **Preparing:** snapshot local data; create or reuse a persistent migration record (stable migration id + target uid); ensure the profile exists (same creation fields; `coins: 20` as the create rule requires).
2. **Uploading:** upload habits (fields + `completedDates` mirror + `migratedFrom: "{migrationId}:{localId}"`) and every completion document in batches of ≤400; upload notes keyed `{cloudHabitId}_{date}`; then **replay the wallet ledger entry by entry through the normal ledger operations** (grant/revoke reward, welcome freeze, buy freeze with the recorded price, apply freeze), each a real transaction with its original id. This is what prevents double rewards, overdraft and limit violations, and what lets rewards already present on the account be recognised as duplicates.
3. **Verifying:** read everything back from the server (habit exists with the right `migratedFrom`, schedule history equal, completion count ≥, freezes/ledger entries/notes present). Any mismatch fails the run; it can be retried.
4. **Completed:** record the account uid locally so the same data can never be imported twice; keep the local data as a backup, delete nothing.
- Every step is idempotent; a failed or interrupted run resumes with the same migration id. If the account already has Consisto data (`habits` or `walletTransactions` non-empty), Android asks the user what to do first; the web should do the same (merge / skip).
- If a local habit id is already used in the cloud by an unrelated habit, derive a stable new id (`{id}-m{migrationId[0..8]}`) as Android does.

Web-specific problems to resolve first (these do not exist on Android):
- **The web's "guest data" is mock data unless the user changed it.** Uploading the five demo habits and 35 seeded coins to a real account would be wrong. Needs a decision and a stored marker (R6): e.g. record `seeded: true` and only offer migration if the user has created/changed data, or let the user choose "Start fresh / Import this browser's data".
- **Local ids (`h1`, `local-3`) are not unique across browsers.** Switch new local habits to random ids (or always generate Firestore-style ids at upload) and use the derived-id rule on collision. Reward ids and freeze ids embed the habit id, so the id map must be applied consistently when replaying.
- **Ledger fidelity:** the web ledger entries lack `date`, `habitId`, `milestone`, `rewardId`; replay from the reward records and freeze list (which hold them) rather than copying transactions verbatim.
- **Starting balance:** a new account is created with 20 coins by rule; the seeded web wallet starts differently (20 + seeded rewards). Replay, do not copy balances.
- Storage versioning: any change to local data needed for migration (marker, id scheme) goes through the existing `appStorage` migration mechanism (version 2).

---

## 8. Risks and required decisions

| # | Risk / question | Severity | Notes / proposed handling |
|---|---|---|---|
| R1 | Deployed Firestore rules may differ from `firestore.rules` | High | Compare in the console before any web write; do not assume. [?] |
| R2 | Web writes that violate the wallet transaction protocol will be rejected or, worse, drift from Android | High | Implement the ledger as a port of `FirestoreLedgerRunner`, with tests that replay Android's `WalletTest` cases against the Firebase emulator |
| R3 | Habit `color` is stored as a Compose `Color.value` Long | High | Android writes `color.value.toLong()` and reads `Color(value.toULong())` [V]. For sRGB, Compose packs ARGB into the high 32 bits [A: Compose implementation detail]; confirm by decoding real documents (e.g. `#4ADE80` ↔ the stored number) before writing a converter. Must round-trip, and the web must write the same format Android reads. |
| R4 | Both clients can edit one habit; web must not drop unknown fields (`why`, `migratedFrom`, `streak`, `bestStreak`, `sortOrder`) | Medium | Write with `update`/merge of known fields only |
| R5 | Wallet is client-trusted (rules admit this); web is easier to tamper with | Medium (existing) | Product decision: accept for now, or add Cloud Functions / stricter rules later |
| R6 | Web "guest" data is demo data | High for migration | Decide: marker + opt-in import (recommended), or never migrate seeded data |
| R7 | Offline: Android wallet ops require a connection; web must behave the same (clear error), while habits/notes work offline | Medium | Persistent Firestore cache on the web; wallet buttons disabled/explained offline |
| R8 | "Today" is device-local on both clients; time-zone differences between devices | Medium | Same as Android today; document; no change in this migration |
| R9 | Email enumeration, password policy, reset email template/continue URL | Medium | Android relies on defaults and shows generic errors; keep identical. Check the console setting for enumeration protection [?] |
| R10 | API key / authorised domains / App Check for the web origin | Medium | Add `localhost` and the production domain to Auth authorised domains; restrict the web API key by HTTP referrer; App Check only if enforced [?] |
| R11 | Anonymous provider and the feedback path | Low | Not needed for the web in this phase (Feedback screen is not migrated); if added, mirror the separate-app anonymous identity |
| R12 | Account deletion on the web must delete in the same order as `AccountRepository` and respect `deletionRequested` rules | Medium | Port exactly; include `todos` |
| R13 | Deleting a habit leaves freezes/rewards/ledger entries (by design) | Low | Replicate; do not "clean up" |
| R14 | Existing local web data (seeded or user-entered) when a user later signs in | Medium | Covered by §7 and R6 |
| R15 | Web repo hygiene: Firebase config must not hold secrets; `.gitignore` for env files | Low | Config values are public identifiers, but keep them in env/config, never commit service-account keys |

### Decisions needed from you
1. Confirm the project to use is `habbit-tracker-12` and that the web app should be registered in it.
2. Authentication scope for the web v1: email + password only (recommended, matches Android)?
3. Guest/seed data policy (R6): opt-in import of user-modified local data only, or always start fresh after sign-in?
4. Is the deployed rules file the same as `firestore.rules`? (someone with console access should confirm)
5. Is Firestore App Check enforced? Is email-enumeration protection on?
6. Accept the client-trusted wallet for now (R5)?
7. Production hosting domain (for authorised domains and key restriction).

---

## 9. Exact next steps for Firebase Web registration (not performed yet)

Pre-checks (read-only, console):
1. Firebase console → project `habbit-tracker-12` → **Authentication → Sign-in method**: confirm Email/Password enabled; note whether Anonymous/Google are enabled. → **Settings → User actions / Authorized domains**: list domains; check email-enumeration protection.
2. **Firestore → Rules**: copy the deployed rules and diff against `android/firestore.rules`. **Firestore → Data**: open one real user document tree and confirm the structure in §3 (especially one habit's `color` value, `sortOrder`, `completions`, and a `walletTransactions` entry).
3. **Project settings → App Check**: confirm whether Firestore enforcement is on.

Registration (needs your go-ahead; it is a console change but changes no data):
4. **Project settings → Your apps → Add app → Web.** Nickname e.g. `Consisto Web`. Do **not** enable Firebase Hosting unless wanted.
5. Copy the SDK config object (apiKey, authDomain, projectId, appId, messagingSenderId, storageBucket) into a local, uncommitted environment file (e.g. `web/.env.local`, Expo `EXPO_PUBLIC_FIREBASE_*`). Add the file to `.gitignore`. These are identifiers, not secrets, but keep them out of source for easy rotation.
6. **Authentication → Settings → Authorized domains:** add `localhost` (already default) and the production web domain.
7. **Google Cloud console → APIs & Services → Credentials:** restrict the new web API key by HTTP referrer to the same domains and to the Identity Toolkit and Firestore APIs.
8. If App Check is enforced: register the web app with reCAPTCHA v3/Enterprise before any web write. Otherwise leave it for later.
9. Do **not** edit Firestore rules in this step.

Then (next phases, each needing approval): 9B read-only connection + sign-in against a **test account** (and ideally the Firebase Emulator Suite for development); 9C `FirestoreRepository` behind the repository interface with emulator tests porting Android's ledger tests; 9D guest-data migration per §7; 9E delete-account and remaining Settings actions.

---

## 10. Verification checklist still open
- [ ] Deployed rules equal `firestore.rules` (R1).
- [ ] Providers enabled in the console (Email/Password; Anonymous).
- [ ] Real document sample: `color` encoding (R3), `sortOrder` types, tx fields.
- [ ] Whether any production user data uses legacy fields (`freezeDates`, `completedDates` without completion docs, `todos`, 10-coin freeze purchases).
- [ ] App Check, billing plan, Firestore location/edition.
- [ ] Firebase JS SDK API/packaging for Expo SDK 58 + React Native Web (check the versioned docs, per `AGENTS.md`).

---

## Phase 9D.3 — completion, undo and live sync (implemented)

- **Completion write** (`services/habitWriter.ts` `setCompletion`, = Kotlin `HabitRepository.setCompletion`): one batch — `users/{uid}/habits/{id}/completions/{yyyy-MM-dd}` merge-set `{date, completed, updatedAt, completedAt | uncheckedAt}` + habit update `{streak, bestStreak, completedDates: arrayUnion/arrayRemove(date), updatedAt}`.
- **Reward protocol** (`services/cloudLedger.ts`, = Kotlin `WalletLedger.grantReward/revokeReward` on `FirestoreLedgerRunner`): one Firestore transaction per reward: reads user doc + reward + needed `walletTransactions`, then atomically writes the user wallet fields (`coins, freezesOwned, pendingAdjustment, lastTransactionId, updatedAt`), `walletTransactions/{txId}` and `rewards/{id}`. Arithmetic is the shared domain `grantReward/revokeReward`; decision is the shared `planRewards`; reporting is `summarizeRewards`. Ids: first grant `{id}`, restores `{id}_grant{n}`, reversals `{id}_rev{cycle}`.
- **Bookkeeping** (`services/cloudRewards.ts`): `inFlight` + `known[id]` like Kotlin's `rewardsInFlight` / `rewardKnown`; reconcile runs after each tap and after every server-confirmed (not `fromCache`) habits snapshot.
- **Listeners** (`services/cloudSync.ts`, `services/firestoreLive.ts`): user doc, habits (with metadata), one completions listener per habit, walletTransactions, rewards, freezes, freezeMonths, dayNotes; coalesced; disposed on sign-out / account switch.
- Still blocked for accounts (later stages): notes, freeze apply/purchase, reordering. No user document is created; rewards are skipped for an account without a profile document.

---

## Phase 9D.5 — wallet, coins and rewards synchronisation (implemented)

The Kotlin `WalletLedger` / `WalletRepository` / `RewardRules` are the only source of truth. Nothing was invented: the web runs the **same domain arithmetic** (`domain/ledger.ts`, `domain/rewards.ts`, `domain/freeze.ts`) inside the **same Firestore transaction protocol** (`services/cloudLedger.ts` = `FirestoreLedgerRunner`).

### Firestore paths (all under `users/{uid}`; no new collection, field or schema)

| Path | Written by | Fields |
|---|---|---|
| `users/{uid}` | every wallet operation | `coins`, `freezesOwned`, `pendingAdjustment`, `lastTransactionId`, `updatedAt` (+ `welcomeFreezePending: false` once, after the welcome freeze) |
| `walletTransactions/{txId}` | every wallet operation | `type`, `coinDelta`, `freezeDelta`, `balanceAfter`, `createdAt`, optional `date`, `habitId`, `milestone`, `pendingDelta` (only when ≠ 0), `rewardId` |
| `rewards/{rewardId}` | reward grant / reversal | `active`, `cycle`, `amount`, `type`, `lastTransactionId`, `updatedAt`, optional `date`, `habitId`, `milestone` |
| `freezes/{habitId}_{yyyy-MM-dd}` | freeze application | `habitId`, `date`, `month`, `paidWith` (`inventory`), `transactionId`, `createdAt` |
| `freezeMonths/{yyyy-MM}` | freeze application | `count` (+1, max 3), `updatedAt` |

### Transaction protocols (one Firestore `runTransaction` each; all reads before any write; each document read once)

| Operation | Entry id (idempotency key) | Reads | Writes |
|---|---|---|---|
| daily / milestone reward | `{rewardId}` (first), `{rewardId}_grant{n}` (restore) | user, reward, needed entries | user, entry, reward |
| reward reversal | `{rewardId}_rev{cycle}` | user, reward, needed entries | user, entry, reward |
| **freeze purchase** | `freeze_buy_{requestId}` — one UUID **per tap** | entry, user, `freezeMonths/{purchase month}` | user, entry |
| **freeze application** | `freeze_apply_{habitId}_{date}` | freeze record, user, `freezeMonths/{protected day's month}` | user, entry, freeze record, month counter |
| welcome freeze | `welcome_freeze` | entry, user | user, entry; then a second transaction clears `welcomeFreezePending` |

`services/cloudLedger.ts` wraps the transaction in a scope that refuses any read or write outside these documents (and any user-document field outside the wallet fields), so a bug cannot reach habits, notes or another user.

### Calculations (domain, shared with the guest ledger)

- Daily reward: **+1** when every active habit of the day is complete; milestones **15→+5, 30→+5, 45→+5, 60→+5, 75→+10, 100→+20**; only the current local month earns; an older day is only ever *corrected*.
- Reversal takes back `min(coins, amount)`; the rest becomes `pendingAdjustment`. Later earnings pay it off **first** (`coinDelta = amount − applied`, `pendingDelta = −applied`). Invariant: `pending > 0` only when `coins == 0`.
- Purchase: **−20 coins, +1 freeze**. Rejected when `coins < 20` (InsufficientCoins), when `freezeMonths/{month}.count ≥ 3` (MonthlyLimit) or when `freezesOwned ≥ 3 − count` (HoldLimit). Pending is untouched.
- Application: **−1 freeze, 0 coins**; rejected without an owned freeze (NoFreezes), when that day already has a freeze record (AlreadyFrozen) or the protected day's month has 3 (MonthlyLimit). Whether the *day* is eligible (rest day, completed, 3-day window, earlier miss first, live streak) is `checkFreeze`, checked first.
- The month counter comes from `freezeMonths` inside the transaction (Kotlin `LedgerTxn.freezeCount`); the screen's "freezes left" counts freeze records, exactly like Kotlin's `freezesUsedIn`.

### Safety properties and how they are achieved

- **No double spending.** Firestore serialises conflicting transactions (the block is re-run on a changed read, so it is pure over its reads); the second of two purchases for the last 20 coins re-reads the new balance and is rejected. Verified with a concurrent optimistic-retry fake (`tests/fakeFirestore.ts`) *and* by the mirror of the production rules it runs at commit.
- **No duplicate purchase.** One UUID per tap; the entry id is the key, so a lost-response retry or a second tab with the same attempt is a `Duplicate` (reported as success, like Kotlin). A second *tap* while an operation runs is ignored (`walletBusy`, Kotlin's flag, with a synchronous ref guard).
- **Nothing is shown before the server confirms.** The wallet and the blue day change only after the transaction resolves (`domain/walletOps.ts settleConfirmed`); a rejected or failed transaction changes nothing on screen, and the listener delivers the server's state either way. The result of an old transaction never overwrites a newer snapshot (it is skipped when the listener already delivered that entry).
- **Offline = refused, not queued** (transactions need a connection): "You're offline. Connect to the internet and try again."
- **Guest**: guest wallet and rewards stay in `localStorage`; no demo coin is uploaded; guest and account balances are never merged; the guest ledger code path is unchanged.
- **Account switching / sign-out**: the store is keyed by uid; listeners are disposed on sign-out; a result that resolves after the provider is gone is dropped.

### Known security limitation (unchanged, documented for production hardening)

The wallet is **client-trusted**. `firestore.rules` verify that a wallet change is backed by a *matching ledger entry* (deltas, balance, +1/−1 freeze, ≤ ±20 coins per entry, month counter ≤ 3), not that the change is *legitimate*: an owner can still write a forged reward entry (≤ +20 coins, repeatable), forge a purchase price, skip the 3-day eligibility check or choose any `habitId` for a freeze record. The web client is easier to inspect than the Android app. Real protection needs server-side logic (Cloud Functions that compute rewards and apply freezes from the stored completions) and stricter rules — a product decision, deliberately **not** changed in this phase (rules, schema and App Check untouched).

### Remaining differences from Kotlin

- **Profile creation only through the guest import (Phase 10).** Kotlin `loadUser` creates `users/{uid}` (`coins: 20`, `welcomeFreezePending: true`) for a new account. The web still creates nothing: an account that has never opened the Android app has no wallet; purchases/applications say so ("Your wallet isn't set up yet…"). The *retry* of a pending welcome freeze **is** implemented (fixed id `welcome_freeze`, then the marker is cleared).
- The welcome-freeze marker is cleared in a separate transaction, as Kotlin does with a separate update.
- Kotlin shows "…" on the wallet tiles until the first wallet snapshot; the web mounts only after the first snapshot, so there is no loading state.
- No transaction-history list exists on either platform's Wallet screen (the history is the synchronised `walletTransactions` collection, used by the ledger and read by the converters); none was added (no UI redesign).
- Guest data import: done in Phase 10 (habits and history only; see the Phase 10 section below).

## Phase 10: guest data migration

Guest habits can be imported into a signed-in account, chosen habit by habit, after an explicit choice. The full audit, protocol, paths and
limitations are in `GUEST_MIGRATION_PLAN.md` (see "Phase 10 implementation report"). In short: only habits, schedule history, completions,
notes and archived state are written (`habits/{id}-m{migrationId8}`, `habits/{id}/completions/{date}`, `dayNotes/{id}_{date}`, with the
guest id kept in `migratedFrom`); a missing profile is created once in a transaction with Android's new-account fields; the wallet, rewards,
milestones and freezes are never imported, and imported history up to the import day can't earn or remove rewards in this browser. No
Kotlin file, Firestore rule or schema was changed.
