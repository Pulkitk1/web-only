import { describe, expect, it, vi } from 'vitest';

import type { RawDoc } from '@/domain/cloudMapping';
import { createCloudSync, type LiveSource, type SnapshotMeta, type SyncEvent } from '@/services/cloudSync';

/** A fake Firestore for listeners: documents by path, listeners that can be fired by hand (an "Android" write), counted so leaks show. */
function fakeLive(initial: Record<string, Record<string, unknown>>) {
  const docs: Record<string, Record<string, unknown>> = JSON.parse(JSON.stringify(initial));
  const subs = new Set<{ path: string; kind: 'doc' | 'col'; next: (v: never, m: SnapshotMeta) => void; error: (e: unknown) => void; id: number }>();
  let n = 0;
  let cache = false;
  const snapDoc = (path: string): RawDoc | null => (path in docs ? { id: path.split('/').pop()!, data: JSON.parse(JSON.stringify(docs[path])) } : null);
  const snapCol = (path: string): RawDoc[] => Object.keys(docs).filter((p) => p.startsWith(path + '/') && !p.slice(path.length + 1).includes('/')).map((p) => snapDoc(p)!);
  const fire = (s: { path: string; kind: string; next: (v: never, m: SnapshotMeta) => void }) =>
    s.kind === 'doc' ? (s.next as (d: RawDoc | null, m: SnapshotMeta) => void)(snapDoc(s.path), { fromCache: cache }) : (s.next as (d: RawDoc[], m: SnapshotMeta) => void)(snapCol(s.path), { fromCache: cache });
  const source: LiveSource = {
    watchDoc(path, next, error) {
      const s = { path, kind: 'doc' as const, next: next as never, error, id: ++n };
      subs.add(s);
      queueMicrotask(() => subs.has(s) && fire(s));
      return () => subs.delete(s);
    },
    watchCollection(path, next, error) {
      const s = { path, kind: 'col' as const, next: next as never, error, id: ++n };
      subs.add(s);
      queueMicrotask(() => subs.has(s) && fire(s));
      return () => subs.delete(s);
    },
  };
  return {
    source,
    docs,
    activeListeners: () => subs.size,
    /** Another device writes: change documents, then every affected listener fires. */
    remote(change: (d: typeof docs) => void) {
      change(docs);
      [...subs].forEach(fire);
    },
    setCache: (v: boolean) => (cache = v),
    refire: () => [...subs].forEach(fire),
    fail: (e: unknown) => [...subs][0]?.error(e),
  };
}

const U = 'u1';
const base = () => ({
  [`users/${U}`]: { email: 'a@b.co', coins: 20, freezesOwned: 0 },
  [`users/${U}/habits/h1`]: { name: 'Read', color: -4140122267844886528, createdDate: '2026-11-01', sortOrder: 0 },
  [`users/${U}/habits/h1/completions/2026-11-20`]: { date: '2026-11-20', completed: true },
});
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));

function start(fs: ReturnType<typeof fakeLive>, uid = U) {
  const events: SyncEvent[] = [];
  const errors: unknown[] = [];
  const sync = createCloudSync(fs.source, uid, { onData: (e) => events.push(e), onError: (f) => errors.push(f) }, 10);
  return { sync, events, errors };
}

describe('live cloud sync', () => {
  it('delivers one merged snapshot once every listener (including each habit\'s completions) has reported', async () => {
    const fs = fakeLive(base());
    const { events } = start(fs);
    await wait();
    expect(events).toHaveLength(1);
    expect(events[0].data.habits.map((h) => [h.id, h.completedDates])).toEqual([['h1', ['2026-11-20']]]);
    expect(events[0].data.ledger.wallet.coins).toBe(20);
    expect(events[0].fromCache).toBe(false);
  });

  it('opens exactly the documented listeners for the user (and one per habit for completions)', async () => {
    const fs = fakeLive(base());
    start(fs);
    await wait();
    expect(fs.activeListeners()).toBe(1 + 6 + 1); // user + 6 collections + 1 habit's completions
  });

  it('an Android completion arrives without a reload: the new completion document updates the habit', async () => {
    const fs = fakeLive(base());
    const { events } = start(fs);
    await wait();
    fs.remote((d) => {
      d[`users/${U}/habits/h1/completions/2026-11-21`] = { date: '2026-11-21', completed: true };
    });
    await wait();
    expect(events.at(-1)!.data.habits[0].completedDates).toEqual(['2026-11-20', '2026-11-21']);
  });

  it('an Android undo arrives: completed=false removes the day even though the legacy array still lists it', async () => {
    const fs = fakeLive({ ...base(), [`users/${U}/habits/h1`]: { name: 'Read', createdDate: '2026-11-01', completedDates: ['2026-11-20'] } });
    const { events } = start(fs);
    await wait();
    expect(events.at(-1)!.data.habits[0].completedDates).toEqual(['2026-11-20']);
    fs.remote((d) => {
      d[`users/${U}/habits/h1/completions/2026-11-20`] = { date: '2026-11-20', completed: false };
    });
    await wait();
    expect(events.at(-1)!.data.habits[0].completedDates).toEqual([]);
  });

  it('Android rewards and wallet changes arrive too (coins, reward records, ledger entries)', async () => {
    const fs = fakeLive(base());
    const { events } = start(fs);
    await wait();
    fs.remote((d) => {
      d[`users/${U}`] = { ...d[`users/${U}`], coins: 21, lastTransactionId: 'daily_2026-11-21' };
      d[`users/${U}/rewards/daily_2026-11-21`] = { active: true, cycle: 1, amount: 1, type: 'daily_completion', date: '2026-11-21' };
      d[`users/${U}/walletTransactions/daily_2026-11-21`] = { type: 'daily_completion', coinDelta: 1, balanceAfter: 21 };
    });
    await wait();
    const last = events.at(-1)!.data;
    expect(last.ledger.wallet.coins).toBe(21);
    expect(last.ledger.rewards['daily_2026-11-21']).toMatchObject({ active: true, amount: 1 });
    expect(last.transactions.map((t) => t.id)).toEqual(['daily_2026-11-21']);
  });

  it('a habit added on Android gets its own completions listener and is only delivered with its history; a deleted habit\'s listener is removed', async () => {
    const fs = fakeLive(base());
    const { events } = start(fs);
    await wait();
    const before = fs.activeListeners();
    fs.remote((d) => {
      d[`users/${U}/habits/h2`] = { name: 'Run', createdDate: '2026-11-21', sortOrder: 5 };
      d[`users/${U}/habits/h2/completions/2026-11-21`] = { date: '2026-11-21', completed: true };
    });
    await wait();
    expect(fs.activeListeners()).toBe(before + 1);
    expect(events.at(-1)!.data.habits.map((h) => h.id)).toEqual(['h1', 'h2']);
    expect(events.at(-1)!.data.habits[1].completedDates).toEqual(['2026-11-21']);
    fs.remote((d) => {
      delete d[`users/${U}/habits/h2`];
      delete d[`users/${U}/habits/h2/completions/2026-11-21`];
    });
    await wait();
    expect(fs.activeListeners()).toBe(before);
    expect(events.at(-1)!.data.habits.map((h) => h.id)).toEqual(['h1']);
  });

  it('coalesces a burst of listener events (a batch reaches several listeners) into one emission', async () => {
    const fs = fakeLive(base());
    const { events } = start(fs);
    await wait();
    const n = events.length;
    fs.remote((d) => {
      d[`users/${U}/habits/h1/completions/2026-11-21`] = { date: '2026-11-21', completed: true };
      d[`users/${U}/habits/h1`] = { ...d[`users/${U}/habits/h1`], completedDates: ['2026-11-21'], streak: 2 };
    });
    await wait();
    expect(events.length - n).toBe(1);
  });

  it('reports fromCache while the server has not confirmed (offline / reconnecting) and false again after reconnecting', async () => {
    const fs = fakeLive(base());
    fs.setCache(true);
    const { events } = start(fs);
    await wait();
    expect(events.at(-1)!.fromCache).toBe(true);
    fs.setCache(false);
    fs.refire();
    await wait();
    expect(events.at(-1)!.fromCache).toBe(false);
  });

  it('duplicate identical snapshots keep the data identical (replays are harmless)', async () => {
    const fs = fakeLive(base());
    const { events } = start(fs);
    await wait();
    fs.refire();
    fs.refire();
    await wait();
    expect(JSON.stringify(events.at(-1)!.data)).toBe(JSON.stringify(events[0].data));
  });

  it('dispose (sign-out / switching account) removes every listener and nothing is delivered afterwards', async () => {
    const fs = fakeLive(base());
    const { sync, events } = start(fs);
    await wait();
    expect(fs.activeListeners()).toBeGreaterThan(0);
    const n = events.length;
    sync.dispose();
    expect(fs.activeListeners()).toBe(0);
    fs.remote((d) => {
      d[`users/${U}/habits/h1/completions/2026-11-22`] = { date: '2026-11-22', completed: true };
    });
    await wait();
    expect(events.length).toBe(n);
    sync.dispose(); // idempotent
  });

  it('dispose before the first snapshot delivers nothing', async () => {
    const fs = fakeLive(base());
    const { sync, events } = start(fs);
    sync.dispose();
    await wait();
    expect(events).toHaveLength(0);
    expect(fs.activeListeners()).toBe(0);
  });

  it("one user's events never reach another user's session", async () => {
    const fs = fakeLive({ ...base(), 'users/u2': { email: 'b@c.co', coins: 999 }, 'users/u2/habits/x': { name: 'Secret' } });
    const a = start(fs, 'u1');
    await wait();
    a.sync.dispose();
    const b = start(fs, 'u2');
    await wait();
    fs.remote((d) => {
      d['users/u2'] = { ...d['users/u2'], coins: 1000 };
      d[`users/${U}`] = { ...d[`users/${U}`], coins: 5 };
    });
    await wait();
    expect(JSON.stringify(a.events.at(-1)!.data)).not.toContain('Secret');
    expect(a.events.at(-1)!.data.ledger.wallet.coins).toBe(20); // unchanged after u1 was disposed
    expect(b.events.at(-1)!.data.uid).toBe('u2');
    expect(b.events.at(-1)!.data.ledger.wallet.coins).toBe(1000);
    expect(JSON.stringify(b.events.map((e) => e.data))).not.toContain('"a@b.co"');
  });

  it('a listener error (e.g. permission denied) disposes everything and reports once', async () => {
    const fs = fakeLive(base());
    const { events, errors } = start(fs);
    await wait();
    const n = events.length;
    fs.fail(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    fs.fail(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    await wait();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ kind: 'permission-denied' });
    expect(fs.activeListeners()).toBe(0);
    expect(events.length).toBe(n);
  });

  it('an account with no documents at all is an empty account (nothing is created)', async () => {
    const fs = fakeLive({});
    const { events } = start(fs, 'fresh');
    await wait();
    expect(events[0].data.profileExists).toBe(false);
    expect(events[0].data.habits).toEqual([]);
    expect(Object.keys(fs.docs)).toEqual([]);
  });

  it('refuses a malformed uid', () => {
    const fs = fakeLive({});
    expect(() => createCloudSync(fs.source, 'a/b', { onData: vi.fn(), onError: vi.fn() })).toThrow();
    expect(() => createCloudSync(fs.source, '', { onData: vi.fn(), onError: vi.fn() })).toThrow();
  });
});
