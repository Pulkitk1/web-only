# Phase 10: Guest data migration (audit and plan)

Status: **audit and plan only. Nothing is implemented.** No Kotlin file, Firestore rule, schema, cloud document or local guest
data was changed while writing this. Implementation waits for approval, and section 11 lists decisions that need an answer first.

How to read it: **[V]** means verified by reading the named file. **[A]** means an assumption or a proposal that was not
verified or that the Kotlin code does not do. I read the Kotlin tests but did not run them, so "tested in Kotlin" means "a test
exists", not "I saw it pass".

Kotlin sources (all under `android/app/src/`):
`main/java/com/habittracker/app/data/migration/GuestMigration.kt`, `.../FirestoreMigrationCloud.kt`,
`.../AppViewModel.kt` (lines 150 to 313), `.../ui/screens/BackupDialog.kt`, `.../data/local/LocalEntities.kt`,
`test/java/com/habittracker/app/data/migration/GuestMigrationTest.kt`, and `android/firestore.rules`.

---

## 1. Kotlin migration protocol [V]

**Entry.** A guest taps "Sign in to back up your progress" (`SettingsScreen` -> `vm.startBackup()`), which sets
`backupRequested`, ends the guest session and shows the login screen. After `authenticate` succeeds, `beginBackup` runs if
`backupRequested` is set or a pending migration record exists for that uid. A user who signs in normally and never asked for a
backup is not migrated.

**Decision in `beginBackup`** (AppViewModel.kt:233):

| Situation | Result |
|---|---|
| A pending migration for this uid exists | Resume it (`runBackup`) |
| No guest data (no habits and no wallet transactions) or already completed | Open the account normally |
| The account already has habits or wallet transactions (`hasConsistoData`) | Show the choice: Merge Guest Progress, Keep Existing Account, Cancel |
| The account is empty | **Migrate immediately, without asking** |

`GuestMigrator.migrate` (GuestMigration.kt:131):

1. **Preparing.** Refuses if a completion marker exists. `record.begin(uid)` reuses an unfinished migration id for the same uid,
   otherwise it makes a new UUID. It snapshots habits, schedule periods, completions, wallet transactions and notes from the
   guest Room database, then `ensureProfile` creates `users/{uid}` only if missing (20 coins, 0 freezes, no welcome marker).
2. **Uploading.** Each guest habit id is mapped to a cloud id by `cloudIdFor`:
   - the same id if the slot is free or already ours,
   - otherwise `{guestId}-m{migrationId[0..8]}[-n]`.
   "Ours" means the cloud habit's `migratedFrom` field equals `"{migrationId}:{guestHabitId}"`.
   Habit documents are written with `completedDates` rebuilt from the completions and `migratedFrom`. Every completion is written
   to `habits/{id}/completions/{date}`, including `completed=false` rows. Batches are 400 writes. Then day notes are written to
   `dayNotes/{cloudHabitId}_{date}`. Notes whose habit isn't in the map are dropped.
3. **Wallet replay.** Guest ledger entries are replayed in order through the normal `WalletLedger`, one Firestore transaction
   each, with their original ids:

   | Guest entry | Replay |
   |---|---|
   | daily reward, milestone, restored | `grantReward(rewardId, amount = coinDelta - pendingDelta, date, habit, milestone)` |
   | reversal | `revokeReward(rewardId or id before "_rev")` |
   | welcome freeze | `grantWelcomeFreeze()` (fixed id `welcome_freeze`) |
   | freeze purchase | `buyFreeze(requestId, date, price actually paid)` |
   | freeze application | `applyFreeze(habit, date)`; "already frozen" counts as done |
   | anything else | skipped, reported as unknown |

   The balance is never copied. Entries the account can't take (not enough coins, monthly limit, no freezes) are **skipped and
   listed** in the report.
4. **Verifying.** Everything is read back from the server (`Source.SERVER`): habit exists and `migratedFrom` matches, the
   schedule history is equal, the completion count is at least the uploaded count, each freeze and ledger entry exists, each note
   exists. Any mismatch throws and the migration can be retried.
5. **Completed.** `migration.completedUid` and `migration.completedAt` are stored in the guest DB's `local_meta`. After that the
   same guest data can't be migrated again, to this account or to another one. **The guest database is kept as a backup;
   nothing is deleted.**

**Migration record** keys in `local_meta`: `migration.id`, `migration.uid`, `migration.step`, `migration.completedUid`,
`migration.completedAt`. Steps are `NotStarted -> Preparing -> Uploading -> Verifying -> Completed | Failed`.
`abandon()` forgets the record **only if upload hasn't started**, so a later retry re-uses the same migration id and recognises
its own earlier uploads.

**UI** (`BackupDialog.kt`): a progress dialog with the three steps, the existing-account choice, a result summary (habits,
check-ins, up to 5 skipped wallet items) and a failure dialog with Try Again or Back to Guest Mode. Cancel signs out and returns
to guest mode with the data intact. A new account also takes over the guest's reminder settings (not relevant to the web).

**Kotlin tests** (`GuestMigrationTest.kt`, 17 tests): a new account gets everything, id collisions get derived ids, the replay
doesn't duplicate rewards or the welcome freeze, an existing account can't be overdrawn, old purchase prices are replayed at the
recorded price, the monthly limit holds, an interrupted run resumes without duplicates, verification failure is retried, a
completed migration can't run twice, Keep Existing imports nothing, concurrent wallet changes stay consistent, notes follow
remapped habit ids, and a failed note upload retries without duplicates.

---

## 2. Web guest data structure [V]

Storage: one `localStorage` key `consisto_app_data`, an envelope `{version: 1, savedAt, data}`
(`services/appStorage.ts`). `data` is `{habits, ledger, notes, nextId}`.

| Part | Shape |
|---|---|
| `habits[]` | `id, name, color "#RRGGBB", completedDates[], daysPerWeek, restDays[], createdDate, scheduleHistory[{from, restDays, daysPerWeek}], archived, goal, reminderEnabled, reminderTime` |
| `ledger.wallet` | `{coins, freezesOwned, pending}` |
| `ledger.rewards` | `{[rewardId]: {id, active, cycle, amount, type, date?, habitId?, milestone?}}` |
| `ledger.transactions[]` | `{id, type, coinDelta, freezeDelta, balanceAfter, pendingDelta}` |
| `ledger.txIds[]`, `ledger.freezes[]` | idempotency ids; `{habitId, date, paidWith}` |
| `notes` | `{[habitId]: {[yyyy-MM-dd]: text}}` |

Related and not part of the envelope: a corrupt-data backup key (`consisto_app_data_backup`), the guest flag and theme and
notification switches and milestone queue in `devicePrefs`, and the mock-start-coins test knob.

Session behaviour [V] (`sessionController.ts`, `AppStore.tsx:205`): signing in or out **does not read, write or clear guest
data**. In cloud mode `commit` skips `appStorage.save`, so an account never writes into the guest key. Guest data therefore
already survives sign-in untouched, which is what the migration needs.

---

## 3. Differences between guest and cloud data

| Topic | Web guest (localStorage) | Cloud / Kotlin |
|---|---|---|
| Habit id | `h1`..`h5` (mock seed) or `local-{n}` [V `AppStore.tsx:389`] | Firestore auto id (`newHabitId`) |
| Sort order | array position | `sortOrder` field |
| Created time | only `createdDate` | `createdAt` timestamp |
| Unchecked days | **not stored**: only the checked dates | `completions/{date}` with `completed=false` kept |
| Completion time | none | `completedAt` / `uncheckedAt` / `updatedAt` |
| Tx details | `Tx` has **no date, habitId, milestone or createdAt** | `walletTransactions` carry these |
| Reward details | `RewardRecord` has `date`, `habitId`, `milestone` | same |
| Purchase request id | `buy-{n}` (`AppStore.tsx:596`), e.g. `freeze_buy_buy-1` | UUID (`isValidRequestId` needs 8 to 100 chars) |
| Freeze application | `freezes[]` list, tx `freeze_apply_{habitId}_{date}` | `freezes/{habitId}_{date}`, `freezeMonths/{yyyy-MM}` |
| Wallet start | 20 coins, welcome freeze | 20 coins, `welcomeFreezePending` on Android-created accounts |
| Notes | `notes[habitId][date]` | `dayNotes/{habitId}_{date}` with `habitId, date, text, createdAt, updatedAt` |

### Mock/demo data is mixed into guest data (important, not covered by Kotlin)

On a first run, `loadInitialState` saves `buildFreshState` (`store/initialState.ts`): **five demo habits** (`h1` SQL Practice,
`h2` Morning Run, `h3` Read Books, `h4` Meditate, `h5` Drink Water), a demo frozen day on `h3` that has no ledger transaction,
and rewards that "the seed history already qualifies for", **recorded silently with real coin transactions**. So an untouched
guest wallet already holds more than 20 coins from demo history, and nothing in the envelope says which data is demo.
Kotlin has no demo data, so it never faced this. Consequences:

- "Is there meaningful guest data?" can't be answered from the envelope alone.
- Replaying the guest ledger would import coins that were earned from demo habits. That would break "do not upload mock/demo
  data".
- `daily_{date}` rewards are not tied to a habit, so they can't be attributed to demo or real habits.

---

## 4. Habit ID collision risks

- **Kotlin's rule [V]:** keep the guest id if free or ours, otherwise derive `{id}-m{migrationId8}[-n]`, and tag every habit with
  `migratedFrom`.
- **Web risks [A]:**
  1. `h1`..`h5` and `local-N` are not unique across browsers. Two browsers importing into one account both hold `local-1`. The
     `migratedFrom` tag (which includes a per-run migration id) makes the second one derive a new id, as in Kotlin, so this is
     covered if the same protocol is used.
  2. Cloud ids are Firestore auto ids, so a collision with a web id is unlikely. It is still handled the same way.
  3. **Milestone reward ids embed the habit id** (`milestone_{habitId}_{n}_{runKey}`, `rewards.ts:86`, same in Kotlin
     `RewardRules.kt:98`). Kotlin's replay keeps the *original* reward id but passes the *remapped* habit id [V
     `GuestMigration.kt:218`]. After a remap, the normal reconciler would compute `milestone_{newId}_...`, find no record, and
     pay the milestone a second time. This is my reading of the code. No Kotlin test covers it. The web version should rewrite
     the id segment when a habit is remapped. **[A]**
  4. **Purchase ids:** `freeze_buy_buy-1` is not unique across browsers, and the second browser's purchase would be silently
     treated as a duplicate. Replayed purchases need a migration-scoped id, which departs from Kotlin's "keep the original id".
     Kotlin can keep it because its ids are UUIDs. **[A]**

---

## 5. Completion and note migration

- **Completions [V in Kotlin, A for web]:** upload one `completions/{date}` document per checked date
  (`completed: true, date, completedAt, updatedAt`) and set `completedDates`. The web has no unchecked rows, so none are
  written, and there is nothing to lose. There are no real timestamps, so `completedAt` and `updatedAt` would be the import time
  (Kotlin used the local `updatedAt`). `createdAt` would be derived from `createdDate` at local midnight so ordering is
  stable. `sortOrder` would be the array index.
- **Streak fields:** write `streak` and `bestStreak` from the web streak engine, as `habitCreateFields` and `setCompletion` do
  for normal writes. Kotlin writes the cached values from its entity.
- **Notes:** write `dayNotes/{cloudHabitId}_{date}` (`habitId, date, text, createdAt, updatedAt`). The rules require the id to
  equal `habitId + '_' + date`, and the text length to be 1 to 200 [V `firestore.rules:52`]. The web limit is also 200
  (`NOTE_MAX_LENGTH`). Notes of a habit that isn't imported are dropped, as in Kotlin. Rewriting the same id on retry is safe.
- **Optional fields:** `goal`, `reminderEnabled` and `reminderTime` follow `habitCreateFields` (goal only if set, reminder fields
  only if on). `archived` is written only when true. **[A]** Kotlin's `toFields` also carries these.

---

## 6. Schedule history migration

- **Kotlin [V]:** `toFields(periods)` writes `scheduleHistory` as `[{from, restDays, daysPerWeek}]` plus the latest `restDays`
  and `daysPerWeek`. Verification compares `ScheduleHistory.fromFirestore(...)` on both sides.
- **Web [V]:** `scheduleHistoryToFirestore` in `domain/cloudWrite.ts` already writes the same shape, with rest days in
  week order, and the cloud reader already parses it (`mapScheduleHistory`). The plan reuses that function unchanged and
  verifies by comparing parsed histories. The web validator already guarantees `from` is a valid date key.

---

## 7. Wallet and reward handling

The restriction says **do not merge wallet balances automatically, and do not duplicate rewards or freezes.**

What the web ledger gives us for a faithful Kotlin-style replay:

| Replay item | Web source | Gap |
|---|---|---|
| Daily or milestone reward | `ledger.rewards` (date, habitId, milestone, amount) and tx | none |
| Partly-paid grant | `amount = coinDelta - pendingDelta` (same formula as Kotlin) | none |
| Reversal | tx id ends `_rev{n}`; reward id is the part before | none |
| Welcome freeze | tx id `welcome_freeze` | none |
| Freeze application | `ledger.freezes` (habitId, date) and `freeze_apply_{habit}_{date}` | none |
| Freeze purchase | tx `freeze_buy_{requestId}` | **no date** (needed for the monthly hold limit), id not unique, and `cloudLedger.buyFreeze` has no price argument (the guest price is always 20) |

The cloud ledger already has every operation the replay needs (`grantReward`, `revokeReward`, `buyFreeze`, `applyFreeze`,
`grantWelcomeFreeze`), each idempotent by id and each in one transaction, so replaying through it can't duplicate a reward, a
freeze or a welcome freeze, and can't overdraw.

**Proposal [A], to confirm in section 11:** import habits, completions, notes and schedule history first, **without touching the
wallet**. Offer the wallet as a separate, explicit second choice in the preview ("Also import N reward and freeze entries"),
**off by default**, showing what would be applied and what would be skipped. Whatever the choice, the guest balance number is
never copied. Only ledger entries are replayed, and only through the checked ledger.

Rewards and demo data: if demo habits are not imported (section 3), replaying the guest ledger would import demo-earned coins.
So the replay must be limited to entries that can be attributed to imported habits, which excludes `daily_{date}` rewards.
The alternative is not to replay rewards at all and let the normal reconciler pay for the imported completions. Its window is the
current month (`rewardWindowStart`), so older history would earn nothing, and `daily_{date}` ids already prevent doubles.
That departs from Kotlin and is an open decision.

---

## 8. Duplicate prevention

1. **Completion marker [V in Kotlin]:** guest data can be imported once, ever. Proposed web marker **[A]**: a new localStorage
   key `consisto_guest_migration` holding `{id, uid, step, completedUid?, completedAt?}`, kept outside the `consisto_app_data`
   envelope so `STORAGE_VERSION` and the guest data are not changed. It is **not** a Firestore change.
2. **Migration id** per attempt, reused on retry for the same uid, as in Kotlin.
3. **`migratedFrom` tag** on every imported habit. A retry sees its own habits as "ours" and rewrites them in place, a foreign
   habit as "taken".
4. **Deterministic ids:** completions by date, notes by `{habit}_{date}`, rewards and freezes by their ledger ids (with the two
   web-specific fixes in section 4).
5. **Never mutate or merge existing cloud data:** existing habits, completions, notes and wallet documents are only read. A
   same-name habit is not merged (Kotlin test `mergeKeepsCloudHabitsAndResolvesIdCollisions`).
6. **One migration at a time per browser** (a busy flag like `walletBusy`), and the import writes through the same listeners, so
   the live feed shows imported data without reloading.
7. **Second-browser case:** the completion marker is per browser, as in Kotlin (per device). A second browser with its own guest
   data gets its own migration id, so nothing collides.

---

## 9. Interrupted migration recovery

Same model as Kotlin [V]: every step is idempotent, the local data is never modified, and the record keeps the step.

- **Closed or crashed mid-upload:** the record stays `Uploading`. On the next sign-in to the same uid the app resumes with the same
  migration id. Already-uploaded habits are recognised ("ours").
- **Verification failure:** the step becomes `Failed`. Try Again re-runs; the retry succeeds without duplicates.
- **User backs out before upload:** `abandon()` forgets the record. After upload starts, the record is kept.
- **A different account signs in while a migration is pending for another uid:** the record is for the first uid, so the second
  account is not touched. **[A]** A new migration id would be created only if the first has not started uploading.
- **Offline:** fails with a clear message and keeps the record. No queueing, consistent with the wallet work in 9D.5.
- **Sign-out during import:** the in-flight run is cancelled and later results are ignored, as for cloud writes today.

---

## 10. Data verification

After upload, read everything back from the **server** (not the cache) and compare, as Kotlin does:

- every imported habit exists, its `migratedFrom` matches, its schedule history parses equal, and the server completion count is
  at least the uploaded count (Kotlin also compares only counts; I'd also compare the date sets, which is cheap and stricter **[A]**);
- every imported note exists with the right text;
- if the wallet import was chosen, every applied freeze and ledger entry exists, and the wallet equals the starting balance plus
  the applied deltas (the same invariant the 9D.5 tests use).

The result screen reports habits, check-ins and notes imported, and lists skipped wallet entries with the reason. The completion
marker is written only after verification succeeds. Local guest data is **never deleted**.

---

## 11. Proposed user experience (not implemented)

Trigger: after sign-in, once the cloud data has loaded, if meaningful guest data exists and no completion marker exists. Both
choices are always explicit. This is stricter than Kotlin, which migrates an empty account without asking.

```
Import your guest habits?
You have 2 habits on this device that aren't in your account.
   [Preview]
   - Read (14 check-ins, 3 notes)
   - Gym (40 check-ins)
   [ ] Also import rewards and freeze activity (12 entries)   <- off by default
[Import my guest habits]     [Start with my existing account]
```

- **Preview** lists each habit, check-in count, note count and, if chosen, the wallet entries that would be applied or skipped. It
  also shows which habits will get a new id because of a collision.
- **Start with my existing account:** records the user's choice, imports nothing, makes no cloud writes. The guest data stays on
  the device. Whether to ask again next sign-in is a decision below.
- **Progress** (Preparing, Uploading, Verifying) with a "keep this tab open" note, then a result summary or a failure dialog with
  Try Again and Start With My Existing Account.
- **Entry point:** also available from Settings while signed in, as "Import guest data", until the completion marker is set.
- No demo habit is ever selected by default.

### Decisions needed before implementing

1. **Demo data.** How do we recognise it? Option A: fingerprint (ids exactly `h1`..`h5` with the five demo names, no notes) for
   existing data, plus a "seeded" marker written from now on. Option B: always list `h1`..`h5` in the preview, unticked by
   default, and let the user decide. I recommend B plus A for "is there anything to offer".
2. **Wallet.** Faithful Kotlin replay (opt-in, section 7), or habits only with the normal reconciler paying afterwards, or no wallet
   import at all? I recommend habits only by default with the opt-in replay.
3. **Account without a profile document.** A brand-new Firebase account made on the web has no `users/{uid}` (ledger operations
   throw `not-found`). Kotlin's `ensureProfile` creates it (20 coins, 0 freezes), which the existing create rule allows. The web
   scoped writers don't permit a user-document `set` today, so this needs a new tightly-scoped write path (no rule change).
   Confirm that is acceptable.
4. **Ask again?** After "Start with my existing account", should the offer reappear on later sign-ins (Kotlin keeps guest data
   available for a later retry) or only from Settings?
5. **Purchase and milestone id handling** (section 4, items 3 and 4): confirm the migration-scoped ids.

---

## 12. Implementation plan once approved (for reference only)

1. `domain/guestMigration.ts`: pure planning (what to import, id mapping, reward id rewriting, preview model, verification
   comparison) with unit tests.
2. `services/guestMigrationRecord.ts`: the marker and step record in its own localStorage key.
3. `services/cloudMigration.ts`: a narrowly scoped writer (habits, completions, dayNotes, and the profile-create case), using the
   existing `cloudLedger` for any wallet replay, plus server-side verification reads.
4. UI: choice and preview sheet, progress and result dialogs, Settings entry. No Wallet redesign.
5. Tests: unit tests mirroring each Kotlin test above, a fake-Firestore interruption and retry suite, browser tests, and a live
   test on the dedicated test account only (never the main Android account).

## 13. What this audit did not do

No code was written or changed, no Kotlin or rules file was touched, no Firestore document was read or written, no guest data
was altered, and nothing was committed. The Kotlin tests were read, not run.

---

# Phase 10 implementation report

Implemented under the approved decisions. This section supersedes the earlier proposals where they differ.

## Approved decisions and where they landed

| Decision | Implementation |
|---|---|
| 1. Demo data is never guessed | The preview lists every guest habit, all **unticked**, with a warning that sample habits may be included. Only a habit that carries the explicit `dataOrigin: 'demo'` marker (new: seeded by `constants/mockData.ts`, kept by `appStorage.ts`, never written to the cloud) is labelled "Sample habit". Older saved habits have no marker and are not labelled. Nothing is imported unless the user ticks it and taps "Import selected". |
| 2. Habits and history only | Imported: name, colour, goal, reminder, weekly target, rest days, full schedule history, completions, notes, archived. **Not** imported: coins, wallet transactions, rewards, milestones, freezes, freeze usage. The import code contains no ledger code, and its backend is scoped to habit, completion and day-note documents. |
| 3. Profile creation | `ensureProfile` runs in one Firestore transaction (read, then create only if missing), with Kotlin's exact new-account fields. |
| 4. Reminder | Offered once per account; "Start with my existing account" is recorded and the prompt is never shown again; Settings has "Import guest habits" until the guest data has been imported. |
| 5. Stable migration-scoped ids | Cloud id `{guestId}-m{migrationId[0..8]}[-n]`, the original guest id kept in `migratedFrom`, the id map saved before the first write and never replaced. |

## Migration paths (all under `users/{uid}`)

| Path | Written by the import | Content |
|---|---|---|
| `habits/{guestId}-m{mig8}` | yes, once per habit (never rewritten on retry) | the habit as Android writes it (`habitCreateFields`) plus: full `scheduleHistory`, `completedDates`, `streak`, `bestStreak`, `createdAt` (creation day, local noon), `updatedAt` (server time), `archived: true` only when archived, `migratedFrom: "{migrationId}:{guestId}"` |
| `habits/{cloudId}/completions/{yyyy-MM-dd}` | yes, one per checked day | `date, completed: true, completedAt, updatedAt` (the day at local noon, so a rewrite is identical) |
| `dayNotes/{cloudId}_{yyyy-MM-dd}` | yes | `habitId` (the cloud id), `date`, `text` (trimmed, 1..200), `createdAt`, `updatedAt` |
| `users/{uid}` | **only if it does not exist** | see "Profile fields" |
| `walletTransactions`, `rewards`, `freezes`, `freezeMonths`, any wallet field | **never** | refused by the scoped backend, and by the test fake's rules mirror |

`migratedFrom` is the only migration metadata written, and it is the field Kotlin's protocol already writes.

## Profile fields (created only when `users/{uid}` is missing)

Matches `AppViewModel.loadUser` (AppViewModel.kt:449): `email`, `displayName` (the part of the email before `@`), `coins: 20`,
`freezesOwned: 0`, `welcomeFreezePending: true`, `isDark: true`, `createdAt` and `updatedAt` (server timestamps). The existing create
rule accepts exactly `coins == 20` and `freezesOwned == 0`. The marker is how the account's one free Streak Freeze is still granted
exactly once: the web's existing `ensureWelcomeFreeze` records it under the fixed id `welcome_freeze` and clears the marker. That is
the standard new-account grant, not an import of guest wallet data. An existing profile, including its balance, is never read for
changes, reset or overwritten.

## Protocol (Kotlin order)

1. **Prepare**: record created or reused (stable id, chosen habits), profile created only if missing, cloud ids fixed (checking the server
   for collisions: a doc with another `migratedFrom` is "taken" and the next id is tried) and saved.
2. **Upload** habits and completions in batches of 400. An already-uploaded habit ("ours") is not rewritten; only missing completions are
   added, so a retry can't overwrite what the user changed in the meantime.
3. **Notes** after the habits; notes already in the account are left as they are on a retry.
4. **Verify from the server** (`getDocFromServer` / `getDocsFromServer`): every habit exists with its `migratedFrom` and an equal schedule
   history, every completion date exists, every note exists.
5. **Complete** marker written only after verification. The guest data is never changed or deleted.

Recovery: the record per account (`consisto_guest_migration`) keeps the step, so an interrupted run is offered for resume, with the habits
chosen the first time and the same ids. A write that never answers is reported as offline after 30 seconds instead of hanging. A browser that
can't save the record stops before writing anything.

## Rewards: imported history cannot earn or remove them

Reward eligibility is derived from completions, so an imported day in the current month would otherwise pay a daily reward, and an imported
habit that was active but unchecked on a day would make the account reverse a reward it already holds. The web reward logic therefore takes
an `ignore(habitId, date)` rule: for an imported habit, every day **up to and including the import day** neither earns nor removes anything,
and milestones reached on those days pay nothing. From the next day on the habit counts normally. The set of imported habit ids is saved with
the migration record **before the first upload**, so no listener update can reward imported history in between. `planRewards`,
`eligibleRewards`, `dailyRewardEligible`, `milestonesReached` and the reconciler gained the optional rule; without it behaviour is unchanged.

## Remaining limitations

1. **Other devices.** The reward guard lives in this browser. Android (which this phase does not change) derives rewards from completions too,
   so it can pay the normal daily reward for imported days in the *current month*. Preventing that would need wallet or reward documents, which
   the decisions forbid. A second browser that did not run the import has the same exposure.
2. **Streak freezes are not imported**, so an imported habit's streak is recomputed without them and can be shorter than the guest's.
3. **The import day itself** does not count towards the daily reward for an imported habit (see above).
4. **One import per guest data set**, as in Kotlin: after a completed import, the remaining guest habits can't be imported later.
5. **Check-in times** are not known on the web, so completions carry the day at local noon, and `createdAt` is the creation day.
6. **New web accounts** only get a profile through this import (or Android). Creating it on every first sign-in is not part of this phase.
7. **Verification compares presence, not values**, for completions and notes, so an edit made in the account between attempts is never
   treated as a failure.
8. **Guest data stays on the device** after the import and is not hidden, so signing out and back in as a guest shows it as before.

---

# Phase 10 final verification (status: complete, awaiting approval)

## Results

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0, no errors |
| `npm test` (unit) | **25 files, 672 tests passed, 0 failed** (the Phase 10 suites are `guestMigration.test.ts`, 44 tests, and `importRewardGuard.test.ts`, 13 tests) |
| Browser suite (`npm run e2e`, port 8083, fresh server) | **687 passed, 0 failed** |
| Live Firebase | **not run** (no credentials were supplied, and no live writes were made in this verification) |

Run history, stated plainly: five browser runs did not finish green before the final one.
- Runs 1 and 5 stopped at an old login-screen check because the page-text helper threw while the page was navigating. That is a test-harness race, not an application bug; the helper now treats that instant as "not there yet".
- Run 2 ran against a stale development server that did not contain the new code (and under CPU load from other commands), so its Phase 10 failures were not real.
- Run 3 failed 10 checks: the habit rows exposed no `aria-checked` attribute (an **application accessibility bug, fixed**: the rows now set it like the other toggles), plus two wrong test expectations (a key search that also matched another account's earlier import, and a sign-in name that was not registered) and what followed from them.
- Run 4 failed one check that expected three habits on Home while Home hides archived habits (**wrong test expectation, fixed**).
- The final run changed nothing in the app and passed completely.

## Safety review (each item with its evidence)

| Requirement | Verified by |
|---|---|
| Demo habits are never imported automatically | The preview ticks nothing and `guestPreview` has no selection. Unit tests: "nothing is guessed or selected", "refuses an empty selection". Browser: "NO habit is ticked by default", the button is disabled until a tick, and the unticked `SQL Practice` (the explicit demo marker) was never written. |
| The user explicitly selects habits | Unit: "imports only the selected habits". Browser: tick, untick, select all, clear, and "the unticked habits are absent". |
| Stable migration ids survive retries | The id map is saved once before the first write and never replaced. Unit: "ids are identical on every retry", "a retry keeps the habits chosen the first time". Browser: the same ids before and after a failed run and a resume. |
| History and notes are preserved | Unit: schedule history, completions, notes, archived, goal, reminder, colour. Browser: habit fields, 9 completions, the note under `{cloudId}_{date}`, the archived habit. |
| Existing cloud data is not overwritten | An "ours" habit is not rewritten on retry, only missing completions and notes are added (unit: a rename made in the account survives, exactly the missing 51 writes happen). A taken id gets the next free id (unit). Another browser's import is untouched. |
| Guest data is never deleted or changed | The importer only reads a snapshot. Unit tests compare the data byte for byte after success and after failure. Browser compares `consisto_app_data` after every scenario. |
| Guest wallet balances are never imported | There is no wallet code in the import, and the scoped backend refuses wallet paths (unit). In the browser the account's wallet, last transaction and reward records are unchanged after each import. |
| The Firebase wallet is unchanged | Unit: snapshot comparison of the profile and every ledger collection. Browser: 31 coins, the same last transaction, 0 ledger runs, 11 reward records all still active. |
| Imported completions cannot create duplicate or reversed rewards **in the Web app** | `importRewardGuard.test.ts`. Browser: imported days 1-9 Nov earned nothing and the account's 10-20 Nov rewards were not reversed. |
| Profile creation follows Kotlin | The fields equal `AppViewModel.loadUser` (AppViewModel.kt:449). It is created once, in a transaction, and only when missing; an existing profile is never changed. The browser shows exactly one profile creation and then the standard welcome freeze. |
| Interrupted migrations resume safely | Unit: failure at each stage, resume without duplicates, the record is kept after upload starts and forgotten before. Browser: failure, "Not now", reload, resume prompt, same ids. |
| Server verification before completion | Verification reads with `getDocFromServer` / `getDocsFromServer`, and the completion marker is written only afterwards. Unit: a document that is not readable fails the import, nothing is marked complete, and the retry succeeds. |

Findings from the review:
1. **Verification checks presence, not values**, for completions and notes. This is deliberate, so an edit made in the account between attempts is not a failure. A completion that exists with different content would pass.
2. **The reward guard and the migration record live in this browser only** (see the next section).
3. Every write passes through `scopedMigrationBackend`, which accepts only habit, completion and day-note documents plus the profile creation.

## Cross-platform reward protection: analysis and recommendation (not implemented)

**What Android does** (RewardRules.kt, AppViewModel.reconcileRewards): new rewards are evaluated only for the current month (`rewardWindowStart(today)`). A day pays when every habit that is active that day is completed. A reward in effect is reversed when its day stops qualifying. A milestone pays when the streak's n-th counted day falls in the window. Android has no notion of an imported habit.

**Two exposures on Android after an import (the second is the more serious):**
1. *Grants:* imported completions in the current month can pay daily or milestone rewards that nobody earned on the account (when the imported habit is the only active one that day, or the other habits were completed too).
2. *Reversals:* an imported habit is "active" on every day since its `createdDate`. If it was **unchecked** on a day in the current month on which the account already holds a paid reward, Android sees the day as no longer qualifying and **reverses** that reward, which reduces coins or becomes a pending adjustment. This happens **even if no current-month completion was imported**. The Web guard prevents both exposures on the Web only.

**Recommended solution (needs your approval, because it adds one optional field and a small Android change):** a per-habit migration field `rewardsFrom` (a date), written next to `migratedFrom`, the metadata the Kotlin protocol already uses. Meaning: for that habit, days before `rewardsFrom` neither earn nor remove rewards. The Web already implements exactly this rule locally (`importRewardIgnore`); the change makes it travel with the data.
- Web: write `rewardsFrom = import day + 1` on each imported habit, and read it from the habit instead of the local record. This also fixes the second-browser case.
- Android (a later, separately approved Kotlin task): in `RewardRules`, treat `(habit, day)` with `day < rewardsFrom` as ignored in `dailyRewardEligible`, `milestonesReached` and the reversal candidates, like the Web `ignore` argument. No rules change and no wallet change; reward ids and amounts are unchanged, so duplicates and reversals are impossible by construction.
- Rollout order: Android release first, then the Web starts writing the field. Until a user's Android has the change, older builds behave as they do today.

**Interim options with no schema change and no Kotlin change** (they reduce the exposure but do not remove it; only the field above does):
- Import only completions dated **before the first day of the current month** (outside every reward window on both platforms), and show the current-month days in the preview as "added after the month ends". They could be imported from Settings on or after the 1st, with the same migration id, adding only missing completions. This removes the grant exposure (1) for those days.
- Offer the import only when the account has no reward in effect in the current month (a clear message otherwise). This removes the reversal exposure (2), because there is nothing to reverse.
- I do not recommend moving the imported habit's `createdDate` forward to avoid (2): it makes the stored creation date untrue and affects calendar and weekly statistics.

## Live Firebase tests (`tests/live/guestMigration.live.ts`): what they do

They are skipped unless `LIVE_TEST_EMAIL` and `LIVE_TEST_PASSWORD` are set (all 4 tests report as skipped; the whole live suite shows 22 skipped). Never run them against the main Android account; use a dedicated test account.

| Question | Answer |
|---|---|
| Profile created? | **No.** The test account must already have a profile. One test asserts that `ensureProfile` returns `exists` and leaves the document identical. Profile creation is covered by unit and browser tests, not live. |
| Documents created | Habit documents `habits/live-1-m{migrationId8}` and `habits/live-2-m{migrationId8}` (first import) and one more `habits/live-1-m{other8}` (second "browser"). Their completion documents (3 + 1 + 3 = 7, all dated June 2015). Two day notes (`{id}_2015-06-03`). All carry `migratedFrom`. The dates are in 2015, so no device's reward window can see them. |
| Imported content | Names "Live Test Habit A" and "Live Test Habit B (archived)", a two-period schedule history, rest days, an archived flag. |
| Wallet changes | **None.** The wallet (coins, freezes, pending, last transaction id, every ledger entry, every reward record) is read before and after each import and must be identical. |
| Other writes | One deliberately denied write to a foreign account path (the rules must refuse it; nothing is written). |
| Cleanup | `afterAll` deletes every habit, each habit's completions, and the notes of those habits, then signs out. The wallet never needs cleaning. If a run is aborted before cleanup, delete the habits named "Live Test Habit A" / "Live Test Habit B (archived)" in the app (Delete Habit removes their completions and notes too), or filter `habits` by `migratedFrom` ending `:live-1` / `:live-2`. |
| Status | **Not run in this verification** (no credentials were provided and no live writes were performed). |

## Remaining known limitations and production risks

1. **Android can still pay or reverse rewards for imported history** until the field above exists on both platforms. The reversal case can reduce an account's coins. This is the highest-priority risk. Until it is resolved, importing into an account that already has rewards this month is the risky case.
2. The Web guard and the migration record are per browser: a second browser that did not run the import is exposed like Android.
3. Imported streaks are computed without the guest's freezes and can be shorter than the guest saw.
4. One import per guest data set; the remaining guest habits cannot be imported afterwards.
5. A new web account only gets a profile through the import (or Android): signing in on the web alone still creates nothing.
6. Check-in times are not known on the web, so completions carry the day at local noon.
7. The live tests have not been run against real Firebase. The rules and the real SDK behaviour (batches, server reads, the profile transaction) are therefore verified only through the fakes and the rules text, not yet end to end.
8. A very large guest history is written in batches of 400. A batch is atomic, and an interrupted run resumes from the next missing document.
9. The browser suite needs a fresh development server: a server started earlier in CI mode does not pick up code changes.

---

# Phase 10.1: cross-platform imported-reward protection (status: implemented and verified on both platforms; awaiting approval)

## What was added

One optional field on an imported habit document: **`rewardsIgnoredThrough`**, a `yyyy-MM-dd` date equal to the import date (the migration record's `through`, so a retry writes the same value, also on a later day). It is written only by the guest import, on the habit document only (never on completions or notes), and never on a habit that was not imported.

**Rule (identical on both platforms):** for an imported habit, days up to and including `rewardsIgnoredThrough` take no part in reward decisions. From the next day on the habit counts normally. A habit without the field behaves exactly as before.
- *Daily rewards:* the habit is removed from the day entirely. It cannot complete the day and it cannot block it. A day is decided only by the habits that still count, so an imported habit that was active but unchecked can no longer make an earned daily reward ineligible (which is what caused reversals).
- *Milestones:* a milestone whose n-th counted day is on or before the cutoff pays nothing. A milestone reached after the cutoff (the user keeps the streak going) pays as usual. A milestone record that already exists keeps its id and amount.
- *Streaks, calendar, freezes, notes and statistics* are untouched: only the reward rules read the field.

## Files changed

Android (Kotlin, in `android/app/src/main/java/com/habittracker/app/`):
- `data/RewardRules.kt`: `HabitSchedule` gets an optional `rewardsIgnoredThrough: LocalDate? = null` (a trailing default parameter, so every existing call compiles unchanged), `countsForRewards(date)`, and the two reward rules (`dailyRewardEligible`, `milestonesReached`) use it.
- `data/HabitRecordParsing.kt`: reads the field (missing, blank, malformed or non-text reads as null) and passes it to `toSchedule`.
- `AppViewModel.kt`: `Habit` gets `rewardsIgnoredThrough: String? = null` (trailing default), `habitFrom` reads it, `Habit.schedule()` passes it to the rules.
- New test: `app/src/test/java/com/habittracker/app/data/ImportedRewardProtectionTest.kt` (12 tests).
No other Kotlin file, no screen, no Firestore rule and no wallet code was touched.

Web (`web/`):
- `types/habit.ts`, `domain/cloudMapping.ts` (reads the field), `domain/schedule.ts` (`HabitSchedule.rewardsIgnoredThrough`, `countsForRewards`), `domain/rewards.ts`, `domain/ledger.ts`, `services/cloudRewards.ts`: the reward rules now read the field from the habit. The per-call `ignore` argument and the device-local reward baseline from Phase 10 were removed (`importRewardIgnore`, `rewardBaseline`, and their use in `store/AppStore.tsx`), so the field in the document is the single source of truth. This also fixes the "second browser" limitation.
- `domain/guestImport.ts`: writes `rewardsIgnoredThrough = through` on each imported habit.
- `services/guestMigrationStore.ts`: comment only (the date is fixed by the record).
- New `services/guestImportFlag.ts` and `components/migration/GuestImportFlow.tsx`: the rollout gate (below).
- Tests: `tests/importRewardGuard.test.ts` (rewritten for the field), `tests/guestMigration.test.ts` (+2), `scripts/e2e-dashboard.mjs` (+1 check).

## Rollout gate (required: do not enable for production users before both platforms understand the field)

The import is **off in production builds**. `guestImportEnabled()` is true in development builds and in tests, and in a production build only when `EXPO_PUBLIC_GUEST_IMPORT_ENABLED=true` is set at build time. When it is off, neither the automatic offer nor the Settings entry appears. The Web importer code is otherwise unchanged.

Required order:
1. Ship the Android release that contains this change (it reads `rewardsIgnoredThrough` and is backward compatible: older documents without the field behave as before, and an older Android that ignores the field simply keeps today's behaviour).
2. Only after that release is the build users run (and after a reasonable adoption period), build the Web with `EXPO_PUBLIC_GUEST_IMPORT_ENABLED=true`.
3. An account that imported before step 1 with an old Android build installed has the same exposure as before (see "Remaining risks").

## Compatibility notes
- Backward compatible both ways: the field is optional, ignored by older code, and absent on every existing document. No collection structure, wallet field, reward id or reward amount changed, and no Firestore rule was changed (the existing habit rule already allows the write).
- Kotlin deserialization is tolerant: a missing, blank, non-text or malformed value reads as "no cutoff".
- The field is a plain string date, the same format as `createdDate`, so both platforms parse it with their existing date parsers.
- Nothing is rewritten retroactively: no reward is created or reversed by the field itself, and non-imported habits are never rewritten.

## Test status (be precise)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| Web unit tests (`npm test`) | **25 files, 677 tests passed** (includes 15 in `importRewardGuard.test.ts` and 2 new migration tests) |
| **Kotlin unit tests** (`gradlew testDebugUnitTest --offline`) | **BUILD SUCCESSFUL: 36 suites, 379 tests, 0 failures, 0 errors, 0 skipped**, including the 12 new tests in `ImportedRewardProtectionTest`. The first three attempts crashed with a JVM out-of-memory error (see "The blocker", now resolved); the fourth, run after the Expo dev servers were closed and with `--no-daemon`, `-Xmx1024m` and one worker, completed in 3m 24s. |
| **Browser suite** (fresh server, port 8083) | **688 passed, 0 failed**, including the new check that the imported habit carries `rewardsIgnoredThrough = 2026-11-21` and that completions and notes do not. |
| Live Firebase | not run (no credentials, and no live writes) |

## The blocker (resolved)

Resolved: the three Expo dev servers I had started were closed at the user's request, which freed about 1.5 GB of commit, and the Kotlin run then completed. The description below is kept because the same limit will recur on this machine.

The Windows commit limit is almost used up: about **31.2 GB committed of a 32.6 GB limit** (8 GB RAM plus a 24 GB page file on D:), with 0.7 to 0.9 GB of RAM free. The large users are not mine: about 8.5 GB in 42 VS Code processes, 4.4 GB in 10 Java processes (mostly the Red Hat Java language server in VS Code), 3.7 GB in Brave, and about 2 GB in Node processes. Three of those Node processes are the Expo dev servers I started (ports 8081, 8082, 8083). Gradle plus the Android unit-test JVM needs about 1.5 GB more than is available. An attempt to stop my own dev servers to free memory was refused by the permission system, and I did not work around that.

To unblock, any one of these is enough: (a) close the VS Code Java language server (or the Java extension) and a few Brave tabs, then I run the Kotlin tests once; (b) allow me to stop my three Expo dev servers (or stop them yourself), then I run Kotlin, then start one fresh server for the browser suite; (c) run `gradlew testDebugUnitTest --offline` yourself from `android/` when memory is free and send me the result.

## Remaining risks

1. **Kotlin verified by the unit tests only.** The Android change compiles and all 379 unit tests pass, but it has not been run on a device or against real Firestore data. A test on a device with an imported habit document (and an older build for comparison) should come before the Android release.
2. **Older Android builds** do not read the field. Until the Android release is the build in use, importing into an account with rewards in the current month can still pay or reverse rewards on those builds. The rollout gate exists for this reason.
3. **The import date is the cutoff.** On that day itself an imported habit does not count towards the daily reward (even if the user checks it after importing). This is the approved behaviour ("through and including").
4. **Streaks of imported habits** are computed without the guest's freezes and can be shorter than the guest saw (unchanged from Phase 10).
5. **Check-in times** are the day at local noon (unchanged).
6. The live Firebase tests have still not been run.
