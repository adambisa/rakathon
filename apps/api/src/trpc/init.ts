import { initTRPC, TRPCError } from "@trpc/server";

import type { TrpcContext } from "#trpc/context";

const t = initTRPC.context<TrpcContext>().create({
  errorFormatter({ shape, error }) {
    const { stack: _stack, ...data } = shape.data;

    return {
      ...shape,
      message: error.code === "INTERNAL_SERVER_ERROR" ? "Internal server error" : shape.message,
      data,
    };
  },
});

export const router = t.router;
export const createCallerFactory = t.createCallerFactory;
export const publicProcedure = t.procedure;

/** Requires a session; narrows ctx.session to non-null for everything downstream. */
export const protectedProcedure = publicProcedure.use(async function isAuthed({ ctx, next }) {
  if (ctx.session === null) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return next({ ctx: { session: ctx.session } });
});

/** Custom file uploads require a registered account. */
export const registeredProcedure = protectedProcedure.use(async function isRegistered({ ctx, next }) {
  if (ctx.session.user.isAnonymous) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Guests can only use example cases" });
  }

  return next();
});
