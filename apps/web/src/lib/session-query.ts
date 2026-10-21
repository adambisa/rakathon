import { queryOptions } from "@tanstack/react-query";

import { trpcClient } from "#trpc";

export type Session = Awaited<ReturnType<typeof trpcClient.session.get.query>>;

export const sessionQueryOptions = queryOptions({
  queryKey: ["session"],
  queryFn: async ({ signal }) => trpcClient.session.get.query(undefined, { signal }),
  staleTime: Infinity,
  refetchOnWindowFocus: "always",
  refetchOnReconnect: "always",
});
