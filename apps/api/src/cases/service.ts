import { randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import {
  Case,
  type Case as CaseModel,
  type CaseAccessRole,
  CaseStatus,
  MappingOutput,
  type ReviewQueueEntry,
  type ReviewQueueSummary,
  ReviewReadyRecord,
  type SurgeryRecord,
} from "@prostapaper/contracts";
import { user } from "@prostapaper/db/auth-schema";
import { approveCase, startReview, submitCase } from "@prostapaper/db/cases";
import { markUploaded } from "@prostapaper/db/documents";
import { caseAuditEvents, caseMembers, caseReviews, cases, reviewRevisions } from "@prostapaper/db/schema";

import { caseAccess, lockCase } from "#cases/access";
import type { DatabaseService, DatabaseTransaction } from "#database/service";
import { documentReadRelations, toDocument } from "#documents/model";
import type { DocumentService } from "#documents/service";
import type { CaseIngestTrigger } from "#ingest/trigger";
import { prepareRedcapSubmission, type RedcapClient, RedcapImportUnconfirmed } from "#redcap/client";
import { ReviewArtifact } from "#review/model";
import { sampleDocuments } from "#sample-cases";
import type { ObjectStorageService } from "#storage/service";

const PRESIGNED_GET_TTL_SECONDS = 5 * 60;

interface CaseTransition {
  id: string;
  ownerId: string;
  from: CaseStatus;
  apply: (tx: DatabaseTransaction) => Promise<boolean>;
}

export class CaseService {
  private readonly db: DatabaseService["db"];
  constructor(
    private readonly storage: ObjectStorageService,
    database: DatabaseService,
    private readonly integrations: {
      ingest: CaseIngestTrigger;
      redcap?: RedcapClient;
      exportTimeoutMs?: number;
    },
  ) {
    this.db = database.db;
  }

  async sharing(
    caseId: string,
    actorId: string,
  ): Promise<{ id: string; name: string; email: string; role: CaseAccessRole | null }[]> {
    const [item] = await this.db
      .select({ ownerId: cases.ownerId })
      .from(cases)
      .where(and(eq(cases.id, caseId), caseAccess(actorId, "owner")));
    if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    const people = await this.db
      .select({ id: user.id, name: user.name, email: user.displayEmail })
      .from(user)
      .where(eq(user.banned, false))
      .orderBy(asc(user.name), asc(user.id));
    const members = await this.db.select().from(caseMembers).where(eq(caseMembers.caseId, caseId));

    return people.map((person) => ({
      ...person,
      role:
        person.id === item.ownerId
          ? ("owner" as const)
          : (members.find((m) => m.userId === person.id)?.role ?? null),
    }));
  }

  async addAccess(
    { caseId, userId, role }: { caseId: string; userId: string; role: "reviewer" | "viewer" },
    actorId: string,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const item = await lockCase(tx, caseId, { userId: actorId, access: "owner" });
      if (!item) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      const [recipient] = await tx
        .select({ id: user.id })
        .from(user)
        .where(and(eq(user.id, userId), eq(user.banned, false)));
      if (!recipient) throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
      if (userId === actorId) return;
      await tx
        .insert(caseMembers)
        .values({ caseId, userId, role, grantedBy: actorId })
        .onConflictDoNothing({ target: [caseMembers.caseId, caseMembers.userId] });
    });
  }

  async list(ownerId: string, limit: number): Promise<{ cases: CaseModel[]; hasMore: boolean }> {
    const rows = await this.db.query.cases.findMany({
      where: caseAccess(ownerId),
      orderBy: [desc(cases.createdAt), desc(cases.id)],
      limit: limit + 1,
      with: {
        documents: { with: documentReadRelations },
        members: true,
        owner: { columns: { id: true, name: true, displayEmail: true, image: true } },
      },
    });

    return { cases: rows.slice(0, limit).map((row) => toCase(row, ownerId)), hasMore: rows.length > limit };
  }

  async exports(ownerId: string): Promise<CaseModel[]> {
    const rows = await this.db.query.cases.findMany({
      where: and(caseAccess(ownerId), isNotNull(cases.exportedAt)),
      orderBy: [desc(cases.exportedAt), desc(cases.id)],
      with: {
        documents: { with: documentReadRelations },
        members: true,
        owner: { columns: { id: true, name: true, displayEmail: true, image: true } },
      },
    });

    return rows.map((row) => toCase(row, ownerId));
  }

  async reviewQueue(ownerId: string): Promise<ReviewQueueEntry[]> {
    const rows = await this.db.query.cases.findMany({
      where: and(
        caseAccess(ownerId),
        inArray(cases.status, [CaseStatus.enum.ready_for_review, CaseStatus.enum.in_review]),
      ),
      orderBy: [asc(cases.mappedAt), asc(cases.id)],
      limit: 50,
      with: {
        documents: { with: documentReadRelations },
        members: true,
        owner: { columns: { id: true, name: true, displayEmail: true, image: true } },
      },
    });
    let summaries: (typeof caseReviews.$inferSelect)[] = [];
    if (rows.length > 0)
      summaries = await this.db
        .select()
        .from(caseReviews)
        .where(
          inArray(
            caseReviews.caseId,
            rows.map((row) => row.id),
          ),
        );

    return rows.map((row) => {
      const summary = summaries.find((item) => item.caseId === row.id);
      let review: ReviewQueueSummary | null = null;
      if (summary !== undefined)
        review = {
          revision: summary.currentRevision,
          approvedRevision: summary.approvedRevision,
          blockingIssueCount: summary.blockingIssueCount,
          unresolvedFieldCount: summary.unresolvedFieldCount,
          unresolvedMarkCount: summary.unresolvedMarkCount,
          unconfirmedSectionCount: summary.unconfirmedSectionCount,
        };

      return { ...toCase(row, ownerId), review };
    });
  }

  async findById(id: string, ownerId: string): Promise<CaseModel> {
    const row = await this.db.query.cases.findFirst({
      where: and(eq(cases.id, id), caseAccess(ownerId)),
      with: {
        documents: { with: documentReadRelations },
        members: true,
        owner: { columns: { id: true, name: true, displayEmail: true, image: true } },
      },
    });
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });

    return toCase(row, ownerId);
  }

  async create(name: string, ownerId: string): Promise<CaseModel> {
    const id = randomUUID();
    await this.db.insert(cases).values({ id, name, ownerId }).returning({ id: cases.id });

    return this.findById(id, ownerId);
  }

  async createSample(
    sampleId: "0005" | "0008" | "0012",
    ownerId: string,
    documents: DocumentService,
  ): Promise<CaseModel> {
    const files = await sampleDocuments(sampleId);
    const created = await this.create(`Rakathon ${Number(sampleId)}`, ownerId);
    await Promise.all(
      files.map(async ({ kind, filename, body }) => {
        const documentId = randomUUID();
        await documents.register(
          {
            caseId: created.id,
            documentId,
            kind,
            file: { filename, contentType: "image/jpeg", size: body.length },
          },
          ownerId,
        );
        await this.storage.writeSample(`uploads/${documentId}/source`, body, filename);
      }),
    );

    return created;
  }

  async submit(id: string, ownerId: string): Promise<CaseModel> {
    const existing = await this.findById(id, ownerId);
    let uploads: { id: string; versionId: string }[] = [];
    if (existing.status === "draft") {
      const docs = await this.db.query.documents.findMany({ where: (d, { eq }) => eq(d.caseId, id) });
      uploads = await Promise.all(
        docs.map(async (doc) => {
          const object = await this.storage.head(doc.storageKey);
          if (object === undefined) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "All documents must be uploaded before submission",
            });
          }
          if (object.size !== doc.sizeBytes) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "Uploaded file does not match its registration",
            });
          }

          return { id: doc.id, versionId: object.versionId };
        }),
      );
    }
    await this.db.transaction(async (tx) => {
      const row = await lockCase(tx, id, { userId: ownerId });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      if (row.submittedAt !== null) {
        if (row.status === "queued") return;
        throw new TRPCError({ code: "CONFLICT", message: "Case is already submitted" });
      }
      const current = await tx.query.documents.findMany({ where: (d, { eq }) => eq(d.caseId, id) });
      if (
        current.length === 0 ||
        current.length !== uploads.length ||
        current.some((doc) => !uploads.some((upload) => upload.id === doc.id))
      ) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "All documents must be uploaded before submission",
        });
      }
      if (!current.some((doc) => doc.kind === "text_description")) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "The report must be uploaded before submission",
        });
      }
      await uploads.reduce(async (previous, upload) => {
        await previous;
        await markUploaded(tx, upload.id, upload.versionId);
      }, Promise.resolve());
      await submitCase(tx, id);
    });
    try {
      await this.integrations.ingest.caseSubmitted(id);
    } catch (error) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Could not start document ingestion",
        cause: error,
      });
    }

    return this.findById(id, ownerId);
  }

  async startReview(id: string, ownerId: string): Promise<CaseModel> {
    await this.transition({
      id,
      ownerId,
      from: CaseStatus.enum.ready_for_review,
      apply: async (tx) => startReview(tx, id),
    });

    return this.findById(id, ownerId);
  }

  async approve(id: string, ownerId: string): Promise<CaseModel> {
    await this.transition({
      id,
      ownerId,
      from: CaseStatus.enum.in_review,
      apply: async (tx) => {
        const [review] = await tx.select().from(caseReviews).where(eq(caseReviews.caseId, id));
        if (review !== undefined) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Saved corrections require the revision-based approval workflow",
          });
        }

        return approveCase(tx, id, ownerId);
      },
    });

    return this.findById(id, ownerId);
  }

  async reopen(id: string, ownerId: string): Promise<CaseModel> {
    await this.transition({
      id,
      ownerId,
      from: CaseStatus.enum.approved,
      apply: async (tx) => {
        await tx
          .update(cases)
          .set({ approvedAt: null, approvedBy: null, updatedAt: sql`now()` })
          .where(eq(cases.id, id));

        return true;
      },
    });

    return this.findById(id, ownerId);
  }

  async sendToRedcap(id: string, ownerId: string): Promise<CaseModel> {
    const redcap = this.integrations.redcap;
    if (redcap === undefined)
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "REDCap is not configured" });
    const attemptId = randomUUID();
    const signal = AbortSignal.timeout(this.integrations.exportTimeoutMs ?? 45_000);
    // Commit the claim before any external work. A crash leaves the case locked for reconciliation.
    const source = await this.db.transaction(async (tx) => {
      const row = await lockCase(tx, id, { userId: ownerId, access: "owner" });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      if (row.status !== "approved")
        throw new TRPCError({
          code: "CONFLICT",
          message: "Case is not approved or export has already started",
        });
      const [item] = await tx.select({ key: cases.mappingResultKey }).from(cases).where(eq(cases.id, id));
      if (item?.key === undefined || item.key === null)
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Case mapping is not complete" });
      const [review] = await tx
        .select({ approvedRevision: caseReviews.approvedRevision, revision: reviewRevisions })
        .from(caseReviews)
        .leftJoin(
          reviewRevisions,
          and(
            eq(reviewRevisions.caseId, caseReviews.caseId),
            eq(reviewRevisions.revision, caseReviews.approvedRevision),
          ),
        )
        .where(eq(caseReviews.caseId, id));
      if (review !== undefined && (review.approvedRevision === null || review.revision === null))
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Approved review revision is missing" });
      await tx
        .update(cases)
        .set({
          exportStartedAt: sql`now()`,
          exportAttemptId: attemptId,
          exportReviewRevision: review?.approvedRevision ?? null,
          exportPayloadHash: null,
          updatedAt: sql`now()`,
        })
        .where(eq(cases.id, id));

      return { mappingKey: item.key, review: review?.revision ?? null };
    });
    const asActor = async <T>(apply: (tx: DatabaseTransaction) => Promise<T>): Promise<T> =>
      this.db.transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.actor_id', ${ownerId}, true)`);

        return apply(tx);
      });
    let confirmation: typeof caseAuditEvents.$inferInsert | undefined;
    try {
      let record: SurgeryRecord;
      if (source.review === null) {
        record = MappingOutput.parse(await this.storage.readJson(source.mappingKey, signal)).record;
      } else {
        const review = ReviewArtifact.parse(
          await this.storage.readJson(source.review.artifactKey, signal, {
            versionId: source.review.artifactVersionId,
            sha256: source.review.artifactHash,
          }),
        );
        if (
          review.caseId !== id ||
          review.snapshot.revision !== source.review.revision ||
          review.snapshot.mappingIdentity !== source.mappingKey
        )
          throw new Error("Approved review identity mismatch");
        record = ReviewReadyRecord.parse(review.snapshot.record);
      }
      signal.throwIfAborted();
      const { payloadHash } = prepareRedcapSubmission(record, attemptId);
      const [preparedCase] = await asActor(async (tx) =>
        tx
          .update(cases)
          .set({ exportPayloadHash: payloadHash, updatedAt: sql`now()` })
          .where(and(eq(cases.id, id), eq(cases.exportAttemptId, attemptId), eq(cases.status, "exporting")))
          .returning({ id: cases.id }),
      );
      if (preparedCase === undefined) throw new Error("Export claim has changed");
      signal.throwIfAborted();
      const receipt = await redcap.upload(record, attemptId, signal);
      confirmation = {
        id: randomUUID(),
        caseId: id,
        actorId: ownerId,
        attemptId,
        kind: "export_confirmed",
        payloadHash,
        redcapRecordId: receipt.recordId,
      };
      // Persist the known remote receipt independently of the final case transition.
      await this.db.insert(caseAuditEvents).values(confirmation).returning({ id: caseAuditEvents.id });
      const [exportedCase] = await asActor(async (tx) =>
        tx
          .update(cases)
          .set({ redcapRecordId: receipt.recordId, exportedAt: sql`now()`, updatedAt: sql`now()` })
          .where(and(eq(cases.id, id), eq(cases.exportAttemptId, attemptId), eq(cases.status, "exporting")))
          .returning({ id: cases.id }),
      );
      if (exportedCase === undefined) throw new Error("Export receipt requires reconciliation");
    } catch (error) {
      if (confirmation !== undefined || error instanceof RedcapImportUnconfirmed) {
        await asActor(async (tx) => {
          // Retrying this local insert is idempotent; the remote import is never retried.
          if (confirmation !== undefined)
            await tx.insert(caseAuditEvents).values(confirmation).onConflictDoNothing();
          await tx
            .update(cases)
            .set({ exportUnconfirmed: true, updatedAt: sql`now()` })
            .where(
              and(eq(cases.id, id), eq(cases.exportAttemptId, attemptId), eq(cases.status, "exporting")),
            );
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "REDCap submission is unconfirmed. Reconcile before retrying.",
        });
      }
      // The shared deadline aborts reads/preflight, preventing a delayed import after release.
      await asActor(async (tx) =>
        tx
          .update(cases)
          .set({
            exportStartedAt: null,
            exportAttemptId: null,
            exportReviewRevision: null,
            exportPayloadHash: null,
            updatedAt: sql`now()`,
          })
          .where(and(eq(cases.id, id), eq(cases.exportAttemptId, attemptId), eq(cases.status, "exporting"))),
      );
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "REDCap export could not start. Check configuration and mapping.",
      });
    }

    return this.findById(id, ownerId);
  }

  private async transition({ id, ownerId, from, apply }: CaseTransition): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await lockCase(tx, id, { userId: ownerId });
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      if (row.status !== from) {
        throw new TRPCError({ code: "CONFLICT", message: `Case is not ${from.replaceAll("_", " ")}` });
      }
      await apply(tx);
    });
  }

  async presignMapping(id: string, ownerId: string): Promise<{ url: string; expiresAt: string }> {
    const [row] = await this.db
      .select({ mappedAt: cases.mappedAt, mappingResultKey: cases.mappingResultKey })
      .from(cases)
      .where(and(eq(cases.id, id), caseAccess(ownerId)));
    if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    if (row.mappedAt === null || row.mappingResultKey === null) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Case mapping is not complete" });
    }
    const url = await this.storage.presignDownload(row.mappingResultKey, PRESIGNED_GET_TTL_SECONDS);

    return { url, expiresAt: new Date(Date.now() + PRESIGNED_GET_TTL_SECONDS * 1000).toISOString() };
  }
}

type CaseRow = typeof cases.$inferSelect & {
  documents: Parameters<typeof toDocument>[0][];
  members: (typeof caseMembers.$inferSelect)[];
  owner: { id: string; name: string; displayEmail: string; image: string | null };
};

function toCase(row: CaseRow, userId: string): CaseModel {
  return Case.parse({
    ...row,
    owner: {
      id: row.owner.id,
      name: row.owner.name,
      email: row.owner.displayEmail,
      image: row.owner.image,
    },
    accessRole:
      row.ownerId === userId ? "owner" : row.members.find((member) => member.userId === userId)?.role,
    createdAt: row.createdAt.toISOString(),
    mappedAt: row.mappedAt?.toISOString() ?? null,
    reviewStartedAt: row.reviewStartedAt?.toISOString() ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    exportStartedAt: row.exportStartedAt?.toISOString() ?? null,
    exportedAt: row.exportedAt?.toISOString() ?? null,
    exportUnconfirmed:
      row.exportUnconfirmed ||
      (row.status === "exporting" &&
        row.exportStartedAt !== null &&
        Date.now() - row.exportStartedAt.getTime() > 60_000),
    documents: row.documents.map(toDocument),
  });
}
