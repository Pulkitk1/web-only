# Phase 11C.4 review: production rules versus Part A (final recommendation)

Production project: **`habbit-tracker-12`**. Status: **review only. Nothing was deployed, published or committed; no production data, Kotlin file or App Check setting was touched.** The tests ran in the local emulator only.

## 0. Verification status of the backup (still open)
| Item | State |
|---|---|
| Original Console backup `D:\claude-data\rules-backups\production-firestore-rules-BEFORE-PartA-2026-11-23.rules` | **Not provided yet** (does not exist; re-checked). Items 2 to 5 of your task (compare it with the transcription, verify its hash) **wait for it**. |
| Transcription (from your chat message) | `D:\claude-data\rules-backups\production-rules-TRANSCRIBED-FROM-CHAT-2026-11-23.rules`, SHA-256 `5D279870602A0DCC0BE7A4E234C66C5984766ED5D104A9C9A2E62DFA227CB42D`, unmodified |
| Copy used by tests | `tests/rules/production-observed.rules` (identical text; it is a test fixture, **to be re-checked against the Console file**) |
**Everything below rests on the transcription.** If your Console file differs in any way (for example it has more rules than the pasted line), tell me and I will redo this review; the new test table makes that a quick re-run.

## 1. Every permission change, production now versus Part A
Production (observed) grants exactly one thing: **an owner can read and write anything under `users/{theirUid}/**`**; everything else, including every other path, `feedback` and other users' data, has no rule and is denied.

| # | Area | Production now | Part A | Effect |
|---|---|---|---|---|
| 1 | Profile document, create | any fields, any wallet | exactly Android's eight fields, 20 coins, 0 freezes, no forged pointer | tightened |
| 2 | Profile, update | any field, any value | only wallet fields (with a ledger entry), welcome marker, deletion marker, `displayName`, `email`, `isDark`; the transaction pointer cannot move alone | tightened |
| 3 | Wallet (`coins`, `freezesOwned`, `pendingAdjustment`) | writable freely | change needs a matching ledger entry in the same commit (deltas, balance, non-negative); entry **type, id pattern and amounts validated** (daily +1, milestone 5/10/20, reversal/restore, welcome freeze once, freeze purchase **exactly -20**, freeze application -1 with its freeze record); pending adjustment cannot be erased | tightened (the core change) |
| 4 | `walletTransactions` | any content, edit and delete | append-only, validated shape; deletion only after `deletionRequested` | tightened |
| 5 | `rewards` | any content | known fields, `amount` in {1,5,10,20}, known types, tied to the entry | tightened |
| 6 | `freezes`, `freezeMonths` | any content | freeze id `habit_date`, `month == date[0:7]`, counter +1 in the same commit, at most 3; month id `YYYY-MM` | tightened |
| 7 | `habits/{id}` | any fields | **unchanged** (Part B would validate) | none |
| 8 | Paths nested under a habit | any path | only `completions/{date}` | tightened |
| 9 | `completions` | any content | **unchanged** (Part B) | none |
| 10 | `dayNotes` | any content | id must equal `habitId_date`; text 1 to 200 characters (key whitelist is Part B) | tightened (Android and Web already satisfy it) |
| 11 | `todos` | read, write | read and delete only (deletion needs it); **no new writes** | tightened (the app no longer writes it) |
| 12 | Any other path under the user (`users/{uid}/anything`) | read, write | **denied** | tightened |
| 13 | Account deletion | free deletion of everything | profile and ledger collections can be deleted only after `deletionRequested` (Android sets it first); habits, completions, notes, `todos` are deletable | tightened, and Android and Web flows pass |
| 14 | Other users, signed-out clients | denied | denied | none |
| 15 | **`feedback` collection** | **denied (no rule)** | create-only with validated fields, owner-only `get` | **new permission (section 2)** |
All 29 rows of operations behind this table are asserted, both for the observed production rules and for Part A, in `tests/rules/production.rules.ts` (**58 passed**, together with the older suites: **367 emulator tests passed**).

## 2. The newly enabled `feedback` collection
**Today in production** it is denied, so the Android "Feedback & Suggestions" screen cannot save: `FeedbackRepository` catches `PERMISSION_DENIED` and tells the user "Feedback couldn't be accepted". Part A would make it work. (The Web app has no feedback feature: its Settings row only says it opens an Android screen.)

What Part A allows (the same text as `android/firestore.rules`, byte for byte in the `feedback` block):
- **Create** by any authenticated client, including an **anonymous** identity (guests): exactly the seven fields `category, description, userId, isGuest, createdAt, appVersion, status`; `userId == auth.uid`; `category` in bug, improvement, feature; `description` a non-blank string up to 2000 characters; `isGuest` must equal "signed in anonymously"; `createdAt == request.time`; `appVersion` up to 32 characters; `status == 'new'`.
- **`get`** only of your own document (the app checks before retrying to avoid duplicates). **No list, update or delete** by clients.
- Tested (all passed): a signed-in and a guest submission succeed; naming another user, a signed-in user flagged as guest, 3000 characters, an extra field, a client-chosen timestamp, listing, editing, deleting and reading someone else's are all denied.

**Review notes and risks:**
1. **Spam and cost:** any signed-in or anonymous identity can create unlimited feedback documents (each up to 2 KB). Rules cannot rate-limit. The Firebase Web API key is public, so if **Anonymous sign-in is enabled** in Firebase Auth, anyone can mint anonymous identities and write feedback. Mitigations outside the rules: budget alert, App Check later, a rate-limited function later. Impact is storage cost and noise, not data exposure.
2. **Guests need Anonymous sign-in enabled** in the Firebase Authentication providers. I cannot see the Console; **please confirm whether it is enabled**. If it is not, guest feedback fails (as it does today) and nothing else changes.
3. **No client can read feedback**, so you read it in the Console or with the Admin SDK. Feedback that contains personal text is stored as plain data in Firestore: say so in the privacy policy if you have one.
4. Feedback is separate from wallet and habit data; no other rule reads it.
Verdict: acceptable and probably intended (the Android code was written for these rules). It is the only **new capability** Part A grants; it is optional and can be dropped by deleting that block from `build-rules.mjs` before deploying, if you do not want it live yet.

## 3. Android and Web compatibility against production-realistic rules
Earlier emulator results used `android/firestore.rules` as the baseline and so did not prove production behaviour. Now the same operations run against the **observed production rules** and Part A side by side:
- **Everything the apps really do passes under both:** profile creation, habit create, edit, check, delete with completion, day notes, daily reward with its record, freeze purchase at 20, freeze application with its record and month counter, and the whole account-deletion flow.
- I mapped every Firestore path the Android source uses (`users`, `habits`, `completions`, `dayNotes`, `walletTransactions`, `rewards`, `freezes`, `freezeMonths`, `feedback`) and the Web services (the same paths): **all are covered by Part A**. The unused `saveProfile` helper (no callers) is the only profile update besides the wallet, the welcome marker and the deletion marker, so no profile field written by a current app is refused.
- The earlier full suites (real Web ledger, habit writer, import planner and all Android shapes under Part A; 14 stored-data shapes that Part A never rejects) still apply.

## 4. Does any feature depend on the permissive production rules?
Reviewed by reading the Kotlin and Web sources and by the new pairwise tests:
- **No feature found that writes anything Part A refuses.** Anything that "works only because production is permissive" would be: an unknown ledger type, a purchase at a price other than 20, a wallet change without an entry, a note with a non-standard id, a nested path under a habit, a `todos` write, or an unknown profile field. Current Kotlin and Web code write none of them.
- **Differences that matter in practice:** (a) a freeze purchase at **10** coins (an earlier price) is refused; (b) `todos` can no longer be created (the app removed that feature; Android only deletes it); (c) feedback starts working.
- **Not provable from code:** (i) a user running an **old Android build** that wrote other shapes (you confirmed none are in use); (ii) **data already stored**: Part A never re-checks stored documents, so existing habits, completions and notes are safe, but any user whose **stored wallet already disagrees with the ledger** (possible, since production never checked) keeps that state and a later honest change is judged against the stored values.
- **Not tested:** the real Android binary and the real browser UI against Part A (emulator only), and the production Console data (no access).

## 5. Exact rollback procedure using the backup
Prerequisites: the **Console backup file verified** (hash recorded here once you provide it); until then the transcription is used. Rollback only restores rules; Part A writes nothing to data, so no data repair is needed.

**A. Fastest, no CLI (about 30 seconds):** Firebase Console > Firestore > Rules > version history > pick the version published **before** Part A (the observed one-line rules) > **Publish**. Keep that tab open during deployment.

**B. From the saved backup (CLI, you sign in first with `npx firebase-tools@15.37.0 login`):**
```
Copy-Item "D:\claude-data\rules-backups\production-firestore-rules-BEFORE-PartA-2026-11-23.rules" "D:\habbit_tracker_web\web\firebase\rollback\firestore.rules"
(Get-FileHash "D:\habbit_tracker_web\web\firebase\rollback\firestore.rules" -Algorithm SHA256).Hash    # must be 5D279870602A0DCC0BE7A4E234C66C5984766ED5D104A9C9A2E62DFA227CB42D
npx firebase-tools@15.37.0 deploy --only firestore:rules --project habbit-tracker-12 --config firebase/rollback/firebase.json
```
When your original Console file is verified, replace the source path with it (the commands are otherwise identical) and use its hash. `firebase/rollback/firebase.json` references only `firestore.rules` in its own folder, which holds the copy you place there; the copy is git-ignored. **Verified without publishing:** the backup loads in the emulator (rules compile, behave as observed), the rollback config contains only a Firestore rules entry, and the test fixture is identical to the transcription. No rollback was executed (it would publish).

## 6. Remaining risks (for the decision)
1. **The Console backup is unverified** (the transcription is a copy from chat). Highest priority: confirm it.
2. **Not proven on the real Android app or browser UI**; the emulator proves the rules logic and the exact payloads. A write shape I have not found would fail for real users until a rollback.
3. **Real users are exposed immediately**: a refusal shows as a failed save or a rolled-back action.
4. A freeze purchase at the old price of 10 coins is refused (a guest database from an old build that holds one would fail to import on Android).
5. Earning is not verified by rules (a user can still write a plausible daily reward for a date up to the shape limits); the 3-day freeze window is app-only; the owner can still set `deletionRequested`; no document counts; App Check cannot be enforced while Android has none. Part B is not deployed.
6. Feedback: spam and cost exposure if anonymous sign-in is enabled (section 2).
7. Pre-existing inconsistent wallets stay as they are.
8. The unexplained one-off browser-suite flake from Phase 11C.3.

## 7. Final production deployment recommendation
**Do not deploy yet. Conditionally recommend Part A, after these are done:**
1. You provide the **real Console backup**, I verify it (hash, diff against the transcription and this review); if it is not the one-line rules, I redo sections 1, 3 and 4.
2. You decide on **feedback** (leave enabled, or I remove that block before deployment) and confirm whether Anonymous sign-in is enabled.
3. You accept the residual risk of "emulator only". If you do not, the low-risk alternative is a **short canary**: deploy at a quiet hour, run the 13-step smoke checklist in `PART_A_DEPLOYMENT_RUNBOOK.md` with a brand-new account on Android and Web while watching the Rules monitor, and roll back at once (option A, 30 seconds) if any step or the denied-request count fails.
4. You sign in to the Firebase CLI yourself and give **explicit approval with a time window**. Before the command I will re-run `build-rules.mjs --check`, confirm the SHA-256 of `firebase/firestore.rules` (`B913DB0B438C3A5E339CC01A624AF7630141330F291759AF74ECA47831CE5509`) and do a `--dry-run`.
On the merits, Part A is a large security improvement (closes free coins and freezes, forged ledgers, arbitrary paths) with no compatibility problem found in the code or emulator; the remaining uncertainty is about real binaries and real stored data, not about rule logic.

## 8. Files changed in this review
Added: `tests/rules/production.rules.ts`, `tests/rules/production-observed.rules`, this document. Appended earlier: `PART_A_DEPLOYMENT_RUNBOOK.md` section 9. Unchanged: all Kotlin, all rules, production.


## 9. Update (final backup verification step): feedback removed from the candidate
- **Decision:** the `feedback` rule is no longer part of Part A (or Part B or the combined set). `scripts/build-rules.mjs` has a `feedback` option, default off; the generated files contain only a comment where the rule was. Production has no feedback rule today, so after Part A feedback stays denied exactly as now (the Android feedback screen keeps failing until a separate decision enables it). Sections 1 (row 15), 2 and 7 above describe the earlier proposal and are superseded.
- **New Part A:** `firebase/firestore.rules`, 168 lines, SHA-256 `B913DB0B438C3A5E339CC01A624AF7630141330F291759AF74ECA47831CE5509` (the earlier 02C3995C... hash is obsolete).
- **Tests after the change:** emulator 367 passed (feedback rows now assert "denied" for Part A; the seven real app operations still pass under both production and Part A), unit tests 749 passed, generator check up to date, `tsc` clean.


## 10. Backup file saved (final)
`D:\claude-data\rules-backups\production-firestore-rules-BEFORE-PartA-2026-11-23.rules` was created from the rules text you supplied (289 bytes, UTF-8, no BOM, one line). SHA-256 `5D279870602A0DCC0BE7A4E234C66C5984766ED5D104A9C9A2E62DFA227CB42D`, byte-identical to the earlier transcription and to the test fixture `tests/rules/production-observed.rules`. **Caveat: it contains the text you pasted into the chat, not a file exported by the Console, so it is only as exact as that paste** (for example, line breaks the Console may show are not represented). The rollback commands now copy from this file and expect that hash.
