# Final Firestore security rules for Consisto (Phase 11G): report

Project: `habbit-tracker-12`. Status: **Part A is confirmed live in production. The final Combined ruleset is built, tested in the emulator and dry-run validated. It is NOT published. Nothing was deployed, committed or pushed; no production data, wallet balance or Firebase configuration was touched; no Kotlin file was changed; App Check enforcement, Cloud Functions and guest import are unchanged.**

Product context used: Consisto has no public users yet (development and test accounts only), so the aim is to have the final rules in place before launch. That lowers the blast radius of a mistake; it does not remove the need for the Console checks below.

## 1. Final rules architecture
- **One generator, three outputs.** `scripts/build-rules.mjs` (`npm run build:rules`) builds all rule files from shared pieces; `--check` fails if a committed file is stale; `tests/rulesBuild.test.ts` checks their structure.
| File | What it is | SHA-256 |
|---|---|---|
| **`firebase/rules/combined.rules`** | **the final ruleset: Part A (wallet integrity) + Part B (habit, completion, note validation)** | **`7582DEF7F7346DCEBCB3D5017918547061977C486A53D24A7281D56C45984213`** (14,226 bytes, 212 lines, UTF-8, LF, no BOM; header comment corrected on 2026-11-24, the earlier hash is obsolete) |
| `firebase/firestore.rules` | Part A only (the file previously deployed; **unchanged**) | `B913DB0B438C3A5E339CC01A624AF7630141330F291759AF74ECA47831CE5509` |
| `firebase/rules/part-b.rules` | Part B on top of the original open rules (not a candidate; it would drop Part A) | `FC856A2A937C1C4E422B432FCF9E8F72DE574EC5FCA226C96FBF7E14BC3F3DE8` |
- **Structure of the final rules:** everything lives under `match /users/{userId}` and every rule starts from `isOwner()` (signed in, `auth.uid == userId`); any other path, including `feedback`, has no rule and is **denied by default**. There is no `{document=**}` or `{rest=**}` catch-all. Collections: the profile document, `habits/{id}` with `completions/{date}`, `dayNotes`, `walletTransactions`, `rewards`, `freezes`, `freezeMonths`, and `todos` (read and delete only).
- **Deploy configs (each publishes only Firestore rules, no hosting, functions, storage or indexes):** `firebase/deploy-combined.json` (new) points at `rules/combined.rules`; `firebase/deploy-part-a.json` at `firestore.rules`.

## 2. The approved backward-compatibility adjustment (what changed in this phase)
Applied to **Part B only** (Part A is byte-identical; its hash is unchanged):
| | Before | Now |
|---|---|---|
| Completion documents | only five known fields allowed | **any additional fields, at most 10 fields in all**; **`completed` is required and must be a boolean**; `date`, if present, must equal the document id; the id must be `yyyy-MM-dd` |
| Calendar notes | only five known fields allowed | **any additional fields, at most 10 fields in all**; `habitId` must be text; `date` must be `yyyy-MM-dd`; the id must equal `habitId_date`; `text` is text of 1 to 200 characters |
Owner-only access is untouched. The data scanner (`scripts/lib/rulesCompat.mjs`) and its tests were updated to the same rules (more than 10 fields is the problem now). Result: an unknown field on a stored completion or note can no longer make that document impossible to write.

## 3. All validations in the final ruleset
### Wallet and profile (Part A)
- **Ledger entry** (`walletTransactions`, append-only): known fields only; whole-number amounts; a type with its id pattern and amounts: `daily_completion` +1, `streak_milestone` 5, 10 or 20, `reward_restored`, `reward_reversal`, `welcome_freeze` (once, +1 freeze, 0 coins), **`freeze_purchase` exactly -20 coins and +1 freeze**, `freeze_application` (0 coins, -1 freeze, its freeze record in the same commit).
- **Wallet change** (`coins`, `freezesOwned`, `pendingAdjustment`): needs a ledger entry written in the same commit whose deltas and balance match; never negative; the transaction pointer `lastTransactionId` cannot move alone; a pending adjustment cannot be erased.
- **Reward records:** known fields, `amount` in {1, 5, 10, 20}, known types, `cycle` at least 1.
- **Freeze records and month counters:** freeze id `habit_date`, `month` equals the date's month, the month counter id is `YYYY-MM` and goes up by exactly one in the same commit, at most 3 a month.
- **Profile:** creation has exactly Android's eight fields, 20 coins, 0 freezes; an update may change only the wallet fields (with an entry), the welcome marker, the deletion marker, `displayName`, `email`, `isDark`.
- **Paths:** nothing nested under a habit except `completions`; no new `todos`; nothing under the ledger or the profile.
- **Account deletion:** the ledger and profile can be deleted only after `deletionRequested` is set (Android sets it first); habits, completions, notes and `todos` can be deleted.
### Habits, completions, notes (Part B)
- **Habit:** `name` 1 to 1,000 characters; `goal`, `why` up to 1,000 (an empty string is allowed); `color` a number; `daysPerWeek` a whole number 1 to 7; `restDays` a list of at most 7; `reminderEnabled` and `archived` booleans; **`reminderTime` null or `HH:mm` (00:00 to 23:59)**; `createdDate` and `rewardsIgnoredThrough` `yyyy-MM-dd`; `scheduleHistory` a list of at most 2,000; `completedDates` a list of at most 20,000; `sortOrder`, `streak`, `bestStreak` numbers; `migratedFrom` text up to 200; at most 40 fields (unknown extra fields tolerated).
- **Completion** and **note:** section 2. Timestamp types (`createdAt`, `updatedAt`, `completedAt`, `uncheckedAt`) are deliberately **not** validated.
- **Feedback:** no rule: **denied** (as in production today).

## 4. Emulator test results (local Firebase emulator only; project ids `demo-*`; host 127.0.0.1)
| Step | Result |
|---|---|
| `npm run build:rules` and `--check` | up to date; Part A unchanged |
| Firestore emulator rules tests (`npm run test:rules`): current rules, Part A, Part B, Combined, production-as-observed | **1,091 passed, 0 failed** (6 files) |
| TypeScript | **0 errors** |
| Unit tests | **759 passed, 0 failed** (30 files) |
| Server-side dry run of the combined file (`deploy --dry-run`) | **compiled successfully, nothing published** |
Not re-run in this phase (no application, Kotlin or build input changed): Kotlin unit tests (379 passed in Phase 11C.3), browser suite (688 of 688 passed on a fresh server in Phase 11E), production build.
**Covered by the emulator suites (all rule sets, the Combined set included):** authentication and user isolation (another user and a signed-out client read and write nothing); habit create, edit, delete; archive and unarchive; reorder; completion and undo; calendar notes (create, edit, delete); schedule history; wallet transactions; daily and milestone rewards and reversals; freeze purchase at 20; freeze application including an old date; monthly limit; pending adjustments; account deletion (Android's whole flow); the guest-migration upload (`migratedFrom`, completions and notes with Timestamp fields) and the import planner output (`rewardsIgnoredThrough`); legacy stored shapes; and malicious writes (forged coins, free or cheap freezes, double freezes, counter tricks, erasing pending adjustments, pointer moves, extra or wrong profile fields, nested paths, oversized or malformed documents). New in this phase: completions and notes with extra fields (accepted up to 10 fields, refused at 11), a completion without `completed` (refused on create), `habitId` that is not text (refused).

## 5. Android and Web compatibility
Every write shape in the Kotlin source and every real Web write path (`createCloudLedger`, `habitCreateFields`, the habit writer, `habitReminderFields`, the import planner) is replayed against the Combined rules and **accepted**; no current Android or Web operation is rejected. Android itself cannot be pointed at the emulator without a Kotlin change (not approved), so its **exact payloads** are tested, not the app binary; the Web UI was likewise tested against the emulator rules only through its real write code, and against a fake Firestore in the browser suite. **Known intentional differences from today's production rules:** a freeze purchase at the old price of 10 is refused; `todos` cannot be created; feedback stays denied (the Android Feedback screen keeps failing there, exactly as today).

## 6. Part A's live status: not assumed, how to verify
Part A was deployed from the CLI, but nobody has confirmed the live text. **Before replacing anything, verify what is published:**
1. Firebase Console > project `habbit-tracker-12` > Firestore Database > **Rules**. Note "Last published" and open the version history.
2. The live text is Part A if it starts `rules_version = '2';`, has about 182 lines, contains `entryShape`, `profileCreateOk` and `freezePath`, and has no `match /feedback`. It is the **original one-line wildcard** if it is one line containing `{document=**}`.
3. For an exact check, copy the whole editor text unedited and save it as UTF-8, for example `D:\claude-data\rules-backups\live-before-combined-<date>.rules`, then hash it: `(Get-FileHash "<file>" -Algorithm SHA256).Hash`. It should equal `B913DB0B…5509` for Part A (or `5D279870…CB42D` for the original). Line endings: the Console may return CRLF; if the hash differs only by line endings, compare after replacing `` `r`n `` with `` `n ``.
4. **Do not use a deploy to "check":** deploying publishes whatever differs. The CLI cannot read the live rules.
5. Whatever it turns out to be, **that saved file is the rollback source** (section 8).

## 7. Final deployment command (NOT run; needs your explicit approval)
Pre-flight, in `D:\habbit_tracker_web\web`: `node scripts/build-rules.mjs --check` (exit 0); `(Get-FileHash firebase\rules\combined.rules -Algorithm SHA256).Hash` equals `7582DEF7F7346DCEBCB3D5017918547061977C486A53D24A7281D56C45984213`; the live rules saved and hashed (section 6); the Firebase CLI signed in (it was at last check).
```
npx firebase-tools@15.37.0 deploy --only firestore:rules --project habbit-tracker-12 --config firebase/deploy-combined.json
```
Validation run already done (publishes nothing): the same command with `--dry-run` reported "rules file rules/combined.rules compiled successfully". Only Firestore rules are selected: no hosting, functions, storage or indexes entry exists in the config, and there is no `functions` folder.

## 8. Rollback procedure
Use the **text that was live before the deployment** (section 6, saved to a file). In order of speed:
1. **Console (about 30 seconds):** Firestore > Rules > version history > pick the version published before this deployment > **Publish**.
2. **If the previous rules were Part A** (hash `B913DB0B…5509`): from `D:\habbit_tracker_web\web`, after confirming `firebase\firestore.rules` still hashes to that value:
   `npx firebase-tools@15.37.0 deploy --only firestore:rules --project habbit-tracker-12 --config firebase/deploy-part-a.json`
3. **If the previous rules were the original wildcard** (the backup `D:\claude-data\rules-backups\production-firestore-rules-BEFORE-PartA-2026-11-23.rules`, hash `5D279870…CB42D`, created from the text you pasted, not a Console export):
   ```
   Copy-Item "D:\claude-data\rules-backups\production-firestore-rules-BEFORE-PartA-2026-11-23.rules" "D:\habbit_tracker_web\web\firebase\rollback\firestore.rules"
   (Get-FileHash "D:\habbit_tracker_web\web\firebase\rollback\firestore.rules" -Algorithm SHA256).Hash   # must be 5D279870...CB42D
   npx firebase-tools@15.37.0 deploy --only firestore:rules --project habbit-tracker-12 --config firebase/rollback/firebase.json
   ```
4. **If the previous rules were something else:** copy your saved live file to `firebase\rollback\firestore.rules` and run the last command. Delete the copy afterwards (it is git-ignored).
Rollback restores rules only; the rules never write data, so no data repair is needed. Trigger: any `PERMISSION_DENIED` on a smoke-test step, or a rising denied-request count in the Console Rules monitor.

## 9. Post-deployment smoke-test checklist (test accounts only, never the main Android account)
Keep the Console Rules tab open (version history and the denied-requests graph) and `adb logcat | findstr PERMISSION_DENIED` running. Pass means it works, the data is right and nothing is denied. **Any failure of a current-app action means roll back.**
1. Confirm in the Console that the live text is now the Combined rules (about 211 lines, contains `validHabit` and `entryShape`, no `match /feedback`; hash it if you saved a copy).
2. Sign up a new account (Android and Web): profile with 20 coins, welcome freeze (1 freeze, still 20 coins). Sign out, sign in.
3. Create habits (plain; with goal; reminder on; 3 rest days; a long name). Edit name, colour, goal (add, then clear), reminder time on and off, weekly target and rest days. Archive and unarchive. Reorder. Delete one that has completions and a note.
4. Check today, uncheck, check a past day; check three habits on one day.
5. Calendar notes: add, edit, delete (a completed, a missed and a frozen day); try exactly 200 characters; the app refuses 201.
6. Wallet: complete all habits (+1), undo (-1), redo; with 0 coins create a pending adjustment (undo a reward) and earn it back; a 15-day streak milestone if seeded.
7. Freeze: buy one (exactly -20 coins, +1 freeze); apply one within the 3-day window (-1 freeze, no coin change, month count 1); up to the monthly limit; the fourth is refused by the app.
8. Cross-device: act on Android, see it on the Web, and the reverse.
9. Android offline: airplane mode, check two days, add a note, reconnect: both sync with no denial.
10. Android account deletion on a throwaway account with habits, notes, a reward and a freeze: it completes.
11. Expected, not a failure: Android's **Feedback** screen reports it could not send (feedback stays denied).
12. Console Rules monitor: no jump in denied requests over the next hour.

## 10. Remaining limitations
1. **Earning is not verified by rules.** A signed-in user can still write a plausible daily reward for a date, or a milestone, within the shape limits. Needs a server (`CLOUD_FUNCTIONS_PROPOSAL.md`). Coins are virtual.
2. **The 3-day freeze window is app-enforced only** (Android's guest import replays old dates through the same writes).
3. **The owner can set `deletionRequested`** (Android deletion does it from the client).
4. **Not validated by rules:** the shape of items inside `scheduleHistory`, `restDays` and `completedDates` (rules cannot iterate lists); timestamp types; whether a date exists on the calendar; collection sizes (no document counts; the Web caps habits at 200). Extra unknown fields are tolerated (at most 40 on a habit, 10 on a completion or note), and an extra field can hold a large value up to Firestore's 1 MiB document limit.
5. **Not proven on the real binaries:** the Android app and the Web UI were not run against the emulator or the new rules; payloads and the real Web write code were. Real Firestore can differ from the emulator in rare edge cases.
6. **Stored data was not inspected.** With no public users the exposure is only your development and test accounts, which can be repaired or deleted, but the Console checks in `RULES_CONSOLE_INSPECTION.md` (the Phase 11F addendum) are still worth doing on them.
7. **Part A's live status is unverified** (section 6).
8. A freeze purchase at the old price of 10 is refused; `todos` can no longer be created.
9. **App Check cannot be enforced** while the Android app has none; guest import stays off in production.
10. The browser suite was flaky in an earlier stretch (688 of 688 on a fresh server since); its cause was not proven.
11. Feedback is denied, so the Android Feedback feature does not work against these rules until a separate decision enables it.

## 11. Process note
While editing the generator I used a PowerShell read that treated the file as Windows ANSI. It garbled the box-drawing characters in the generator's comments, which briefly changed the generated Part A file's bytes (comments only; hash changed). I restored the generator byte-exactly (Part A's hash is verified back to `B913DB0B…5509`), repaired the same kind of damage in one comment of `tests/fakeFirestore.ts` and in one character of `PART_B_VALIDATION_REPORT.md`, and removed stray byte-order marks from two files I had rewritten. No rule logic or test logic was affected. All later edits used UTF-8-safe tools.

## 12. Files changed in this phase
Changed: `scripts/build-rules.mjs` (completion and note validation), generated `firebase/rules/part-b.rules` and `firebase/rules/combined.rules` (`firebase/firestore.rules` unchanged), `scripts/lib/rulesCompat.mjs`, `tests/rules/partb.rules.ts`, `tests/rules/legacy.rules.ts`, `tests/rules/firestore.rules.ts`, `tests/rulesCompat.test.ts`, `tests/fakeFirestore.ts` (comment repair), `PART_B_VALIDATION_REPORT.md` (character repair). Added: `firebase/deploy-combined.json`, this report. Untouched: all Kotlin, production Firebase, `.env.local`.

## 13. Recommendation
The Combined ruleset is ready for a production deployment **once you have (1) verified and saved the live rules (section 6) and (2) accepted the remaining limitations, in particular that the real apps have not been run against it.** With no public users, a short canary on test accounts using the checklist in section 9, with the Console rollback open, is proportionate. I will not deploy without your explicit approval.
