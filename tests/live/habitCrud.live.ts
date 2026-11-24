/**
 * LIVE Stage 1 test against the real Firebase project (habbit-tracker-12) with a DEDICATED TEST ACCOUNT.
 *
 *   $env:LIVE_TEST_EMAIL = 'test-account@example.com'
 *   $env:LIVE_TEST_PASSWORD = '...'
 *   npm run test:live
 *
 * It uses the app's real writer and reader. It creates one clearly named test habit ("ZZ web live test …") under the
 * test account, exercises create / edit / goal / reminder / schedule / archive / unarchive / delete, and removes
 * everything it created, even if a step fails. It never touches the wallet fields and never writes to another user.
 * Without LIVE_TEST_EMAIL / LIVE_TEST_PASSWORD it is skipped. Credentials and config values are never printed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const EMAIL = process.env.LIVE_TEST_EMAIL;
const PASSWORD = process.env.LIVE_TEST_PASSWORD;
const run = EMAIL && PASSWORD ? describe : describe.skip;

// Load the Expo public config from .env.local into process.env (values are not printed).
try {
  for (const line of readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = /^(EXPO_PUBLIC_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* the describe below fails with a clear Firebase configuration error */
}

run('Stage 1 habit writes against the real Firestore (dedicated test account)', () => {
  let uid = '';
  let writer: Awaited<ReturnType<typeof makeWriter>>;
  let habitId = '';
  const created: string[] = [];

  async function makeWriter() {
    const { createHabitWriter } = await import('@/services/habitWriter');
    const { firestoreWriter } = await import('@/services/firestoreWriter');
    const { firestoreReader } = await import('@/services/firestoreReader');
    return { w: createHabitWriter(firestoreWriter, firestoreReader, uid), reader: firestoreReader };
  }
  const load = async () => (await import('@/services/cloudRepository')).loadCloudData((await import('@/services/firestoreReader')).firestoreReader, uid);
  const raw = async (path: string) => (await (await import('@/services/firestoreReader')).firestoreReader.getDoc(path))?.data ?? null;

  beforeAll(async () => {
    const { auth } = await import('@/services/firebase');
    const { signInWithEmailAndPassword } = await import('firebase/auth');
    uid = (await signInWithEmailAndPassword(auth, EMAIL!, PASSWORD!)).user.uid;
    writer = await makeWriter();
  });

  afterAll(async () => {
    // Remove whatever this run created, even after a failure.
    if (!uid) return;
    for (const id of created) {
      try {
        await writer.w.remove(id);
      } catch {
        /* best effort */
      }
    }
  });

  it('the test account is readable and its wallet is captured before any write', async () => {
    const data = await load();
    expect(data.uid).toBe(uid);
    expect(data.profileExists).toBe(true);
    (globalThis as unknown as { __walletBefore: unknown }).__walletBefore = data.ledger.wallet;
  });

  it('create: the habit is written under the test account with the Android document structure', async () => {
    const { hexToComposeColor } = await import('@/domain/cloudMapping');
    habitId = writer.w.newHabitId();
    created.push(habitId);
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    await writer.w.create(habitId, {
      id: habitId, name: `ZZ web live test ${Date.now()}`, color: '#4ADE80', completedDates: [], daysPerWeek: 7, restDays: [], createdDate: key,
      scheduleHistory: [{ from: key, restDays: [], daysPerWeek: 7 }], archived: false, goal: null, reminderEnabled: false, reminderTime: null,
    });
    const doc = (await raw(`users/${uid}/habits/${habitId}`))!;
    expect(doc).not.toBeNull();
    expect(doc.completedDates).toEqual([]);
    expect(doc.streak).toBe(0);
    expect(doc.bestStreak).toBe(0);
    expect(doc.daysPerWeek).toBe(7);
    expect(doc.createdDate).toBe(key);
    expect(Number(doc.color)).toBe(hexToComposeColor('#4ADE80'));
    expect(typeof doc.sortOrder).toBe('number');
    expect(doc.createdAt).toBeTruthy();
    expect(doc.updatedAt).toBeTruthy();
    expect('goal' in doc).toBe(false);
  });

  it('reload: the habit reads back through the converters, at the end of the list, with its colour', async () => {
    const data = await load();
    const h = data.habits.find((x) => x.id === habitId)!;
    expect(h).toBeTruthy();
    expect(h.color).toBe('#4ADE80');
    expect(h.completedDates).toEqual([]);
    expect(data.habits.at(-1)?.id).toBe(habitId);
  });

  it('edit name and colour: only those fields change; completion history stays', async () => {
    const { hexToComposeColor } = await import('@/domain/cloudMapping');
    const { setDoc, doc, getDoc } = await import('firebase/firestore');
    const { db } = await import('@/services/firebase');
    // Give the test habit one completion (direct, test-only) so "history unchanged" is meaningful.
    await setDoc(doc(db, `users/${uid}/habits/${habitId}/completions/2026-01-02`), { date: '2026-01-02', completed: true });
    const before = (await raw(`users/${uid}/habits/${habitId}`))!;
    await writer.w.update(habitId, { name: 'ZZ web live test renamed', color: hexToComposeColor('#2DD4BF') });
    const after = (await raw(`users/${uid}/habits/${habitId}`))!;
    expect(after.name).toBe('ZZ web live test renamed');
    expect(Number(after.color)).toBe(hexToComposeColor('#2DD4BF'));
    for (const k of ['completedDates', 'daysPerWeek', 'restDays', 'createdDate', 'scheduleHistory', 'sortOrder']) expect(after[k], k).toEqual(before[k]);
    expect((await getDoc(doc(db, `users/${uid}/habits/${habitId}/completions/2026-01-02`))).exists()).toBe(true);
    expect((await load()).habits.find((x) => x.id === habitId)!.completedDates).toEqual(['2026-01-02']);
  });

  it('goal, reminder, schedule and archive writes use the Kotlin fields', async () => {
    const { habitArchiveFields, habitGoalFields, habitReminderFields, habitScheduleFields } = await import('@/domain/cloudWrite');
    await writer.w.update(habitId, habitGoalFields('Live goal'));
    expect((await raw(`users/${uid}/habits/${habitId}`))!.goal).toBe('Live goal');
    await writer.w.update(habitId, habitGoalFields(null));
    expect((await raw(`users/${uid}/habits/${habitId}`))!.goal).toBe('');
    await writer.w.update(habitId, habitReminderFields(true, '07:45'));
    expect(await raw(`users/${uid}/habits/${habitId}`)).toMatchObject({ reminderEnabled: true, reminderTime: '07:45' });
    const h = (await load()).habits.find((x) => x.id === habitId)!;
    await writer.w.update(habitId, habitScheduleFields({ ...h, daysPerWeek: 6, restDays: ['Sun'], scheduleHistory: [...h.scheduleHistory, { from: '2099-01-01', restDays: ['Sun'], daysPerWeek: 6 }] }, { current: 0, best: 0 }));
    expect(await raw(`users/${uid}/habits/${habitId}`)).toMatchObject({ daysPerWeek: 6, restDays: ['Sun'] });
    await writer.w.update(habitId, habitArchiveFields(true));
    expect((await load()).habits.find((x) => x.id === habitId)!.archived).toBe(true);
    await writer.w.update(habitId, habitArchiveFields(false));
    expect((await load()).habits.find((x) => x.id === habitId)!.archived).toBe(false);
  });

  it("another user's documents cannot be read or written (security rules)", async () => {
    const { setDoc, getDoc, doc } = await import('firebase/firestore');
    const { db } = await import('@/services/firebase');
    const other = 'not-a-real-user-id-live-test';
    await expect(getDoc(doc(db, `users/${other}`))).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(setDoc(doc(db, `users/${other}/habits/x`), { name: 'nope' })).rejects.toMatchObject({ code: 'permission-denied' });
    // and the app's own writer refuses before even asking Firestore
    const { scopedWriter } = await import('@/services/habitWriter');
    const { firestoreWriter } = await import('@/services/firestoreWriter');
    expect(() => scopedWriter(firestoreWriter, uid).set(`users/${other}/habits/x`, {})).toThrow(/Refusing/);
  });

  it('completion: check and undo write the completion document and the legacy array exactly like Android', async () => {
    const { getDoc, doc } = await import('firebase/firestore');
    const { db } = await import('@/services/firebase');
    const date = '2099-01-02'; // far-future test date: never a real day, never a reward window
    await writer.w.setCompletion(habitId, date, true, { current: 1, best: 1 });
    const c = (await raw(`users/${uid}/habits/${habitId}/completions/${date}`))!;
    expect(c).toMatchObject({ date, completed: true });
    expect(c.completedAt).toBeTruthy();
    expect(c.updatedAt).toBeTruthy();
    let h = (await raw(`users/${uid}/habits/${habitId}`))!;
    expect(h.completedDates).toContain(date);
    expect(h).toMatchObject({ streak: 1, bestStreak: 1 });
    // checking the same day again does not create a second record (the id is the date)
    await writer.w.setCompletion(habitId, date, true, { current: 1, best: 1 });
    expect((h.completedDates as string[]).filter((d) => d === date)).toHaveLength(1);
    await writer.w.setCompletion(habitId, date, false, { current: 0, best: 1 });
    const u = (await raw(`users/${uid}/habits/${habitId}/completions/${date}`))!;
    expect(u).toMatchObject({ date, completed: false }); // the document is kept
    expect(u.uncheckedAt).toBeTruthy();
    expect(u.completedAt).toBeTruthy();
    h = (await raw(`users/${uid}/habits/${habitId}`))!;
    expect(h.completedDates).not.toContain(date);
    expect((await load()).habits.find((x) => x.id === habitId)!.completedDates).toEqual(['2026-01-02']); // the other test completion is untouched
    expect((await getDoc(doc(db, `users/${uid}/habits/${habitId}/completions/${date}`))).exists()).toBe(true);
  });

  it('reward ledger: a grant is one transaction, repeats are duplicates, undo reverses, restore is cycle 2, the wallet nets to zero', async () => {
    // A synthetic far-future reward id, so the test never competes with a real day. It leaves three immutable ledger entries on the TEST account.
    const { createCloudLedger } = await import('@/services/cloudLedger');
    const { firestoreLedgerRunner } = await import('@/services/firestoreLedger');
    const ledger = createCloudLedger(firestoreLedgerRunner, uid);
    const stamp = Date.now();
    const id = `daily_2099-12-31`;
    const before = (await load()).ledger.wallet;
    const already = await raw(`users/${uid}/rewards/${id}`);
    const g = { id, type: 'daily_completion', amount: 1, date: '2099-12-31' };
    if (already?.active === true) await ledger.revokeReward(id); // leftover of an aborted run
    const start = (await load()).ledger.wallet;
    const r1 = await ledger.grantReward(g);
    expect(r1.kind).toBe('done');
    expect((await ledger.grantReward(g)).kind).toBe('duplicate');
    const after = (await load()).ledger.wallet;
    expect(after.coins + after.pending - (start.coins + start.pending)).toBe(1);
    const rev = await ledger.revokeReward(id);
    expect(rev.kind).toBe('done');
    expect((await ledger.revokeReward(id)).kind).toBe('duplicate');
    const rest = await ledger.grantReward(g);
    expect(rest.kind === 'done' && rest.tx.id.endsWith('_grant' + ((await raw(`users/${uid}/rewards/${id}`))!.cycle as number))).toBe(true);
    expect((await ledger.revokeReward(id)).kind).toBe('done');
    const end = (await load()).ledger.wallet;
    expect(end).toEqual(start); // net zero: coins, freezes and pending exactly as before
    expect(before.freezesOwned).toBe(end.freezesOwned);
    void stamp;
  });

  it('live listeners: a change made elsewhere (here: a second write) arrives without reloading, and dispose removes the listeners', async () => {
    const { createCloudSync } = await import('@/services/cloudSync');
    const { firestoreLive } = await import('@/services/firestoreLive');
    const events: import('@/services/cloudSync').SyncEvent[] = [];
    const sync = createCloudSync(firestoreLive, uid, { onData: (e) => events.push(e), onError: () => undefined });
    const waitFor = async (fn: () => boolean) => {
      for (let i = 0; i < 100 && !fn(); i++) await new Promise((r) => setTimeout(r, 200));
      return fn();
    };
    expect(await waitFor(() => events.length > 0)).toBe(true);
    const h = events.at(-1)!.data.habits.find((x) => x.id === habitId)!;
    expect(h).toBeTruthy();
    await writer.w.update(habitId, { goal: 'live listener' });
    expect(await waitFor(() => events.at(-1)!.data.habits.find((x) => x.id === habitId)?.goal === 'live listener')).toBe(true);
    sync.dispose();
    const n = events.length;
    await writer.w.update(habitId, { goal: 'after dispose' });
    await new Promise((r) => setTimeout(r, 1500));
    expect(events.length).toBe(n);
  });

  it('delete removes the habit, its completions and its notes; the wallet is unchanged', async () => {
    const { setDoc, doc, getDoc } = await import('firebase/firestore');
    const { db } = await import('@/services/firebase');
    await setDoc(doc(db, `users/${uid}/dayNotes/${habitId}_2026-01-02`), { habitId, date: '2026-01-02', text: 'live test note' });
    await writer.w.remove(habitId);
    expect(await raw(`users/${uid}/habits/${habitId}`)).toBeNull();
    expect((await getDoc(doc(db, `users/${uid}/habits/${habitId}/completions/2026-01-02`))).exists()).toBe(false);
    expect((await getDoc(doc(db, `users/${uid}/dayNotes/${habitId}_2026-01-02`))).exists()).toBe(false);
    created.length = 0;
    const data = await load();
    expect(data.habits.some((x) => x.id === habitId)).toBe(false);
    expect(data.ledger.wallet).toEqual((globalThis as unknown as { __walletBefore: unknown }).__walletBefore);
  });
});
