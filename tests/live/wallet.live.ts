/**
 * LIVE Phase 9D.5 test against the real Firebase project (habbit-tracker-12) with a DEDICATED TEST ACCOUNT. Never use a real
 * user's account: the ledger is append-only (the rules forbid deleting or editing entries), so what these tests write stays.
 *
 *   $env:LIVE_TEST_EMAIL = 'test-account@example.com'
 *   $env:LIVE_TEST_PASSWORD = '...'
 *   $env:LIVE_TEST_SPEND = '1'        # optional: also run the purchase / freeze-application steps (spends 20 coins per run)
 *   npm run test:live
 *
 * It uses the app's real ledger, runner, reader and listeners. Without credentials it is skipped. Credentials and config values
 * are never printed, and nothing is written to any user but the signed-in test account.
 *
 * What stays behind, per run (documented so the account can be topped up):
 *   always       0 net coins: one reward granted then reversed (entries `daily_2020-01-01_grant{n}` / `_rev{n}`, one inactive reward record)
 *   with SPEND   -20 coins (one purchase entry), +1 -1 freeze (net 0), one application entry, one freeze record and one monthly counter
 *                in a PAST month (2015-xx) so the account's CURRENT month allowance is never consumed.
 * The wallet of any other account is never read or written (the isolation test only proves the rules refuse a foreign read).
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const EMAIL = process.env.LIVE_TEST_EMAIL;
const PASSWORD = process.env.LIVE_TEST_PASSWORD;
const SPEND = process.env.LIVE_TEST_SPEND === '1';
const run = EMAIL && PASSWORD ? describe : describe.skip;

try {
  for (const line of readFileSync(join(__dirname, '..', '..', '.env.local'), 'utf8').split(/\r?\n/)) {
    const m = /^(EXPO_PUBLIC_[A-Z_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  /* the describe below fails with a clear Firebase configuration error */
}

type Wallet = { coins: number; freezesOwned: number; pending: number };

run('Phase 9D.5 wallet against the real Firestore (dedicated test account)', () => {
  let uid = '';
  const raw = async (path: string) => (await (await import('@/services/firestoreReader')).firestoreReader.getDoc(path))?.data ?? null;
  const load = async () => (await import('@/services/cloudRepository')).loadCloudData((await import('@/services/firestoreReader')).firestoreReader, uid);
  const ledger = async () => (await import('@/services/cloudLedger')).createCloudLedger((await import('@/services/firestoreLedger')).firestoreLedgerRunner, uid);
  const walletOf = async (): Promise<Wallet> => {
    const d = (await raw(`users/${uid}`))!;
    return { coins: Number(d.coins ?? 0), freezesOwned: Number(d.freezesOwned ?? 0), pending: Number(d.pendingAdjustment ?? 0) };
  };
  const todayKey = () => {
    const t = new Date();
    return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  };
  let baseline: Wallet;

  beforeAll(async () => {
    const { auth } = await import('@/services/firebase');
    const { signInWithEmailAndPassword } = await import('firebase/auth');
    uid = (await signInWithEmailAndPassword(auth, EMAIL!, PASSWORD!)).user.uid;
  });

  afterAll(async () => {
    const { auth } = await import('@/services/firebase');
    const { signOut } = await import('firebase/auth');
    await signOut(auth).catch(() => undefined);
  });

  it('the test account has a wallet, readable through the same converters as Android; its balance is captured before any write', async () => {
    const data = await load();
    expect(data.uid).toBe(uid);
    expect(data.profileExists).toBe(true);
    baseline = await walletOf();
    expect(baseline.coins).toBeGreaterThanOrEqual(0);
    expect(baseline.pending).toBeGreaterThanOrEqual(0);
    expect(data.ledger.wallet).toEqual(baseline);
    // every transaction on record maps without losing its Kotlin fields
    for (const t of data.transactions) expect(typeof t.type).toBe('string');
  });

  it("the rules refuse to read another user's wallet (account isolation is enforced by Firestore, not only by the app)", async () => {
    const { firestoreReader } = await import('@/services/firestoreReader');
    await expect(firestoreReader.getDoc('users/zz-not-my-uid-0000')).rejects.toMatchObject({ code: 'permission-denied' });
    await expect(firestoreReader.listDocs('users/zz-not-my-uid-0000/walletTransactions')).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('a reward is granted, repeated (Duplicate), reversed and reversed again (Duplicate): the net balance change is zero', async () => {
    const l = await ledger();
    const id = 'daily_2020-01-01'; // a past month: never in anyone\'s reward window, so no device reconciles it
    const g = { id, type: 'daily_completion', amount: 1, date: '2020-01-01' };
    const rec = await raw(`users/${uid}/rewards/${id}`);
    if (rec && rec.active === true) await l.revokeReward(id); // leave the record inactive, whatever an earlier run left
    const before = await walletOf();
    const granted = await l.grantReward(g);
    expect(granted.kind).toBe('done');
    // the entry's coinDelta is what reached the balance (the rest of the coin, if any, paid down a pending adjustment)
    expect((await walletOf()).coins).toBe(before.coins + (granted.kind === 'done' ? granted.tx.coinDelta : 0));
    expect((await l.grantReward(g)).kind).toBe('duplicate');
    const reversed = await l.revokeReward(id);
    expect(reversed.kind).toBe('done');
    expect((await l.revokeReward(id)).kind).toBe('duplicate');
    expect(await walletOf()).toEqual(before);
    const entry = await raw(`users/${uid}/walletTransactions/${reversed.kind === 'done' ? reversed.tx.id : 'x'}`);
    expect(entry).toMatchObject({ type: 'reward_reversal', rewardId: id });
    expect(await raw(`users/${uid}/rewards/${id}`)).toMatchObject({ active: false });
  });

  it('two tabs granting the same reward at once (real Firestore contention): paid exactly once', async () => {
    const l = await ledger();
    const id = 'daily_2020-01-01';
    const g = { id, type: 'daily_completion', amount: 1, date: '2020-01-01' };
    const before = await walletOf();
    const results = await Promise.all([l.grantReward(g), l.grantReward(g)]);
    expect(results.map((r) => r.kind).sort()).toEqual(['done', 'duplicate']);
    expect((await walletOf()).coins).toBeGreaterThanOrEqual(before.coins); // +1, or less if a pending adjustment absorbed it
    await l.revokeReward(id);
    expect(await walletOf()).toEqual(before);
  });

  (SPEND ? it : it.skip)('freeze purchase: one transaction, the exact Kotlin entry; the same attempt twice (and in parallel) buys once', async () => {
    const l = await ledger();
    const w = await walletOf();
    const month = todayKey().slice(0, 7);
    const used = Number(((await raw(`users/${uid}/freezeMonths/${month}`)) ?? { count: 0 }).count ?? 0);
    if (w.coins < 20 || used >= 3 || w.freezesOwned >= 3 - used) {
      console.warn('SKIPPED purchase: the test account needs >= 20 coins and room for another freeze this month');
      return;
    }
    const requestId = randomUUID();
    const [a, b] = await Promise.all([l.buyFreeze(requestId, todayKey()), l.buyFreeze(requestId, todayKey())]);
    expect([a.kind, b.kind].sort()).toEqual(['done', 'duplicate']);
    const after = await walletOf();
    expect(after).toEqual({ coins: w.coins - 20, freezesOwned: w.freezesOwned + 1, pending: w.pending });
    const entry = await raw(`users/${uid}/walletTransactions/freeze_buy_${requestId}`);
    expect(entry).toMatchObject({ type: 'freeze_purchase', coinDelta: -20, freezeDelta: 1, balanceAfter: w.coins - 20, date: todayKey() });
    expect(entry && 'rewardId' in entry).toBe(false);
    expect((await raw(`users/${uid}`))!.lastTransactionId).toBe(`freeze_buy_${requestId}`);
    expect((await l.buyFreeze(requestId, todayKey())).kind).toBe('duplicate'); // a later retry of the same attempt
    expect(await walletOf()).toEqual(after);
  });

  (SPEND ? it : it.skip)('freeze application: uses the owned freeze, never coins; a past month keeps the current allowance untouched; the same day cannot be protected twice', async () => {
    const l = await ledger();
    const w = await walletOf();
    if (w.freezesOwned < 1) {
      console.warn('SKIPPED application: the test account owns no freeze');
      return;
    }
    // a past month whose counter is still free (each month can take 3 applications, and they can never be undone)
    let month = '';
    for (let y = 2015; y <= 2019 && !month; y++) {
      for (let m = 1; m <= 12 && !month; m++) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        const c = Number(((await raw(`users/${uid}/freezeMonths/${key}`)) ?? { count: 0 }).count ?? 0);
        if (c < 3) month = key;
      }
    }
    expect(month).not.toBe('');
    const habitId = 'zz-live-test-habit';
    let date = '';
    for (let d = 1; d <= 28 && !date; d++) {
      const key = `${month}-${String(d).padStart(2, '0')}`;
      if (!(await raw(`users/${uid}/freezes/${habitId}_${key}`))) date = key;
    }
    expect(date).not.toBe('');
    const used = Number(((await raw(`users/${uid}/freezeMonths/${month}`)) ?? { count: 0 }).count ?? 0);
    const currentMonthBefore = await raw(`users/${uid}/freezeMonths/${todayKey().slice(0, 7)}`);
    const [a, b] = await Promise.all([l.applyFreeze(habitId, date), l.applyFreeze(habitId, date)]);
    expect([a.kind, b.kind].sort()).toEqual(['done', 'rejected']);
    expect((a.kind === 'rejected' ? a : b)).toEqual({ kind: 'rejected', reason: 'AlreadyFrozen' });
    expect(await walletOf()).toEqual({ coins: w.coins, freezesOwned: w.freezesOwned - 1, pending: w.pending });
    expect(await raw(`users/${uid}/freezes/${habitId}_${date}`)).toMatchObject({ habitId, date, month, paidWith: 'inventory', transactionId: `freeze_apply_${habitId}_${date}` });
    expect(await raw(`users/${uid}/freezeMonths/${month}`)).toMatchObject({ count: used + 1 });
    expect(await raw(`users/${uid}/walletTransactions/freeze_apply_${habitId}_${date}`)).toMatchObject({ type: 'freeze_application', coinDelta: 0, freezeDelta: -1, balanceAfter: w.coins, date, habitId });
    expect(await raw(`users/${uid}/freezeMonths/${todayKey().slice(0, 7)}`)).toEqual(currentMonthBefore); // the current month's counter is untouched
  });

  it('the live listeners deliver the wallet and the ledger, and dispose() removes them', async () => {
    const { createCloudSync } = await import('@/services/cloudSync');
    const { firestoreLive } = await import('@/services/firestoreLive');
    const events: { coins: number; tx: number }[] = [];
    const sync = createCloudSync(firestoreLive, uid, { onData: (e) => events.push({ coins: e.data.ledger.wallet.coins, tx: e.data.transactions.length }), onError: (f) => { throw new Error(f.message); } });
    const t0 = Date.now();
    while (events.length === 0 && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 200));
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1)!.coins).toBe((await walletOf()).coins);
    sync.dispose();
    expect(sync.isDisposed()).toBe(true);
    const seen = events.length;
    await (await ledger()).grantReward({ id: 'daily_2020-01-01', type: 'daily_completion', amount: 1, date: '2020-01-01' }).then(() => undefined);
    await new Promise((r) => setTimeout(r, 1500));
    expect(events.length).toBe(seen); // nothing is delivered after dispose
    await (await ledger()).revokeReward('daily_2020-01-01');
  });

  it("the wallet ends exactly where it started (net of the documented spend)", async () => {
    const end = await walletOf();
    expect(end.pending).toBe(baseline.pending);
    if (!SPEND) expect(end).toEqual(baseline);
    else expect(end.coins).toBeLessThanOrEqual(baseline.coins);
  });
});
