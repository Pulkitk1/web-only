# Android smoke-test plan for the staged Firestore rules (Part A first, Part B later)

> **Phase 11C.2:** the full staging setup (creating the project, registering the Android and Web apps, the synthetic data, publishing rules to staging, the Web smoke tests, the rollback check) is in **`STAGING_SETUP.md`**; this file is the Android matrix. Run the matrix **three times in order**: under the **baseline** (`android/firestore.rules`), under **Part A** (`firebase/firestore.rules`, the production candidate), and later, separately, under **Part B** or the combined set (`firebase/rules/part-b.rules`, `firebase/rules/combined.rules`). Part A needs no historical-data inspection; Part B does (`RULES_CONSOLE_INSPECTION.md`).

Purpose: prove, on a real Android build, that every write the app makes is accepted by the staged rules (`web/firebase/firestore.rules` = Part A, then Part B) **before** those rules are published to `habbit-tracker-12`. Nothing here touches production data or publishes anything. The plan is for you (or a tester) to run; I have not run it, because it needs an Android device or emulator and a Firebase project.

## 0. Where to test (read this first)

| Option | What it is | Risk | Verdict |
|---|---|---|---|
| **A. A separate staging Firebase project** (recommended) | A new free project (for example `consisto-rules-staging`) with Email/Password sign-in and Firestore. You publish the **current** rules, test, publish the **proposed** rules, and test again. The Android debug build is pointed at it with that project's own `google-services.json` (the file `app/google-services.json` is configuration, not Kotlin; back up the production one and never commit the staging one). | None for real users | **Do this** |
| B. The Firestore emulator | Already covered by `npm run test:rules` for the write shapes. The Android app cannot be pointed at an emulator without a code change, which is out of scope. | None | Already done, but not a substitute for a real app |
| C. A dedicated test account in **production** with the proposed rules published | The only way to see a real production build, but publishing the rules exposes **every user** while you test | High | Only as a final, short canary **after A passes**, with the rollback ready (section 6) |

Never run any step with a real person's account. Use accounts created for the test (for example `rules-test-1@example.invalid`).

## 1. Preparation (staging project)
1. Create the project, enable **Authentication > Email/Password** and **Firestore** (same region as production).
2. Add an Android app with the package `com.habittracker.app`; download its `google-services.json` and place it in `app/` (keep the production file safe). Build a **debug** APK (`gradlew assembleDebug`). Install it on a device or emulator. Also have the Web build pointed at the same project if you want the Web interop steps (section 5, step 11).
3. Publish `android/firestore.rules` (the rules in force) to the staging project. Run the whole matrix below = the **baseline**. Every step must pass here, otherwise the test setup is wrong, not the rules.
4. Publish `firebase/firestore.rules` (**Part A**) to the staging project. Run the whole matrix again = the **Part A result**. Part B is a separate later round.
5. Watch `adb logcat` filtered to `Firestore` and `PERMISSION_DENIED` during every step, and Firebase Console > Firestore > **Usage > Rules** (the allowed and denied request graph).
6. Prepare legacy-shaped data **in the staging project only**: `npm run seed:staging -- --yes` (see `STAGING_SETUP.md` section 4; the seed contains the shapes listed in section 4 below).

## 2. The matrix

Pass = the action works, the data is right, and logcat shows no `PERMISSION_DENIED`. Record each result in the table in section 7.

| # | Area | Steps | What it exercises in the rules |
|---|---|---|---|
| 1 | Login and profile | Sign up a new account; sign out; sign in again | Profile create (exact field set, 20 coins, 0 freezes); `welcomeFreezePending` then the free freeze (`welcome_freeze` entry: +1 freeze, 0 coins) and the marker cleared. Expect 20 coins and 1 freeze. |
| 2 | Habit create | Create habits with: a plain name; a goal; a reminder on; 3 rest days; a 150-character name; a colour | Habit `validHabit`, `createdAt`/`sortOrder`/`scheduleHistory` |
| 3 | Habit edit | Rename; change colour; edit goal (add, then clear it); change reminder on/off; change weekly target and rest days; archive then unarchive; drag to reorder; delete a habit that has completions and a note | Updates of the whole document; `sortOrder` alone; deleting a habit (completions then habit) |
| 4 | Completion and undo | Check today; uncheck it; check a day in the past; uncheck it; check 3 different habits on one day | Completion merge writes (`completed`, `completedAt`, `uncheckedAt`), the habit `completedDates` array union and remove |
| 5 | Wallet rewards | Complete all habits for today (+1); undo (reward reversed, -1); redo (restored, `_grant2`); with 0 coins, undo a reward (a **pending adjustment**) then earn it back; reach a 15-day streak (use seeded data, section 4) for the 5-coin milestone | `daily_completion`, `reward_reversal`, `reward_restored`, `streak_milestone`, partial grants with `pendingDelta`, reward records |
| 6 | Calendar notes | Add a note on a completed day, on a missed day, on a frozen day; edit it; delete it; try 200 characters | `dayNotes` create, merge update (no `createdAt`), delete |
| 7 | Freeze purchase | With 40 coins buy a freeze (-20); buy another until the hold limit; check the button state at 3 owned | `freeze_purchase` (-20 coins, +1 freeze) |
| 8 | Freeze application | Miss yesterday with a streak running; apply a freeze to it; try the same day again (refused by the app); apply three in one month and try a fourth; apply to a day 3 days ago | `freeze_application` (0 coins, -1 freeze) with the freeze record **and** the month counter in the same commit |
| 9 | Guest migration (Android) | As a guest create habits, check days, buy and apply a freeze **on an old date** (set the device date back, or use seeded guest data); then sign in to an existing account with data and choose **Merge**; repeat into an empty account | Replay of the guest ledger: old dates, the recorded price (10 or 20), the welcome freeze, `migratedFrom`. This is the step most likely to expose a rule that is too strict. |
| 10 | Account deletion | On a throwaway account with habits, notes, rewards and freezes: Delete Account with the password | The `deletionRequested` marker, then deleting completions, habits, ledger collections, `todos`, then the profile. Afterwards check the Console for leftovers (`dayNotes` are expected to remain: a known Android gap). |
| 11 | Web interop | Sign in to the same account on the Web build; check a day on each side; buy a freeze on one, see it on the other | Both clients writing the same documents |
| 12 | Offline | Turn on airplane mode, check two days, add a note, reorder; turn it off | Queued writes are evaluated by the rules when they reach the server |

## 3. What a failure looks like
- `PERMISSION_DENIED` in logcat, a toast such as "Couldn't save" or a rollback of what you just did, or the action silently reverting after a moment.
- For each failure record: the step number, the exact action, the document path (in logcat), and, if it is a ledger write, the entry id and type. That is enough to find the rule.

## 4. Legacy-shaped data to seed in the staging project (never in production)
Create these with the Firebase Console or an Admin script **pointed at staging**. The shapes are the ones the Kotlin readers still tolerate; they are also the corpus of `tests/rules/legacy.rules.ts`.
- **Profiles:** one with only `email`, `coins`, `freezesOwned`; one with the legacy `freezeDates` list and `isDark`; one with extra unknown fields.
- **Habits:** one without `createdAt`, `sortOrder`, `scheduleHistory`, `goal`, `archived`, reminder fields; one without `createdDate`; one with a 300-character name; one with about 1,800 `completedDates` and **no** completion documents (legacy array only); one with a 14-day streak (for the 15-day milestone).
- **Completions:** `{date, completed}` only; `{completed}` only; an uncheck record with `uncheckedAt`.
- **Ledger:** a `daily_completion` entry with **no** reward record and no `pendingDelta`; a `freeze_purchase` at -10.
- **Freezes and counters:** a freeze with `paidWith: "inventory"`; a `freezeMonths` document with `count` 1, 2 and 3.
- **Notes:** one with `createdAt`, one without.
Then, for each: check a day, rename, reorder, edit the note, earn and reverse a reward, buy and apply a freeze, and delete the account.

## 5. Order of the run
Baseline (current rules): steps 1 to 12 and the legacy seeds. Result (proposed rules): steps 1 to 12 and the legacy seeds. Compare the two tables. **Any step that passes in the baseline and fails in the result is a blocker** for publishing.

## 6. If you later canary in production (option C)
1. Use only a brand-new test account.
2. Publish the proposed rules at a quiet hour. Firebase Console > Firestore > Rules keeps a **history of every published version**; the previous version can be published again in one click. Have it open.
3. Run steps 1 to 10 once (about 15 minutes), watch Console > Firestore > Rules monitoring for **denied** requests from other users, and roll back immediately if the denied count rises.
4. Keep a copy of the exact previous rules text (`android/firestore.rules`) outside the Console as well.

## 7. Result table (copy and fill in)

| # | Baseline (current rules) | Result (proposed rules) | Notes (path, entry id, error) |
|---|---|---|---|
| 1 | | | |
| 2 | | | |
| 3 | | | |
| 4 | | | |
| 5 | | | |
| 6 | | | |
| 7 | | | |
| 8 | | | |
| 9 | | | |
| 10 | | | |
| 11 | | | |
| 12 | | | |
| Legacy seeds | | | |

Tester, date, Android build (version name and code), device, project id (must be the **staging** project): ______
