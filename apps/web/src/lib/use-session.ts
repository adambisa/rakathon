import { createContext, useContext } from "react";

import type { Credentials, Registration } from "#lib/auth";
import type { Session } from "#lib/session-query";

interface SessionState {
  session: Session;
  isPending: boolean;
  error: Error | null;
  signIn: (credentials: Credentials) => void;
  signUp: (registration: Registration) => void;
  signOut: () => void;
}

export const SessionContext = createContext<SessionState | undefined>(undefined);

export function useSession(): SessionState {
  const session = useContext(SessionContext);
  if (session === undefined) {
    throw new Error("useSession requires SessionProvider");
  }

  return session;
}
