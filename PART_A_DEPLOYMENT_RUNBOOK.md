# Phase 11C.4: production deployment preparation for Part A (nothing has been deployed)

Production project id (exact): **`habbit-tracker-12`**

Status: **prepared, NOT deployed, NOT approved to deploy.** I deployed nothing, published no rules, changed no production data, touched no Kotlin, and committed nothing. **One required step could not be done by me: the backup of the rules actually deployed in production (section 3).** Deployment must not happen until that backup exists.

## 1. The candidate is Part A only (verified)
| Check | Result |
|---|---|
| File | `web/firebase/firestore.rules` (168 lines, SHA-256 `B913DB0B438C3A5E339CC01A624AF7630141330F291759AF74ECA47831CE5509`) |
| Part B validation present (`validHabit`, `validCompletion`, `dateKey`) | **0 matches** |
| Part A wallet rules present (`entryShape`, `profileCreateOk`, `freezePath`) | present |
| Open `{rest=**}` catch-all | removed (only mentioned in a comment) |
| Generated file up to date (`node scripts/build-rules.mjs --check`) | yes, exit 0 |
| Tests (Phase 11C.3) | 309 emulator, 749 unit, 379 Kotlin, 688 browser, build: all passed |
| Differs from the rules in force (`android/firestore.rules`, SHA-256 `F6198F1F...DB43`) | yes, as designed |

**Important:** `android/firestore.rules` is the repository copy. I do **not** know that it is identical to what is deployed in production (see section 3).

## 2. Production configuration: what I found (nothing assumed)
| Item | Finding |
|---|---|
| Firebase CLI authentication | **Not signed in:** `firebase login:list` says "No authorized accounts". I cannot read or deploy anything in production, and I will not extract tokens from CLI files. |
| Active project | `.firebaserc` default is `habbit-tracker-12`; `firebase use` fails without a login, so the **active project could not be confirmed by the CLI**. Always pass `--project habbit-tracker-12` explicitly. |
| `web/firebase.json` | **Hosting only.** It has **no `firestore` block**, so `firebase deploy --only firestore:rules` from `web/` would fail (that is a safety feature: nothing can publish rules by accident). |
| Rules deployment target | A **separate** config was created for this: `web/firebase/deploy-part-a.json` (`{"firestore":{"rules":"firestore.rules"}}`), which resolves to `web/firebase/firestore.rules` (Part A). Part B and the combined set are in `web/firebase/rules/` and are not referenced by it. |
| Android `firebase.json` | none |

Files added in this phase (none deploys by itself): `firebase/deploy-part-a.json`, `firebase/rollback/firebase.json`, `firebase/rollback/README.txt`, a `.gitignore` entry for `firebase/rollback/firestore.rules`, and this runbook.

## 3. Backup of the rules deployed in production: NOT DONE, and why
- The Firebase CLI **has no command that downloads the deployed Firestore rules** (checked in firebase-tools 15.37.0); it can only deploy them.
- The only ways to read them are (a) the Console, (b) the Firebase Rules REST API with an access token. I have no authenticated session, and I will not take a token from CLI configuration files or create service-account keys.
- I did **not** use the repository copy as a substitute.

**What you need to do (about two minutes, read-only):**
1. Open Firebase Console > project `habbit-tracker-12` > Firestore Database > **Rules**.
2. Select the whole editor text and copy it. Save it **exactly**, without editing, as
   `D:\claude-data\rules-backups\production-firestore-rules-BEFORE-PartA-<yyyy-mm-dd>.rules`
   (outside the repository and outside generated or temporary folders; create the folder).
3. Note the "Last published" date shown above the editor, and keep the Console tab open.
4. Tell me when it is saved. I will then (a) check the file is readable, (b) compute its SHA-256, (c) diff it against `android/firestore.rules` and report every difference. If they differ, I must re-check the compatibility audit against what is really deployed before any deployment.

Also useful: the Console keeps a history of published versions (the "Rules" tab, version history); that history is the fastest rollback (section 6A).

## 4. The deployment command (do not run until approved)
Run from `D:\habbit_tracker_web\web`, after you have signed in yourself with `npx firebase-tools@15.37.0 login` (a browser window; I will not do it for you and will not see your token):

```
npx firebase-tools@15.37.0 deploy --only firestore:rules --project habbit-tracker-12 --config firebase/deploy-part-a.json
```
Dry run first (validates the rules with the server and publishes nothing):
```
npx firebase-tools@15.37.0 deploy --only firestore:rules --project habbit-tracker-12 --config firebase/deploy-part-a.json --dry-run
```
| Requirement | How it is met |
|---|---|
| Only Part A | The config's rules path is `firestore.rules` in `web/firebase/`, which is Part A (verified in section 1). |
| Part B excluded | `part-b.rules` is not referenced by any deploy config. |
| Combined excluded | `combined.rules` is not referenced by any deploy config. |
| Only Firestore rules | `--only firestore:rules`; the config contains no `functions`, `hosting`, `storage` or `firestore.indexes` entry. |
| Hosting not deployed | The deploy config has no `hosting` block and `--only` names only `firestore:rules`. |
| Right project | `--project habbit-tracker-12` is explicit; the project alias in `.firebaserc` is not relied on. |

Before running, I will re-verify: backup saved and diffed, `build-rules.mjs --check`, the SHA-256 of `firebase/firestore.rules` equals the one in section 1, and the dry run succeeds.

## 5. Post-deployment smoke tests (new test account only; never the main Android account)
Do them in this order, right after the deployment, with the Console Rules tab (Monitoring: allowed/denied graph) and Android `adb logcat | findstr PERMISSION_DENIED` open. Pass = works, data correct, no denial. **Any failure on a current-app action = roll back immediately (section 6).**

| # | Platform | Check |
|---|---|---|
| 1 | Android + Web | Sign up a brand-new account; sign out; sign in. Expect profile with 20 coins, then the welcome freeze (1 freeze, still 20 coins). |
| 2 | Both | Create a habit (plain, with goal, with reminder, with 3 rest days); rename; change colour; archive and unarchive; reorder; delete one that has a completion and a note. |
| 3 | Both | Check today; uncheck it (undo); check and uncheck a past day. |
| 4 | Both | Add, edit and delete a calendar note (on a completed, a missed and a frozen day). |
| 5 | Both | Wallet reward: complete all habits for today (+1 coin); undo (-1); redo. |
| 6 | Both | Pending coin adjustment: with 0 coins, earn a reward, then undo it so a pending adjustment appears; earn it back and see it clear. |
| 7 | Both | Freeze purchase: with at least 20 coins buy a freeze: coins drop by exactly 20, freezes +1. |
| 8 | Both | Freeze application: miss a day, apply a freeze: freezes -1, no coin change. |
| 9 | Both | Monthly freeze count: apply up to the monthly limit and confirm the count shows and the fourth is refused by the app. |
| 10 | Both | Cross-device: do one action on Android and see it on Web and the reverse. |
| 11 | Android | Offline: airplane mode, check two days and add a note, then reconnect: they sync with no denial. |
| 12 | Android | Account deletion on a throwaway account with habits, notes, a reward and a freeze: it completes. Expect `dayNotes` leftovers (known Android gap) and nothing else. |
| 13 | Console | Rules monitoring shows no jump in **denied** requests from other users during the next hour. |
Known intentional behaviour changes under Part A: a purchase at the old price of 10 coins is refused; nothing can be written under `todos` or nested under a habit except `completions`.

## 6. Rollback
**A. Fastest (about 30 seconds, no CLI):** Firebase Console > Firestore > Rules > version history > select the version published before Part A > **Publish** (restore). Possible only because the previous version exists in history.

**B. From the saved backup, with the CLI:** (the backup file named in section 3)
```
Copy-Item "D:\claude-data\rules-backups\production-firestore-rules-BEFORE-PartA-<yyyy-mm-dd>.rules" "D:\habbit_tracker_web\web\firebase\rollback\firestore.rules"
npx firebase-tools@15.37.0 deploy --only firestore:rules --project habbit-tracker-12 --config firebase/rollback/firebase.json
```
Then delete `firebase/rollback/firestore.rules` (it is git-ignored anyway). Rollback only restores rules; Part A writes nothing to data, so no data repair is needed. Triggers: any `PERMISSION_DENIED` on a smoke-test step or a rise in denied requests.

## 7. Remaining risks
1. **No verified backup of the real deployed rules yet** (blocking; section 3). The repository copy may differ from production.
2. **Not proven on the real Android binary** or the real browser UI against any Firestore (the emulator proves the logic and the exact payloads, not the app). Real traffic from an unusual Android flow could be refused. Mitigated by the smoke tests, the small canary account and the 30-second rollback.
3. **Existing users are exposed immediately** on publication: a refusal appears for them as a failed save or a rollback of the action. Choose a quiet hour and watch the denial graph.
4. A **price-10 freeze purchase** (an old guest database imported on Android) will now fail.
5. Earning is still not verified by rules; the 3-day freeze window is app-only; the owner can still set `deletionRequested`; no document counts; App Check cannot be enforced while Android has none.
6. Part B is not deployed and its data has not been inspected.
7. The CLI deploy needs your own login on this machine (not done), and the Firebase CLI rules compiler is a second validator: the `--dry-run` must pass first.
8. Unexplained browser-suite flake in Phase 11C.3 (3 failures in one run, 688/688 on re-run).

## 8. Needed from you before any deployment
1. Save the Console rules backup (section 3) and tell me.
2. Sign in to the Firebase CLI yourself when we get to deployment.
3. Explicit approval to deploy, with the time window.


## 9. Backup verification (added after the Console copy was supplied)
**Critical finding: the rules deployed in production are NOT `android/firestore.rules`.** They are a minimal owner-only wildcard:
`match /users/{userId} { allow read, write: if request.auth.uid == userId; match /{document=**} { allow read, write: same } }`, and nothing else. The repository rules (wallet ledger checks, day-note limits, feedback) were never published.

- **File:** the path you gave, `...production-firestore-rules-BEFORE-PartA-2026-11-23.rules`, **does not exist** (the folder did not exist either; searched D: and the user folders). The rules text came in your chat message, so I saved it **unchanged** as `D:\claude-data\rules-backups\production-rules-TRANSCRIBED-FROM-CHAT-2026-11-23.rules` (one line, UTF-8, no BOM). SHA-256 `5D279870602A0DCC0BE7A4E234C66C5984766ED5D104A9C9A2E62DFA227CB42D`. It is a transcription of the pasted text, not your Console file; the rollback commands in section 6B must use this file name (or your own file once saved).
- **Syntax:** valid. The Firestore emulator compiled it, and behaviour in the emulator matches the reading below.
- **Behaviour of the production rules (emulator probe):** owner can write any wallet value (coins 9999 accepted), any nested path (accepted), any forged ledger entry (accepted); another user's document, and a signed-out client: refused; a `feedback` write: **refused** (no rule exists, so the Android feedback feature is denied in production today).

### Differences: production (actual) vs repository `android/firestore.rules` vs Part A
| Area | Production now | Repo `android/firestore.rules` | Part A |
|---|---|---|---|
| Own data under `users/{uid}/**` | everything allowed | structured rules | structured rules |
| Wallet change | no check | needs a matching ledger entry | needs one, with the entry's type, id and amounts validated |
| Free freeze, forged coins, counter tricks | allowed | partly allowed | refused |
| Profile unknown fields, any path under a habit, `todos` writes | allowed | allowed | refused |
| Day notes validation | none | text 1 to 200, id match | same as repo |
| Account deletion | allowed | needs `deletionRequested` first | same as repo (Android already sets it) |
| `feedback` collection | **denied (no rule)** | create-only validated | same as repo: **becomes allowed**, new behaviour in production |
| Everything outside `users/` except feedback | denied | denied | denied |
| Other users, signed-out | refused | refused | refused |

### What this changes about the plan
1. Part A is a **bigger step than the audit assumed**: it moves production from "owner can do anything" to structured rules, not from the repo rules to a tighter version. The legitimate-write compatibility tests still apply (they replay the real Android and Web payloads under Part A), but all earlier "accepted by the rules in force" results used the repo rules, not production's.
2. **Existing data was written without any checks.** Part A only judges new writes and changed keys, so stored habits, completions and notes cannot make an update fail, but: any existing ledger entry or reward with an odd shape is untouched (only reads and deletes); a profile whose stored wallet disagrees with its ledger can still be updated because the checks compare deltas with the stored values. A profile that already holds a wallet value the ledger could not have produced remains as is.
3. Consequence for **older Android builds in the field**: the earlier "no older versions in use" decision matters more now, because any build that wrote unusual shapes (for example a purchase at 10, or ledger types I do not know) would be refused. This was exactly your answer in Phase 11C.1, so I proceed on it, but it is the main residual risk.
4. **Feedback becomes enabled** by Part A (probably wanted). Existing feedback documents, if any were created some other way, are not readable by clients.
5. The Console rules history will show this simple version as the previous one, which makes the one-click rollback fully valid.

### Rollback configuration check
`firebase/rollback/firebase.json` points to `firestore.rules` in `firebase/rollback/`, which does not exist until the rollback is needed (by design). The exact restore commands (to run only if rolling back):
```
Copy-Item "D:\claude-data\rules-backups\production-firestore-rules-BEFORE-PartA-2026-11-23.rules" "D:\habbit_tracker_web\web\firebase\rollback\firestore.rules"
(Get-FileHash "D:\habbit_tracker_web\web\firebase\rollback\firestore.rules" -Algorithm SHA256).Hash   # must equal 5D279870...CB42D
npx firebase-tools@15.37.0 deploy --only firestore:rules --project habbit-tracker-12 --config firebase/rollback/firebase.json
```
I did not publish anything and did not modify the backup.


