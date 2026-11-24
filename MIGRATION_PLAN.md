# Consisto Web: Migration Plan

Source of truth: the Android/Kotlin app in `D:\habbit_tracker_web\android` (package `com.habittracker.app`, `versionName 1.2.0`).
Target: this Expo + React Native Web + TypeScript project.

> **Scope of this document.** It records only what was read in the Kotlin sources during Phase 1. Each item is marked
> **[read]** (the code was opened and read) or **[listed]** (the file or symbol exists, but its body was *not* read, so
> its behaviour is unverified). Items marked **[listed]** must be read before they are migrated.
> No Phase 1 code ports any business logic.

## 0. Naming note

Android's user-visible name is **"Habit Tracker"** (`strings.xml`, `SplashScreen.kt`, `LoginScreen.kt`) **[read]**. "Consisto"
appears in the Android sources only in identifiers: the Room file `consisto-local.db` and `hasConsistoData()` **[read]**.
The web app uses "Consisto" as the brand name, per the project brief.

## 1. Phase 1 deliverables (done)

- Expo SDK 58 + TypeScript + Expo Router (routes in `app/`) + React Native Web (Metro bundler, `output: single`).
- Folder structure: `app/`, `components/`, `assets/`, `constants/`, `theme/`, `hooks/`, `services/`, `types/`, `utils/`.
- Theme tokens ported from `ui/theme/Theme.kt` into `theme/colors.ts`: `Brand` colours, dark and light `Tokens`.
- Brand colour from the Android resources: coral `#F26B4E` (`ic_launcher_background.xml`, `LoginScreen.kt` `Accent`, `ic_splash_logo.xml`)
  and the splash palette from `SplashScreen.kt` and `themes.xml`.
- Logo: `android/store/play-store-icon-512.png` copied (not moved) to `assets/images/logo.png`, `assets/icon.png` and `assets/favicon.png`.
- Placeholder entry screen (`app/index.tsx`) with a light/dark toggle. No data, auth or database.

## 1b. Phase 2 status: Home Dashboard (done, awaiting approval)

Ported from `ui/screens/HabitsScreen.kt` with local mock data (`constants/mockData.ts`); no Firebase, auth or database.

- **Screen:** `components/dashboard/*`, route `/habits` (`/` redirects there). Top bar, week selector (5-day windows), day header,
  habit cards (ring, streak, five day circles, Archive/Delete menu), Today's Progress card, Toast.
- **Overlays:** Coin-earned popup, Missed-Day freeze modal, Guest Bonus popup, Archive sheet, New Habit sheet (weekly goal, rest days, create).
- **Ported logic** (`domain/`, pure TypeScript): StreakEngine, ScheduleHistory, HabitSchedule, HabitAnalytics (`daysCompletion`, `dayProgress`),
  FreezeRules, RewardRules, and an in-memory WalletLedger with reward reconciliation (grant, reverse, pending adjustment, welcome freeze).
- **Placeholders** (not migrated): `/habits/[slug]`, `/wallet`, `/settings` show a "later phase" screen so navigation doesn't dead-end.

### Dashboard parity pass (done, awaiting approval)

Closed the gaps listed after the first dashboard pass, again from the Kotlin sources and tests:

- Drag-and-drop reordering (`ReorderableList.kt`, `AppViewModel.reorderHabits`) -> `domain/reorder.ts`, `components/dashboard/HabitList.tsx`.
- Streak celebration (`Popups.kt`), milestone celebration screen (`MilestoneCelebrationScreen.kt`) and the "Bonus Effort" rest-day
  celebration (`Popups.kt`, `RestDayCelebrations.kt`) -> `components/celebrations/*`, `domain/celebrations.ts`.
- Reminder and Goal fields in New Habit (`ReminderSection.kt`, `GoalWhy.kt`, `HabitReminderRules.kt`, `GoalWhyRules`) -> `domain/reminder.ts`.
- Saved theme (`DevicePrefs.isDark`) and the other per-device flags -> `services/devicePrefs.ts` (localStorage, not a database).
- Guest Bonus: already matched Kotlin (`guestBonusClaimed` is always true and `claimGuestBonus()` does nothing, so the popup says
  "Bonus already claimed"); now covered by an end-to-end check.
- Tests: `npm test` (212 unit tests, most ported from Kotlin's StreakEngineTest and WalletTest) and `npm run e2e` (59 browser checks).

Known remaining differences from Kotlin for the dashboard: reminders are stored but never delivered (no scheduler on the web);
no "Open settings" shortcut; sheets/modals have no exit animation or swipe-to-dismiss; Material icons are the filled set;
touch dragging is implemented but only mouse dragging was exercised in the browser tests.

## 1c. Phase 3 status: habit creation and editing (done, awaiting approval)

Source: `CreateHabitSheet.kt`, `EditHabitDialog.kt`, `HabitDetailScreen.kt` (Edit Rest Days sheet, Edit links), `ReminderSection.kt`
(`EditReminderSheet`), `GoalWhy.kt` (`GoalSection`, `EditGoalSheet`), `HabitNameRules.kt`, and `AppViewModel` (`addHabit`, `editHabit`,
`updateSchedule`, `updateGoal`, `updateHabitReminder`, `deleteHabit`, `reminderLabel`), plus their Kotlin tests.

- **Create** (from Home "+"): weekly goal -> rest days -> name/colour/schedule/reminder/goal (unchanged from the dashboard pass; the weekly-target
  arithmetic now lives in `domain/weeklyGoal.ts` and is unit-tested).
- **Edit** (in Kotlin all editing is on Habit Details; here at `/habits/{slug}` at the same positions): pencil -> Edit Habit dialog (name + colour);
  "N days/week" Edit -> Edit Rest Days sheet (applies from tomorrow); bell Edit -> Reminder sheet; Goal section -> Goal sheet.
  Rules in `domain/habitRules.ts`; components in `components/habit/`.
- **Delete:** Home card menu only, immediate, no confirmation (as Kotlin).
- Facts about Kotlin worth knowing: there is **no habit description field**; "why" is legacy (stored by old versions, never shown or asked);
  weekly target is derived (7 minus rest days); creating a habit does not check for duplicate names (only renaming does).

## 1d. Phase 4 status: Habit Details (done, awaiting approval)

Source: `HabitDetailScreen.kt` (all sections), `Charts.kt`, `HabitAnalytics.kt` (`period`, `overview`), `ArchivedHabits.kt` (`ArchivedBanner`),
`HabitAnalyticsTest.kt`. Route `/habits/{slug}` (`components/habit/HabitDetailScreen.tsx`), in Kotlin's order: streak card, Calendar View,
OVERVIEW, archived banner, Goal, SCORE line chart, HISTORY bar chart. The edit actions from the editing phase are unchanged.
`/habits/{slug}/calendar` is the Calendar View (Phase 5). Charts are drawn with SVG (`components/charts/Charts.tsx`); their maths is in
`domain/habitDetail.ts`.

## 1e. Phase 5 status: Calendar View (done, awaiting approval)

Source: `HabitCalendarScreen.kt` (screen, cards, `DayCell`, sheets, `CalendarRange`, `DayState`, `onTileTap`/`onTileDoubleTap`,
`bestStreakRows`), `HorizontalMonthStrip.kt` (`MonthStripRules`), `DayNotes.kt`, `HabitAnalytics.kt` (`monthBreakdown`). Route
`/habits/{slug}/calendar` (the existing route; `components/calendar/CalendarScreen.tsx`). Logic is pure TypeScript: `domain/calendar.ts` (range,
grid, strip rules, day states, tap / double-tap decisions, best streaks), `domain/notes.ts` (note rules), `monthBreakdown` in `domain/analytics.ts`.
All state is the shared AppStore (completion, freeze, schedule, notes), so the dashboard and Habit Details update with the calendar.
Interactions are Kotlin's only: single tap, double tap (emulated with a 300 ms click window), EDIT/DONE, freeze sheet, completed-day sheet,
notes (add/edit/delete with confirmation), month arrows, month picker (draft + Apply/Cancel), Schedule sheet (effective tomorrow). Notes are
in memory only, like the rest of the mock data.

## 1f. Phase 6 status: Wallet and rewards (done, awaiting approval)

Source: `WalletScreen.kt`, `AppViewModel.kt` (`freezesLeft`, `canBuyFreeze`, `buyFreeze`, `reconcileRewards`), `WalletLedger.kt`, `WalletTest.kt`.
Route `/wallet` (`components/wallet/WalletScreen.tsx`). The reward/ledger rules were already ported in Phase 2 and are reused unchanged; Phase 6 adds
`freezesLeft`/`canBuyFreeze` to `domain/ledger.ts` and `pendingAdjustment`, `freezesLeft`, `canBuyFreeze`, `buyFreeze` to the AppStore. Kotlin's Wallet has
no transaction-history list, so none was invented. Freeze applications live in the ledger, so they survive deleting a habit (Kotlin's `freezes` table has no
cascade). `localStorage['consisto_mock_start_coins']` is a test-only knob for the mock wallet.

## 1g. Phase 7 status: Settings and Archived Habits (done, awaiting approval)

Source: `SettingsScreen.kt`, `ArchivedHabits.kt`, `AccountSheets.kt` (Privacy Policy, Back Up sheet), `NotificationPrefs.kt`, `MainActivity.kt` routes. Routes `/settings`
(`components/settings/SettingsScreen.tsx`) and `/settings/archived` (`ArchivedHabitsScreen.tsx`). Settings is Kotlin's signed-out (Guest) view; accounts are a later
phase. Archive rules are in `domain/archive.ts` (shared by Home, Settings and the AppStore). Notification switches persist as `guest_habit_reminders` /
`guest_streak_alerts` (default on). The theme key `theme_is_dark` is unchanged.

## 1h. Phase 8 status: local data persistence (done, awaiting approval)

`services/appStorage.ts` saves habits, the wallet ledger, day notes and the id counter as one versioned JSON envelope (`consisto_app_data`, version 1) in
localStorage, with defensive validation, a corrupt-data backup (`consisto_app_data_backup`), a lock against newer-version data, and a `MIGRATIONS` table.
`store/initialState.ts` restores saved data (never reconciling rewards on load) or seeds the mock data once. The AppStore saves on every change.
Theme, notification switches, the milestone queue and rest-day markers keep their own `devicePrefs` keys. Dev-only reset: `?resetData=1` or
`window.consistoDev.resetData()` (`services/devTools.ts`). To add a stored field: bump `STORAGE_VERSION`, add `MIGRATIONS[oldVersion]`, extend `validateData`.

## 2. Existing Kotlin screens to migrate

Routes are defined in `MainActivity.kt` `Routes` **[read]**.

| Android route | Composable (file) | Status | Notes |
|---|---|---|---|
| `splash` | `SplashScreen` (`ui/screens/SplashScreen.kt`) | partial [read] | Cream (`#FFF8F1`) screen, logo, title, subtitle, animated loading dots. Shown while the saved session loads. |
| `login` | `LoginScreen` (`LoginScreen.kt`) | partial [read] | Email/password, "Create account" toggle, "Forgot Password?", "OR" divider, **"Continue as Guest"**. Dark-only palette (`ScreenBg #0B0D12`). |
| `login/forgot?email=` | `ForgotPasswordScreen` (`LoginScreen.kt`) | partial [read] | "Check your email" confirmation, "Resend email", "Back to Login". |
| `habits` | `HabitsScreen` (`HabitsScreen.kt`, 837 lines) | [listed] | Dashboard. Has `windowDays`, `weekRangeLabel`, `weekTitle` (week window, offset), `StreakBadge`. Callbacks to open habit, Wallet and Settings. |
| `habits/{id}` | `HabitDetailScreen` (`HabitDetailScreen.kt`) | [listed] | Takes a habit `slug`. Callbacks: back, calendar, `onRenamed(newSlug)`. Uses `LineChart`/`BarChart` (`Charts.kt`), `GoalSection`. |
| `habits/{id}/calendar` | `HabitCalendarScreen` (`HabitCalendarScreen.kt`, 1201 lines) | [listed] | Has `monthGrid`, `CalendarRange`, `DayCell`. Callback to Wallet. Largest screen. |
| `settings` | `SettingsScreen` (`SettingsScreen.kt`, 794 lines) | [listed] | Callbacks to Feedback and Archived. Includes `ToggleSwitch`. Sheets in `AccountSheets.kt`: `DeleteAccountSheet`, `PrivacyPolicySheet`, `GuestSignInSheet`. `ReminderSection`/`EditReminderSheet`. |
| `settings/archived` | `ArchivedHabitsScreen` (`ArchivedHabits.kt`) | [listed] | Also `ArchiveHabitSheet`, `ArchivedBanner`. |
| `settings/feedback` | `FeedbackScreen` (`FeedbackScreen.kt`) | [listed] | Backed by `FeedbackRepository.kt` (max length 2000 **[read]**). |
| `wallet` | `WalletScreen` (`WalletScreen.kt`, 420 lines) | [listed] | Back goes to `habits`. |
| overlay (any screen) | `BackupDialog` (`BackupDialog.kt`) | [listed] | Guest backup progress/choice/result. Driven by `BackupState`. |

Supporting UI (all **[listed]**): `CreateHabitSheet`, `EditHabitDialog`, `Popups.kt` (`CoinEarnPopup`, `GuestBonusPopup`,
`MissedDayFreezeModal`, `StreakCelebration`, `RestDayCelebration`), `MilestoneCelebrationScreen`, `MonthPicker`/`HorizontalMonthStrip`,
`ReorderableList` (drag to reorder habits), `GoalWhy` (`GoalField`, `GoalSection`, `EditGoalSheet`), `FlameIcon`, `ProgressIcon`, `Components.kt`.

Navigation behaviour **[read]**: the app starts on `splash`. `Routes.destinationFor` sends `SignedIn` to `habits` and `SignedOut` to
`login`. `Loading` keeps the splash up. Leaving splash or login removes it from the back stack. Logout or deletion clears the whole stack.
Tapping a reminder notification opens that habit's detail screen once signed in and the habits have loaded.

## 3. Existing features to migrate

Confirmed in code **[read]** unless marked:

- **Habits:** create, edit, rename (name rules in `HabitNameRules.kt`: not blank, max 100 on edit, slug is the route key), delete, archive/unarchive, reorder (`reorderHabits`, `sortOrder`), per-habit goal and "why" (`GoalWhy.kt` [listed]), colour palette (`HabitColorGrid` [listed]).
- **Completions:** `setCompletion(uid, habitId, date, completed)` per habit per day.
- **Schedules and rest days:** weekly schedule with named rest days (`"Mon".."Sun"`). Schedule changes take effect from the day made, and past days keep the schedule in effect then (`ScheduleHistory.kt`).
- **Streaks:** one shared `StreakEngine` (see section 4).
- **Calendar:** month grid with per-day state, back-filling past days, day notes.
- **Day notes:** one optional text per habit per date, max 200 characters. Reflection only, never read by streaks, rewards or freezes (`DayNotes.kt`).
- **Analytics:** `HabitAnalytics.kt` [listed] feeding the detail charts.
- **Wallet and rewards:** coins, daily reward, streak-milestone bonuses, Streak Freezes (see section 4).
- **Celebrations:** streak celebration, milestone celebration, "Bonus Effort!" celebration for completing today's planned rest day, shown at most once per habit and date (`RestDayCelebrations.kt`).
- **Reminders and notifications:** per-habit reminders (`reminderEnabled`, `reminderTime` "HH:mm", `HabitReminderRules.kt`); a master "Habit Reminders" switch in Settings; streak alerts in the evening; a "remember your why" notification at 8:30 PM; each notification sent at most once per day (`NotificationPrefs.kt`, `ReminderRules.kt`, workers). *Web note: Android uses WorkManager, an OS-level scheduler. The browser has no equivalent, so this needs a separate design decision.*
- **Theme:** light/dark toggle, saved per device (`DevicePrefs`, "Saved theme, or null if the user never chose one").
- **Auth flows:** email/password, create account, forgot password, guest mode, delete account, and `AuthMethod { Email, Google, Phone }` in `AppViewModel.kt`. How Google and Phone sign-in work is not read.
- **Guest to account migration and backup:** `GuestMigration.kt` / `FirestoreMigrationCloud.kt` / `BackupDialog` [listed]. `hasConsistoData()` and `BackupState.Choice` exist.
- **Feedback:** user feedback submission (`FeedbackRepository.kt`).
- **Privacy policy sheet, App/Account settings:** [listed].

## 4. Business logic that must be preserved

All values below were **[read]** from the named files. Port them with unit tests, and do not re-derive them from the old `src/` prototype
(see section 7).

### Streaks (`data/StreakEngine.kt`, header read)
Walks the local calendar day by day from the first completion to today:
- Completed day: streak +1 (rest-day completions count as voluntary bonus effort).
- Scheduled rest day, not completed: skipped (neither extends nor breaks).
- Missed active day covered by an applied freeze: skipped, streak preserved.
- Today not yet completed: skipped, so yesterday's streak stays alive until the day ends.
- Any other missed active day: resets to 0.
- Completions after today are ignored. A schedule where all 7 days are rest days yields no streak.
- Same engine is used by every screen. Result is `StreakResult(current, best, runs[])`.

### Rewards (`data/RewardRules.kt`, `data/WalletLedger.kt`, read)
- `DAILY_REWARD = 1`. A day earns it only if the habits **active** that day are non-empty and **all** completed (`dailyRewardEligible`).
- `MILESTONE_BONUSES = {15:5, 30:5, 45:5, 60:5, 75:10, 100:20}`, per habit and per streak run. Milestones count completed *active* days only (rest-day completions extend the streak but never earn coins).
- **Eligibility window:** new coins can only be earned for activity dated in the *current local calendar month*. Earlier months can be edited for tracking and streaks but never issue new rewards.
- **Correction policy:** a reward that stops qualifying (e.g. un-checking) is reversed and restored if it qualifies again. Coins already spent are not taken below zero: the shortfall becomes `pending`, which future earnings pay off first. Invariant: `pending > 0` only when `coins == 0`.
- **Idempotency:** reward ids `daily_{date}` and `milestone_{habitId}_{n}_{runStartKey}`. Each grant/reversal cycle gets a unique transaction id (`{id}_grant{n}`). Granting twice is a no-op (`Duplicate`).
- Ledger types: `daily_completion`, `streak_milestone`, `reward_restored`, `reward_reversal`, `welcome_freeze`. Every ledger operation is atomic (a Firestore transaction in production).

### Streak Freeze (`WalletLedger.kt`, `RewardRules.kt` `FreezeRules`, read)
- `FREEZE_PRICE_COINS = 20` (earlier 10-coin purchases keep their recorded amount). `MAX_FREEZE_APPLICATIONS_PER_MONTH = 3`, counted per calendar month **of the protected date**. `STREAK_FREEZE_RECOVERY_DAYS = 3`.
- **Buy** spends 20 coins and adds one freeze to inventory. You cannot hold more than you can still apply this month. **Apply** consumes exactly one owned freeze and never spends coins.
- One free `welcome_freeze` (fixed id, so it happens once) for every new user.
- A freeze may protect a date only if it is: within the last 3 days (yesterday back), a scheduled active day under the schedule then in effect, not completed, not already frozen, on or after the habit's start, and the habit had a live streak entering that day. Consecutive misses are recovered oldest first. Refusal reasons: `Future`, `Today`, `RestDay`, `Completed`, `AlreadyFrozen`, `TooOld`, `NotStarted`, `EarlierDayFirst`, `NoStreak`.
- Wallet rejection reasons: `InsufficientCoins`, `NoFreezes`, `MonthlyLimit`, `HoldLimit`, `AlreadyFrozen`, `NotEligible`, `NoReward`.
- Freeze id is `{habitId}_{date}`.

### Other rules (read)
- Rest-day schedule: `isActiveOn(date) = !isRest(date) && isTracked(date)`. Days before a habit's `trackedFrom` (its `createdDate`, or first completion if unknown) are *untracked*: neither missed nor scheduled.
- Day-note eligibility: allowed on completed days (active or rest) and on past active days that were missed or frozen. Not on uncompleted rest days, today before completion, future days, or unrecorded days before the habit start.
- Reminders (`HabitReminderRules.kt`): a reminder runs only if the master switch is on, the habit exists and has its own reminder on, is scheduled today (not a rest day, already started) and is not yet completed. A reminder more than a set delay late is dropped, never sent late.
- Rest-day celebration: only for completing *today's* planned rest day, once per (habit, date).

## 5. Authentication and database dependencies (Android)

Read from `app/build.gradle.kts`, `Session.kt`, `Stores.kt`, `AccountRepository.kt`, `LocalDatabase.kt`/`LocalEntities.kt`, `firestore.rules`.
**None of these is connected in the web app. Phase 1 adds no auth or database.**

- **Firebase Auth** (`firebase-auth`, BoM 34.4.0). `app/google-services.json` exists. Do not copy it into `web/` without an explicit decision.
- **Cloud Firestore** (`firebase-firestore`) for signed-in accounts. Paths seen: `users/{uid}` (fields `coins`, `freezesOwned`, `pendingAdjustment`, `lastTransactionId`, `deletionRequested`), `users/{uid}/habits/{id}` (+ `completions`), `walletTransactions`, `freezes`, `freezeMonths`, `rewards`, `dayNotes`, and a legacy `todos` (kept from a removed Daily To-Do).
- **Security rules** (`android/firestore.rules`): owner-only access. Wallet fields can change only together with a matching ledger entry written in the same transaction. A new user doc must have `coins == 20` and `freezesOwned == 0`. Day notes are 1 to 200 characters. Deletion is a two-step flow gated by `deletionRequested`.
- **Room (SQLite), database version 7**, file `consisto-local.db`, for **guest mode**. Tables seen: `habits`, `schedule_periods`, `completions`, `wallet`, `wallet_transactions`, plus `rewards` and `day_notes` per the entity docs. Guest uid is the constant `"guest"`.
- **Session model** (`Session.kt`): a Firebase login always wins. Otherwise the remembered guest choice. Otherwise show login. Storage never mixes the two (Room for guest, Firestore for accounts).
- **DataStore Preferences** for notification prefs (scoped by uid) and device prefs (guest-mode flag, saved theme).
- **WorkManager + notifications** (`POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`), `INTERNET` permission.
- Abstractions already present: `HabitStore`, `WalletStore`, `LedgerRunner`/`LedgerTxn`, `NoteStore`. These interfaces are a natural seam for a TypeScript `services/` layer.

Web consequences to decide in a later phase (not decided here): the browser has no Room. Whether the web app talks to the same Firebase project, and
how guest-mode data is stored, are open questions.

## 6. Proposed migration phases

Phases after 1 are proposals for approval, not commitments.

| Phase | Goal | Notes |
|---|---|---|
| **1** | Foundation (done) | Scaffold, theme tokens, branding, placeholder screen. |
| **2** | Pure domain logic in TypeScript, no UI, no backend | Port `StreakEngine`, `ScheduleHistory`, `RewardRules`, `FreezeRules`, `HabitNameRules`, `DayNotes` rules to `utils/` or a `domain/` folder. Unit-test against the Android cases. Read the matching tests in `android/app/src/test` first. |
| **3** | App shell and navigation | Splash and route guard mirroring `Routes.destinationFor`, tab or stack layout, shared UI components (`Components.kt`, sheets, toggles). Mock session only. |
| **4** | Core screens on local mock data | Habits dashboard, create/edit habit sheets, completion toggling, rest days. |
| **5** | Calendar and Habit detail | Month grid, back-filling, notes, charts. |
| **6** | Wallet and rewards UI | Wallet screen, coin/freeze popups, milestone celebration, using the Phase 2 logic. |
| **7** | Settings, archived habits, feedback | Reminders UI (decide the web notification strategy first). |
| **8** | Storage and auth | Decide the web data layer and sign-in. Implement behind `services/` interfaces mirroring `HabitStore`/`WalletStore`. Guest storage and guest-to-account migration. Requires explicit approval. |
| **9** | Hardening | Responsive layout, accessibility, tests, build and deploy. |

## 7. Caveats

- **The Kotlin code is the only source of truth.** The older React prototype in the repo root (`D:\habbit_tracker_web\src`) and its design notes (`src/imports/*.md`) are **not**. Verified differences from Kotlin: the prototype prices a freeze at **10 coins** (Kotlin: **20**, `FREEZE_PRICE_COINS`); the design notes say **2 freezes/month** (Kotlin: **3**, `MAX_FREEZE_APPLICATIONS_PER_MONTH`); the prototype has milestones only at Days 15 and 30 (Kotlin: 15, 30, 45, 60, 75, 100 with bonuses 5, 5, 5, 5, 10, 20); and the prototype's Daily To-Do no longer exists in Android. Wherever they disagree, follow Kotlin.
- Not yet read, and needing review before migrating: the bodies of all `[listed]` screens, `AppViewModel.kt` (978 lines), `HabitAnalytics.kt`, `GuestMigration.kt`, the notification workers, and the Android unit tests under `android/app/src/test`.
- Expo SDK 58 is newer than much public documentation. Check the versioned Expo docs before using APIs.
