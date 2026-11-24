/**
 * Development-only helpers (never installed in a production build, and not part of Kotlin, so no screen offers them):
 *  - `?resetData=1` on any URL clears the saved app data and starts again from the mock data;
 *  - `window.consistoDev.resetData()` does the same and reloads; `window.consistoDev.dump()` returns the stored JSON.
 * Theme and notification preferences are left alone.
 */
import { appStorage, STORAGE_KEY } from './appStorage';
import { devicePrefs } from './devicePrefs';

const GUEST = 'guest';

/** Clears the saved data and the per-account markers that refer to it (pending milestones, rest-day celebrations). */
export function resetSavedData() {
  appStorage.clear();
  devicePrefs.clearAccount(GUEST);
}

export function installDevTools() {
  if (typeof __DEV__ === 'undefined' || !__DEV__ || typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.get('resetData') === '1') {
      resetSavedData();
      url.searchParams.delete('resetData');
      // The router may rewrite the address while it starts up, so strip the parameter again once it has settled
      // (otherwise every later refresh would reset the data again).
      const clean = url.pathname + url.search + url.hash;
      window.history.replaceState(null, '', clean);
      setTimeout(() => window.location.search.includes('resetData') && window.history.replaceState(null, '', clean), 400);
    }
    (window as unknown as { consistoDev: object }).consistoDev = {
      resetData: () => {
        resetSavedData();
        window.location.reload();
      },
      dump: () => window.localStorage.getItem(STORAGE_KEY),
    };
  } catch {
    /* dev helper only */
  }
}
