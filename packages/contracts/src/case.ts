import { z } from "zod";

import { Document } from "#document";

export const CaseId = z.uuid();
export const CaseStatus = z.enum([
  "draft",
  "queued",
  "mapping",
  "ready_for_review",
  "in_review",
  "approved",
  "exporting",
  "exported",
]);
export type CaseStatus = z.infer<typeof CaseStatus>;
export const CaseAccessRole = z.enum(["owner", "reviewer", "viewer"]);
export type CaseAccessRole = z.infer<typeof CaseAccessRole>;

export const Case = z
  .object({
    id: CaseId,
    name: z.string().trim().min(1).max(255),
    ownerId: z.string().min(1),
    owner: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        email: z.email(),
        image: z.url().nullable(),
      })
      .readonly(),
    accessRole: CaseAccessRole,
    status: CaseStatus,
    createdAt: z.iso.datetime(),
    mappedAt: z.iso.datetime().nullable(),
    reviewStartedAt: z.iso.datetime().nullable(),
    approvedAt: z.iso.datetime().nullable(),
    exportStartedAt: z.iso.datetime().nullable(),
    exportedAt: z.iso.datetime().nullable(),
    redcapRecordId: z.string().nullable(),
    exportUnconfirmed: z.boolean(),
    documents: z.array(Document),
  })
  .readonly();
export type Case = z.infer<typeof Case>;

export const CASE_PAGE_SIZE = 20;
export const CaseListInput = z.object({ limit: z.number().int().min(1).max(1000) });
