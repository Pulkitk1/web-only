/** Static Settings content from Kotlin (SettingsScreen.kt, AccountSheets.kt, build.gradle). */

/** Kotlin `versionName` (android/app/build.gradle). */
export const APP_VERSION = '1.2.0';
/**
 * A support address is shown only if one is configured at build time (`EXPO_PUBLIC_SUPPORT_EMAIL`) and it is a plausible email address. It is
 * never invented: with nothing configured, Help & Support says so (see {@link supportContact}). It is public by nature (it is shown to users).
 */
export function validSupportEmail(value: string | undefined): string {
  const v = (value ?? '').trim();
  return v.length <= 254 && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(v) ? v : '';
}
export const SUPPORT_EMAIL = validSupportEmail(process.env.EXPO_PUBLIC_SUPPORT_EMAIL);

/** What the Help & Support row shows and does: a mail link when an address is configured, otherwise a plain, truthful statement. */
export function supportContact(email: string = SUPPORT_EMAIL): { sub: string; href: string | null; message: string | null } {
  return email
    ? { sub: email, href: `mailto:${email}`, message: null }
    : { sub: 'No support address yet', href: null, message: "A support address hasn't been set up yet, so there is nobody to contact from here." };
}

/** Reminders and streak alerts are not delivered by the web app (see WEB_RELEASE_READINESS.md); this is the one honest line used for it. */
export const WEB_REMINDERS_NOTE = "Reminders aren't available on the web yet.";

/**
 * The "Back Up Your Progress" sheet. While guest import is off (the first public release) it must not promise that guest habits move to
 * the account: it says what an account does give, and that what is already on this device stays here.
 */
export function backupSheetCopy(importEnabled: boolean): { intro: string; detail: string } {
  return importEnabled
    ? {
        intro: 'Your habits and their history can be saved to your account. Coins, rewards and streak freezes are not imported.',
        detail: 'Sign in or create an account on the next screen, then choose which habits to import. Nothing is deleted from this device.',
      }
    : {
        intro: 'Create an account to save your progress to Firebase and open it on any device you sign in on.',
        detail: 'Sign in or create an account on the next screen. Habits you create while signed in are saved to your account. Habits already on this device stay here and are not moved to your account.',
      };
}
/** The Privacy Policy text, verbatim from AccountSheets.kt (the blank support email adds no sentence). */
export const PRIVACY_POLICY: readonly (readonly [string, string])[] = [
  ['What we store', '• Your account: email address and a display name derived from it.\n• Your habits: names, colours, weekly goals, rest days, schedule changes and the reminder settings you choose for a habit.\n• Completion history for each habit, by date.\n• Calendar notes you write for a habit and day.\n• Wallet: coin balance, owned streak freezes, a history of coin rewards and purchases, and the days you protected with a freeze.'],
  ['Stored only on this device', 'Your theme choice and whether you chose to continue as a guest. The web app does not send reminders or notifications; reminder settings you choose for a habit are saved with the habit.'],
  ['Guest mode', "If you choose Continue as Guest, your habits, completion history, coins and streak freezes are stored only in this browser's storage on this device. Nothing is sent to Firebase, and the data is not backed up: it is lost if you clear your browser data."],
  ['Services we use', 'Firebase Authentication (Google) handles sign-in with your email and password. Cloud Firestore (Google) stores the data listed above under your account so it syncs between your devices. Only your signed-in account can read or change your data.'],
  ["What we don't do", "The app contains no advertising or analytics libraries, and it doesn't send your data anywhere other than the Firebase services above."],
  ['Deleting your data', 'Settings → Delete Account permanently deletes your account and all of the data above, calendar notes included, after you confirm with your password. Logging out keeps your data so you can sign back in. Guest data on this device is not part of your account; clear your browser data to remove it.'],
];

