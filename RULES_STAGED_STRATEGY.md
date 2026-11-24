# Phase 11C.2: staged Firestore security rules (Part A and Part B)

Status: **prepared and tested in the local emulator. Nothing is published, nothing was committed, no production data or credential was touched, no Kotlin file was modified, App Check is not enforced, no function was deployed.** I did not create the staging project and did not run anything against Firebase.

## 1. The three rule sets

| Rule set | File | What it is |
|---|---|---|
| **Part A: wallet integrity** | `firebase/firestore.rules` | The rules in force plus **only** the wallet, profile and path changes below. **The production deployment candidate.** |
| **Part B: habit and document validation** | `firebase/rules/part-b.rules` | The rules in force plus **only** the habit, completion and note validation. Wallet rules left exactly as in force. **Not a candidate yet.** |
| **A + B combined** | `firebase/rules/combined.rules` | The eventual end state. |
| Rules in force (the baseline) | `android/firestore.rules` | Unchanged. |

Rules have no include mechanism, so the three files are **generated** from shared pieces by `npm run build:rules` (`scripts/build-rules.mjs`). `tests/rulesBuild.test.ts` fails if a committed file is stale and checks the structure: Part A contains no habit, completion or note validation; Part B contains no wallet change; the combined set holds both; ownership and `feedback` are untouched in all three; none keeps the open `{rest=**}` catch-all.

### Part A: what it changes (it judges only NEW writes, or the keys an update CHANGES; it never re-checks a stored habit, completion or note)
| Area | Change |
|---|---|
| Ledger entries | Only the known keys; integer amounts; a known `type` with its id pattern and amounts: `daily_completion` (+1, counting pending), `streak_milestone` (5, 10 or 20), `reward_restored`, `reward_reversal`, `welcome_freeze` (once, +1 freeze, 0 coins), `freeze_purchase` (**exactly -20 coins**, +1 freeze), `freeze_application` (0 coins, **-1 freeze**, its freeze record in the same commit) |
| Reward records | Known fields; `cycle` an integer of at least 1; `amount` in {1, 5, 10, 20}; `type` in {`daily_completion`, `streak_milestone`} |
| Freeze records | Known fields; `yyyy-MM-dd` date; `month == date[0:7]`; and the **month counter must go up by exactly one in the same commit** |
| Month counters | The id must be `YYYY-MM` (count: previous + 1, at most 3, as before) |
| Pending adjustment | Only grants and reversals may change it, each by the amount tied to its entry, so it **cannot be erased** with an invented entry; the transaction pointer `lastTransactionId` cannot move without its entry |
| Profile | An update may only change the wallet fields, the welcome marker, the deletion marker, and `displayName`, `email`, `isDark`; a new profile has exactly Android's eight fields and 20 coins |
| Paths | Nothing can be created below a habit except `completions` (the catch-all that allowed any nested path is gone); `todos` can no longer be written (still readable and deletable, which Android's account deletion needs) |

### Part B: what it changes (it re-validates the WHOLE resulting document on every write, so it needs the data inspection)
Habits (field types and bounds: name 1 to 1,000 characters, goal and why up to 1,000, weekly target an integer 1 to 7, at most 7 rest days, `createdDate` yyyy-MM-dd, at most 20,000 `completedDates`, at most 2,000 `scheduleHistory` periods, at most 40 fields, booleans, reminder `HH:mm` or null, numbers for streaks and colour); completions (date id, known fields, `date` equal to the id); day notes (date format, known fields, text 1 to 200). **Collection limits are not supported by rules** (they cannot count documents): the Web app enforces 200 habits; the field, list and string bounds above are the document-size limits.

## 2. Your Part A requirements, one by one
| Requirement | Result |
|---|---|
| Wallet transaction structure | Done (entry shape per type) |
| Reward records | Done |
| Freeze purchases: no free ones; the existing 20-coin rule | Done: a purchase must cost **exactly 20** and give exactly one freeze (0 coins, 1 coin or two freezes for one price are all refused) |
| Freeze applications: owned-freeze requirement | Done: an application must remove exactly one freeze (the existing balance rule forbids going below zero, so none owned means refused) |
| Monthly application limit | Done: the counter must rise by one with each freeze and stay at most 3 |
| Pending adjustment protection | Done (see above) |
| Profile wallet fields | Done |
| Unknown paths under protected collections | Done (nested paths under habits; `todos`; nothing nested under the ledger or the profile) |
| Preserve the current Kotlin and Web write shapes | Done: every Android write site and the real Web ledger, habit writer and import planner pass under all four rule sets |
| **The three-day recovery window "where supported by the rules"** | **Not supported, deliberately.** Android's guest import replays a freeze through the same write with its **original (old) date**, so a date window would break a current Android feature. The window stays enforced by the apps (and a future server). A test pins that an old-dated freeze is accepted. |
| Preserve legit existing formats | One deliberate narrowing: **the earlier freeze price of 10 is no longer accepted** (only older versions wrote it, and you confirmed none are in use). Consequence: a guest database that contains a price-10 purchase would fail to import on Android. |
| Part A must not revalidate habit documents | Proven: see section 4 |

## 3. Tests (emulator, `npm run test:rules`; all 295 pass)

Four rule sets are tested independently, each against the same suites:

| Rule set | Android + Web shapes and abuse | Stored (legacy) data | Staging seed | Total |
|---|---|---|---|---|
| Rules in force | 38 passed | 34 passed | 2 passed | 74 |
| **Part A** | 38 passed | 34 passed | 2 passed | 74 |
| **Part B** | 38 passed | 33 passed | 2 passed | 73 |
| **A + B** | 38 passed | 33 passed | 2 passed | 73 |
| Synthetic plan (rule-independent) | | | 1 passed | 1 |

Plus the unit tests: **749 passed** (30 files), TypeScript **no errors**, generator check **up to date**. The browser suite was not re-run: no application code changed in this phase.

### Who refuses what (the abuse cases)
| Case | In force | Part A | Part B | A + B |
|---|---|---|---|---|
| Mint coins (unknown type, daily worth 20, invented reward amount) | accepts | **refuses** | accepts | **refuses** |
| Free freeze (0 coins, 1 coin, an invented +1 entry) | accepts | **refuses** | accepts | **refuses** |
| Freeze applied with none owned; freeze without its month counter | accepts | **refuses** | accepts | **refuses** |
| Counter that jumps or goes backwards; a fourth freeze in a month; negative balances; replaying or editing an entry | refuses | refuses | refuses | refuses |
| Erasing a pending adjustment; moving the pointer alone | accepts | **refuses** | accepts | **refuses** |
| Profile with extra fields; unknown profile field on update; a new `todos` document | accepts | **refuses** | accepts | **refuses** |
| Nested path under a habit | accepts | **refuses** | **refuses** | **refuses** |
| Invalid habit (huge name, weekly target 0 or 9, 8 rest days, bad date, 20,001 dates) | accepts | accepts | **refuses** | **refuses** |
| Completion with a wrong id, another date field, extra fields; note with extra fields or a bad date | accepts | accepts | **refuses** | **refuses** |
| Another user or a signed-out client: any read, write, delete or list | refuses | refuses | refuses | refuses |
| `deletionRequested` set by the owner (**known limitation**); cleared; wallet change after it is set | accepts / refuses / refuses | same | same | same |
Each part does its own job and not the other's; the baseline accepts what the audit found.

### Android and Web compatibility
Under **all four** rule sets: every Android write shape from the Kotlin source (profile creation as `loadUser` and as the guest migration; the welcome freeze and its marker; habit create, edit, check, uncheck, reorder, delete with completions; notes with and without `createdAt`; every ledger entry type including partial grants into pending and reversals that become pending; a freeze applied to an **old date**; the migrated-habit upload; **Android's full account-deletion flow**) and every Web shape (the real `createCloudLedger`, `habitCreateFields`, the guest import's `planImport` output, the profile transaction) is accepted. The one exception is by design: a purchase at 10 is refused by Part A and accepted by the others (section 2).

### Part A does not reject existing valid habit updates
`tests/rules/legacy.rules.ts` seeds 14 stored habit shapes (a minimal legacy habit; no `createdDate`; a 300-character name; a name exactly at the Part B bound; five years of legacy completed dates; extra unknown fields; null reminder; plus six RISK PROBES that break a Part B bound) and performs Android's check-in update and reorder on each. **Under the rules in force and under Part A every one succeeds**, including the probes; **only under Part B and A + B do the probes fail**, exactly where the data scanner's checker predicts. The same holds for 6 stored completion shapes and 3 stored note shapes, and for 3 old profile shapes (updates are judged on the keys they change).

## 4. Production inspection and staging
- **Production data inspection:** `RULES_CONSOLE_INSPECTION.md`: exact Query builder steps (collection-group queries) for habits, completions, day notes, wallet transactions, rewards, freezes, month counters and profiles; what a clean answer is; what cannot be queried (name length, list sizes, unknown fields: sample by hand or use the scanner); a result table that holds counts and field names only. Part A does not depend on it; Part B does.
- **Staging:** `STAGING_SETUP.md`: creating the staging project (you do it), registering the Android app (a debug-only `google-services.json`) and the Web app (shell environment variables, `.env.local` untouched), importing synthetic data (`npm run seed:staging -- --yes`; refuses production; tested against all four rule sets), publishing the rules to staging through the Console, the Android matrix (`ANDROID_SMOKE_TEST_PLAN.md`), eleven Web smoke tests, a rollback check, clean-up.

## 5. Remaining security limitations
1. **Earning is not verified.** No rule can prove a reward was earned; a determined signed-in user can still claim "+1 for a date" (and 5, 10 or 20 per milestone id) up to the shape limits. Needs a server (`CLOUD_FUNCTIONS_PROPOSAL.md`). Low impact: coins are virtual.
2. **The 3-day freeze window is not enforced by rules** (Android's guest import replays old dates). Apps enforce it.
3. **The owner can set `deletionRequested`** (Android's deletion does it from the client), which opens ledger deletion and a wallet reset. Needs a backend (`deleteAccount`).
4. **Part B is unpublished and its data exposure is unmeasured**: it re-validates whole documents, and the real habit, completion and note data has not been inspected.
5. **A price of 10 is now refused** (a guest database from an older app version containing one would fail to import on Android).
6. **App Check cannot be enforced** while the Android app has none.
7. **Nothing has run against a real Firebase project:** the emulator proves the rules' logic; the staging smoke tests prove the real apps. They are written, not run.
8. **No document counts** can be enforced by rules (the Web caps habits at 200).
9. The Console and the production data are unverified from here (no access).

## 6. Publication status and what I need from you
- **Part A** is ready to take to staging. Before it goes to production: the staging Android and Web smoke tests pass (baseline versus Part A), you have a copy of the current production rules, the one-click rollback has been tried in staging, and you approve. The historical-data inspection is **optional for Part A** (it never re-checks stored documents) but recommended for the ledger shapes (W1 to W5 in the inspection guide).
- **Part B** waits for the data inspection and its own staging round.
- **Nothing is published.** I will not publish any rules, and I will not commit.

## 7. Files added or changed in Phase 11C.2
Added: `scripts/build-rules.mjs` (+ `.d.mts`), `firebase/rules/part-b.rules`, `firebase/rules/combined.rules`, `tests/rules/rulesets.ts`, `tests/rules/seed.rules.ts`, `tests/rulesBuild.test.ts`, `scripts/lib/syntheticData.mjs` (+ `.d.mts`), `scripts/seed-staging-data.mjs`, `RULES_CONSOLE_INSPECTION.md`, `STAGING_SETUP.md`, this document.
Changed: `firebase/firestore.rules` (now **Part A**, generated; the previous combined proposal is `firebase/rules/combined.rules`), `tests/rules/firestore.rules.ts` and `tests/rules/legacy.rules.ts` (all four rule sets), `scripts/lib/rulesCompat.mjs` and `tests/rulesCompat.test.ts` (price exactly 20), `package.json` (scripts `build:rules`, `seed:staging`, `audit:data`), `ANDROID_SMOKE_TEST_PLAN.md`, and a pointer banner on `WEB_SECURITY_HARDENING.md`, `RULES_COMPATIBILITY_AUDIT.md`, `CLOUD_FUNCTIONS_PROPOSAL.md`.
Untouched: all Kotlin, `android/firestore.rules`, production Firebase, `.env.local`.
