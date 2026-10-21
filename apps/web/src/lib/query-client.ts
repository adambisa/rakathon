import { MutationCache, QueryClient } from "@tanstack/react-query";

import { toast } from "#lib/toast";

declare module "@tanstack/react-query" {
  interface Register {
    mutationMeta: { toast?: boolean };
  }
}

export const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
  mutationCache: new MutationCache({
    onError: (error, ...rest) => {
      const mutation = rest[2];
      if (mutation.meta?.toast === false) return;
      toast.error(error);
    },
  }),
});
