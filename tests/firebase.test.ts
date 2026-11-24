import { afterEach, describe, expect, it, vi } from 'vitest';

const NAMES = [
  'EXPO_PUBLIC_FIREBASE_API_KEY',
  'EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN',
  'EXPO_PUBLIC_FIREBASE_PROJECT_ID',
  'EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET',
  'EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID',
  'EXPO_PUBLIC_FIREBASE_APP_ID',
];

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('services/firebase', () => {
  it('throws naming (not valuing) the missing variables', async () => {
    for (const n of NAMES) vi.stubEnv(n, '');
    vi.stubEnv('EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'test-project');
    const err = await import('@/services/firebase').then(() => null, (e: Error) => e);
    expect(err?.message).toContain('EXPO_PUBLIC_FIREBASE_API_KEY');
    expect(err?.message).not.toContain('EXPO_PUBLIC_FIREBASE_PROJECT_ID');
    expect(err?.message).not.toContain('test-project');
  });

  it('initialises a single app with auth and firestore, even if imported twice', async () => {
    for (const n of NAMES) vi.stubEnv(n, `test-${n.toLowerCase()}`);
    const a = await import('@/services/firebase');
    vi.resetModules();
    const b = await import('@/services/firebase');
    expect(a.firebaseApp).toBe(b.firebaseApp);
    expect(a.auth.app).toBe(a.firebaseApp);
    expect(a.db.app).toBe(a.firebaseApp);
    const { getApps } = await import('firebase/app');
    expect(getApps()).toHaveLength(1);
  });
});
