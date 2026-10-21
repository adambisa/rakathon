import { z } from "zod";

import { ReviewFieldRef, ReviewSectionRef } from "#review-fields";

export const REVIEW_WORKFLOW_POLICY_VERSION = 3;
const Binding = {
  id: z.uuid(),
  actorId: z.string().min(1),
  atRevision: z.int().positive(),
  at: z.iso.datetime(),
  basisHash: z.string().regex(/^[a-f0-9]{64}$/),
  invalidatedAtRevision: z.int().positive().nullable(),
  invalidation: z.enum(["changed", "replaced", "revoked"]).nullable(),
};
export const ReviewFieldDecision = z.strictObject({
  ...Binding,
  reference: ReviewFieldRef,
  action: z.enum(["accept", "correct", "clear"]),
  note: z.string().trim().min(1).max(2000).nullable(),
});
export type ReviewFieldDecision = z.infer<typeof ReviewFieldDecision>;
export const ReviewSectionConfirmation = z.strictObject({ ...Binding, reference: ReviewSectionRef });
export type ReviewSectionConfirmation = z.infer<typeof ReviewSectionConfirmation>;
export const ReviewWorkflow = z
  .strictObject({
    policyVersion: z.union([z.literal(1), z.literal(2), z.literal(REVIEW_WORKFLOW_POLICY_VERSION)]),
    decisions: z.array(ReviewFieldDecision),
    confirmations: z.array(ReviewSectionConfirmation),
  })
  .superRefine((workflow, context) => {
    const entries = [...workflow.decisions, ...workflow.confirmations];
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length)
      context.addIssue({ code: "custom", message: "Workflow event IDs must be unique" });
    for (const group of [workflow.decisions, workflow.confirmations]) {
      const active = group
        .filter((entry) => entry.invalidatedAtRevision === null)
        .map((entry) => JSON.stringify(entry.reference));
      if (new Set(active).size !== active.length)
        context.addIssue({ code: "custom", message: "Only one active decision per reference is allowed" });
    }
    for (const entry of entries) {
      if (
        (entry.invalidatedAtRevision === null) !== (entry.invalidation === null) ||
        (entry.invalidatedAtRevision !== null && entry.invalidatedAtRevision < entry.atRevision)
      )
        context.addIssue({ code: "custom", message: "Invalid workflow invalidation history" });
    }
  });
export type ReviewWorkflow = z.infer<typeof ReviewWorkflow>;
export function emptyReviewWorkflow(): ReviewWorkflow {
  return { policyVersion: REVIEW_WORKFLOW_POLICY_VERSION, decisions: [], confirmations: [] };
}

export interface ReviewFieldRequirement {
  reference: ReviewFieldRef;
  decisionRequired: boolean;
  noteRequired: boolean;
  resolved: boolean;
}
export interface ReviewSectionState {
  reference: ReviewSectionRef;
  confirmed: boolean;
  blockingIssueCount: number;
  unresolvedFieldCount: number;
  unresolvedMarkCount: number;
}
export interface ReviewWorkflowStatus {
  fields: ReviewFieldRequirement[];
  sections: ReviewSectionState[];
}
