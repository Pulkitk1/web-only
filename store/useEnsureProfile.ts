import { useEffect } from 'react';

import { createProfileEnsurer, ENSURE_RETRY_DELAYS_MS } from '@/services/profileEnsurer';
import type { MigrationBackend } from '@/services/guestMigration';

/**
 * Creates the signed-in account's profile (and so its welcome wallet) when the server says it has none. Runs only on a
 * server-confirmed snapshot (never on cached data, which can be missing documents that do exist), stops as soon as the profile
 * appears, and retries after a failure with a growing pause. See `services/profileEnsurer.ts`.
 */
export function useEnsureProfile(opts: { uid: string; email: string; profileExists: boolean; fromCache: boolean; backend: Pick<MigrationBackend, 'ensureProfile'> }) {
  const { uid, email, profileExists, fromCache, backend } = opts;
  useEffect(() => {
    if (!uid || profileExists || fromCache) return;
    const ensurer = createProfileEnsurer(backend);
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (n: number) => {
      ensurer.ensure(uid, email).catch(() => {
        const wait = ENSURE_RETRY_DELAYS_MS[n];
        if (!stopped && wait !== undefined) timer = setTimeout(() => attempt(n + 1), wait);
      });
    };
    attempt(0);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [uid, email, profileExists, fromCache, backend]);
}
