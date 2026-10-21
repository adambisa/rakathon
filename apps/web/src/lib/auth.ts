import type { trpcClient } from "#trpc";

export type Credentials = Parameters<typeof trpcClient.auth.signIn.mutate>[0];
export type Registration = Parameters<typeof trpcClient.auth.signUp.mutate>[0];
