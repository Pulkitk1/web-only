# Phase 11E: Part B (habit, completion and note validation): report

Project: `habbit-tracker-12` (production). Status: **Part B is tested locally and remains UNPUBLISHED. The combined rules are unpublished. Nothing was deployed, committed or pushed; no production data was read or modified; no Kotlin file, wallet rule, guest-import setting, Hosting or Function was touched.**

**Part A is not independently verified live.** It was deployed from the CLI, but its exact live contents still need the Console check (Rules tab, "Last published", the text itself, or a saved copy hashed against `B913DB0B438C3A5E339CC01A624AF7630141330F291759AF74ECA47831CE5509`). Nothing here assumes it. The Part A file in the repository is **byte-identical** after this phase (same hash).

## 1. Fields and validations (what Part B checks)
Part B re-validates the **whole resulting document** on every create and update (Android's check-in and reorder are updates, so every stored habit is judged each time it is written).

| Document | Field | Rule | Notes |
|---|---|---|---|
| Habit | `name` | string, 1 to 1,000 characters | Android has no limit at creation, so the bound is generous (legacy 300-character names pass) |
| | `goal`, `why` | string, up to 1,000 | Android clears a goal by writing `""`: accepted |
| | `color` | any number | Android stores a Long, older data may be a signed Int: both accepted; string and null refused |
| | `daysPerWeek` | integer 1 to 7 | the apps never write 0 or 8 (Android's create sheet allows 0 to 6 rest days) |
| | `restDays` | list, at most 7 entries | element types are not checked (rules cannot iterate lists) |
| | `reminderEnabled` | boolean | |
| | `reminderTime` | **new in this phase:** null, or `HH:mm` with hours 00 to 23 and minutes 00 to 59 | before it accepted `24:00` or `99:99`; Android's own parser accepts only valid times (`HabitReminderRules`). Android writes the time even when the reminder is off: accepted |
| | `createdDate` | `yyyy-MM-dd` (digit pattern, not calendar validity) | |
| | `scheduleHistory` | list of at most 2,000 periods | **element shape is not validated** (rules cannot iterate lists); `{from, restDays, daysPerWeek}` entries are written by both apps |
| | `archived` | boolean | |
| | `sortOrder`, `streak`, `bestStreak` | number | Android reorder writes only `sortOrder` |
| | `completedDates` | list, at most 20,000 | legacy array kept in sync by Android; element types not checked |
| | `rewardsIgnoredThrough` | `yyyy-MM-dd` | the import protection field (Phase 10.1) |
| | `migratedFrom` | string, at most 200 | |
| | any other field | allowed, at most **40 fields in total** | both apps tolerate unknown fields |
| Completion `completions/{date}` | id | `yyyy-MM-dd` | |
| | fields | only `date`, `completed`, `updatedAt`, `completedAt`, `uncheckedAt` | |
| | `date` | if present, equals the id | legacy documents without `date` stay valid |
| | `completed` | boolean | an uncheck is `completed:false` plus `uncheckedAt` (the record is kept) |
| Day note `dayNotes/{id}` | id | `{habitId}_{date}`, date `yyyy-MM-dd` | |
| | fields | only `habitId`, `date`, `text`, `createdAt`, `updatedAt` | |
| | `text` | string, 1 to 200 characters | |

**Decision I made and why:** I first added timestamp type checks (`createdAt`, `updatedAt`, `completedAt`, `uncheckedAt`) because you asked to verify timestamp fields. The legacy-data suite immediately showed what they do to old data: two stored shapes with numeric timestamps made ordinary updates fail. Timestamps have no business or wallet meaning and the Console cannot query field types, so I **removed** them. **Timestamp types are deliberately not validated**, and the tests pin that.

## 2. Business rules preserved
Part B contains no wallet change (verified by `rulesBuild.test.ts` and unchanged tests), no change to rewards, freezes, streaks or schedules, and it does not touch the guest import (the flag is untouched). The 1 to 7 weekly target, the 7-rest-day limit and the 200-character note limit are the existing app rules; the larger bounds (1,000 characters, 20,000 dates, 2,000 periods, 40 fields) are safety ceilings above any normal data.

## 3. Compatibility testing
### Android
Every Android write shape from the Kotlin source passes under Part B and A+B, create and update: habit create (`AppViewModel.kt:828`), edit (name, colour, goal, reminder, rest days and weekly target with `scheduleHistory`), archive and unarchive (the single field `archived`), reorder (`sortOrder` only), check and uncheck (completion merge plus `completedDates` union and remove), delete, notes (merge without `createdAt`), the guest-migration upload (habits with `migratedFrom`, completions and notes with `Timestamp` fields), and account deletion. Verified by reading `HabitRepository.kt`, `DayNotes.kt`, `FirestoreMigrationCloud.kt`, `AppViewModel.kt` against the rules, and by the emulator tests.
### Web
The real Web code runs against Part B and A+B: `habitCreateFields`, the habit writer (create, check with `arrayUnion`, edit), the import planner output with its notes, `habitReminderFields` (time `null` when the reminder is off), and the ledger. All pass.
### Legacy and stored data
`legacy.rules.ts` (14 habit shapes, 6 completion shapes, 3 note shapes, 3 profile shapes) performs Android's check-in update and reorder on each stored shape: all succeed under the rules in force and Part A; under Part B and A+B only the **six deliberate risk probes** fail (name over 1,000 characters, weekly target 9, rest days stored as a string, empty or foreign-format `createdDate`, more than 40 fields; a completion or note with an unknown field), exactly where the data scanner predicts.
### New field-by-field suite (`tests/rules/partb.rules.ts`)
Every field case above (valid and invalid) is run as a **create** and as an **update of a stored valid habit**, plus completions (create and merge-update, uncheck, legacy shapes, bad ids), notes (create, edit, delete, bad ids, bad dates, over-long text, extra fields), schedule history (empty, 2,000, 2,001, wrong type), archive status (toggle and delete of an archived habit) and reorder, under **all four** rule sets: valid values accepted by all four; an invalid value refused by Part B and A+B and accepted by the rules in force and Part A (except where the rules in force already refuse it, such as an over-long note).

## 4. Test results (run sequentially)
| Step | Result |
|---|---|
| Rules generation `npm run build:rules` and `--check` | up to date; Part A file unchanged (`B913DB0B…5509`) |
| Firestore emulator rules tests | **1035 passed, 0 failed** (6 files; was 367 before this phase: +668 from `partb.rules.ts`), all four rule sets |
| TypeScript | 0 errors |
| Unit tests | **759 passed, 0 failed** (30 files; +10 for the scanner's reminder-time check) |
| Browser tests | **NOT CLEAN: flaky, results varied run to run.** Runs in this stretch: 685 passed / 3 failed (checks not recorded), 687 / 1 (`the route also works when opened directly`), 683 / 5 (all in "Stage 3: repeated taps never double-pay"). The earlier run before this phase was 688 / 0. **No application code changed between those runs** (this phase changed only the rules generator, generated rules and tests), and the Firestore rules are not exercised by the browser suite (it uses fake Firestore), so I attribute it to timing under memory pressure (about 650 MB physical memory free, a long-running dev server on port 8084, 17 Chrome processes) but **have not proven that**. A clean run needs a fresh dev server and a quieter machine; I did not stop any server without your permission |
Kotlin and the production build were not re-run: no Kotlin, application or build input changed in this phase (only the rules generator, generated rule files and tests).

## 5. Combined rules (A + B)
All four suites pass against `combined.rules`: every legitimate Android and Web operation (wallet, ledger, freezes, habits, completions, notes, account deletion) is accepted; malformed writes are refused by Part B's validation; forged wallet writes and nested paths are refused by Part A's; cross-user and signed-out access are refused. Feedback is not granted in any staged set.

## 6. Existing production data: what still needs manual inspection before Part B can be published
No production data was accessed. Part B can **block an ordinary write** (check-in, edit, reorder, note edit) of any stored document that breaks a bound. These shapes need a Console look (checklist `RULES_CONSOLE_INSPECTION.md`; counts only, never content):

| Already in the checklist | Query |
|---|---|
| H1 weekly target outside 1 to 7; H2/H3 `createdDate` not ISO; H4/H5 `archived` / `reminderEnabled` not boolean; C1 `completed` not boolean; N1/N2 note dates not ISO | collection-group queries, expect zero |
| **Added by this phase** | |
| H6 `reminderTime` **>** `23:59` | expect nothing: catches `24:00` to `99:99` and non-padded times such as `7:30` |
| H7 `reminderTime` **<** `00:00` | expect nothing: catches empty or odd strings |
| **Cannot be queried; sample by hand (open about 10 of the oldest and 10 of the newest documents; look at field names and sizes only)** | |
| habit `name` over 1,000 characters; `goal`/`why` over 1,000 | likely none |
| a habit with more than 40 fields; `restDays` over 7; `scheduleHistory` over 2,000 periods; `completedDates` over 20,000 | very unlikely; the scanner script checks all of these, but needs credentials we decided not to create |
| **completion documents with fields other than `date`, `completed`, `updatedAt`, `completedAt`, `uncheckedAt`** | **the most likely real trap**: any older app version that wrote an extra field (for example `habitId`) would block every later check-in of that day |
| completion whose `date` field differs from its id | cannot be queried (cross-field) |
| note documents with fields other than `habitId`, `date`, `text`, `createdAt`, `updatedAt` | possible trap |
| `color` stored as a string, `sortOrder`/`streak` as strings | unlikely |
Because production rules were wide open until Part A, **old app versions could have written anything**; this is why the inspection matters more than the emulator results.

## 7. Remaining production risks
1. **Unseen stored data** (section 6) can make ordinary updates fail for the affected user: it shows as a failed save or a rollback.
2. **Not proven on the real Android binary or browser UI** against Part B; the emulator proves the logic and exact payloads.
3. **Element shapes** of `scheduleHistory`, `restDays` and `completedDates` are not validated (rules cannot iterate lists); bounds only.
4. **Timestamp types** are not validated (by design).
5. **No collection limits** (rules cannot count documents); the Web caps 200 habits.
6. `dateKey` checks the digit pattern, not that the date exists.
7. Part A is still not independently verified live.
8. Earning of rewards, the 3-day freeze window and the owner's ability to set `deletionRequested` are unchanged limitations.
9. The earlier unexplained one-off browser-suite flake.

## 8. Exact steps required before publishing Part B (none done)
1. **Console check of Part A** (live text and "Last published"), and a short Part A soak period with no reported failures.
2. **Console data inspection** (section 6: queries H1 to H7, C1, N1, N2, plus hand sampling for completion and note extra fields). Any non-zero result means fixing the data or relaxing that rule first.
3. Decide whether to publish **Part B alone** (`firebase/rules/part-b.rules` is "the rules in force plus validation" and is **not** suitable now: it is based on the old open rules and would drop Part A's wallet rules) or the **combined set** (`firebase/rules/combined.rules`, the right candidate: Part A already live plus Part B). Plan on the combined set.
4. Re-run `npm run build:rules -- --check`, hash `combined.rules`, a `--dry-run` deploy, and prepare a deploy config for it (a new file, like `deploy-part-a.json`) and a rollback that restores the **Part A** rules (their hash is above), because the Console history will then contain Part A as the previous version.
5. Back up the live Part A text from the Console first (unedited), save it with its hash.
6. Canary at a quiet hour: smoke checklist on Android and Web with a new account (habit create, edit, reminder on and off, archive, reorder, check and undo, notes) plus **an old real account's** check-in, watching the denied-requests graph; roll back at once if denials appear.
7. Explicit written approval from you.

## 9. Files changed in this phase
Changed: `scripts/build-rules.mjs` (stricter `reminderTime`; a comment on timestamps), generated `firebase/rules/part-b.rules` and `firebase/rules/combined.rules` (`firebase/firestore.rules` is unchanged, same hash). Added: `tests/rules/partb.rules.ts`, this report. Changed (scanner): `scripts/lib/rulesCompat.mjs` (reminder-time pattern identical to Part B) and `tests/rulesCompat.test.ts`. Untouched: all Kotlin, wallet rules, production.



---

# Phase 11F: production compatibility verification (review only)

Status: **nothing published or deployed, no production access, no production data touched, no Kotlin change, no commit.** Part B and the combined rules remain unpublished. Only the emulator tests needed for this review were run (the Part B file: **684 passed**, up from 668 with the 16 new tests; the other emulator files were unchanged, so the whole emulator suite would be 367 + 684 = 1,051, but I did not re-run it as a whole); the browser suite was not repeated, as agreed. Part A is still not independently verified live.

## 11F.1 What a rejection does to a user (proved in the emulator, `tests/rules/partb.rules.ts`)
Part B validates the **whole resulting document** on every write. A stored document that already breaks a bound is therefore not "grandfathered": the next ordinary write to it fails. The new emulator tests pin exactly how:
| Situation | Under Part B / A+B | Under the rules in force / Part A |
|---|---|---|
| **Reorder** (Android writes every habit's `sortOrder` in **one batch**) with ONE invalid habit among three | **the whole batch is refused: no habit moves**, for any habit of that user | accepted |
| **Check-in or uncheck** of the invalid habit (a batch: completion document + habit update) | **refused as a whole**; no completion document is written; the app shows the failed save and rolls the tick back | accepted |
| **Delete** the invalid habit with its completions | **accepted** (deletes are never validated): the user is never locked out, but the habit's history is lost if they delete it | accepted |
| An update that **repairs** the invalid value (for example shortens the name) | **accepted** | accepted |
| Other habits of the same user | unaffected, except through the shared reorder batch | |
So a single bad stored habit can disable check-ins for that habit and reordering for the whole account until it is repaired or deleted. The apps cannot repair arbitrary fields (the UI edits name, colour, goal, reminder, schedule, archive), so some violations could not be fixed by the user at all.

## 11F.2 Per-rule assessment
"Android / Web can trigger it" means: can a current app operation produce a **new** write that Part B rejects (answer: no for every rule, tested), versus "stranded" meaning a **stored** document that breaks it blocks later writes.

| Validation | Accepts | Rejects | Can current Android or Web writes trigger a rejection? | Could a historical document become uneditable? |
|---|---|---|---|---|
| Habit `name` | text of 1 to 1,000 characters (or absent) | empty, over 1,000, not text | **No.** Web caps names at 100, Android has no cap but the create sheet is a normal text field; nobody writes 1,000+ in practice | Only if an old name exceeds 1,000 characters (very unlikely; **cannot be queried**) |
| `goal`, `why` | text up to 1,000 (an empty string is accepted: both apps clear a goal with `""`) | over 1,000, not text (including `null`) | No: Android writes `""` or text; Web writes `''` or text and omits the field when unset | Only over-long or null goals; **cannot be queried** |
| `color` | any number | text, `null` | No: both write a number (a Long) | No realistic case |
| `daysPerWeek` | whole number 1 to 7 | 0, 8, decimals, text | No: Android's rest-day picker allows 0 to 6 rest days, so 1 to 7; Web validates 1 to 7 | Only a corrupt value (**query H1 catches it**) |
| `restDays` | list of at most 7 | more than 7, not a list | No | Only if stored as text or longer than 7 (very unlikely; sample by hand) |
| `reminderEnabled` | true or false | any other type | No | Only a non-boolean (**H5**) |
| `reminderTime` | `HH:mm` (00:00 to 23:59), or `null` | `24:00`, `12:60`, `7:30`, seconds, other text | No: Android formats the time `%02d:%02d` and Web writes the same format or `null` | Only a malformed text (**H6, H7** catch all but a minutes value above 59) |
| `createdDate` | `yyyy-MM-dd` (digits) | other formats, numbers | No | Only a non-ISO date (**H2, H3**) |
| `scheduleHistory` | list up to 2,000 entries (entry shape unchecked) | longer, not a list | No (a handful of entries in practice) | No realistic case |
| `archived` | true or false | other types | No | Only a non-boolean (**H4**) |
| `sortOrder`, `streak`, `bestStreak` | any number | text | No | No realistic case |
| `completedDates` | list up to 20,000 (elements unchecked) | longer, not a list | No (20,000 days is 55 years) | No realistic case |
| `rewardsIgnoredThrough`, `migratedFrom` | ISO date; text up to 200 | other formats | No: only the guest import writes them, and the current code writes valid values | No: these fields exist only on imported habits |
| At most 40 fields per habit | up to 40 (unknown extras allowed) | 41 or more | No: a habit has about 15 | Only a habit that accumulated dozens of extra fields (hand sample) |
| Completion id | `yyyy-MM-dd` | anything else | No: both apps use the date as the id | Only if an old build used another id format (hand sample) |
| Completion `date` field equals the id | equal, or absent (legacy) | different | No | A mismatch cannot be queried (hand sample) |
| Completion `completed` | boolean (or absent) | other types | No | Only a non-boolean (**C1**) |
| **Completion: only the five known fields** | `date`, `completed`, `updatedAt`, `completedAt`, `uncheckedAt` | **any other field** | **No** from current code (`setCompletion` and the guest import write exactly these) | **Yes, if any older build or tool added another field: that day's check or uncheck is then refused, and the same batch's habit update with it. Cannot be queried; only a hand sample or the scanner can prove it is absent** |
| Note id | `habitId_date` | other ids | No | **Already enforced by Part A (deployed)** |
| Note date | `yyyy-MM-dd` | other formats | No | Only a non-ISO date (**N1, N2**); Part A already accepts any date text, Part B would not |
| Note text | text of 1 to 200 | empty, over 200, not text | No: both apps cap at 200 and refuse empty | **Already enforced by Part A (deployed)**; cannot be queried by length |
| **Note: only the five known fields** | `habitId`, `date`, `text`, `createdAt`, `updatedAt` | **any other field** | **No** from current code | **Yes, if any note carries another field: its next edit is refused (delete still works). Cannot be queried** |

## 11F.3 Classification of every Part B validation
| Class | Validations | Why |
|---|---|---|
| **Safe to publish** | `color` is a number; `sortOrder`, `streak`, `bestStreak` are numbers; `scheduleHistory` at most 2,000; `completedDates` at most 20,000; at most 40 habit fields; `rewardsIgnoredThrough` and `migratedFrom`; completion id is an ISO date; completion `date` equals the id | The SDK fixes the types or the bounds sit far beyond any reachable value, and only current code ever wrote the fields. Residual risk is a corrupt document I cannot see, not a design problem |
| **Requires production inspection** (queries exist in `RULES_CONSOLE_INSPECTION.md`, Phase 11F addendum) | `daysPerWeek` (H1); `createdDate` (H2, H3); `archived` (H4); `reminderEnabled` (H5); `reminderTime` (H6, H7); completion `completed` (C1) and `date` (C2, C3); note date (N1, N2) | Each can be answered with a zero-result Console query |
| **Requires production inspection, by hand sampling only** | habit `name` at most 1,000; `goal` and `why` at most 1,000; `restDays` list of at most 7; note text at most 200 and note id (already live through Part A) | A query cannot test length, count or type; only a sample or the scanner can |
| **Requires adjustment** | **"only the five known fields" on completions and on notes** (`hasOnly`) | Its benefit is small (rules do not use these fields), but its failure mode is the worst in Part B: a stored document with one unknown field can never be written again, the user cannot fix it, and **no Console query can prove that no such document exists**. Recommended adjustment (not applied; needs your approval): allow unknown fields and only bound the field count, as habits already do (for example `d.keys().size() <= 10` for completions and notes), keeping the type checks on `date`, `completed` and `text`. Without the adjustment, publication should wait for a full scan |

## 11F.4 Recommendation
1. **Do not publish Part B or the combined rules yet.** The inspection has not been done, and one rule needs your decision.
2. **Decide the adjustment** for the two `hasOnly` checks (recommended: apply it). I would then regenerate, re-run the Part B emulator file and the legacy suite, and re-hash.
3. **Run the Console inspection** (addendum: queries H1 to H7, C1 to C3, N1, N2, plus the hand samples). Any non-zero result: repair that data or relax that rule first.
4. Re-verify **Part A live** in the Console and let it run, because the note rules are already live through it.
5. Then follow the publication steps in section 8 above (combined set, dry run, backup of the live rules, canary with an old real account, explicit approval).
Expected outcome if the data is clean: Part B is safe. The real unknown is old data written when production had no rules at all (before Part A, an owner could write anything), so the sample matters more than any emulator result.

## 11F.5 Files changed in this phase
Added to `tests/rules/partb.rules.ts`: four emulator tests (reorder batch, check-in batch, deletion, repair). Added to `RULES_CONSOLE_INSPECTION.md`: the Phase 11F addendum. Updated: this report. Untouched: all rules, Kotlin, production.

