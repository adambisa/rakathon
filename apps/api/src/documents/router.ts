import { z } from "zod";

import { CaseId, DocumentFile, DocumentId, DocumentKind } from "@prostapaper/contracts";

import { protectedProcedure, registeredProcedure, router } from "#trpc/init";

export const documentRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => ctx.documents.list(ctx.session.user.id)),

  get: protectedProcedure
    .input(z.object({ documentId: DocumentId }))
    .query(async ({ ctx, input }) => ctx.documents.findById(input.documentId, ctx.session.user.id)),

  presignGet: protectedProcedure
    .input(z.object({ documentId: DocumentId, target: z.enum(["source", "extraction"]).default("source") }))
    .query(async ({ ctx, input }) => {
      ctx.responseHeaders.set("Cache-Control", "no-store");

      return ctx.documents.presignGet(input.documentId, ctx.session.user.id, input.target);
    }),

  register: registeredProcedure
    .input(z.object({ caseId: CaseId, documentId: DocumentId, kind: DocumentKind, file: DocumentFile }))
    .mutation(async ({ ctx, input }) => ctx.documents.register(input, ctx.session.user.id)),

  presign: registeredProcedure
    .input(z.object({ documentId: DocumentId }))
    .mutation(async ({ ctx, input }) => ctx.documents.presign(input.documentId, ctx.session.user.id)),
});
