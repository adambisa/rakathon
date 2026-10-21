import { SignInSchema, SignUpSchema } from "#auth/validation";
import { protectedProcedure, publicProcedure, router } from "#trpc/init";

export const sessionRouter = router({
  get: publicProcedure.query(({ ctx }) => ctx.session),
});

export const meProcedure = protectedProcedure.query(({ ctx }) => ctx.session.user);

const authProcedure = publicProcedure.use(async ({ ctx, path, next }) => {
  await ctx.auth.authorizeRequest(path, ctx.request.headers);

  return next();
});

export const authRouter = router({
  signUp: authProcedure
    .input(SignUpSchema)
    .mutation(async ({ ctx, input }) => ctx.auth.signUp(input, ctx.request.headers, ctx.responseHeaders)),

  signIn: authProcedure
    .input(SignInSchema)
    .mutation(async ({ ctx, input }) => ctx.auth.signIn(input, ctx.request.headers, ctx.responseHeaders)),

  signInAsGuest: authProcedure.mutation(async ({ ctx }) =>
    ctx.auth.signInAsGuest(ctx.request.headers, ctx.responseHeaders),
  ),

  signOut: authProcedure.mutation(async ({ ctx }) =>
    ctx.auth.signOut(ctx.request.headers, ctx.responseHeaders),
  ),
});
