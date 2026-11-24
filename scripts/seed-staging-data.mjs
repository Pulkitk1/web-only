// Imports SYNTHETIC test data into a STAGING Firebase project, as the staging test user (signed in with email and password), through the ordinary
// client write paths. The staging rules decide what is accepted. It writes ONLY under users/{that user's uid}.
//
//   $env:EXPO_PUBLIC_FIREBASE_API_KEY = '<staging web api key>'            # the six values come from the STAGING project's web app, never production's
//   $env:EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN = '...'; $env:EXPO_PUBLIC_FIREBASE_PROJECT_ID = '<staging project id>'
//   $env:EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET = '...'; $env:EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID = '...'; $env:EXPO_PUBLIC_FIREBASE_APP_ID = '...'
//   $env:STAGING_TEST_EMAIL = 'staging-test@example.invalid'; $env:STAGING_TEST_PASSWORD = '<a password you made up for the test user>'
//   node scripts/seed-staging-data.mjs --yes [--risk-probes]
//
// SAFETY: it refuses to run against the production project (habbit-tracker-12), and it needs --yes. The password is read from the environment of
// YOUR terminal and is never printed or stored. It creates the test user's data once: run it on a fresh test user (it creates the profile).
// --risk-probes also writes habits that break a Part B bound on purpose (to show what Part B would block); omit it unless you are testing Part B.
import { seedAccount } from './lib/syntheticData.mjs';

const PRODUCTION = 'habbit-tracker-12';
const env = process.env;
const need = ['EXPO_PUBLIC_FIREBASE_API_KEY', 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET', 'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID', 'EXPO_PUBLIC_FIREBASE_APP_ID', 'STAGING_TEST_EMAIL', 'STAGING_TEST_PASSWORD'];
const missing = need.filter((k) => !env[k]);
if (missing.length) { console.error(`Missing environment variables: ${missing.join(', ')}. See the header of this script.`); process.exit(2); }
if (env.EXPO_PUBLIC_FIREBASE_PROJECT_ID === PRODUCTION || /habbit-tracker/i.test(env.EXPO_PUBLIC_FIREBASE_PROJECT_ID)) {
  console.error(`REFUSING to run: project "${env.EXPO_PUBLIC_FIREBASE_PROJECT_ID}" looks like production. This script is for a separate STAGING project only.`);
  process.exit(3);
}
if (!process.argv.includes('--yes')) { console.error(`This writes synthetic data into project "${env.EXPO_PUBLIC_FIREBASE_PROJECT_ID}" as the test user. Re-run with --yes to confirm.`); process.exit(2); }

const { initializeApp } = await import('firebase/app');
const { getAuth, signInWithEmailAndPassword } = await import('firebase/auth');
const fsm = await import('firebase/firestore');
const app = initializeApp({ apiKey: env.EXPO_PUBLIC_FIREBASE_API_KEY, authDomain: env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN, projectId: env.EXPO_PUBLIC_FIREBASE_PROJECT_ID, storageBucket: env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET, messagingSenderId: env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID, appId: env.EXPO_PUBLIC_FIREBASE_APP_ID });
const uid = (await signInWithEmailAndPassword(getAuth(app), env.STAGING_TEST_EMAIL, env.STAGING_TEST_PASSWORD)).user.uid;
const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
console.error(`Seeding project ${env.EXPO_PUBLIC_FIREBASE_PROJECT_ID} (staging) for the signed-in test user ...`);
const summary = await seedAccount({ db: fsm.getFirestore(app), uid, fs: fsm, today, includeRiskProbes: process.argv.includes('--risk-probes') });
console.error(`Done: ${JSON.stringify(summary)}`);
process.exit(0);
