import { createRouter } from "@tanstack/react-router";

import { RouteError } from "#components/route-error";
import { queryClient } from "#lib/query-client";
import { routeTree } from "#routeTree.gen";
import { createTrpcOptions } from "#trpc";

export const router = createRouter({
  routeTree,
  context: { queryClient, trpc: createTrpcOptions(queryClient) },
  defaultErrorComponent: RouteError,
  defaultPreload: "intent",
  defaultPendingMs: 300,
  defaultPendingMinMs: 300,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
