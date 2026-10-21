import { authRouter, meProcedure, sessionRouter } from "#auth/router";
import { caseRouter } from "#cases/router";
import { documentRouter } from "#documents/router";
import { createCallerFactory, router } from "#trpc/init";

export const appRouter = router({
  auth: authRouter,

  me: meProcedure,

  session: sessionRouter,

  case: caseRouter,

  document: documentRouter,
});

export const createCaller = createCallerFactory(appRouter);
export type AppRouter = typeof appRouter;
