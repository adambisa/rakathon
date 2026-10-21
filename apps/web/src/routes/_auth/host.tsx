import { createFileRoute, Navigate } from "@tanstack/react-router";

import { sessionQueryOptions } from "#lib/session-query";
import { trpcClient } from "#trpc";

export const Route = createFileRoute("/_auth/host")({
  loader: async ({ preload, context: { queryClient } }) => {
    if (preload) return;
    if ((await queryClient.query(sessionQueryOptions)) !== null) return;
    await trpcClient.auth.signInAsGuest.mutate();
    await queryClient.cancelQueries();
    await queryClient.resetQueries();
  },
  component: Host,
});

function Host() {
  return <Navigate to="/" replace />;
}
