import { createHash, randomUUID } from "node:crypto";

import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";

import {
  emptyReviewWorkflow,
  MappingOutput,
  parseMappingReview,
  REVIEW_SCHEMA_VERSION,
  ReviewAssignMark,
  ReviewDecideField,
  ReviewDismissMark,
  reviewFieldKey,
  ReviewReadyRecord,
  ReviewSave,
  ReviewSectionCommand,
  reviewSectionKey as sectionKey,
  ReviewSnapshot,
  reviewValidationIssues,
  type ReviewWorkspace,
} from "@prostapaper/contracts";
import { approveCase } from "@prostapaper/db/cases";
import { caseReviews, cases, reviewRevisions } from "@prostapaper/db/schema";

import { caseAccess, lockCase } from "#cases/access";
import type { DatabaseService } from "#database/service";
import { effectiveMarks, reconcileRegionEdits, resolveMark } from "#review/marks";
import { applyReviewOperations, ReviewArtifact } from "#review/model";
import { reconcileWorkflow, workflowSummary, workflowView } from "#review/workflow";
import type { ObjectStorageService } from "#storage/service";

type Mutation =
  | { kind: "save"; request: ReviewSave }
  | { kind: "assignMark"; request: ReviewAssignMark }
  | { kind: "dismissMark"; request: ReviewDismissMark }
  | { kind: "decideField"; request: ReviewDecideField }
  | { kind: "confirmSection"; request: ReviewSectionCommand }
  | { kind: "revokeSection"; request: ReviewSectionCommand };

type RevisionRow = typeof reviewRevisions.$inferSelect;

const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "Review revision or mapping has changed; reload before saving",
  });
const unavailable = () => new TRPCError({ code: "PRECONDITION_FAILED", message: "Review is not editable" });

export class ReviewService {
  private readonly db: DatabaseService["db"];

  constructor(
    private readonly storage: ObjectStorageService,
    database: DatabaseService,
  ) {
    this.db = database.db;
  }

  async get(caseId: string, ownerId: string): Promise<ReviewWorkspace> {
    const state = await this.state(caseId, ownerId);
    let saved: ReviewArtifact | null = null;
    if (state.revision !== null) saved = await this.readRevision(state.revision, state.mappingIdentity);
    const baseline = await this.baseline(state.mappingIdentity, saved?.baseline);
    const proposal = baseline.proposal;
    const snapshot = saved?.snapshot ?? null;
    const record = snapshot?.record ?? proposal.record;
    const lesionIds = snapshot?.lesionIds ?? baseline.lesionIds;
    const markHistory = saved?.markHistory ?? [];
    const manualRegions = saved?.manualRegions ?? [];
    const marks = effectiveMarks({ record, lesionIds, evidence: baseline.evidence, markHistory });

    return {
      proposal: { record: proposal.record },
      evidence: baseline.evidence,
      mappingIdentity: state.mappingIdentity,
      baseline: baseline.identity,
      approvedRevision: state.approvedRevision,
      revision: snapshot?.revision ?? 0,
      snapshot,
      record,
      note: saved?.note ?? "",
      lesionIds,
      proposalLesionIds: baseline.lesionIds,
      issues: reviewValidationIssues(record, lesionIds),
      readOnly: state.status !== "in_review" || !state.canReview,
      marks,
      markHistory,
      workflow: saved?.workflow ?? emptyReviewWorkflow(),
      workflowStatus: workflowView({
        record,
        lesionIds,
        marks,
        manualRegions,
        workflow: saved?.workflow ?? emptyReviewWorkflow(),
        proposal,
        evidence: baseline.evidence,
        baseline: baseline.identity,
      }).status,
    };
  }

  async save(input: ReviewSave, ownerId: string): Promise<ReviewArtifact> {
    const parsed = ReviewSave.safeParse(input);
    if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid review save request" });

    return this.mutate({ kind: "save", request: parsed.data }, ownerId);
  }

  async decideField(input: ReviewDecideField, ownerId: string): Promise<ReviewArtifact> {
    const parsed = ReviewDecideField.safeParse(input);
    if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid field decision" });

    return this.mutate({ kind: "decideField", request: parsed.data }, ownerId);
  }

  async confirmSection(input: ReviewSectionCommand, ownerId: string): Promise<ReviewArtifact> {
    const parsed = ReviewSectionCommand.safeParse(input);
    if (!parsed.success)
      throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid section confirmation" });

    return this.mutate({ kind: "confirmSection", request: parsed.data }, ownerId);
  }

  async revokeSection(input: ReviewSectionCommand, ownerId: string): Promise<ReviewArtifact> {
    const parsed = ReviewSectionCommand.safeParse(input);
    if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid section revocation" });

    return this.mutate({ kind: "revokeSection", request: parsed.data }, ownerId);
  }

  async assignMark(input: ReviewAssignMark, ownerId: string): Promise<ReviewArtifact> {
    const parsed = ReviewAssignMark.safeParse(input);
    if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid mark assignment" });

    return this.mutate({ kind: "assignMark", request: parsed.data }, ownerId);
  }

  async dismissMark(input: ReviewDismissMark, ownerId: string): Promise<ReviewArtifact> {
    const parsed = ReviewDismissMark.safeParse(input);
    if (!parsed.success) throw new TRPCError({ code: "BAD_REQUEST", message: "Invalid mark dismissal" });

    return this.mutate({ kind: "dismissMark", request: parsed.data }, ownerId);
  }

  async approve(caseId: string, ownerId: string, expectedRevision: number): Promise<void> {
    const state = await this.state(caseId, ownerId, "review");
    if (
      state.approvedRevision === expectedRevision &&
      ["approved", "exporting", "exported"].includes(state.status)
    )
      return;
    if (state.status !== "in_review" || state.revision?.revision !== expectedRevision) throw conflict();
    const saved = await this.readRevision(state.revision, state.mappingIdentity);
    if (saved.baseline === undefined)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Save a pinned review revision before approval",
      });
    const baseline = await this.baseline(state.mappingIdentity, saved.baseline);
    const marks = effectiveMarks({
      ...saved.snapshot,
      evidence: baseline.evidence,
      markHistory: saved.markHistory,
    });
    const view = workflowView({
      ...saved.snapshot,
      workflow: saved.workflow,
      proposal: baseline.proposal,
      evidence: baseline.evidence,
      baseline: baseline.identity,
      marks,
      manualRegions: saved.manualRegions,
    });
    if (
      !ReviewReadyRecord.safeParse(saved.snapshot.record).success ||
      view.sections.some(
        (section) =>
          !section.confirmed ||
          section.blockingIssueCount > 0 ||
          section.unresolvedFieldCount > 0 ||
          section.unresolvedMarkCount > 0,
      )
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Complete valid field, source-mark and section review before approval",
      });
    await this.db.transaction(async (tx) => {
      const row = await lockCase(tx, caseId, { userId: ownerId });
      if (row === undefined) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      const [head] = await tx.select().from(caseReviews).where(eq(caseReviews.caseId, caseId));
      if (
        head?.approvedRevision === expectedRevision &&
        ["approved", "exporting", "exported"].includes(row.status)
      )
        return;
      if (
        row.status !== "in_review" ||
        row.mappingResultKey !== state.mappingIdentity ||
        head?.currentRevision !== expectedRevision
      )
        throw conflict();
      await tx
        .update(caseReviews)
        .set({ approvedRevision: expectedRevision })
        .where(eq(caseReviews.caseId, caseId));
      if (!(await approveCase(tx, caseId, ownerId))) throw conflict();
    });
  }

  private async mutate(command: Mutation, ownerId: string): Promise<ReviewArtifact> {
    const request = command.request;
    const requestHash = createHash("sha256")
      .update(JSON.stringify(command.kind === "save" ? request : command))
      .digest("hex");
    const state = await this.state(request.caseId, ownerId, "review");
    const prior = await this.receipt(request);
    if (prior !== undefined) {
      this.checkRetry(prior, requestHash);

      return this.readRevision(prior, state.mappingIdentity);
    }
    if (state.status !== "in_review") throw unavailable();
    if (
      state.mappingIdentity !== request.mappingIdentity ||
      (state.revision?.revision ?? 0) !== request.expectedRevision
    )
      throw conflict();

    let saved: ReviewArtifact | null = null;
    if (state.revision !== null) saved = await this.readRevision(state.revision, state.mappingIdentity);
    if (
      request.baseline !== undefined &&
      saved?.baseline !== undefined &&
      JSON.stringify(request.baseline) !== JSON.stringify(saved.baseline)
    )
      throw conflict();
    const baseline = await this.baseline(state.mappingIdentity, saved?.baseline ?? request.baseline);
    let current;
    if (saved === null) {
      current = {
        record: baseline.proposal.record,
        lesionIds: baseline.lesionIds,
        retiredLesionIds: [],
      };
    } else {
      current = {
        record: saved.snapshot.record,
        lesionIds: saved.snapshot.lesionIds,
        retiredLesionIds: saved.retiredLesionIds,
      };
    }
    if (command.kind !== "save" && saved === null)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Save a review revision before making decisions",
      });
    let draft =
      command.kind === "save"
        ? applyReviewOperations(current, command.request.operations, {
            record: baseline.proposal.record,
            lesionIds: baseline.lesionIds,
          })
        : current;
    const revision = request.expectedRevision + 1;
    const regionState = reconcileRegionEdits({
      ...draft,
      previous: current.record,
      previousLesionIds: current.lesionIds,
      evidence: baseline.evidence,
      proposal: baseline.proposal.record,
      originalLesionIds: baseline.lesionIds,
      markHistory: saved?.markHistory ?? [],
      manualRegions: saved?.manualRegions ?? [],
      revision,
      actorId: ownerId,
      manualAllSegments:
        command.kind === "save"
          ? command.request.operations.flatMap((operation) =>
              operation.kind === "update_lesion" && operation.changes.all_sgm === true
                ? [operation.lesionId]
                : [],
            )
          : [],
    });
    if (command.kind === "assignMark" || command.kind === "dismissMark") {
      let lesionId: string | null = null;
      if (command.kind === "assignMark") lesionId = command.request.lesionId;
      const resolved = resolveMark({
        ...draft,
        ...regionState,
        evidence: baseline.evidence,
        actorId: ownerId,
        revision,
        markId: command.request.markId,
        note: command.request.note,
        lesionId,
      });
      draft = { ...draft, record: resolved.record };
      regionState.markHistory = resolved.markHistory;
    }
    const manualRegions = regionState.manualRegions;
    const marks = effectiveMarks({
      ...draft,
      evidence: baseline.evidence,
      markHistory: regionState.markHistory,
    });
    let workflow = reconcileWorkflow(
      {
        ...draft,
        marks,
        manualRegions,
        workflow: saved?.workflow ?? emptyReviewWorkflow(),
        proposal: baseline.proposal,
        evidence: baseline.evidence,
        baseline: baseline.identity,
      },
      revision,
    );
    const view = workflowView({
      ...draft,
      marks,
      manualRegions,
      workflow,
      proposal: baseline.proposal,
      evidence: baseline.evidence,
      baseline: baseline.identity,
    });
    const binding = {
      id: randomUUID(),
      actorId: ownerId,
      atRevision: revision,
      at: new Date().toISOString(),
      invalidatedAtRevision: null,
      invalidation: null,
    };
    if (command.kind === "decideField") {
      const reference = command.request.reference;
      const field = view.fields.find(
        (field) => reviewFieldKey(field.reference) === reviewFieldKey(reference),
      );
      if (field === undefined) throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown review field" });
      if (field.blockingIssues.length > 0)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Correct validation issues before resolving this field",
        });
      if (field.noteRequired && command.request.note === null)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "A note is required for conflicts and manual corrections",
        });
      workflow = {
        ...workflow,
        decisions: [
          ...workflow.decisions.map((decision) => {
            if (
              decision.invalidatedAtRevision === null &&
              reviewFieldKey(decision.reference) === reviewFieldKey(reference)
            )
              return { ...decision, invalidatedAtRevision: revision, invalidation: "replaced" as const };

            return decision;
          }),
          {
            ...binding,
            reference,
            basisHash: field.basisHash,
            action: field.action,
            note: command.request.note,
          },
        ],
      };
    }
    if (command.kind === "confirmSection" || command.kind === "revokeSection") {
      const reference = command.request.reference;
      const section = view.sections.find(
        (section) => sectionKey(section.reference) === sectionKey(reference),
      );
      if (section === undefined)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown review section" });
      if (
        command.kind === "confirmSection" &&
        (section.blockingIssueCount > 0 ||
          section.unresolvedFieldCount > 0 ||
          section.unresolvedMarkCount > 0)
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Resolve validation, flagged fields and source marks before confirming the section",
        });
      const invalidation = command.kind === "confirmSection" ? ("replaced" as const) : ("revoked" as const);
      workflow = {
        ...workflow,
        confirmations: workflow.confirmations.map((confirmation) => {
          if (
            confirmation.invalidatedAtRevision === null &&
            sectionKey(confirmation.reference) === sectionKey(reference)
          )
            return { ...confirmation, invalidatedAtRevision: revision, invalidation };

          return confirmation;
        }),
      };
      if (command.kind === "confirmSection")
        workflow.confirmations.push({ ...binding, reference, basisHash: section.basisHash });
    }
    workflow = reconcileWorkflow(
      {
        ...draft,
        marks,
        manualRegions,
        workflow,
        proposal: baseline.proposal,
        evidence: baseline.evidence,
        baseline: baseline.identity,
      },
      revision,
    );
    const summary = workflowSummary(
      workflowView({
        ...draft,
        marks,
        manualRegions,
        workflow,
        proposal: baseline.proposal,
        evidence: baseline.evidence,
        baseline: baseline.identity,
      }).status,
      marks,
    );
    const candidate = ReviewArtifact.safeParse({
      caseId: request.caseId,
      note: command.kind === "save" ? (command.request.note ?? saved?.note ?? "") : (saved?.note ?? ""),
      snapshot: {
        schemaVersion: REVIEW_SCHEMA_VERSION,
        mappingIdentity: state.mappingIdentity,
        revision: request.expectedRevision + 1,
        record: draft.record,
        lesionIds: draft.lesionIds,
      },
      retiredLesionIds: draft.retiredLesionIds,
      ...regionState,
      baseline: baseline.identity,
      workflow,
    });
    if (!candidate.success || !ReviewSnapshot.safeParse(candidate.data.snapshot).success)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Review draft contains invalid fields or too many lesions",
      });

    // Storage precedes the pointer transaction. Losing saves leave an unreferenced immutable object.
    const artifactKey = `reviews/${request.caseId}/${candidate.data.snapshot.revision}/${randomUUID()}.json`;
    const identity = await this.storage.writeJson(artifactKey, candidate.data);
    const committed = await this.db.transaction(async (tx) => {
      const row = await lockCase(tx, request.caseId, { userId: ownerId });
      if (row === undefined) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
      const [retry] = await tx
        .select()
        .from(reviewRevisions)
        .where(
          and(eq(reviewRevisions.caseId, request.caseId), eq(reviewRevisions.requestId, request.requestId)),
        );
      if (retry !== undefined) {
        this.checkRetry(retry, requestHash);

        return retry;
      }
      if (row.status !== "in_review") throw unavailable();
      const [head] = await tx.select().from(caseReviews).where(eq(caseReviews.caseId, request.caseId));
      if (
        row.mappingResultKey !== request.mappingIdentity ||
        (head?.currentRevision ?? 0) !== request.expectedRevision
      )
        throw conflict();
      const [revision] = await tx
        .insert(reviewRevisions)
        .values({
          caseId: request.caseId,
          revision: candidate.data.snapshot.revision,
          requestId: request.requestId,
          requestHash,
          artifactKey,
          artifactVersionId: identity.versionId,
          artifactHash: identity.sha256,
          actorId: ownerId,
        })
        .returning();
      if (revision === undefined) throw new Error("Review revision insert failed");
      if (head === undefined) {
        await tx
          .insert(caseReviews)
          .values({ caseId: request.caseId, currentRevision: revision.revision, ...summary })
          .returning({ caseId: caseReviews.caseId });
      } else {
        await tx
          .update(caseReviews)
          .set({ currentRevision: revision.revision, approvedRevision: null, ...summary })
          .where(eq(caseReviews.caseId, request.caseId));
      }

      return revision;
    });
    if (committed.artifactKey === artifactKey) return candidate.data;

    return this.readRevision(committed, state.mappingIdentity);
  }

  private async baseline(mappingIdentity: string, pinned?: ReviewArtifact["baseline"]) {
    let value: unknown;
    let identity = pinned;
    if (identity === undefined) {
      const object = await this.storage.readVersionedJson(mappingIdentity);
      value = object.value;
      identity = object.identity;
    } else {
      value = await this.storage.readJson(mappingIdentity, undefined, identity);
    }
    const proposal = MappingOutput.parse(value);
    const evidence = parseMappingReview(proposal.diagnostics?.["review"], proposal.record);

    return {
      proposal,
      identity,
      evidence,
      lesionIds: evidence?.lesionIds ?? proposal.record.lesions.map((_, index) => `lesion-${index + 1}`),
    };
  }

  private async state(caseId: string, ownerId: string, access: "read" | "review" = "read") {
    const [row] = await this.db
      .select({
        status: cases.status,
        canReview: sql<boolean>`${caseAccess(ownerId, "review")}`,
        mappingIdentity: cases.mappingResultKey,
        reviewId: caseReviews.caseId,
        approvedRevision: caseReviews.approvedRevision,
        revision: reviewRevisions,
      })
      .from(cases)
      .leftJoin(caseReviews, eq(caseReviews.caseId, cases.id))
      .leftJoin(
        reviewRevisions,
        and(
          eq(reviewRevisions.caseId, cases.id),
          eq(
            reviewRevisions.revision,
            sql`case when ${cases.approvedAt} is not null then ${caseReviews.approvedRevision} else ${caseReviews.currentRevision} end`,
          ),
        ),
      )
      .where(and(eq(cases.id, caseId), caseAccess(ownerId, access)));
    if (row === undefined) throw new TRPCError({ code: "NOT_FOUND", message: "Case not found" });
    if (row.reviewId !== null && row.revision === null) throw new Error("Review revision pointer is missing");
    if (row.mappingIdentity === null)
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Case mapping is not complete" });

    return { ...row, mappingIdentity: row.mappingIdentity };
  }

  private async receipt(request: Mutation["request"]) {
    const [row] = await this.db
      .select()
      .from(reviewRevisions)
      .where(
        and(eq(reviewRevisions.caseId, request.caseId), eq(reviewRevisions.requestId, request.requestId)),
      );

    return row;
  }

  private checkRetry(row: RevisionRow, requestHash: string) {
    if (row.requestHash !== requestHash)
      throw new TRPCError({ code: "CONFLICT", message: "Request ID was already used for a different save" });
  }

  private async readRevision(row: RevisionRow, mappingIdentity: string): Promise<ReviewArtifact> {
    const artifact = ReviewArtifact.parse(
      await this.storage.readJson(row.artifactKey, undefined, {
        versionId: row.artifactVersionId,
        sha256: row.artifactHash,
      }),
    );
    if (
      artifact.caseId !== row.caseId ||
      artifact.snapshot.revision !== row.revision ||
      artifact.snapshot.mappingIdentity !== mappingIdentity
    ) {
      throw new Error("Review artifact does not match its revision pointer");
    }

    return artifact;
  }
}
