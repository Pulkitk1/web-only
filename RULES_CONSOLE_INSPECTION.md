# Inspecting production data in the Firebase Console (read-only)

Purpose: before **Part B** (habit, completion and note validation) is published, look at the historical production data to learn whether any stored document would make Android's next check-in, edit or note save fail. **Part A does not need this**: it never re-checks a stored habit, completion or note (proved in `tests/rules/legacy.rules.ts`). Part A only judges new writes, and only the keys an update changes. The inspection is still useful for Part A in one place: the ledger queries below tell you what shapes the wallet ever held, which should all be shapes the current app can still write.

This guide uses only **Firebase Console > Firestore > Data > Query builder**, signed in as yourself. It reads documents; it never writes. I (the assistant) do not access production credentials and have not run any of this.

## Ground rules
- **Read only.** Run queries and open documents. Do not edit, delete, import or create anything. Do not click "Add document", "Delete" or an index you do not recognise.
- **No personal data leaves the Console.** Do not copy or screenshot names, emails, note text or ids into chats, tickets or this repository. Write down only the **answers** in the result table at the end (counts, "none", field names, type names).
- **Cost:** a query is billed per document it returns (the Console shows 20 at a time). A query that should return nothing costs nothing.
- **Indexes:** collection-group and some filter combinations need an index. The Console shows a **"Create index" link** in the error message; clicking it only adds an index definition (it never changes data) and builds in a few minutes. You can delete these indexes afterwards (Firestore > Indexes).

## How to run a collection-group query
1. Firebase Console > project **habbit-tracker-12** > **Firestore Database** > **Data**.
2. Open the **Query builder** tab.
3. Under **Query scope**, choose **Collection group**, and type the collection id (for example `habits`).
4. Add a **filter**: pick the field, the operator, the value; type values exactly as written below. Press **Run**.
5. **Zero results is the good answer** for every "should be empty" query below. If documents appear, open one (do not copy its content) and note **which field** is odd, using the table at the end.

For a number list write it as an array value (for example `[1, 2, 3, 4, 5, 6, 7]`).

## The queries

### Habits (collection group `habits`)
| # | Filter | Should return | If it returns documents |
|---|---|---|---|
| H1 | `daysPerWeek` **not-in** `[1, 2, 3, 4, 5, 6, 7]` | nothing | The weekly target is outside 1 to 7 on some habit. Part B would block updates of it |
| H2 | `createdDate` **<** `2000-01-01` | nothing | Empty or non-ISO dates (for example `01/06/2024`, an empty string) |
| H3 | `createdDate` **>** `2999-12-31` | nothing | Dates starting with a digit above 2, like `31/12/2024` |
| H4 | `archived` **not-in** `[true, false]` | nothing | `archived` is not a true boolean |
| H5 | `reminderEnabled` **not-in** `[true, false]` | nothing | the same, for the reminder switch |

What a query cannot show: the **length of a name** (Part B allows 1,000 characters; Android has no limit at creation), a **list's size** (`completedDates` up to 20,000, `scheduleHistory` up to 2,000, `restDays` up to 7), **how many fields** a habit has (up to 40), whether `restDays` is an array or a string, and whether a number is stored as an integer or a decimal (the Console shows both as "number"). For those, **sample by hand** (below), or run the scanner (`RULES_COMPATIBILITY_AUDIT.md` section 4.3) when you are ready to give it credentials.

**Sampling habits by hand** (open about 8 documents, no copying): the **oldest** (sort by `createdAt` ascending in the query builder; some have none), the one with the **longest-looking name**, the one with the **most completed dates**, one **archived**, one with **no `createdDate`**. For each, check: `restDays` shows as an **array** `[...]`; `daysPerWeek` is a plain number from 1 to 7; the field count is far below 40; no field has an unexpected type (a `streak` that is text, a date that is a timestamp where text is expected).

### Completions (collection group `completions`)
| # | Filter | Should return | If it returns documents |
|---|---|---|---|
| C1 | `completed` **not-in** `[true, false]` | nothing | `completed` is not a boolean |

Unknown **extra fields** cannot be queried (a query cannot ask for "a field I do not know"). **Sample by hand:** open about 8 documents from the oldest habits and check that the field names are only `date`, `completed`, `updatedAt`, `completedAt`, `uncheckedAt`, and that `date` equals the document's id. Any other field name (for example `note`) would block Android's next check-in of that day under Part B.

### Day notes (collection group `dayNotes`)
| # | Filter | Should return | If it returns documents |
|---|---|---|---|
| N1 | `date` **<** `2000-01-01` | nothing | notes with a non-ISO date |
| N2 | `date` **>** `2999-12-31` | nothing | the same, digits above 2 |

**Sample by hand** (about 5 documents; read the field names only, never the text): they should have only `habitId`, `date`, `text`, `createdAt`, `updatedAt`, and the id should read `<habitId>_<date>`.

### Wallet transactions (collection group `walletTransactions`)
These entries are never re-validated (they are created once). The queries tell you which shapes **ever existed**, so you know Part A does not forbid a shape the current app still writes.
| # | Filter | Should return | If it returns documents |
|---|---|---|---|
| W1 | `type` **not-in** `[daily_completion, streak_milestone, reward_restored, reward_reversal, welcome_freeze, freeze_purchase, freeze_application]` | nothing | A type no current code writes (an old bonus, for example). Harmless to Part A (history), but note its name |
| W2 | `type` **==** `freeze_purchase` and `coinDelta` **!=** `-20` | nothing, or only old entries | Purchases at another price (the earlier price was 10). Part A requires exactly 20 for **new** purchases |
| W3 | `type` **==** `freeze_application` and `coinDelta` **!=** `0` | nothing | Freezes that were paid for in coins instead of using an owned freeze |
| W4 | `type` **==** `freeze_application` and `freezeDelta` **!=** `-1` | nothing | Applications that did not use a freeze |
| W5 | `type` **==** `daily_completion` and `coinDelta` **not-in** `[0, 1]` | nothing | A daily reward other than 1 coin (a partial grant shows as 0) |
(W2 to W5 need a composite index; accept the Console's prompt.)

### Rewards (collection group `rewards`)
| # | Filter | Should return | If it returns documents |
|---|---|---|---|
| R1 | `amount` **not-in** `[1, 5, 10, 20]` | nothing | An amount outside the milestone and daily values (an older milestone bonus, for example) |
| R2 | `type` **not-in** `[daily_completion, streak_milestone]` | nothing | An unknown reward type (records with **no** `type` do not appear in this query; they are fine, the Kotlin code derives the type from the id) |
| R3 | `cycle` **<** `1` | nothing | an invalid cycle |

### Freezes (collection group `freezes`)
| # | Filter | Should return | If it returns documents |
|---|---|---|---|
| F1 | `paidWith` **!=** `inventory` | nothing | Freezes paid for in another way (`coins`), the older behaviour. History only: records are never rewritten |

### Freeze month counters (collection group `freezeMonths`)
| # | Filter | Should return | If it returns documents |
|---|---|---|---|
| M1 | `count` **>** `3` | nothing | A counter above the monthly limit |
| M2 | `count` **<** `1` | nothing | an empty counter |

### Profiles (collection `users`, scope **Collection**, not collection group)
| # | Filter | Meaning |
|---|---|---|
| P1 | `deletionRequested` **==** `true` | accounts whose deletion started and may be stuck (data left behind) |
| P2 | sort by `createdAt` ascending, open the first 3 | the **oldest profiles**: note only the **field names** (the harmless extras such as `freezeDates` or `isDark` do not matter: a profile update is judged on the keys it changes) |

## Result table (copy and fill in; counts and field names only)

| Check | Result (none / count / field names) | Notes |
|---|---|---|
| H1 weekly target outside 1 to 7 | | |
| H2, H3 non-ISO created dates | | |
| H4, H5 non-boolean flags | | |
| Habit sampling: `restDays` arrays, field counts, odd types | | |
| C1 non-boolean `completed` | | |
| Completion sampling: field names beyond the five | | |
| N1, N2 non-ISO note dates | | |
| Note sampling: field names beyond the five | | |
| W1 unknown ledger types (names only) | | |
| W2 purchases not at 20 (how many, how old) | | |
| W3, W4 freeze applications that cost coins or used no freeze | | |
| W5 daily rewards other than 0 or 1 | | |
| R1, R2, R3 rewards | | |
| F1 freezes not paid with inventory | | |
| M1, M2 counters | | |
| P1 stuck deletions | | |

## How to read the results
- **Part A:** nothing in this table can block it, because it never re-checks stored habit, completion or note documents. W1 to W5, R1, R2, F1 only describe history. What matters for Part A is that the **current app** cannot write a shape Part A refuses, and the emulator tests and the Android smoke test prove that.
- **Part B:** every row that returns documents is a place where Android's next write to that document could fail. Fix it by **widening the specific bound** that the valid stored data needs (for example a longer name limit) and adding that shape to `tests/rules/legacy.rules.ts`, or by repairing the odd documents. "Preserve all existing valid production data" decides it.
- If H1 to C1 and the samples are all clean, the remaining Part B risk is name length, list sizes, field count and integer-versus-decimal, which the Console cannot show: either accept it (the bounds are generous), or run the scanner once with your credentials.


---

# Phase 11F addendum: the exact Part B checklist (read-only, Firebase Console only)

Same ground rules as above: signed in as yourself, **Query builder**, queries only, no edits, no copying of names or note text anywhere. Write only counts or field names in the table at the end. I have not run any of this and have no production access.

**One thing already matters today:** Part A (deployed, still to be verified live) already enforces the note rules on every note create or edit: the id must be `habitId_date` and the text must be a string of 1 to 200 characters. A stored note that breaks that cannot be edited now. So the note checks (N1 to N4) are not only for Part B.

## A. Checks the Console can do (run each; zero results is the good answer)
| # | Collection group | Filter | What a result means |
|---|---|---|---|
| H1 | `habits` | `daysPerWeek` **not-in** `[1, 2, 3, 4, 5, 6, 7]` | a weekly target outside 1 to 7, a decimal such as 3.5, or a text value. This also answers "invalid daysPerWeek" |
| H2 | `habits` | `createdDate` **<** `2000-01-01` | empty or non-ISO created date |
| H3 | `habits` | `createdDate` **>** `2999-12-31` | non-ISO created date starting with a digit above 2 |
| H4 | `habits` | `archived` **not-in** `[true, false]` | `archived` is not a boolean |
| H5 | `habits` | `reminderEnabled` **not-in** `[true, false]` | not a boolean |
| **H6** | `habits` | `reminderTime` **>** `23:59` | **invalid reminder time**: `24:00` to `99:99` and times without the leading zero such as `7:30` (a text value above `23:59`) |
| **H7** | `habits` | `reminderTime` **<** `00:00` | **invalid reminder time**: an empty text or other odd text |
| C1 | `completions` | `completed` **not-in** `[true, false]` | `completed` is not a boolean |
| **C2** | `completions` | `date` **<** `2000-01-01` | a `date` field that is not an ISO date |
| **C3** | `completions` | `date` **>** `2999-12-31` | the same, starting with a digit above 2 |
| N1 | `dayNotes` | `date` **<** `2000-01-01` | a note date that is not ISO |
| N2 | `dayNotes` | `date` **>** `2999-12-31` | the same |
Notes on the queries: a document that does not have the field at all is not returned (that is fine: absent fields are allowed). A result means "open one document, find which field is odd, and record only the field name". `12:60` is a valid-looking time that H6 and H7 cannot catch; Android only ever writes a formatted time, so this is a very small risk.

## B. Checks the Console cannot do (a query cannot test length, count or unknown fields): sample by hand
Open documents from **each of the five oldest accounts and five of the newest** (sort `users` by `createdAt`; the oldest accounts are the ones older app builds wrote). For each account open **about 3 habits, 3 completions and 3 notes**, looking at field **names and types only**, never at the content:
| Look for | Habits | Completions | Notes |
|---|---|---|---|
| **Habit name longer than 1,000 characters** | a name that fills the whole panel (Android had no limit when creating) | | |
| **Goal or why longer than 1,000 characters** | a very long goal | | |
| **More than 40 fields** | scroll the field list: a habit normally has about 15 | | |
| `restDays` shown as an **array** with at most 7 entries | yes | | |
| `scheduleHistory` an array (normally 1 to a few entries, never thousands) | yes | | |
| **Unexpected fields** | any field name you do not recognise is fine for habits | **only** `date`, `completed`, `updatedAt`, `completedAt`, `uncheckedAt` are allowed | **only** `habitId`, `date`, `text`, `createdAt`, `updatedAt` are allowed |
| **Document id equals the date** | | the id `2026-11-05` and the field `date` agree (or `date` is absent) | the id reads `<habitId>_<date>` and agrees with the `habitId` and `date` fields |
| **Note text over 200 characters** | | | a long note (the Web and Android both cap at 200; this should be impossible) |
The two most valuable things to find or rule out are **extra fields on completions** and **extra fields on notes**: Part B (as written) refuses any write to a document that has one, which would block that day's check-in or that note's edit.

## C. The only way to cover everything
The read-only scanner (`scripts/audit-existing-data.mjs`, `npm run audit:data`) checks **every** habit, completion and note for all the rules above, but it needs Google credentials that you create yourself (`gcloud auth application-default login`, done by you, never shared). You decided against it for now. Without it, sections A and B are a sample, not proof.

## D. Result table for Phase 11F (counts and field names only)
| Check | Result | Notes (field names only) |
|---|---|---|
| H1 daysPerWeek | | |
| H2, H3 createdDate | | |
| H4, H5 booleans | | |
| H6, H7 reminderTime | | |
| C1 completed | | |
| C2, C3 completion date | | |
| N1, N2 note date | | |
| Sample: habit name or goal length, field count | | |
| Sample: completion extra fields, id vs date | | |
| Sample: note extra fields, id vs habitId_date, text length | | |
