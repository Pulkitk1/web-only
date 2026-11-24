import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';

import { sessionController } from '@/services/auth';
import type { SessionController, SessionState } from '@/services/sessionController';

const SessionContext = createContext<SessionController>(sessionController);

/** Provides the session controller (the Firebase-backed one by default). */
export function SessionProvider({ children, controller = sessionController }: { children: ReactNode; controller?: SessionController }) {
  return <SessionContext.Provider value={controller}>{children}</SessionContext.Provider>;
}

export type Session = SessionState & { controller: SessionController };

/** The current session (`loading` | `signedOut` | `guest` | `firebase`) and the sign-in actions. */
export function useSession(): Session {
  const controller = useContext(SessionContext);
  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return { ...state, controller };
}
