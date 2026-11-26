import { describe, expect, it } from 'vitest';

import { createProfileEnsurer, ENSURE_RETRY_DELAYS_MS } from '@/services/profileEnsurer';
import { newProfileFields } from '@/services/guestMigration';
import { createFakeMigration } from './fakeMigration';

const UID = 'uid-new';
const EMAIL = 'new@example.test';
const root = `users/${UID}`;

describe('account profile creation (the new-account wallet)', () => {
  it('the profile a new account gets is 20 coins, no freezes and the welcome-freeze marker (Android loadUser)', () => {
    expect(newProfileFields(EMAIL)).toMatchObject({ email: EMAIL, displayName: 'new', coins: 20, freezesOwned: 0, welcomeFreezePending: true });
  });

  it('creates the missing profile once', async () => {
    const fake = createFakeMigration(UID);
    const ensurer = createProfileEnsurer(fake.backend);
    expect(await ensurer.ensure(UID, EMAIL)).toBe('created');
    expect(fake.get(root)).toMatchObject({ coins: 20, freezesOwned: 0, welcomeFreezePending: true });
    expect(await ensurer.ensure(UID, EMAIL)).toBe('exists');
    expect(fake.state.profileCreates).toBe(1);
  });

  it('overlapping calls in one page share a single request', async () => {
    const fake = createFakeMigration(UID);
    const ensurer = createProfileEnsurer(fake.backend);
    const results = await Promise.all([ensurer.ensure(UID, EMAIL), ensurer.ensure(UID, EMAIL), ensurer.ensure(UID, EMAIL)]);
    expect(results).toEqual(['created', 'created', 'created']);
    expect(fake.state.profileCreates).toBe(1);
  });

  it('two browsers (separate ensurers) racing create exactly one profile', async () => {
    const fake = createFakeMigration(UID);
    fake.state.yieldInTransaction = true;
    const results = await Promise.all([createProfileEnsurer(fake.backend).ensure(UID, EMAIL), createProfileEnsurer(fake.backend).ensure(UID, EMAIL)]);
    expect([...results].sort()).toEqual(['created', 'exists']);
    expect(fake.state.profileCreates).toBe(1);
  });

  it('a failed creation writes nothing, remembers nothing, and the retry creates the profile', async () => {
    const fake = createFakeMigration(UID);
    const ensurer = createProfileEnsurer(fake.backend);
    fake.state.offline = true;
    await expect(ensurer.ensure(UID, EMAIL)).rejects.toMatchObject({ code: 'unavailable' });
    expect(fake.get(root)).toBeUndefined();
    fake.state.offline = false;
    expect(await ensurer.ensure(UID, EMAIL)).toBe('created');
    expect(fake.state.profileCreates).toBe(1);
  });

  it('an existing account is never changed: balance, freezes, markers and other fields stay exactly as they were', async () => {
    const existing = { email: EMAIL, displayName: 'Custom', coins: 91, freezesOwned: 3, pendingAdjustment: 2, welcomeFreezePending: false, lastTransactionId: 'daily_x' };
    const fake = createFakeMigration(UID, { [root]: existing });
    expect(await createProfileEnsurer(fake.backend).ensure(UID, EMAIL)).toBe('exists');
    expect(fake.get(root)).toEqual(existing);
    expect(fake.state.profileCreates).toBe(0);
  });

  it('refuses a user id that is not a plain id, and creates only that account', async () => {
    const fake = createFakeMigration(UID);
    const ensurer = createProfileEnsurer(fake.backend);
    await expect(ensurer.ensure('', EMAIL)).rejects.toThrow('Invalid user id');
    await expect(ensurer.ensure('a/b', EMAIL)).rejects.toThrow('Invalid user id');
    expect(fake.state.written).toEqual([]);
  });

  it('retries a few times, with growing pauses, before waiting for the next server snapshot', () => {
    expect(ENSURE_RETRY_DELAYS_MS.length).toBeGreaterThanOrEqual(3);
    expect([...ENSURE_RETRY_DELAYS_MS]).toEqual([...ENSURE_RETRY_DELAYS_MS].sort((a, b) => a - b));
  });
});
