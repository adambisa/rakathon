import { z } from "zod";

import { CaseId, CaseListInput } from "@prostapaper/contracts";

import { reviewRouter } from "#review/router";
import { protectedProcedure, registeredProcedure, router } from "#trpc/init";

export const caseRouter = router({
  review: reviewRouter,
  sharing: protectedProcedure.input(z.object({ caseId: CaseId })).query(async ({ ctx, input }) => {
    ctx.responseHeaders.set("Cache-Control", "no-store");

    return ctx.cases.sharing(input.caseId, ctx.session.user.id);
  }),

  addAccess: protectedProcedure
    .input(z.object({ caseId: CaseId, userId: z.string().min(1), role: z.enum(["reviewer", "viewer"]) }))
    .mutation(async ({ ctx, input }) => ctx.cases.addAccess(input, ctx.session.user.id)),

  list: protectedProcedure
    .input(CaseListInput)
    .query(async ({ ctx, input }) => ctx.cases.list(ctx.session.user.id, input.limit)),

  exports: protectedProcedure.query(async ({ ctx }) => ctx.cases.exports(ctx.session.user.id)),

  reviewQueue: protectedProcedure.query(async ({ ctx }) => ctx.cases.reviewQueue(ctx.session.user.id)),

  get: protectedProcedure
    .input(z.object({ caseId: CaseId }))
    .query(async ({ ctx, input }) => ctx.cases.findById(input.caseId, ctx.session.user.id)),

  createSample: protectedProcedure
    .input(z.object({ sampleId: z.enum(["0005", "0008", "0012"]) }))
    .mutation(async ({ ctx, input }) => {
      const created = await ctx.cases.createSample(input.sampleId, ctx.session.user.id, ctx.documents);

      return ctx.cases.submit(created.id, ctx.session.user.id);
    }),

  create: registeredProcedure
    .input(z.object({ name: z.string().trim().min(1).max(255) }))
    .mutation(async ({ ctx, input }) => ctx.cases.create(input.name, ctx.session.user.id)),

  presignMapping: protectedProcedure.input(z.object({ caseId: CaseId })).query(async ({ ctx, input }) => {
    ctx.responseHeaders.set("Cache-Control", "no-store");

    return ctx.cases.presignMapping(input.caseId, ctx.session.user.id);
  }),

  submit: protectedProcedure
    .input(z.object({ caseId: CaseId }))
    .mutation(async ({ ctx, input }) => ctx.cases.submit(input.caseId, ctx.session.user.id)),

  startReview: protectedProcedure
    .input(z.object({ caseId: CaseId }))
    .mutation(async ({ ctx, input }) => ctx.cases.startReview(input.caseId, ctx.session.user.id)),

  reopen: protectedProcedure
    .input(z.object({ caseId: CaseId }))
    .mutation(async ({ ctx, input }) => ctx.cases.reopen(input.caseId, ctx.session.user.id)),

  sendToRedcap: protectedProcedure
    .input(z.object({ caseId: CaseId }))
    .mutation(async ({ ctx, input }) => ctx.cases.sendToRedcap(input.caseId, ctx.session.user.id)),

  approve: protectedProcedure
    .input(z.object({ caseId: CaseId, expectedRevision: z.int().positive() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.reviews.approve(input.caseId, ctx.session.user.id, input.expectedRevision);

      return ctx.cases.findById(input.caseId, ctx.session.user.id);
    }),
});
