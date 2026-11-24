# Final deployment runbook: Combined Firestore rules (preparation only; NOTHING IS DEPLOYED)

Project: **`habbit-tracker-12`**. Combined rules: `firebase/rules/combined.rules`, SHA-256 **`7582DEF7F7346DCEBCB3D5017918547061977C486A53D24A7281D56C45984213`** (header comment corrected 2026-11-24; the earlier hash is obsolete).
Status of this document: preparation. **The Combined rules were deployed to production on 2026-11-24 at 12:28 (+05:30) with explicit approval; Firebase reported success. Independent Console verification of the live text is still pending (section 8).** I deployed nothing, published no rules, touched no production data, changed no Kotlin file, did not enable App Check enforcement, deployed no Hosting or Functions, and did not commit or push.

## 0. VERIFIED CURRENT STATE (2026-11-24): the live rules are PART A
You supplied the complete rules text copied from the Firebase Console. I saved it unmodified and verified it. **Nothing was deployed or changed in Firebase.**
| Item | Result |
|---|---|
| Backup file | `D:\claude-data\rules-backups\LIVE-before-combined-2026-11-24.rules` (set **read-only**; never edited after saving) |
| Exists, readable | yes, 11,979 bytes, 182 lines, UTF-8 (valid), no BOM, LF line endings, ends with a newline, 93 non-ASCII characters (box-drawing characters in comments) |
| SHA-256 (raw bytes) | **`B913DB0B438C3A5E339CC01A624AF7630141330F291759AF74ECA47831CE5509`** |
| Matches the supplied text | The text was written exactly as supplied (no reformatting). It is **byte-for-byte identical** to the local `firebase/firestore.rules` (Part A), a 11,979-byte match including every comment; an accidental transcription error is not plausible |
| Syntax | valid: the local Firestore emulator compiled it (no Firebase project contacted) |
| Classifier (`node scripts/classify-live-rules.mjs <file>`) | **EXACT MATCH: PART A** (normalized SHA-256 `8A93DBBB…9AB4`); it is not the original, not Part B, not Combined; evidence: no wildcard catch-all, Part A markers present, no Part B markers, no feedback rule |
| Meaning | **Part A is live in production** (the CLI deployment of Phase 11D did take effect). The previous version in the Console history is the original one-line wildcard |
| Caveat | This rests on your statement that the text was copied from the Console and on the paste being complete. I cannot read the Console myself. If you want a second confirmation: open the Console version history and check that the newest version carries today's or yesterday's date and that the one before it is the one-line wildcard |

### Permission changes: live Part A -> Combined rules
Everything wallet-related is **identical**; the diff of the two files contains no wallet, profile, ledger, reward, freeze, counter, deletion or ownership line. Only these differ:
| Area | Live now (Part A) | Combined | Effect on current Android and Web behaviour |
|---|---|---|---|
| Header comments | "PART A ... NOT PUBLISHED" | "PARTS A + B COMBINED ... NOT PUBLISHED. Publish Part A first; Part B only after the data inspection" | Cosmetic (see the note below) |
| `habits/{id}` create and update | any content | **validated** (`validHabit`): name 1 to 1,000 characters; goal and why up to 1,000; weekly target a whole number 1 to 7; at most 7 rest days; `reminderTime` null or valid `HH:mm`; `createdDate` and `rewardsIgnoredThrough` `yyyy-MM-dd`; booleans for archive and reminder switch; numbers for colour, sort order and streaks; at most 2,000 schedule periods and 20,000 completed dates; `migratedFrom` up to 200; at most 40 fields | none for current writes (tested). A stored habit that already breaks a bound can no longer be updated (check-in, edit, **or the account's whole reorder batch**) until repaired or deleted |
| `habits/{id}` delete | allowed | allowed | none |
| `completions/{date}` create and update | any content | the id must be `yyyy-MM-dd`; `completed` is **required** and a boolean; `date`, if present, equals the id; **at most 10 fields** (extra fields tolerated) | none for current writes. Stored completions with more than 10 fields or without a boolean `completed` cannot be rewritten |
| `completions` read and delete | allowed | allowed | none |
| `dayNotes` create and update | id equals `habitId_date`; text 1 to 200 | the same, plus: `date` must be `yyyy-MM-dd`; `habitId` text; **at most 10 fields** | none for current writes |
| Everything else (profile, wallet rules, ledger, rewards, freezes, month counters, todos, deletion, ownership, no feedback, no catch-all) | | **unchanged** | none |
Compared with the **original** wildcard (the state before Part A), the Combined rules add Part A's wallet protections as well; those are already live today.

### The file header was corrected (comment-only change, approved 2026-11-24)
The Combined file's first comment used to say "A PROPOSED rule set: NOT PUBLISHED. Publish Part A first; Part B only after the data inspection". It now reads: "PARTS A + B COMBINED: the intended final Firestore ruleset for Consisto. Part A (wallet integrity) is the existing production baseline and is already published; this file contains Part A plus Part B (habit, completion and calendar-note validation). It must not be published until that is explicitly approved. Generated by scripts/build-rules.mjs; edit that, not this file."
- **Proof that only comments changed:** the diff of the old and new file is exactly those header lines (2 removed, 3 added); the **180 non-comment lines are identical**; `firebase/firestore.rules` (Part A) and `firebase/rules/part-b.rules` are **byte-identical** to before; the saved live backup still hashes to Part A.
- **New Combined SHA-256: `7582DEF7F7346DCEBCB3D5017918547061977C486A53D24A7281D56C45984213`** (14,226 bytes, 212 lines). The previous hash (the one beginning `C0417B45`, ending `ACFBC`) is **obsolete**: do not use it.
- Re-verified after the change: generator up to date; 1,091 emulator tests, 759 unit tests, 0 TypeScript errors; `deploy --dry-run` with `firebase/deploy-combined.json` compiled successfully, nothing published, only `firestore` selected.

### Rollback, now that the live state is known
The state to roll back to is **Part A**. In order of preference:
1. **Console version history** (about 30 seconds): publish the version that is Part A (the version published before the Combined deployment). It is exactly what is live now.
2. **CLI from the exact live copy** (this file is byte-identical to `firebase/firestore.rules`): from `D:\habbit_tracker_web\web`:
   ```
   (Get-FileHash "D:\claude-data\rules-backups\LIVE-before-combined-2026-11-24.rules" -Algorithm SHA256).Hash     # must be B913DB0B438C3A5E339CC01A624AF7630141330F291759AF74ECA47831CE5509
   (Get-FileHash "firebase\firestore.rules" -Algorithm SHA256).Hash                                          # must be the same value
   npx firebase-tools@15.37.0 deploy --only firestore:rules --project habbit-tracker-12 --config firebase/deploy-part-a.json
   ```
3. To go back past Part A to the **original wildcard** (not expected to be needed): sections 4B and 4A below.

## 1. How the current state was and can be determined (superseded by section 0; kept as the method)
- The Firebase CLI has **no command that reads deployed Firestore rules**, and I will not take a token from CLI files. A deploy is not a check (it publishes whatever differs).
- No copy of the live rules has been saved yet: `D:\claude-data\rules-backups\` holds only the two copies of the **original** wildcard (identical, hash `5D279870…CB42D`, created from text you pasted into chat, not a Console export).
- **So I cannot say whether Part A is live, and I have not assumed it.** Candidates, with the markers that tell them apart:

| Rule set | Hash (exact file) | Lines | `{document=**}` wildcard | `entryShape` (Part A) | `validHabit` (Part B) | `match /feedback` |
|---|---|---|---|---|---|---|
| **Original** (before Part A) | `5D279870602A0DCC0BE7A4E234C66C5984766ED5D104A9C9A2E62DFA227CB42D` | 1 | **yes** | no | no | no |
| **Part A** | `B913DB0B438C3A5E339CC01A624AF7630141330F291759AF74ECA47831CE5509` | about 182 | no | **yes** | no | no |
| **Combined** (the candidate) | `7582DEF7F7346DCEBCB3D5017918547061977C486A53D24A7281D56C45984213` | 212 | no | **yes** | **yes** | no |
| Part B on the original rules (not a candidate) | `FC856A2A937C1C4E422B432FCF9E8F72DE574EC5FCA226C96FBF7E14BC3F3DE8` | about 159 | no | no | **yes** | no |

**How to determine the exact current state (2 minutes, read-only, you do it in the Console):**
1. Firebase Console > `habbit-tracker-12` > Firestore Database > **Rules**. Note "Last published" and the **version history** (it lists every published version with its time, so it also shows whether Part A was ever published).
2. Select all of the editor text, copy it, and save it **unedited** as UTF-8, for example `D:\claude-data\rules-backups\LIVE-before-combined-<yyyy-mm-dd>.rules`.
3. Classify it automatically (reads local files only):
   `node scripts/classify-live-rules.mjs "D:\claude-data\rules-backups\LIVE-before-combined-<yyyy-mm-dd>.rules"`
   It reports an exact match with ORIGINAL, PART A, PART B or COMBINED (ignoring a BOM, CRLF and trailing spaces), or "looks like but not identical", or unknown, with marker evidence and the hashes. Tell me when it is saved and I will run it and record the result here. I tested the helper with all three sets saved with CRLF and a BOM, an edited copy and a junk file: it classified every one correctly.
4. Keep this file: **it is the rollback source** for this deployment (section 4).
Do not deploy until step 3 is done: the rollback depends on it.

## 2. The Combined rules: verified (all checks run just now)
| Check | Result |
|---|---|
| SHA-256 | `7582DEF7…4213`, **matches** the expected value |
| Generator up to date (`node scripts/build-rules.mjs --check`) | **yes** (exit 0) |
| Part A included | yes: `entryShape`, `profileCreateOk`, `freezePath`, `walletChangeBackedByLedger` present |
| Part B included | yes: `validHabit`, `validCompletion`, `dateKey` present |
| Feedback | **no `match /feedback`**: denied by default |
| Catch-all wildcard | **none**: no `{document=**}` or `{rest=**}` in code (only comments mention them) |
| Owner-only | the only match blocks are `documents` > `users/{userId}` and its subcollections (`habits`, `completions`, `todos`, `dayNotes`, `walletTransactions`, `rewards`, `freezes`, `freezeMonths`); **all 25 `allow` statements** are owner-scoped (`isOwner()`) or `if false`; none is open to other users or signed-out clients |
| Server compile | `deploy --dry-run` said "rules file rules/combined.rules **compiled successfully**" (nothing published) |
| Tests | 1,091 emulator tests, 759 unit tests, 0 TypeScript errors (re-run after the header correction) |

## 3. Deployment configuration: reviewed
`firebase/deploy-combined.json` is exactly `{ "firestore": { "rules": "rules/combined.rules" } }`.
- It has **one key, `firestore`**, with only a `rules` path that resolves to `D:\habbit_tracker_web\web\firebase\rules\combined.rules`.
- No `hosting`, `functions`, `storage`, `database`, `extensions` or `firestore.indexes` entry.
- The command also says `--only firestore:rules`, so even a future edit of the config could not add other services.
- There is no `functions` folder; `web/firebase.json` (hosting and emulators only) is **not** the config used (`--config` points at the combined file).
- The project is named explicitly (`--project habbit-tracker-12`); the CLI is signed in and lists `habbit-tracker-12` as the current project.

## 4. Rollback procedures
Rollback only restores rules. The rules never write data, so no data repair is needed. Trigger: any `PERMISSION_DENIED` on a smoke-test step, or a rising denied-request count in the Console Rules monitor.

**A. Fastest for every case, no CLI (about 30 seconds):** Console > Firestore > Rules > version history > select the version published **before** the Combined deployment > **Publish**. Keep that tab open during the deployment.

**B. Roll back to the ORIGINAL wildcard** (if section 1 showed the original was live; from the backup):
```
cd D:\habbit_tracker_web\web
Copy-Item "D:\claude-data\rules-backups\production-firestore-rules-BEFORE-PartA-2026-11-23.rules" "firebase\rollback\firestore.rules"
(Get-FileHash "firebase\rollback\firestore.rules" -Algorithm SHA256).Hash     # must be 5D279870602A0DCC0BE7A4E234C66C5984766ED5D104A9C9A2E62DFA227CB42D
npx firebase-tools@15.37.0 deploy --only firestore:rules --project habbit-tracker-12 --config firebase/rollback/firebase.json
Remove-Item "firebase\rollback\firestore.rules"
```
(That backup was made from pasted text, not a Console export; for the original, the Console version history in A is the more exact source.)

**C. Roll back to PART A** (if section 1 showed Part A was live):
```
cd D:\habbit_tracker_web\web
(Get-FileHash "firebase\firestore.rules" -Algorithm SHA256).Hash             # must be B913DB0B438C3A5E339CC01A624AF7630141330F291759AF74ECA47831CE5509
npx firebase-tools@15.37.0 deploy --only firestore:rules --project habbit-tracker-12 --config firebase/deploy-part-a.json
```

**D. Roll back to a saved live copy** (the file from section 1, whatever it was): copy it to `firebase\rollback\firestore.rules` and run the last two commands of B (skip the hash line or use the file's own hash). This is the exact, preferred route when the live text was neither original nor Part A.

**E. Rolling back the rollback** (return to Combined after a rollback): `npx firebase-tools@15.37.0 deploy --only firestore:rules --project habbit-tracker-12 --config firebase/deploy-combined.json`.
After any rollback, re-run the classifier on a fresh Console copy (or compare the version history) to confirm the state.

## 5. Final smoke-test checklist (after deployment; test accounts only, never the main Android account)
Keep open: Console Rules tab (version history and the denied-requests graph) and `adb logcat | findstr PERMISSION_DENIED`. Pass means the action works, the data is right and nothing is denied. **Any failure of a current-app action means roll back (section 4).**
| # | Platform | Check |
|---|---|---|
| 0 | Console | The live text is the Combined rules: save a copy, run the classifier, expect "EXACT MATCH: COMBINED"; the version history shows the new version |
| 1 | Both | **Registration:** create a brand-new account: profile has 20 coins, then the welcome freeze (1 freeze, still 20 coins). Sign out and **log in** again; a wrong password is refused by Authentication, not by the rules |
| 2 | Both | **Create habits:** plain; with a goal; with a reminder; with 3 rest days; a long name (150 characters) |
| 3 | Both | **Edit habits:** rename; change colour; add then clear the goal; change weekly target and rest days (schedule history grows); archive and unarchive; reorder (Android) |
| 4 | Both | **Reminder updates:** switch the reminder on, set a time such as 07:30, change it, switch it off and on again (Android writes the time while off) |
| 5 | Both | **Completion and undo:** check today; uncheck it; check and uncheck a past day; check three habits on one day |
| 6 | Both | **Calendar notes:** add, edit and delete a note on a completed, a missed and a frozen day; exactly 200 characters works; 201 is refused by the app |
| 7 | Both | **Daily reward:** complete all habits for today (+1 coin); undo (-1); redo (restored) |
| 8 | Both | **Milestone reward:** with seeded history reach a 15-day streak (+5 coins, once) |
| 9 | Both | **Pending adjustment:** with 0 coins, earn a reward then undo it (a pending adjustment appears); earn it back and see it clear |
| 10 | Both | **Freeze purchase:** with at least 20 coins buy a freeze: coins drop by exactly 20, freezes +1 |
| 11 | Both | **Freeze application:** miss a day within the 3-day window, apply a freeze: freezes -1, coins unchanged, the day counts as frozen; try a day older than 3 days (the app refuses it) |
| 12 | Both | **Monthly freeze limit:** apply up to 3 in one month; the count shows; the fourth is refused by the app |
| 13 | Both | **Cross-device:** do an action on Android, see it on Web, and the reverse |
| 14 | Android | **Offline:** airplane mode, check two days and add a note, reconnect: both sync with no denial |
| 15 | Android | **Account deletion:** on a throwaway account with habits, notes, a reward and a freeze: it completes (notes may remain: a known Android gap) |
| 16 | Android | **Expected, not a failure:** the Feedback screen cannot send (feedback is denied) |
| 17 | Console | The denied-requests graph shows no jump over the next hour |

## 6. FINAL DEPLOYMENT PREVIEW (NOT RUN)
```
cd D:\habbit_tracker_web\web
node scripts/build-rules.mjs --check                                          # exit 0
(Get-FileHash firebase\rules\combined.rules -Algorithm SHA256).Hash          # 7582DEF7F7346DCEBCB3D5017918547061977C486A53D24A7281D56C45984213
npx firebase-tools@15.37.0 deploy --only firestore:rules --project habbit-tracker-12 --config firebase/deploy-combined.json
```
- **Publishes:** only the Firestore rules of `habbit-tracker-12`, replacing whatever is live (section 1) with the Combined rules.
- **Does not touch:** Hosting, Cloud Functions, Storage, indexes, data, Kotlin, App Check.
- **What changes for users:** relative to the **original** wildcard, wallet changes need a validated ledger entry, freeze purchases must cost exactly 20, habits, completions and notes are validated (sections 2 and 3 of `FINAL_FIRESTORE_RULES_REPORT.md`), nested paths and new `todos` are blocked, feedback stays denied. Relative to **Part A**, the only difference is Part B's habit, completion and note validation.
- **Prerequisites before approval:** section 0 is done (live rules saved and classified as Part A), the header is corrected, you have the Console rollback tab ready, and you accept the remaining limitations (the real apps have not run against these rules).
- **Last dry run (after the header correction):** compiled successfully, nothing published.

## 7. Current state record (fill in at the time of approval)
| Item | Value |
|---|---|
| Deployment status | **DEPLOYED 2026-11-24 12:28 (+05:30)**: Firebase reported "released rules rules/combined.rules to cloud.firestore", "Deploy complete!", exit code 0. **Independent Console verification still pending** (section 8) |
| Live rules before deployment | **PART A** (supplied from the Console on 2026-11-24) |
| Classifier verdict | **EXACT MATCH: PART A** |
| Saved live copy path and hash | `D:\claude-data\rules-backups\LIVE-before-combined-2026-11-24.rules`, SHA-256 `B913DB0B438C3A5E339CC01A624AF7630141330F291759AF74ECA47831CE5509` (read-only) |
| Rollback chosen | Console version history (Part A); CLI fallback: `firebase/deploy-part-a.json` (section 0) |

## 8. DEPLOYMENT RECORD (2026-11-24)
| Item | Result |
|---|---|
| Authorization | explicit, from you, for exactly this command |
| Project | `habbit-tracker-12` (named with `--project`; the CLI lists it as the current project; the output says "Deploying to 'habbit-tracker-12'") |
| Pre-flight (immediately before) | Combined SHA-256 `7582DEF7F7346DCEBCB3D5017918547061977C486A53D24A7281D56C45984213` (match); generator up to date; CLI signed in; deploy config contains only `firestore` |
| Command (run once, no retry) | `npx firebase-tools@15.37.0 deploy --only firestore:rules --project habbit-tracker-12 --config firebase/deploy-combined.json` |
| Started / finished | 12:28:17 / 12:28:31 (+05:30), exit code 0 |
| Firebase output | "rules file rules/combined.rules compiled successfully"; "uploading rules rules/combined.rules"; "**released rules rules/combined.rules to cloud.firestore**"; "**Deploy complete!**". Only `firestore` was deployed |
| Services deployed | Firestore rules only. **Hosting not deployed** (live channel's last release is still 2026-10-12 15:39:54). **Functions not deployed** (the command targeted `firestore:rules`; there is no `functions` folder; `functions:list` errors, as it did before) |
| Ruleset version id | **not available**: the CLI does not print it. It is in the Console: Firestore > Rules > version history (the newest entry should read about 2026-11-24 12:28) |
| Production data / Kotlin / wallets | not touched (no data operation was run; no Kotlin file changed today) |

### What is and is not verified
- **Verified:** the file uploaded is the local `rules/combined.rules` whose hash was checked immediately before the run (`7582DEF7…4213`), and Firebase reports it compiled and was released to `cloud.firestore`.
- **Not independently verified:** the CLI cannot read the live rules, so I could not compare the live text against the local file myself. **You need to confirm it in the Console** (below). I did not re-run the deploy as a "check": that would be a second publication.

### Independent verification (2 minutes, read-only, you do it)
1. Console > `habbit-tracker-12` > Firestore Database > **Rules**: "Last published" should be today about 12:28; the editor text should start with the new header ("PARTS A + B COMBINED: the intended final Firestore ruleset...") and have 212 lines; the version history's previous entry is Part A.
2. Copy the full editor text and save it unedited as UTF-8, for example `D:\claude-data\rules-backups\LIVE-after-combined-2026-11-24.rules`.
3. Tell me; I will run `node scripts/classify-live-rules.mjs "<that file>"`. Expected: **EXACT MATCH: COMBINED**.
4. Then run the smoke-test checklist in section 5 with a test account. Any failure of a current-app action: roll back (section 0 and section 4: Console version history first).

### Rollback (unchanged, ready)
Console version history: publish the previous version (Part A). Or from the CLI: `npx firebase-tools@15.37.0 deploy --only firestore:rules --project habbit-tracker-12 --config firebase/deploy-part-a.json` after checking `firebase\firestore.rules` hashes to `B913DB0B438C3A5E339CC01A624AF7630141330F291759AF74ECA47831CE5509` (identical to the saved live copy `LIVE-before-combined-2026-11-24.rules`).
