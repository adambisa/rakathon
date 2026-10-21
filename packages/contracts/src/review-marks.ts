import { z } from "zod";

import type { MappingSectorMark } from "#mapping-marks";
import { RegionCode } from "#region";
import { ReviewLesionId, ReviewMarkId } from "#review-fields";

export const ReviewMarkResolution = z
  .strictObject({
    id: z.uuid(),
    markId: ReviewMarkId,
    action: z.enum(["assigned", "dismissed", "unassigned"]),
    lesionId: ReviewLesionId.nullable(),
    actorId: z.string().min(1),
    atRevision: z.int().positive(),
    at: z.iso.datetime(),
    note: z.string().trim().min(1).max(2000),
  })
  .superRefine((event, context) => {
    if ((event.action === "assigned") !== (event.lesionId !== null))
      context.addIssue({ code: "custom", message: "Only assigned marks have a target lesion" });
  });
export type ReviewMarkResolution = z.infer<typeof ReviewMarkResolution>;
export const ReviewManualRegions = z.strictObject({ lesionId: ReviewLesionId, regions: z.array(RegionCode) });
export type ReviewManualRegions = z.infer<typeof ReviewManualRegions>;
export interface ReviewMarkView {
  source: MappingSectorMark;
  status: "assigned" | "dismissed" | "unassigned" | "ambiguous";
  lesionId: string | null;
  resolutionId: string | null;
  note: string | null;
}
