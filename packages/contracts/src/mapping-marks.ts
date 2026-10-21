import { z } from "zod";

import { RegionCode } from "#region";
import { ReviewFieldRef, ReviewLesionId, ReviewMarkId } from "#review-fields";
import { SectorFocus } from "#sector";

export const MappingSectorMark = z
  .strictObject({
    id: ReviewMarkId,
    documentId: z.string().min(1).max(128),
    sourceVersion: z.string().min(1),
    extractionIdentity: z.string().min(1),
    page: z.int().positive(),
    focus: SectorFocus,
    regions: z.array(RegionCode),
    status: z.enum(["assigned", "unassigned", "ambiguous"]),
    lesionId: ReviewLesionId.nullable(),
    candidateLesionIds: z.array(ReviewLesionId),
    ruleVersion: z.literal(1),
  })
  .superRefine((mark, context) => {
    if ((mark.status === "assigned") !== (mark.lesionId !== null)) {
      context.addIssue({ code: "custom", message: "Assigned marks require exactly one target lesion" });
    }
  });
export type MappingSectorMark = z.infer<typeof MappingSectorMark>;

export const MappingTransformation = z.strictObject({
  id: z.string().min(1),
  ruleId: z.string().min(1),
  ruleVersion: z.literal(1),
  reference: ReviewFieldRef,
  before: z.json(),
  after: z.json(),
  sourceMarkIds: z.array(ReviewMarkId),
});
export type MappingTransformation = z.infer<typeof MappingTransformation>;
