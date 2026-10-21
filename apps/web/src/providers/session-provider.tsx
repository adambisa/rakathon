import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";

import type { Credentials, Registration } from "#lib/auth";
import { sessionQueryOptions } from "#lib/session-query";
import { SessionContext } from "#lib/use-session";
import { trpcClient } from "#trpc";

export interface SessionProviderProps {
  children: ReactNode;
}

export function SessionProvider({ children }: SessionProviderProps) {
  const queryClient = useQueryClient();
  const sessionQuery = useQuery(sessionQueryOptions);

  const adoptSession = async () => {
    await queryClient.cancelQueries();
    await queryClient.resetQueries();
  };

  const signIn = useMutation({
    scope: { id: "session" },
    mutationFn: async (credentials: Credentials) => {
      await trpcClient.auth.signIn.mutate(credentials);

      await adoptSession();
    },
  });

  const signUp = useMutation({
    scope: { id: "session" },
    mutationFn: async (registration: Registration) => {
      await trpcClient.auth.signUp.mutate(registration);

      await adoptSession();
    },
  });

  const signOut = useMutation({
    scope: { id: "session" },
    mutationFn: async () => {
      await trpcClient.auth.signOut.mutate();
      await adoptSession();
    },
  });

  return (
    <SessionContext
      value={{
        session: sessionQuery.data ?? null,
        isPending: sessionQuery.isPending || signIn.isPending || signUp.isPending || signOut.isPending,
        error: sessionQuery.error ?? signIn.error ?? signUp.error ?? signOut.error,
        signIn: (credentials) => signIn.mutate(credentials),
        signUp: (registration) => signUp.mutate(registration),
        signOut: () => signOut.mutate(),
      }}
    >
      {children}
    </SessionContext>
  );
}
