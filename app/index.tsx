import { Redirect } from 'expo-router';

/**
 * Entry route. Android starts on a splash and then routes by sign-in state (`Routes.destinationFor`). The session gate in
 * `_layout.tsx` shows the login screen until a session exists, so by the time this renders the guest session is active.
 * (The Phase 1 branded placeholder was replaced by this redirect.)
 */
export default function Index() {
  return <Redirect href="/habits" />;
}
