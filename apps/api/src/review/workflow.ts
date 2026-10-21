import { createHash } from "node:crypto";

import {
  assessmentConflicts,
  assessmentRequiresDecision,
  isPopulatedMappingValue,
  type MappingOutput,
  type MappingReview,
  REVIEW_VALIDATION_POLICY_VERSION,
  REVIEW_WORKFLOW_POLICY_VERSION,
  type ReviewFieldDecision,
  reviewFieldKey,
  type ReviewFieldRequirement,
  type ReviewManualRegions,
  type ReviewMarkView,
  type ReviewQueueSummary,
  type ReviewRecordField,
  reviewRecordFields,
  reviewSectionKey as sectionKey,
  type ReviewSectionRef,
  type ReviewSectionState,
  type ReviewValidationIssue,
  reviewValidationIssues,
  reviewValueKey,
  type ReviewWorkflow,
  type ReviewWorkflowStatus,
  type SurgeryRecord,
} from "@prostapaper/contracts";

import { effectiveMarks } from "#review/marks";
import type { StoredObjectIdentity } from "#storage/service";

export interface WorkflowInput {
  record: SurgeryRecord;
  lesionIds: string[];
  workflow: ReviewWorkflow;
  proposal: MappingOutput;
  evidence: MappingReview | null;
  baseline: StoredObjectIdentity;
  marks?: ReviewMarkView[];
  manualRegions?: ReviewManualRegions[];
}

function sectionOf(field: ReviewRecordField): ReviewSectionRef {
  if (field.reference.scope === "lesion") return { scope: "lesion", lesionId: field.reference.lesionId };
  if (field.reference.scope === "collection") return field.reference;
  throw new Error("Parent fields are outside the lesion review scope");
}

function dependencies(field: ReviewRecordField, fields: ReviewRecordField[]) {
  const section = sectionOf(field);

  return fields.filter((candidate) => {
    const ref = candidate.reference;

    return (
      ref.scope !== "surgery" &&
      (section.scope === "collection" ||
        ref.scope === "collection" ||
        (section.scope === "lesion" && ref.lesionId === section.lesionId))
    );
  });
}

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

interface BoundField extends ReviewFieldRequirement {
  section: ReviewSectionRef;
  basisHash: string;
  decision: ReviewFieldDecision | undefined;
  action: ReviewFieldDecision["action"];
  blockingIssues: ReviewValidationIssue[];
}
interface BoundSection extends ReviewSectionState {
  basisHash: string;
}
interface WorkflowView {
  fields: BoundField[];
  sections: BoundSection[];
  status: ReviewWorkflowStatus;
}

export function workflowSummary(
  status: ReviewWorkflowStatus,
  marks: readonly ReviewMarkView[],
): Omit<ReviewQueueSummary, "revision" | "approvedRevision"> {
  return {
    blockingIssueCount: status.sections.reduce((total, section) => total + section.blockingIssueCount, 0),
    unresolvedFieldCount: status.fields.filter((field) => field.decisionRequired && !field.resolved).length,
    unresolvedMarkCount: marks.filter((mark) => mark.status === "unassigned" || mark.status === "ambiguous")
      .length,
    unconfirmedSectionCount: status.sections.filter((section) => !section.confirmed).length,
  };
}

export function workflowView(input: WorkflowInput): WorkflowView {
  const fields = reviewRecordFields(input.record, input.lesionIds).filter(
    (field) => field.reference.scope !== "surgery",
  );
  const issues = reviewValidationIssues(input.record, input.lesionIds);
  const evidence = input.evidence;
  const marks = input.marks ?? effectiveMarks({ ...input, markHistory: [] });
  const originalIds =
    evidence?.lesionIds ?? input.proposal.record.lesions.map((_, index) => `lesion-${index + 1}`);
  const originals = new Map(
    reviewRecordFields(input.proposal.record, originalIds).map((field) => [
      reviewFieldKey(field.reference),
      field.value,
    ]),
  );
  const assessments = new Map(
    evidence?.assessments.map((assessment) => [reviewFieldKey(assessment.reference), assessment]),
  );
  const boundFields = fields.map((field) => {
    const key = reviewFieldKey(field.reference);
    const name = field.reference.scope === "collection" ? "lesions" : field.reference.field;
    const original = originals.get(key);
    let changed = isPopulatedMappingValue(field.value);
    if (original !== undefined)
      changed = reviewValueKey(name, original) !== reviewValueKey(name, field.value);
    const assessment = assessments.get(key);
    const conflict = assessment !== undefined && assessmentConflicts(assessment);
    const decisionRequired =
      changed || assessmentRequiresDecision(assessment, isPopulatedMappingValue(field.value));
    const dependencyFields = dependencies(field, fields);
    const keys = new Set(dependencyFields.map((item) => reviewFieldKey(item.reference)));
    const blockingIssues = issues.filter((issue) => keys.has(reviewFieldKey(issue.reference)));
    let markBindings: (string | null)[][] = [];
    if (dependencyFields.some((item) => item.reference.scope !== "surgery"))
      markBindings = marks.map((mark) => [mark.source.id, mark.status, mark.lesionId, mark.resolutionId]);
    let manualBindings: string[][] = [];
    if (dependencyFields.some((item) => item.reference.scope !== "surgery"))
      manualBindings =
        input.manualRegions?.map((item) => [
          item.lesionId,
          reviewValueKey("sur_prostate_regions", item.regions),
        ]) ?? [];
    const basisHash = digest([
      REVIEW_WORKFLOW_POLICY_VERSION,
      REVIEW_VALIDATION_POLICY_VERSION,
      input.baseline,
      key,
      markBindings,
      manualBindings,
      dependencyFields.map((item) => [
        reviewFieldKey(item.reference),
        reviewValueKey(item.reference.scope === "collection" ? "lesions" : item.reference.field, item.value),
      ]),
      blockingIssues.map((issue) => [
        reviewFieldKey(issue.reference),
        issue.source,
        issue.code,
        issue.message,
      ]),
    ]);
    const decision = input.workflow.decisions.find(
      (decision) =>
        decision.invalidatedAtRevision === null &&
        reviewFieldKey(decision.reference) === key &&
        decision.basisHash === basisHash,
    );
    let action: "accept" | "correct" | "clear" = "accept";
    if (changed) {
      action = "correct";
      if (field.value === null || (Array.isArray(field.value) && field.value.length === 0)) action = "clear";
    }

    return {
      reference: field.reference,
      section: sectionOf(field),
      basisHash,
      decisionRequired,
      noteRequired: changed || conflict,
      resolved: decision !== undefined,
      decision,
      action,
      blockingIssues,
    };
  });
  const references: ReviewSectionRef[] = [
    { scope: "collection", collection: "lesions" },
    ...input.lesionIds.map((lesionId): ReviewSectionRef => ({ scope: "lesion", lesionId })),
  ];
  const sections = references.map((reference) => {
    const members = boundFields.filter((field) => sectionKey(field.section) === sectionKey(reference));
    const blockingIssues = new Set(
      members.flatMap((field) => field.blockingIssues.map((issue) => JSON.stringify(issue))),
    );
    let unresolvedMarkCount = 0;
    if (reference.scope !== "surgery")
      unresolvedMarkCount = marks.filter(
        (mark) => mark.status === "unassigned" || mark.status === "ambiguous",
      ).length;
    const basisHash = digest([
      members.map((field) => [reviewFieldKey(field.reference), field.basisHash, field.decision?.id ?? null]),
      unresolvedMarkCount,
    ]);
    const confirmed = input.workflow.confirmations.some(
      (confirmation) =>
        confirmation.invalidatedAtRevision === null &&
        sectionKey(confirmation.reference) === sectionKey(reference) &&
        confirmation.basisHash === basisHash,
    );

    return {
      reference,
      basisHash,
      confirmed,
      blockingIssueCount: blockingIssues.size,
      unresolvedFieldCount: members.filter((field) => field.decisionRequired && !field.resolved).length,
      unresolvedMarkCount,
    };
  });
  const status: ReviewWorkflowStatus = {
    fields: boundFields.map(({ reference, decisionRequired, noteRequired, resolved }) => ({
      reference,
      decisionRequired,
      noteRequired,
      resolved,
    })),
    sections: sections.map(({ basisHash: _hash, ...section }) => section),
  };

  return { fields: boundFields, sections, status };
}

/** Invalidation is recorded once and never reversed when an earlier value is restored. */
export function reconcileWorkflow(input: WorkflowInput, revision: number): ReviewWorkflow {
  const view = workflowView(input);
  const decisions = input.workflow.decisions.map((decision) => {
    if (decision.invalidatedAtRevision !== null) return decision;
    const field = view.fields.find(
      (field) => reviewFieldKey(field.reference) === reviewFieldKey(decision.reference),
    );
    if (field?.basisHash === decision.basisHash) return decision;

    return { ...decision, invalidatedAtRevision: revision, invalidation: "changed" as const };
  });
  const confirmations = input.workflow.confirmations.map((confirmation) => {
    if (confirmation.invalidatedAtRevision !== null) return confirmation;
    const section = view.sections.find(
      (section) => sectionKey(section.reference) === sectionKey(confirmation.reference),
    );
    if (section?.basisHash === confirmation.basisHash) return confirmation;

    return { ...confirmation, invalidatedAtRevision: revision, invalidation: "changed" as const };
  });

  return { ...input.workflow, policyVersion: REVIEW_WORKFLOW_POLICY_VERSION, decisions, confirmations };
}
