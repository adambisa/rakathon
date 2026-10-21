import { z } from "zod";

import {
  CaseId,
  ReviewAssignMark,
  ReviewDecideField,
  ReviewDismissMark,
  ReviewSave,
  ReviewSectionCommand,
} from "@prostapaper/contracts";

import { protectedProcedure, router } from "#trpc/init";

export const reviewRouter = router({
  assignMark: protectedProcedure.input(ReviewAssignMark).mutation(async ({ ctx, input }) => {
    ctx.responseHeaders.set("Cache-Control", "no-store");

    return ctx.reviews.assignMark(input, ctx.session.user.id);
  }),
  dismissMark: protectedProcedure.input(ReviewDismissMark).mutation(async ({ ctx, input }) => {
    ctx.responseHeaders.set("Cache-Control", "no-store");

    return ctx.reviews.dismissMark(input, ctx.session.user.id);
  }),
  decideField: protectedProcedure.input(ReviewDecideField).mutation(async ({ ctx, input }) => {
    ctx.responseHeaders.set("Cache-Control", "no-store");

    return ctx.reviews.decideField(input, ctx.session.user.id);
  }),
  confirmSection: protectedProcedure.input(ReviewSectionCommand).mutation(async ({ ctx, input }) => {
    ctx.responseHeaders.set("Cache-Control", "no-store");

    return ctx.reviews.confirmSection(input, ctx.session.user.id);
  }),
  revokeSection: protectedProcedure.input(ReviewSectionCommand).mutation(async ({ ctx, input }) => {
    ctx.responseHeaders.set("Cache-Control", "no-store");

    return ctx.reviews.revokeSection(input, ctx.session.user.id);
  }),
  get: protectedProcedure.input(z.strictObject({ caseId: CaseId })).query(async ({ ctx, input }) => {
    ctx.responseHeaders.set("Cache-Control", "no-store");

    return ctx.reviews.get(input.caseId, ctx.session.user.id);
  }),
  save: protectedProcedure.input(ReviewSave).mutation(async ({ ctx, input }) => {
    ctx.responseHeaders.set("Cache-Control", "no-store");

    return ctx.reviews.save(input, ctx.session.user.id);
  }),
});
