/**
 * Firebase SDK setup (Phase 9B): one shared Firebase App plus its Auth and Firestore instances.
 *
 * Nothing in the app imports this file yet — login, registration and database access come in later phases — so
 * the existing local-only behaviour is unchanged. Configuration comes from Expo public env vars (`.env.local`,
 * never committed). A Firebase *web* config is an identifier, not a secret; access is controlled by Auth + rules.
 *
 * Expo inlines `process.env.EXPO_PUBLIC_*` only for literal property access, so each variable is spelled out.
 */
import { getApp, getApps, initializeApp, type FirebaseApp, type FirebaseOptions } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';

import { startAppCheck } from './appCheck';

const raw = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

const ENV_NAMES: Record<keyof typeof raw, string> = {
  apiKey: 'EXPO_PUBLIC_FIREBASE_API_KEY',
  authDomain: 'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  projectId: 'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  storageBucket: 'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'EXPO_PUBLIC_FIREBASE_APP_ID',
};

/** Names (never values) of the required variables that are missing or blank. */
export function missingFirebaseEnv(config: Partial<Record<keyof typeof raw, string | undefined>> = raw): string[] {
  return (Object.keys(ENV_NAMES) as (keyof typeof raw)[]).filter((k) => !config[k] || !config[k]!.trim()).map((k) => ENV_NAMES[k]);
}

const missing = missingFirebaseEnv();
if (missing.length > 0) {
  throw new Error(`Firebase is not configured. Missing environment variables: ${missing.join(', ')}. Add them to web/.env.local and restart Expo.`);
}

const firebaseConfig: FirebaseOptions = { ...(raw as Record<keyof typeof raw, string>) };

/** Reuses the existing app on hot reload / repeated imports instead of creating a duplicate. */
export const firebaseApp: FirebaseApp = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
// App Check starts before Authentication and Firestore are used. It does nothing without a site key and is never enforced from here.
startAppCheck(firebaseApp); // never throws; a second call (hot reload) is a harmless no-op
export const auth: Auth = getAuth(firebaseApp);
export const db: Firestore = getFirestore(firebaseApp);
