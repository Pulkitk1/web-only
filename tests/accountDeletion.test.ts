import { describe, expect, it } from 'vitest';

import { BATCH, DataRemainsError, DELETED_MESSAGE, deleteAccountFlow, eraseUserData, failureHint, MAX_PASSES, passwordErrorMessage } from '@/domain/accountDeletion';
import { createFakeAuth, createFakeEraser, seedAccount } from './fakeEraser';

const UID = 'user-a';
const OTHER = 'user-b';
const network = Object.assign(new Error('offline'), { code: 'unavailable' });
const run = (eraser: ReturnType<typeof createFakeEraser>, auth = createFakeAuth(UID), password = 'correct-password') =>
  deleteAccountFlow({ auth, eraser, uid: UID, email: 'a@b.co', password });

describe('eraseUserData', () => {
  it('removes every document under the account, the notes included, and the profile last; the flag is set first', async () => {
    const e = createFakeEraser({ ...seedAccount(UID), ...seedAccount(OTHER) });
    await eraseUserData(e, UID);
    expect([...e.docs.keys()].filter((p) => p.startsWith(`users/${UID}`))).toEqual([]);
    expect(e.log[0]).toBe(`flag ${UID}`);
    expect(e.log.at(-1)).toBe(`delete-profile ${UID}`);
    expect(e.log.filter((l) => l.startsWith('delete users/')).some((l) => l.includes('/dayNotes/'))).toBe(true);
  });

  it("never touches another account's documents", async () => {
    const e = createFakeEraser({ ...seedAccount(UID), ...seedAccount(OTHER) });
    const otherBefore = [...e.docs.keys()].filter((p) => p.startsWith(`users/${OTHER}`)).sort();
    await eraseUserData(e, UID);
    expect([...e.docs.keys()].filter((p) => p.startsWith(`users/${OTHER}`)).sort()).toEqual(otherBefore);
    expect(e.log.some((l) => l.includes(OTHER))).toBe(false);
  });

  it("deletes a habit's completions before the habit itself (a completion whose habit is gone could never be found again)", async () => {
    const e = createFakeEraser(seedAccount(UID));
    await eraseUserData(e, UID);
    const idx = (p: string) => e.log.findIndex((l) => l === `delete ${p}`);
    for (const h of ['h1', 'h2']) {
      const habit = idx(`users/${UID}/habits/${h}`);
      expect(habit).toBeGreaterThan(-1);
      for (const l of e.log.filter((x) => x.startsWith(`delete users/${UID}/habits/${h}/completions/`))) expect(e.log.indexOf(l)).toBeLessThan(habit);
    }
  });

  it('works in batches of at most 400 for large accounts (450 completions, 410 habits)', async () => {
    const docs = seedAccount(UID);
    for (let i = 0; i < 450; i++) docs[`users/${UID}/habits/h1/completions/c${String(i).padStart(4, '0')}`] = { completed: true };
    for (let i = 0; i < 410; i++) docs[`users/${UID}/habits/bulk${String(i).padStart(4, '0')}`] = { name: 'x' };
    docs[`users/${UID}/habits/bulk0409/completions/2026-11-01`] = { completed: true };
    const e = createFakeEraser(docs);
    await eraseUserData(e, UID);
    expect(Math.max(...e.batches)).toBeLessThanOrEqual(BATCH);
    expect(e.batches.length).toBeGreaterThan(3);
    expect([...e.docs.keys()].filter((p) => p.startsWith(`users/${UID}`))).toEqual([]);
  });

  it('does nothing if the profile is already gone (a previous run finished the data)', async () => {
    const e = createFakeEraser({ [`users/${OTHER}`]: { email: 'x' } });
    await eraseUserData(e, UID);
    expect(e.log).toEqual([]);
  });

  it('a failure halfway leaves the profile (with its marker) so a retry continues; the retry finishes the job', async () => {
    const e = createFakeEraser(seedAccount(UID));
    e.failDeleteOn = { call: 4, error: network };
    await expect(eraseUserData(e, UID)).rejects.toBe(network);
    expect(e.docs.has(`users/${UID}`)).toBe(true); // the profile is deleted last, so it is still here
    expect(e.docs.get(`users/${UID}`)?.deletionRequested).toBe(true);
    expect([...e.docs.keys()].some((p) => p.startsWith(`users/${UID}/`))).toBe(true); // some data remains
    await eraseUserData(e, UID);
    expect([...e.docs.keys()].filter((p) => p.startsWith(`users/${UID}`))).toEqual([]);
  });

  it('a document that appears from another device meanwhile is removed by the next pass', async () => {
    const e = createFakeEraser(seedAccount(UID));
    e.after = { call: 1, run: () => e.docs.set(`users/${UID}/walletTransactions/late`, { type: 'x' }) };
    await eraseUserData(e, UID);
    expect(e.docs.has(`users/${UID}/walletTransactions/late`)).toBe(false);
    expect(e.docs.has(`users/${UID}`)).toBe(false);
  });

  it(`gives up after ${MAX_PASSES} passes if documents keep appearing, and does NOT delete the profile`, async () => {
    const e = createFakeEraser(seedAccount(UID));
    e.reappear = { collection: `users/${UID}/rewards`, path: `users/${UID}/rewards/keeps-coming-back` };
    await expect(eraseUserData(e, UID)).rejects.toBeInstanceOf(DataRemainsError);
    expect(e.docs.has(`users/${UID}`)).toBe(true);
  });

  it('stops instead of looping forever if deletes silently do nothing', async () => {
    const e = createFakeEraser(seedAccount(UID));
    e.ignoreDeletes = true;
    await expect(eraseUserData(e, UID)).rejects.toBeInstanceOf(DataRemainsError);
    expect(e.docs.has(`users/${UID}`)).toBe(true);
  });

  it('never reports success if the profile is still there after its deletion', async () => {
    const e = createFakeEraser(seedAccount(UID));
    e.ignoreProfileDelete = true;
    await expect(eraseUserData(e, UID)).rejects.toBeInstanceOf(DataRemainsError);
  });

  it.each(['', 'a/b', '..', 'users/x', 'a b', 'x'.repeat(200)])('refuses an unsafe account id %j before reading or deleting anything', async (bad) => {
    const e = createFakeEraser({ ...seedAccount(UID) });
    await expect(eraseUserData(e, bad)).rejects.toThrow(/Invalid account id/);
    expect(e.log).toEqual([]);
  });
});

describe('deleteAccountFlow', () => {
  it('a wrong password deletes nothing and says so (stage: password)', async () => {
    const e = createFakeEraser(seedAccount(UID));
    const auth = createFakeAuth(UID);
    const r = await run(e, auth, 'wrong');
    expect(r).toEqual({ ok: false, stage: 'password', message: 'Incorrect password. Nothing was deleted.' });
    expect(e.log).toEqual([]);
    expect(auth.calls).toEqual(['reauth']);
    expect(auth.loginDeleted).toBe(false);
  });

  it('on success the data and the login are gone, in that order, and the confirmation callback ran once after the password was accepted', async () => {
    const e = createFakeEraser(seedAccount(UID));
    const auth = createFakeAuth(UID);
    let confirmed = 0;
    const r = await deleteAccountFlow({ auth, eraser: e, uid: UID, email: 'a@b.co', password: 'correct-password', onConfirmed: () => { confirmed++; expect(e.log).toEqual([]); } });
    expect(r).toEqual({ ok: true });
    expect(confirmed).toBe(1);
    expect(auth.calls).toEqual(['reauth', 'deleteLogin']);
    expect(e.docs.size).toBe(0);
    expect(DELETED_MESSAGE).toMatch(/deleted/);
  });

  it('the confirmation callback does not run when the password is wrong', async () => {
    let confirmed = 0;
    await deleteAccountFlow({ auth: createFakeAuth(UID), eraser: createFakeEraser(seedAccount(UID)), uid: UID, email: 'a@b.co', password: 'nope', onConfirmed: () => { confirmed++; } });
    expect(confirmed).toBe(0);
  });

  it('a data failure keeps the login, reports a partial deletion honestly (stage: data), and a retry succeeds', async () => {
    const e = createFakeEraser(seedAccount(UID));
    const auth = createFakeAuth(UID);
    e.failDeleteOn = { call: 3, error: network };
    const first = await run(e, auth);
    expect(first).toMatchObject({ ok: false, stage: 'data' });
    expect(!first.ok && first.message).toContain('no connection');
    expect(!first.ok && first.message).toContain('some of your data may already be removed');
    expect(auth.loginDeleted).toBe(false); // the login is untouched, so the account is not "deleted"
    expect(auth.calls).toEqual(['reauth']);
    const second = await run(e, auth);
    expect(second).toEqual({ ok: true });
    expect(e.docs.size).toBe(0);
    expect(auth.loginDeleted).toBe(true);
  });

  it('a permission error is named as such', async () => {
    const e = createFakeEraser(seedAccount(UID));
    e.failDeleteOn = { call: 1, error: Object.assign(new Error('x'), { code: 'permission-denied' }) };
    const r = await run(e);
    expect(!r.ok && r.message).toContain('permission denied by security rules');
  });

  it('data deleted but the login could not be removed (stage: login): the retry skips the finished data work and removes the login', async () => {
    const e = createFakeEraser(seedAccount(UID));
    const auth = createFakeAuth(UID);
    auth.failLoginDelete = network;
    const first = await run(e, auth);
    expect(first).toMatchObject({ ok: false, stage: 'login' });
    expect(!first.ok && first.message).toContain('Your data was deleted, but the login');
    expect(e.docs.size).toBe(0);
    e.log.length = 0;
    const second = await run(e, auth);
    expect(second).toEqual({ ok: true });
    expect(e.log).toEqual([]); // nothing left to delete: the profile is gone
    expect(auth.loginDeleted).toBe(true);
  });

  it('being offline while deleting reports it and deletes nothing more', async () => {
    const e = createFakeEraser(seedAccount(UID));
    e.offline = true;
    const r = await run(e);
    expect(r).toMatchObject({ ok: false, stage: 'data' });
    expect(!r.ok && r.message).toContain('no connection');
    expect(e.docs.size).toBeGreaterThan(0);
  });

  it('a persistent leftover is reported as a data failure, never as success, and the login is kept', async () => {
    const e = createFakeEraser(seedAccount(UID));
    e.reappear = { collection: `users/${UID}/freezes`, path: `users/${UID}/freezes/ghost` };
    const auth = createFakeAuth(UID);
    const r = await run(e, auth);
    expect(r).toMatchObject({ ok: false, stage: 'data' });
    expect(!r.ok && r.message).toContain('some data could not be removed');
    expect(auth.loginDeleted).toBe(false);
  });

  it('a different signed-in user (mismatch) deletes nothing', async () => {
    const e = createFakeEraser({ ...seedAccount(UID), ...seedAccount(OTHER) });
    const auth = createFakeAuth(OTHER); // signed in as someone else
    const r = await run(e, auth);
    expect(r).toMatchObject({ ok: false, stage: 'password' });
    expect(e.log).toEqual([]);
    expect(e.docs.size).toBeGreaterThan(0);
  });
});

describe('messages', () => {
  it.each([
    ['auth/wrong-password', 'Incorrect password. Nothing was deleted.'],
    ['auth/invalid-credential', 'Incorrect password. Nothing was deleted.'],
    ['auth/network-request-failed', "You're offline. Connect to the internet and try again. Nothing was deleted."],
    ['auth/too-many-requests', 'Too many attempts. Please wait a moment and try again. Nothing was deleted.'],
    ['auth/user-mismatch', 'Please sign in again. Nothing was deleted.'],
    ['something-else', "Couldn't confirm your password. Nothing was deleted."],
  ])('password error %s', (code, msg) => expect(passwordErrorMessage({ code })).toBe(msg));

  it.each([
    ['unavailable', 'no connection'],
    ['auth/network-request-failed', 'no connection'],
    ['permission-denied', 'permission denied by security rules'],
    ['internal', 'unexpected error'],
  ])('failure hint %s', (code, hint) => expect(failureHint({ code })).toBe(hint));
  it('an error without a code is "unexpected error"', () => expect(failureHint(new Error('x'))).toBe('unexpected error'));
});
