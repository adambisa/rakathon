import type { QueryClient } from "@tanstack/react-query";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import { createTRPCContext, createTRPCOptionsProxy } from "@trpc/tanstack-react-query";

import type { AppRouter } from "@prostapaper/api";

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>();

/** Auth rides on the Better Auth session cookie, which fetch sends same-origin. */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [httpBatchLink({ url: "/api/trpc" })],
});

export type TrpcOptions = ReturnType<typeof createTRPCOptionsProxy<AppRouter>>;
export const createTrpcOptions = (queryClient: QueryClient): TrpcOptions =>
  createTRPCOptionsProxy<AppRouter>({ client: trpcClient, queryClient });
