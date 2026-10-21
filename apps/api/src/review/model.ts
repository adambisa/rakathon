import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  CaseId,
  emptyReviewWorkflow,
  redcapAllSegmentRegions,
  ReviewBaselineIdentity,
  ReviewLesionId,
  ReviewManualRegions,
  ReviewMarkResolution,
  type ReviewOperation,
  ReviewStoredSnapshot,
  ReviewWorkflow,
  type SurgeryRecord,
} from "@prostapaper/contracts";

export const ReviewArtifact = z
  .strictObject({
    version: z.literal(1).default(1),
    caseId: CaseId,
    note: z.string().trim().max(4000).default(""),
    snapshot: ReviewStoredSnapshot.refine(
      (snapshot) => snapshot.revision > 0,
      "Saved revisions start at one",
    ),
    retiredLesionIds: z.array(ReviewLesionId),
    markHistory: z.array(ReviewMarkResolution).default([]),
    manualRegions: z.array(ReviewManualRegions).default([]),
    workflow: ReviewWorkflow.default(emptyReviewWorkflow()),
    baseline: ReviewBaselineIdentity.optional(),
  })
  .superRefine(({ snapshot, retiredLesionIds, baseline, workflow }, context) => {
    const entries = [...workflow.decisions, ...workflow.confirmations];
    if (
      (baseline === undefined && entries.length > 0) ||
      entries.some(
        (entry) =>
          entry.atRevision > snapshot.revision ||
          (entry.invalidatedAtRevision !== null && entry.invalidatedAtRevision > snapshot.revision),
      )
    )
      context.addIssue({
        code: "custom",
        message: "Workflow history must belong to a pinned saved revision",
      });
    const used = new Set([...snapshot.lesionIds, ...retiredLesionIds]);
    if (used.size !== snapshot.lesionIds.length + retiredLesionIds.length) {
      context.addIssue({
        code: "custom",
        path: ["retiredLesionIds"],
        message: "Lesion identities cannot be reused",
      });
    }
  });
export type ReviewArtifact = z.infer<typeof ReviewArtifact>;

interface EditableReview {
  record: SurgeryRecord;
  lesionIds: string[];
  retiredLesionIds: string[];
}

/** Apply allowlisted operations to a copy; legacy bounds are checked after the complete batch. */
export function applyReviewOperations(
  current: EditableReview,
  operations: readonly ReviewOperation[],
  original?: { record: SurgeryRecord; lesionIds: string[] },
): EditableReview {
  const draft = structuredClone(current);
  for (const operation of operations) {
    if (operation.kind === "update_surgery") {
      Object.assign(draft.record.surgery, operation.changes);
      continue;
    }
    if (operation.kind === "add_lesion") {
      if (
        draft.lesionIds.includes(operation.lesionId) ||
        draft.retiredLesionIds.includes(operation.lesionId)
      ) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Lesion identity already used" });
      }
      draft.lesionIds.push(operation.lesionId);
      draft.record.lesions.push(structuredClone(operation.lesion));
      continue;
    }
    if (operation.kind === "restore_lesion") {
      const originalIndex = original?.lesionIds.indexOf(operation.lesionId) ?? -1;
      const lesion = original?.record.lesions[originalIndex];
      const retiredIndex = draft.retiredLesionIds.indexOf(operation.lesionId);
      if (lesion === undefined || retiredIndex === -1 || draft.lesionIds.includes(operation.lesionId))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only a deleted original lesion can be restored",
        });
      let insertAt = draft.lesionIds.findIndex((id) => {
        const index = original?.lesionIds.indexOf(id) ?? -1;

        return index === -1 || index > originalIndex;
      });
      if (insertAt === -1) insertAt = draft.lesionIds.length;
      draft.record.lesions.splice(insertAt, 0, structuredClone(lesion));
      draft.lesionIds.splice(insertAt, 0, operation.lesionId);
      draft.retiredLesionIds.splice(retiredIndex, 1);
      continue;
    }
    const index = draft.lesionIds.indexOf(operation.lesionId);
    const lesion = draft.record.lesions[index];
    if (index === -1 || lesion === undefined) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "Unknown lesion identity" });
    }
    if (operation.kind === "update_lesion") {
      Object.assign(lesion, operation.changes);
      if (operation.changes.all_sgm === true) lesion.sur_prostate_regions = [...redcapAllSegmentRegions];
      if (
        lesion.all_sgm &&
        (new Set(lesion.sur_prostate_regions).size !== redcapAllSegmentRegions.length ||
          !redcapAllSegmentRegions.every((region) => lesion.sur_prostate_regions.includes(region)))
      )
        lesion.all_sgm = false;
    } else {
      draft.record.lesions.splice(index, 1);
      draft.lesionIds.splice(index, 1);
      draft.retiredLesionIds.push(operation.lesionId);
    }
  }

  return draft;
}
