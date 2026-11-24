/**
 * LIVE Phase 10 test against the real Firebase project (habbit-tracker-12) with a DEDICATED TEST ACCOUNT. Never use a real user's account.
 *
 *   $env:LIVE_TEST_EMAIL = 'test-account@example.com'
 *   $env:LIVE_TEST_PASSWORD = '...'
 *   npm run test:live
 *
 * It runs the app's real guest importer and real Firestore backend with made-up guest data (nothing from any real guest storage). Without
 * credentials it is skipped. It imports habits dated in 2015 only, so no device's reward window can ever consider them, and it deletes
 * every habit, completion and note it created when it finishes (habits are the one thing the rules let the owner delete). The wallet is
 * read before and after and must be identical: the import has no wallet code, and this proves it against the real rules.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const EMAIL = process.env.LIVE_TEST_EMAIL;
const PASSWORD = process.env.LIVE_TEST_PASSWORD;
const run = EMAIL && PASSWORD ? describe : describe.skip;

try {
  for (const line of readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = /^(EXPO_PUBLIC_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* the describe below fails with a clear Firebase configuration error */
}

run('Phase 10 guest import against the real Firestore (dedicated test account)', () => {
  let uid = '';
  const created = new Set<string>(); // habit ids to delete afterwards
  const raw = async (path: string) => (await (await import('@/services/firestoreReader')).firestoreReader.getDoc(path))?.data ?? null;
  const list = async (path: string) => (await import('@/services/firestoreReader')).firestoreReader.listDocs(path);

  const habit = (id: string, name: string, dates: string[]) => ({
    id,
    name,
    color: '#4ADE80',
    completedDates: dates,
    daysPerWeek: 5,
    restDays: ['Sat', 'Sun'],
    createdDate: '2015-06-01',
    scheduleHistory: [
      { from: '2015-06-01', restDays: ['Sun'], daysPerWeek: 6 },
      { from: '2015-06-10', restDays: ['Sat', 'Sun'], daysPerWeek: 5 },
    ],
    archived: false,
    goal: null,
    reminderEnabled: false,
    reminderTime: null,
  });
  const guest = () => ({
    habits: [habit('live-1', 'Live Test Habit A', ['2015-06-02', '2015-06-03', '2015-06-04']), { ...habit('live-2', 'Live Test Habit B (archived)', ['2015-06-05']), archived: true }],
    notes: { 'live-1': { '2015-06-03': 'Live test note' } },
  });
  const wallet = async () => {
    const d = (await raw(`users/${uid}`))!;
    const tx = await list(`users/${uid}/walletTransactions`);
    const rewards = await list(`users/${uid}/rewards`);
    return JSON.stringify({ coins: d.coins, freezesOwned: d.freezesOwned, pending: d.pendingAdjustment, last: d.lastTransactionId, tx: tx.map((t) => t.id).sort(), rewards: rewards.map((r) => [r.id, r.data.active]).sort() });
  };

  beforeAll(async () => {
    const { auth } = await import('@/services/firebase');
    const { signInWithEmailAndPassword } = await import('firebase/auth');
    uid = (await signInWithEmailAndPassword(auth, EMAIL!, PASSWORD!)).user.uid;
  });

  afterAll(async () => {
    const { db, auth } = await import('@/services/firebase');
    const { collection, deleteDoc, doc, getDocs } = await import('firebase/firestore');
    const { signOut } = await import('firebase/auth');
    for (const id of created) {
      for (const c of (await getDocs(collection(db, `users/${uid}/habits/${id}/completions`))).docs) await deleteDoc(c.ref);
      await deleteDoc(doc(db, `users/${uid}/habits/${id}`));
    }
    for (const n of (await getDocs(collection(db, `users/${uid}/dayNotes`))).docs) if (created.has(String(n.data().habitId))) await deleteDoc(n.ref);
    await signOut(auth).catch(() => undefined);
  });

  it('imports the chosen habits, their schedule history, completions and notes, verified from the server, and leaves the wallet exactly as it was', async () => {
    const { createGuestImporter } = await import('@/services/guestMigration');
    const { createMigrationStore } = await import('@/services/guestMigrationStore');
    const { MemoryStorage } = await import('@/services/devicePrefs');
    const { firestoreMigration } = await import('@/services/firestoreMigration');
    const walletBefore = await wallet();
    const store = createMigrationStore(new MemoryStorage());
    const importer = createGuestImporter({ backend: firestoreMigration, store, guest: guest });
    const steps: string[] = [];
    const report = await importer.migrate(uid, EMAIL!, ['live-1', 'live-2'], (s) => steps.push(s));
    Object.values(store.record(uid)!.idMap).forEach((id) => created.add(id));

    expect(report).toMatchObject({ habits: 2, checkIns: 4, notes: 1, profileCreated: false });
    expect(steps).toEqual(['preparing', 'uploading', 'verifying', 'completed']);
    expect(store.completed()).toMatchObject({ uid });

    const { loadCloudData } = await import('@/services/cloudRepository');
    const { firestoreReader } = await import('@/services/firestoreReader');
    const data = await loadCloudData(firestoreReader, uid);
    const a = data.habits.find((h) => h.name === 'Live Test Habit A')!;
    const b = data.habits.find((h) => h.name === 'Live Test Habit B (archived)')!;
    expect(a.completedDates).toEqual(['2015-06-02', '2015-06-03', '2015-06-04']);
    expect(a.scheduleHistory).toEqual([
      { from: '2015-06-01', restDays: ['Sun'], daysPerWeek: 6 },
      { from: '2015-06-10', restDays: ['Sat', 'Sun'], daysPerWeek: 5 },
    ]);
    expect(b.archived).toBe(true);
    expect(data.notes[a.id]).toEqual({ '2015-06-03': 'Live test note' });
    expect((await raw(`users/${uid}/habits/${a.id}`))!.migratedFrom).toMatch(/^[0-9a-f-]{36}:live-1$/);
    expect(await wallet()).toBe(walletBefore); // balance, freezes, pending, last transaction, every ledger entry and every reward record
  });

  it('the account’s existing profile is left alone (no reset, no overwrite)', async () => {
    const { firestoreMigration } = await import('@/services/firestoreMigration');
    const before = JSON.stringify(await raw(`users/${uid}`));
    expect(await firestoreMigration.ensureProfile(uid, EMAIL!)).toBe('exists');
    expect(JSON.stringify(await raw(`users/${uid}`))).toBe(before);
  });

  it('a second browser (its own record) imports the same guest ids without touching the first import', async () => {
    const { createGuestImporter } = await import('@/services/guestMigration');
    const { createMigrationStore } = await import('@/services/guestMigrationStore');
    const { MemoryStorage } = await import('@/services/devicePrefs');
    const { firestoreMigration } = await import('@/services/firestoreMigration');
    const walletBefore = await wallet();
    const store = createMigrationStore(new MemoryStorage());
    const report = await createGuestImporter({ backend: firestoreMigration, store, guest }).migrate(uid, EMAIL!, ['live-1']);
    Object.values(store.record(uid)!.idMap).forEach((id) => created.add(id));
    expect(report).toMatchObject({ habits: 1, notes: 1 });
    expect(created.size).toBe(3); // two ids from the first import and one distinct id from this one
    expect(await wallet()).toBe(walletBefore);
  });

  it('the rules refuse the import backend any write outside the signed-in account', async () => {
    const { firestoreMigration } = await import('@/services/firestoreMigration');
    await expect(firestoreMigration.setMany([{ path: 'users/zz-not-my-uid-0000/habits/x', fields: { name: 'nope' } }])).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(firestoreMigration.getDoc('users/zz-not-my-uid-0000')).rejects.toMatchObject({ code: 'permission-denied' });
  });
});
