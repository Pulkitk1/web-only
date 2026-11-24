import { describe, expect, it } from 'vitest';

import { DELETED_MESSAGE } from '@/domain/accountDeletion';
import { MemoryStorage, createDevicePrefs } from '@/services/devicePrefs';
import { createMigrationStore } from '@/services/guestMigrationStore';
import { createSessionController, type AuthBackend, type AuthUser } from '@/services/sessionController';
import { createFakeAuth, createFakeEraser, seedAccount } from './fakeEraser';

const UID = 'user-a';
const network = Object.assign(new Error('offline'), { code: 'unavailable' });

function setup(opts: { user?: AuthUser | null; guest?: boolean; withDeletion?: boolean } = {}) {
  const user = opts.user === undefined ? { uid: UID, email: 'a@b.co' } : opts.user;
  let guestOn = opts.guest ?? false;
  const backend: AuthBackend = {
    signIn: async (email) => ({ uid: UID, email }),
    signUp: async (email) => ({ uid: UID, email }),
    sendPasswordReset: async () => undefined,
    signOut: async () => undefined,
    onChange: (fn) => { queueMicrotask(() => fn(user)); return () => undefined; },
  };
  const storage = new MemoryStorage();
  const prefs = createDevicePrefs(storage);
  const migration = createMigrationStore(storage);
  const eraser = createFakeEraser({ ...seedAccount(UID), ...seedAccount('user-b') });
  const auth = createFakeAuth(UID);
  const deleted: string[] = [];
  const controller = createSessionController(
    backend,
    { get: () => guestOn, set: (on) => { guestOn = on; } },
    opts.withDeletion === false ? undefined : { auth, eraser, onDeleted: (uid) => { deleted.push(uid); prefs.clearAccount(uid); migration.forget(uid); } },
  );
  const seen: string[] = [];
  controller.subscribe(() => { const s = controller.getState(); seen.push(`${s.kind}${s.busy ? '+busy' : ''}${s.deleting ? '+deleting' : ''}`); });
  return { controller, eraser, auth, prefs, migration, deleted, seen, guestOn: () => guestOn };
}
const ready = () => new Promise((r) => setTimeout(r, 0));

describe('session: deleting an account', () => {
  it('a guest has no account to delete: nothing is called and no guest data is touched', async () => {
    const t = setup({ user: null, guest: true });
    await ready();
    expect(t.controller.getState().kind).toBe('guest');
    const r = await t.controller.deleteAccount('whatever');
    expect(r).toEqual({ ok: false, stage: 'password', message: 'Guest data has no account to delete.' });
    expect(t.auth.calls).toEqual([]);
    expect(t.eraser.log).toEqual([]);
    expect(t.guestOn()).toBe(true);
  });

  it('a signed-out visitor cannot delete anything either', async () => {
    const t = setup({ user: null });
    await ready();
    const r = await t.controller.deleteAccount('x');
    expect(r.ok).toBe(false);
    expect(t.eraser.log).toEqual([]);
  });

  it('a controller built without deletion support refuses', async () => {
    const t = setup({ withDeletion: false });
    await ready();
    expect((await t.controller.deleteAccount('x')).ok).toBe(false);
  });

  it('a wrong password changes nothing: the sheet gets the message, the app never stops listening (deleting stays false), no notice is left behind', async () => {
    const t = setup();
    await ready();
    const r = await t.controller.deleteAccount('wrong');
    expect(r).toEqual({ ok: false, stage: 'password', message: 'Incorrect password. Nothing was deleted.' });
    expect(t.seen.some((s) => s.includes('deleting'))).toBe(false);
    expect(t.controller.getState()).toMatchObject({ kind: 'firebase', busy: false, deleting: false, notice: null });
    expect(t.eraser.log).toEqual([]);
  });

  it('success: the app is "deleting" only after the password was accepted, then the user is signed out with a confirmation; only this account is gone', async () => {
    const t = setup();
    await ready();
    t.prefs.setHabitReminders(UID, false);
    t.prefs.setHabitReminders('user-b', false);
    t.prefs.setHabitReminders('guest', false);
    const r = await t.controller.deleteAccount('correct-password');
    expect(r).toEqual({ ok: true });
    expect(t.seen).toContain('firebase+busy+deleting');
    expect(t.seen.indexOf('firebase+busy')).toBeLessThan(t.seen.indexOf('firebase+busy+deleting'));
    const s = t.controller.getState();
    expect(s).toMatchObject({ kind: 'signedOut', uid: null, deleting: false, busy: false, notice: { kind: 'success', message: DELETED_MESSAGE } });
    expect(t.auth.loginDeleted).toBe(true);
    expect([...t.eraser.docs.keys()].some((p) => p.startsWith(`users/${UID}`))).toBe(false);
    expect([...t.eraser.docs.keys()].some((p) => p.startsWith('users/user-b'))).toBe(true);
    // device preferences: this account's are removed, another account's and the guest's stay
    expect(t.deleted).toEqual([UID]);
    expect(t.prefs.habitReminders(UID)).toBe(true); // back to the default
    expect(t.prefs.habitReminders('user-b')).toBe(false);
    expect(t.prefs.habitReminders('guest')).toBe(false);
    expect(t.guestOn()).toBe(false);
  });

  it('a data failure leaves the account signed in with an error notice, and a retry finishes it', async () => {
    const t = setup();
    await ready();
    t.eraser.failDeleteOn = { call: 2, error: network };
    const first = await t.controller.deleteAccount('correct-password');
    expect(first).toMatchObject({ ok: false, stage: 'data' });
    expect(t.controller.getState()).toMatchObject({ kind: 'firebase', deleting: false, busy: false, notice: { kind: 'error' } });
    expect(t.controller.getState().notice?.message).toContain('try Delete Account again');
    expect(t.auth.loginDeleted).toBe(false);
    expect(t.deleted).toEqual([]); // local preferences are kept while the account still exists
    const second = await t.controller.deleteAccount('correct-password');
    expect(second).toEqual({ ok: true });
    expect(t.controller.getState()).toMatchObject({ kind: 'signedOut', notice: { kind: 'success' } });
  });

  it('data gone but the login could not be removed: an honest notice, and the retry removes the login', async () => {
    const t = setup();
    await ready();
    t.auth.failLoginDelete = network;
    const first = await t.controller.deleteAccount('correct-password');
    expect(first).toMatchObject({ ok: false, stage: 'login' });
    expect(t.controller.getState().notice).toMatchObject({ kind: 'error' });
    expect(t.controller.getState().notice?.message).toContain('Your data was deleted, but the login');
    const second = await t.controller.deleteAccount('correct-password');
    expect(second).toEqual({ ok: true });
    expect(t.auth.loginDeleted).toBe(true);
  });

  it('a second request while one is running is refused, and signing in is blocked while deleting', async () => {
    const t = setup();
    await ready();
    let releaseAuth: () => void = () => undefined;
    const gate = new Promise<void>((r) => { releaseAuth = r; });
    const realReauth = t.auth.reauthenticate;
    t.auth.reauthenticate = async (...a) => { await gate; return realReauth(...a); };
    const first = t.controller.deleteAccount('correct-password');
    const second = await t.controller.deleteAccount('correct-password');
    expect(second).toMatchObject({ ok: false, message: 'Another action is in progress. Please wait a moment.' });
    expect(await t.controller.authenticate('x@y.co', 'secret1', false)).toBe(false);
    releaseAuth();
    expect(await first).toEqual({ ok: true });
  });

  it('the confirmation notice goes away when the user starts signing in or chooses guest mode, or dismisses it', async () => {
    const a = setup();
    await ready();
    await a.controller.deleteAccount('correct-password');
    expect(a.controller.getState().notice).not.toBeNull();
    a.controller.dismissNotice();
    expect(a.controller.getState().notice).toBeNull();

    const b = setup();
    await ready();
    await b.controller.deleteAccount('correct-password');
    b.controller.continueAsGuest();
    expect(b.controller.getState()).toMatchObject({ kind: 'guest', notice: null });

    const c = setup();
    await ready();
    await c.controller.deleteAccount('correct-password');
    await c.controller.authenticate('new@b.co', 'secret1', false);
    expect(c.controller.getState().notice).toBeNull();
  });

  it('a failure while clearing local preferences never turns a finished deletion into a failure', async () => {
    const user = { uid: UID, email: 'a@b.co' };
    const eraser = createFakeEraser(seedAccount(UID));
    const auth = createFakeAuth(UID);
    const controller = createSessionController(
      { signIn: async () => user, signUp: async () => user, sendPasswordReset: async () => undefined, signOut: async () => undefined, onChange: (fn) => { queueMicrotask(() => fn(user)); return () => undefined; } },
      { get: () => false, set: () => undefined },
      { auth, eraser, onDeleted: () => { throw new Error('storage unavailable'); } },
    );
    await ready();
    expect(await controller.deleteAccount('correct-password')).toEqual({ ok: true });
    expect(controller.getState().notice).toMatchObject({ kind: 'success' });
  });
});

describe('device storage after a deletion', () => {
  it("forgets the deleted account's reminder and streak-alert switches, celebrations and import record, but nothing of anyone else", () => {
    const storage = new MemoryStorage();
    const prefs = createDevicePrefs(storage);
    const migration = createMigrationStore(storage);
    for (const uid of ['gone', 'stays']) {
      prefs.setHabitReminders(uid, false);
      prefs.setStreakAlerts(uid, false);
      prefs.claimRestDayCelebration(uid, 'h1', '2026-11-01', '2026-11-02');
      prefs.addPendingMilestone(uid, { habitId: 'h1', milestone: 5, coins: 5 });
      migration.decline(uid);
    }
    prefs.clearAccount('gone');
    migration.forget('gone');
    expect(prefs.habitReminders('gone')).toBe(true);
    expect(prefs.streakAlerts('gone')).toBe(true);
    expect(prefs.pendingMilestones('gone')).toEqual([]);
    expect(migration.isDeclined('gone')).toBe(false);
    expect(prefs.habitReminders('stays')).toBe(false);
    expect(prefs.streakAlerts('stays')).toBe(false);
    expect(prefs.pendingMilestones('stays')).toHaveLength(1);
    expect(migration.isDeclined('stays')).toBe(true);
  });
});
