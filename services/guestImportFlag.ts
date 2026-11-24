/**
 * Rollout gate for the guest import (Phase 10.1). An imported habit carries `rewardsIgnoredThrough`, which only protects an account's
 * rewards on a device whose app understands it. The import is therefore OFF in production builds until every Android build in use reads
 * the field too; development builds (and the tests) always have it on. To switch it on for a production build, set
 * `EXPO_PUBLIC_GUEST_IMPORT_ENABLED=true` at build time, and only after the Android release that reads `rewardsIgnoredThrough` is out.
 */
export function guestImportEnabled(env: { dev?: boolean; flag?: string } = { dev: typeof __DEV__ !== 'undefined' && __DEV__, flag: process.env.EXPO_PUBLIC_GUEST_IMPORT_ENABLED }): boolean {
  return env.dev === true || env.flag === 'true';
}
