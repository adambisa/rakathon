import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import { SessionProvider } from "#providers/session-provider";
import type { TrpcOptions } from "#trpc";
import { Toaster } from "#ui";

export interface RouterContext {
  queryClient: QueryClient;
  trpc: TrpcOptions;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <SessionProvider>
      <Outlet />
      <Toaster />
    </SessionProvider>
  );
}
