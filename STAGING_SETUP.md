# Staging Firebase project: setup and smoke-test guide

Purpose: test the staged rules (Part A now, Part B later) with a **real Android build and the real Web app**, against a **separate** Firebase project with **synthetic** data, so that production is never involved. I have not created the staging project and have no access to Firebase; this guide is for you (or a tester).

## 0. Ground rules
- **Never use a real person's account or data.** Everything below uses made-up users and the synthetic seed.
- **Never point a build or a script at production by accident.** The staging project id must **not** contain `habbit-tracker` (the seed script refuses such ids). Check the project id shown on every screen you use.
- **Do not edit `web/.env.local`.** The Web is pointed at staging with environment variables in the terminal session only.
- Nothing here publishes anything to production. Rules are published to **staging** only.

## 1. Create the project (you do this)
1. Firebase Console > **Add project**, name it for example `consisto-staging`. Note the generated **project id** (for example `consisto-staging-4f2a`). Google Analytics can stay off.
2. The free **Spark** plan is enough (no Cloud Functions are involved).
3. **Authentication** > Get started > **Sign-in method** > enable **Email/Password**.
4. **Authentication > Users > Add user**: create two test users with made-up addresses and passwords that only you know (not stored in any file): `staging-test@example.invalid` and `staging-test-2@example.invalid`. (The addresses never receive mail; `.invalid` can never be a real address.)
5. **Firestore Database** > Create database > **Production mode** (everything denied until you publish rules) > choose the **same location as production** (Console > production project > Firestore > Settings shows it).
6. Do **not** import, export or copy any production data into it.

## 2. Register the staging Android app
1. Staging project > Project settings > **Your apps** > **Add app > Android**. Package name: `com.habittracker.app` (the same as production: the `applicationId` in `android/app/build.gradle.kts`). Nickname: `Consisto Staging`. A SHA-1 is not needed for email and password sign-in. Download `google-services.json`.
2. Place it at **`android/app/src/debug/google-services.json`** (create the `debug` folder). The Google Services plugin (applied in `app/build.gradle.kts`) prefers a file under `src/<build type>/` for that build type, so **only debug builds use staging; release builds keep using the production file `app/google-services.json`**. Do not overwrite or edit the production file. This is a configuration file, not Kotlin code.
3. **Never commit it**: `android/.gitignore` does not list `google-services.json`, so exclude `app/src/debug/google-services.json` yourself (or delete it when the test is over).
4. Build and install: `gradlew assembleDebug` (then `adb install` the debug APK), or run the `debug` variant from Android Studio.
5. **Verify the app really points to staging** before testing: after the build open `app/build/generated/res/google-services/debug/values/values.xml` and confirm `project_id` is the staging id (the production id is `habbit-tracker-12`). On the device, a sign-in with `staging-test@example.invalid` must work (that user does not exist in production).

## 3. Register the staging Web app
1. Staging project > Project settings > Your apps > **Add app > Web** (`</>`). Nickname `Consisto Staging Web`. Skip Firebase Hosting. Copy the six config values (apiKey, authDomain, projectId, storageBucket, messagingSenderId, appId).
2. In **PowerShell, in `web/`**, set them for this terminal session only:
```
$env:EXPO_PUBLIC_FIREBASE_API_KEY = '<staging apiKey>'
$env:EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN = '<staging authDomain>'
$env:EXPO_PUBLIC_FIREBASE_PROJECT_ID = '<staging project id>'
$env:EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET = '<staging storageBucket>'
$env:EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '<staging messagingSenderId>'
$env:EXPO_PUBLIC_FIREBASE_APP_ID = '<staging appId>'
npx expo start --web
```
Variables already set in the shell win over `.env.local`, so the file stays untouched. **Confirm** in the browser's developer tools (Network tab) that Firestore and sign-in requests go to the **staging** project (the project id appears in the request URL), never `habbit-tracker-12`.
3. `localhost` is an authorized domain by default in a new project.

## 4. Import synthetic test data
The seed writes made-up habits (several legacy shapes), completions, notes and a wallet built from real ledger entries, **only under the test user's own account**, through the normal client write paths (so the staging rules decide what is accepted). It refuses to run against the production project and needs `--yes`.
1. In the same PowerShell session as step 3.2, also set (your made-up password, typed in your terminal, never saved):
```
$env:STAGING_TEST_EMAIL = 'staging-test@example.invalid'
$env:STAGING_TEST_PASSWORD = '<the test user password you set>'
npm run seed:staging -- --yes
```
2. It prints a summary. **Expected result:** 7 habits (a current-shape habit with goal, why, reminder and schedule history; a minimal legacy habit; one with no creation date; one with a 300-character name; one with 1,800 legacy completed dates and no completion documents; an archived one; a 14-day streak habit), 24 completions, 3 notes, and a wallet of **23 coins and 1 freeze** from 22 ledger entries (welcome freeze, 18 daily rewards, a 15-day milestone, a 20-coin purchase, a freeze application with its month counter).
3. Run it **once per fresh test user** (it creates the profile). For a second run use the other test user and its credentials.
4. Add `--risk-probes` **only when testing Part B**: it adds four habits that break a Part B bound on purpose (a 1,001-character name, a weekly target of 9, rest days stored as a string, a created date in another format). Under the rules in force and under Part A they are accepted; Part B refuses them, which is the point.
5. The same seed is tested against the emulator under all four rule sets (`tests/rules/seed.rules.ts`).

## 5. Deploy the proposed rules to STAGING (never production)
Use the Console (no command line, so nothing can reach production):
1. Staging project > **Firestore Database > Rules**. Check the project id at the top.
2. **Baseline first.** Paste the full text of **`android/firestore.rules`** (the rules in force) and **Publish**. Run the smoke tests of sections 6 and 7 = the **baseline results**.
3. **Part A.** Paste the full text of **`web/firebase/firestore.rules`** and **Publish**. Run sections 6 and 7 again = the **Part A results**.
4. **Part B and the combined set, later and separately.** After Part A passes: publish `web/firebase/rules/part-b.rules` (B alone) or `web/firebase/rules/combined.rules` (A + B), seed a second test user with `--risk-probes`, and run the tests again. B/combined must **not** be published to production until the data inspection is done.
5. After each publish, confirm the **Published** time shown on the Rules page changed, and keep the previous version available (next section).
Regenerate the files from their source with `npm run build:rules` if the rules are ever edited (`tests/rulesBuild.test.ts` fails if a committed file is stale).

## 6. Android smoke tests
Follow **`ANDROID_SMOKE_TEST_PLAN.md`** (12 steps, a result table, the legacy seeds) using the debug build from section 2 and the staging user. Run it **once under the baseline and once under Part A** and compare. Any step that passes under the baseline and fails under Part A is a blocker for publishing Part A. Watch `adb logcat` for `PERMISSION_DENIED`, and the Console's **Firestore > Usage > Rules** chart for denied requests.

## 7. Web smoke tests
Web build pointed at staging (section 3), signed in as `staging-test@example.invalid` after seeding. Run once under the baseline and once under Part A.

| # | Do | Pass |
|---|---|---|
| W1 | Sign in; Home loads | The 6 non-archived habits appear; the wallet chip shows 23 coins; no error toast |
| W2 | Check a habit for today, then undo | It sticks after a reload; no failed-save message |
| W3 | Check every habit for today | A daily reward (+1) arrives; undo reverses it (-1); redo restores it |
| W4 | Open the 14-day-streak habit and complete today | The 15-day milestone pays 5 coins, once |
| W5 | Add, edit and delete a calendar note on a completed and on a missed day | Each is saved and shown; the 200-character limit holds |
| W6 | Create a habit, rename it, change its weekly target, add a goal, archive it, delete it | Each step is saved; no failed-save message |
| W7 | Wallet: buy a Streak Freeze (23 coins) | -20 coins, +1 freeze; the button then reflects the balance |
| W8 | Apply a freeze to a missed day inside the recovery window | -1 freeze; the day is protected; a fourth application in the month is refused by the app |
| W9 | Sign out and in again; sign in as the second test user | Nothing of the first user is visible; the second user sees an empty account |
| W10 | As a guest (signed out) create habits, then sign in and import them (the import is on in development builds) | The chosen habits arrive with their history and notes; the wallet is unchanged |
| W11 | Browser developer tools > Console | No `permission-denied` errors under the baseline or Part A |

## 8. Verify rollback
Prove you can go back, before you ever need to in production:
1. With **Part A** published to staging, note the **Published** time. Run W3 (a reward) to confirm it works.
2. On the Rules page, open the **history of published versions** (the version list next to the editor), select the **baseline** version (the one you published in section 5.2) and **publish it again**; or paste `android/firestore.rules` again and publish.
3. Confirm: the editor now shows the baseline text (no `entryShape` function), the **Published** time moved, and the Web and Android smoke steps W2, W3 and Android step 5 still work.
4. Publish Part A again, repeat step 1. You have now proven the rollback works in both directions.
For production later: before publishing anything, copy the **current** production rules text into a file outside the Console, and keep the Console page with the version history open.

## 9. Clean up
Delete the debug `google-services.json`, close the PowerShell session (the environment variables disappear with it), and delete the staging project when you are done (Project settings > Delete project). Nothing of production was involved.

## 10. What this does and does not prove
- It proves the **current Android app and the Web app** can do every action under the staged rules, on a real device and a real Firebase project, including legacy-shaped documents (the seed).
- It does **not** prove anything about **real production documents**: that needs `RULES_CONSOLE_INSPECTION.md` (and, if you ever want it, the scanner). Part A does not depend on it; Part B does.
