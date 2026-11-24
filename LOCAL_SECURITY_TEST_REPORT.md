# Phase 11C.3: complete local security testing (report)

Status: **local testing complete. Nothing was published, deployed or committed. No production Firebase configuration, credential or data was touched. No Kotlin file was modified.** The only new file besides this report is `tests/rules/crossclient.rules.ts`.

## 1. Emulator setup (what was inspected)
| Item | Finding |
|---|---|
| `firebase/emulator.json` | Firestore emulator on **127.0.0.1:8089**, UI off. No Auth emulator is configured (see section 6). |
| `npm run test:rules` | `firebase-tools@15.37.0 emulators:exec --only firestore --project demo-consisto --config firebase/emulator.json`. |
| Project ids in tests | Every test environment uses a **`demo-consisto-*`** id. A `demo-` project can only exist in the emulator; the SDK cannot reach production with it. The rules tests are skipped unless `FIRESTORE_EMULATOR_HOST` is set. |
| Production configuration | `firebase.json` is hosting only (no rules deployment target); `.firebaserc` default is `habbit-tracker-12` but `emulators:exec` is given `--project demo-consisto`, so it is not used. `.env.local` and `android/app/google-services.json` were not read, changed or used by any test. |
| Network | The emulator listens on loopback only; the rules tests use no credentials. |

## 1b. Production-isolation check (re-verified)
- `habbit-tracker` appears in **no** rules test, `vitest.rules.config.ts` or `firebase/emulator.json` (0 matches).
- Every emulator test uses a `demo-consisto-*` project id (cross, rollback, load, legacy, seed, main). Each rules test file is skipped unless `FIRESTORE_EMULATOR_HOST` is set, which only `emulators:exec` sets (127.0.0.1:8089).
- The scripts that can reach a real project are **not** part of any test command, and each needs an explicit opt-in: `audit-existing-data.mjs` (read-only, needs `--project` and `--yes`), `seed-staging-data.mjs` (refuses any project id containing "habbit-tracker", needs `--yes`) and `test:live` (needs `LIVE_TEST_EMAIL` and `LIVE_TEST_PASSWORD`). None was run in this phase.
- `npm test`, `test:rules`, the browser suite (no account or Firestore request to the real project in the import tests) and the build never publish rules or deploy functions; `firebase.json` is hosting-only (checked by `verify:build`).
## 2. Rule generation
`npm run build:rules -- --check` (`node scripts/build-rules.mjs --check`): **up to date** (exit 0). `tests/rulesBuild.test.ts` (in the unit tests) also fails if a committed file is stale, and checks the structure: Part A has no habit/completion/note validation; Part B has no wallet change; combined has both; none keeps the open catch-all.

## 3. Test totals (run sequentially, nothing heavy in parallel)
| # | Suite | Result |
|---|---|---|
| 1 | TypeScript `tsc --noEmit` | **0 errors** |
| 2 | Unit tests (`npm test`) | **749 passed, 30 files** |
| 3 | Firestore emulator rules tests (`npm run test:rules`) | **309 passed, 4 files** (was 295; +14 new in `crossclient.rules.ts`) |
| 4 | Android (Kotlin) unit tests, forced re-run (`cleanTestDebugUnitTest testDebugUnitTest`, `--no-daemon --max-workers=1 -Xmx1024m`) | **379 passed, 0 failed, 0 skipped** |
| 5 | Browser tests (`scripts/e2e-dashboard.mjs`) | **688 passed, 0 failed** (against the dev server on port 8084). Note: an earlier run of the same suite ended **685 passed, 3 failed**; I did not capture which checks failed, and an immediate full re-run passed all 688. I suspect timing under memory pressure but have not proven it, so treat it as an unexplained flake |
| 6 | Production web build and its checks | **passed**: `build:web`, `verify:build` ("All production checks passed") and `verify:csp` (CSP enforced; hosting config works with the build) |

## 4. Result per rule set (emulator, `npm run test:rules`)
| Rule set | Android + Web shapes, abuse, cross-client, duplicates | Stored (legacy) data | Staging seed | Total | Fails |
|---|---|---|---|---|---|
| Rules in force (`android/firestore.rules`) | 38 + 3 | 34 | 2 | **77** | 0 |
| **Part A** (`firebase/firestore.rules`) | 38 + 3 | 34 | 2 | **77** | 0 |
| Part B (`firebase/rules/part-b.rules`) | 38 + 3 | 33 | 2 | **76** | 0 |
| A + B (`firebase/rules/combined.rules`) | 38 + 3 | 33 | 2 | **76** | 0 |
| Rule-independent plan test + rollback (2) | | | 1 | 3 | 0 |
| **Total** | | | | **309** | **0** |

Test expectations differ per set on purpose (for example "refuses a free freeze" is asserted for Part A and A+B, and "accepts it" for the rules in force and Part B). A pass means each set behaved exactly as designed.

## 5. What was tested, by your list

### 5.1 Legitimate operations (every one passes under all four sets, including Part A)
Profile creation (Android `loadUser`, the guest migration, the Web transaction); the welcome freeze and its marker; habit create, edit, reorder, archive and unarchive, delete with completions; completion and undo (batch with `arrayUnion`/`arrayRemove`); notes (merge, with and without `createdAt`, delete); every ledger entry type (daily, milestone, reversal, restore, partial grant into pending, reversal that becomes pending, purchase at 20, application on a current **and on an old date**); month counters; Android's full account-deletion flow; and the real Web code (`createCloudLedger`, `habitCreateFields`, `planImport`). **Authentication** is only simulated: the emulator tests use `authenticatedContext(uid)` (there is no Auth emulator; see section 6).

### 5.2 Invalid operations (Part A refuses; where it matters the rules in force accept)
Forged coin rewards (unknown type, daily worth 20, invented reward amount); free or cheap freeze purchases (0, 1, 19 coins; invented +1 entry); two freezes for one price; freeze balance manipulation (negative balance); freeze application without owning one; **duplicate freeze application** (the same entry replayed, and the same habit and day under a new entry id: both refused by every set); month counter skipped, jumping by 2, going backwards, a fourth freeze in a month; erasing a pending adjustment; moving `lastTransactionId` on its own; replaying, editing or deleting a ledger entry; another user or a signed-out client reading or writing anything; invalid wallet documents (extra field on an entry, fractional coins, string coins, a freeze record whose month does not match its date); profile with extra fields or an unknown field; a new `todos` document; nested paths under a habit.

### 5.3 Business logic, tested separately in the application (unit tests, not by the rules)
These checks run in the app code (and so protect only honest clients). The rules do **not** enforce them.
| Business rule | Where it is tested | Result |
|---|---|---|
| Three-day freeze recovery window | `tests/freeze.test.ts` (27 tests, including "the window is yesterday through three days ago, inclusive", "older than the window is not eligible", and back-filled habits) | passed |
| Daily reward eligibility, milestone rewards, reversals, restores, pending adjustments, duplicate-reward prevention | `tests/rewards.test.ts` (30), `tests/ledger.test.ts` (38), `tests/cloudRewardsSync.test.ts` (26), `tests/walletOps.test.ts` | passed |
| Imported history ignored through `rewardsIgnoredThrough` (daily and milestones, boundary date, Web and Kotlin `ImportedRewardProtectionTest`) | `tests/importRewardGuard.test.ts` (15), `ImportedRewardProtectionTest.kt` | passed |

Targeted re-run of those five Web files: 136 passed. **The Firestore rules do not enforce the 3-day window, whether a reward was earned, or rewardsIgnoredThrough** (the rules cannot read completions or count documents; Android's guest import also replays old freeze dates, which a date window would break). A test pins that an old-dated freeze is accepted by every rule set.

### 5.4 Freeze recovery-window results
Application-level: enforced and tested (above). Rules level: **deliberately not enforced**. What the rules do enforce around a freeze: it must remove exactly one owned freeze, create its freeze record and bump the month counter by one in the same commit, never go above 3 per month, and never be duplicated.

## 6. Cross-platform emulator results
| Client | Can it connect to the emulator safely? | What was done |
|---|---|---|
| **Android** | **No.** There is no emulator configuration anywhere in the Kotlin app (no `useEmulator`, no `10.0.2.2`), and adding it needs a code change in Kotlin, which is not approved. | Its **exact write payloads** (`FirestoreLedgerTxn.commit` field by field, profile creation, habits, completions, notes, the guest-migration upload, account deletion) are replayed through the emulator rules tests. **Limitation: this proves the payload shapes, not the real app binary.** |
| **Web** | **Not done.** The Web app has no emulator switch and no Auth emulator is configured. Adding a development flag to `services/firebase.ts` would put a switch that redirects Firebase traffic into the shipped code path; I judged that not worth the risk without your approval. | The real Web code (`createCloudLedger`, `habitCreateFields`, `habitWriter` field shapes, the guest-import planner) runs against the emulator rules. **Limitation: the real browser UI against the emulator was not exercised.** |
| Cross-client visibility | Yes, at the data level | New tests use two separate Firestore client instances for the same user on one emulator database, under all four rule sets: an Android-shaped freeze purchase is read by the Web client (wallet, ledger entry); the Web's real ledger applies that freeze and Android reads the freeze record, month counter and wallet; the Web grants a daily reward and an Android-shaped reversal changes the balance the Web reads. All pass. |

## 7. Rollback results
- **Same database, rule sets loaded in turn:** current, A, B, A+B, current, A. Each load behaved exactly as that rule set says: the forged free freeze was accepted, refused, accepted, refused, accepted, refused; the invalid habit accepted, accepted, refused, refused, accepted, accepted; an honest write worked after every switch; another user stayed locked out every time. Passed.
- **Each rule file loads on its own** (current, A, B, A+B): passed.
- **Generated files match their source:** `build:rules --check` and `rulesBuild.test.ts` pass.
- **Real rollback in the Console** (publishing the previous rules in one click) was **not tested**, because it needs a real project. Procedure and prerequisites are in `STAGING_SETUP.md` and `ANDROID_SMOKE_TEST_PLAN.md`; keep a copy of `android/firestore.rules` outside the Console.

## 8. Remaining risks
1. Earning is not verified by any rule (a signed-in user can still claim "+1 for a date" within the shape limits); fixing it needs a server. Low impact: coins are virtual.
2. The 3-day freeze window is app-enforced only.
3. The owner can still set `deletionRequested` (Android's deletion does it).
4. Part B re-validates whole documents and the real production habits, completions and notes **have not been inspected** (the Console queries in `RULES_CONSOLE_INSPECTION.md` are still to do). Part B is not a candidate.
5. A freeze purchase at the old price of 10 is refused by Part A (a guest database from an old app version holding one would fail to import on Android).
6. **Not tested against the real binaries:** neither the Android app nor the Web UI ran against the emulator; and nothing ran against a real Firebase project (the staging plan was dropped by your decision). Real Firestore can differ from the emulator in rare cases (for example rules evaluation limits on very large documents).
7. App Check cannot be enforced while Android has none.
8. No document counts can be enforced by rules.
9. Authentication flows (sign-up, sign-in, re-authentication for account deletion) were not tested against an Auth emulator; the rules tests assume a signed-in uid.

## 9. Production publication recommendation
- **Part A: technically ready from the rules side** (309 emulator tests, 749 unit tests, 379 Android tests, all green; it never re-checks stored habits, completions or notes, so existing data cannot make an ordinary update fail). **Not yet proven against the real Android app.** Recommendation, only if you accept that residual risk: publish Part A at a quiet time, with the previous rules text saved and the Console's previous-version rollback ready; first run the Android matrix steps 1 to 10 once with a brand-new test account (it takes about 15 minutes) and watch the Rules monitor for denied requests; roll back at once if denials rise. The least risky option remains a short-lived real-project check; I have not done any of this and I will not publish.
- **Part B: do not publish yet.** First the Console data inspection.
- Nothing has been published, deployed or committed.

## 10. Files
Added: `tests/rules/crossclient.rules.ts`, this report. Everything else is unchanged from Phase 11C.2.


