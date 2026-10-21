import { z } from "zod";

import { prepareRedcapUpload } from "#redcap";
import { toRedcapRows } from "#redcap-rows";
import {
  lesionCollectionRef,
  lesionReviewFields,
  type ReviewFieldRef,
  ReviewLesionId,
  surgeryReviewFields,
} from "#review-fields";
import { LesionFields, ReviewDraftRecord, SurgeryFields, SurgeryRecord } from "#surgery";

// Bump when persisted snapshot structure changes. Policy changes use their own version.
export const REVIEW_SCHEMA_VERSION = 1;
export const REVIEW_VALIDATION_POLICY_VERSION = 2;

const SnapshotFields = z.strictObject({
  schemaVersion: z.literal(REVIEW_SCHEMA_VERSION),
  mappingIdentity: z.string().min(1).max(512),
  revision: z.int().nonnegative(),
  record: ReviewDraftRecord,
  // Kept outside the clinical payload; export continues to number instances sequentially.
  lesionIds: z.array(ReviewLesionId).max(100),
});

function requireStableLesionIds(
  { record, lesionIds }: { record: { lesions: unknown[] }; lesionIds: string[] },
  context: z.RefinementCtx,
) {
  if (lesionIds.length !== record.lesions.length || new Set(lesionIds).size !== lesionIds.length) {
    context.addIssue({
      code: "custom",
      path: ["lesionIds"],
      message: "Every lesion requires a unique stable review ID",
    });
  }
}

export const ReviewSnapshot = SnapshotFields.superRefine(requireStableLesionIds);
export type ReviewSnapshot = z.infer<typeof ReviewSnapshot>;

// Parent fields remain readable for legacy history, but are not part of lesion review or export.
export const StoredReviewRecord = z.object({
  surgery: SurgeryFields,
  lesions: z.array(LesionFields).max(100),
});
export const ReviewStoredSnapshot = SnapshotFields.extend({ record: StoredReviewRecord }).superRefine(
  requireStableLesionIds,
);
export type ReviewStoredSnapshot = z.infer<typeof ReviewStoredSnapshot>;

export interface ReviewValidationIssue {
  reference: ReviewFieldRef;
  source: "record" | "export";
  code: string;
  message: string;
}

function reference(path: readonly PropertyKey[], lesionIds: readonly string[]): ReviewFieldRef {
  if (path[0] === "surgery") {
    const field = surgeryReviewFields.find((field) => field.name === path[1]);
    if (field !== undefined) return { scope: "surgery", field: field.name };
  }
  if (path[0] === "lesions" && typeof path[1] === "number") {
    const lesionId = lesionIds[path[1]];
    const field = lesionReviewFields.find((field) => field.name === path[2]);
    if (lesionId !== undefined && field !== undefined)
      return { scope: "lesion", lesionId, field: field.name };
  }

  return lesionCollectionRef;
}

const ProposalFields = z.object({ surgery: SurgeryFields, lesions: z.array(LesionFields) });

/** Shared UI/API validation, including legacy proposals outside the stricter draft bounds. */
export function reviewValidationIssues(
  record: SurgeryRecord,
  lesionIds: readonly string[],
): ReviewValidationIssue[] {
  if (lesionIds.length !== record.lesions.length || new Set(lesionIds).size !== lesionIds.length) {
    throw new Error("Every lesion requires a unique stable review ID");
  }
  const ids = z.array(ReviewLesionId).parse(lesionIds);
  const shape = ProposalFields.safeParse(record);
  if (!shape.success) {
    return shape.error.issues.map((issue) => ({
      reference: reference(issue.path, ids),
      source: "record",
      code: issue.code,
      message: issue.message,
    }));
  }
  const parsed = SurgeryRecord.shape.lesions.safeParse(shape.data.lesions);
  const issues: ReviewValidationIssue[] = [];
  if (!parsed.success) {
    issues.push(
      ...parsed.error.issues.map((issue) => ({
        reference: reference(["lesions", ...issue.path], ids),
        source: "record" as const,
        code: issue.code,
        message: issue.message,
      })),
    );
  }
  // A local placeholder satisfies serializer syntax; remote REDCap allocation is a separate step.
  for (const issue of prepareRedcapUpload(toRedcapRows(shape.data, "review-readiness")).issues) {
    let path: PropertyKey[] = [];
    if (issue.scope === "surgery") path = ["surgery", issue.field ?? ""];
    if (issue.scope === "lesion") path = ["lesions", Number(issue.instance) - 1, issue.field ?? ""];
    issues.push({
      reference: reference(path, ids),
      source: "export",
      code: issue.code,
      message: issue.message,
    });
  }

  return issues;
}

/** Draft boundary validation followed by the same local checks used for display and approval readiness. */
export function validateReviewRecord(
  record: ReviewDraftRecord,
  lesionIds: readonly string[],
): ReviewValidationIssue[] {
  const snapshot = ReviewSnapshot.parse({
    schemaVersion: REVIEW_SCHEMA_VERSION,
    mappingIdentity: "validation",
    revision: 0,
    record,
    lesionIds: [...lesionIds],
  });

  return reviewValidationIssues(snapshot.record, snapshot.lesionIds);
}

// Ready means clinically valid and locally exportable. Workflow confirmations, resolutions,
// ownership and revision locking are checked separately by the review service's approval path.
export const ReviewReadyRecord = ReviewDraftRecord.superRefine((record, context) => {
  // Zod still runs refinements after nonfatal field failures; preserve safeParse's no-throw contract.
  if (!ReviewDraftRecord.safeParse(record).success) return;
  const ids = record.lesions.map((_, index) => `validation-${index}`);
  for (const issue of validateReviewRecord(record, ids)) {
    const ref = issue.reference;
    let path: PropertyKey[] = ["lesions"];
    if (ref.scope === "surgery") path = ["surgery", ref.field];
    if (ref.scope === "lesion") path = ["lesions", ids.indexOf(ref.lesionId), ref.field];
    context.addIssue({ code: "custom", message: issue.message, path });
  }
});
export type ReviewReadyRecord = z.infer<typeof ReviewReadyRecord>;
