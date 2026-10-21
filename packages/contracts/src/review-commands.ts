import { z } from "zod";

import { type Case, CaseId } from "#case";
import type { MappingReview } from "#mapping-review";
import type { ReviewSnapshot, ReviewValidationIssue } from "#review";
import { ReviewFieldRef, ReviewLesionId, ReviewMarkId, ReviewSectionRef } from "#review-fields";
import type { ReviewMarkResolution, ReviewMarkView } from "#review-marks";
import type { ReviewWorkflow, ReviewWorkflowStatus } from "#review-workflow";
import { ReviewDraftRecord, ReviewSurgeryFields, type SurgeryRecord } from "#surgery";

export const ReviewBaselineIdentity = z.strictObject({
  versionId: z
    .string()
    .min(1)
    .refine((value) => value !== "null" && value === value.trim()),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ReviewBaselineIdentity = z.infer<typeof ReviewBaselineIdentity>;

/** Queue counts persisted with the revision pointer so lists never load review artifacts. */
export interface ReviewQueueSummary {
  revision: number;
  approvedRevision: number | null;
  blockingIssueCount: number;
  unresolvedFieldCount: number;
  unresolvedMarkCount: number;
  unconfirmedSectionCount: number;
}
export interface ReviewQueueEntry extends Case {
  review: ReviewQueueSummary | null;
}

export interface ReviewWorkspace {
  proposal: { record: SurgeryRecord };
  evidence: MappingReview | null;
  mappingIdentity: string;
  baseline: ReviewBaselineIdentity;
  approvedRevision: number | null;
  revision: number;
  snapshot: ReviewSnapshot | null;
  record: ReviewDraftRecord;
  note: string;
  lesionIds: string[];
  proposalLesionIds: string[];
  issues: ReviewValidationIssue[];
  readOnly: boolean;
  workflow: ReviewWorkflow;
  marks: ReviewMarkView[];
  markHistory: ReviewMarkResolution[];
  workflowStatus: ReviewWorkflowStatus;
}

const SurgeryChanges = ReviewSurgeryFields.partial().refine(
  (changes) => Object.keys(changes).length > 0,
  "At least one surgery field must change",
);
const LesionChanges = ReviewDraftRecord.shape.lesions.element
  .partial()
  .refine((changes) => Object.keys(changes).length > 0, "At least one lesion field must change");

export const ReviewOperation = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("update_surgery"), changes: SurgeryChanges }),
  z.strictObject({
    kind: z.literal("update_lesion"),
    lesionId: ReviewLesionId,
    changes: LesionChanges,
  }),
  z.strictObject({
    kind: z.literal("add_lesion"),
    lesionId: ReviewLesionId,
    lesion: ReviewDraftRecord.shape.lesions.element,
  }),
  z.strictObject({ kind: z.literal("delete_lesion"), lesionId: ReviewLesionId }),
  z.strictObject({ kind: z.literal("restore_lesion"), lesionId: ReviewLesionId }),
]);
export type ReviewOperation = z.infer<typeof ReviewOperation>;

const ReviewCommandBase = z.strictObject({
  caseId: CaseId,
  mappingIdentity: z.string().min(1).max(512),
  baseline: ReviewBaselineIdentity.optional(),
  expectedRevision: z.int().nonnegative().max(2_147_483_646),
  requestId: z.uuid(),
});
export const ReviewSave = ReviewCommandBase.extend({
  operations: z.array(ReviewOperation).max(100),
  note: z.string().trim().max(4000).optional(),
})
  // Empty operations may create the baseline or save only the case-level review note.
  .refine((save) => save.operations.length > 0 || save.expectedRevision === 0 || save.note !== undefined, {
    path: ["operations"],
    message: "At least one operation or a review note is required after the first revision",
  });
export type ReviewSave = z.infer<typeof ReviewSave>;

const SavedReviewCommand = ReviewCommandBase.extend({
  expectedRevision: ReviewCommandBase.shape.expectedRevision.min(1),
});
export const ReviewDecideField = SavedReviewCommand.extend({
  reference: ReviewFieldRef,
  note: z.string().trim().min(1).max(2000).nullable().default(null),
});
export type ReviewDecideField = z.infer<typeof ReviewDecideField>;
export const ReviewSectionCommand = SavedReviewCommand.extend({ reference: ReviewSectionRef });
export type ReviewSectionCommand = z.infer<typeof ReviewSectionCommand>;

const MarkCommand = SavedReviewCommand.extend({
  markId: ReviewMarkId,
  note: z.string().trim().min(1).max(2000),
});
export const ReviewAssignMark = MarkCommand.extend({ lesionId: ReviewLesionId });
export type ReviewAssignMark = z.infer<typeof ReviewAssignMark>;
export const ReviewDismissMark = MarkCommand;
export type ReviewDismissMark = z.infer<typeof ReviewDismissMark>;
