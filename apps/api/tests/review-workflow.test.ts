import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { MappingReview, type ReviewWorkflow } from "@prostapaper/contracts";

import { mappingEvidenceFixture } from "#fixtures/mapping";
import { fixture } from "#fixtures/surgery";
import { reconcileWorkflow, type WorkflowInput, workflowView } from "#review/workflow";

function input(): WorkflowInput {
  const record = fixture();

  return {
    record,
    lesionIds: ["first"],
    workflow: { policyVersion: 1, decisions: [], confirmations: [] },
    proposal: { record: structuredClone(record) },
    evidence: null,
    baseline: { versionId: "v1", sha256: "a".repeat(64) },
  };
}

void test("parent values and legacy parent conflicts cannot block or invalidate lesion review", () => {
  const current = input();
  current.record.surgery.surgery_date = null;
  current.record.surgery.surgery_type = null;
  current.evidence = mappingEvidenceFixture(current.record, current.lesionIds);
  for (const assessment of current.evidence.assessments) {
    if (assessment.reference.scope === "surgery") assessment.reasonCodes.push("conflict");
  }
  const before = workflowView(current);
  assert.ok(before.fields.every((field) => field.reference.scope !== "surgery"));
  assert.ok(before.sections.every((section) => section.reference.scope !== "surgery"));
  assert.ok(before.sections.every((section) => section.blockingIssueCount === 0));
  current.record.surgery.histol_post_surg_specify = "Changed legacy parent text";
  current.record.surgery.pt_surg = null;
  const after = workflowView(current);
  assert.deepEqual(
    after.fields.map((field) => field.basisHash),
    before.fields.map((field) => field.basisHash),
  );
  assert.deepEqual(
    after.sections.map((section) => section.basisHash),
    before.sections.map((section) => section.basisHash),
  );
});

void test("region ordering is semantically a no-op, but changed evidence identity invalidates decisions even with identical values", () => {
  const current = input();
  const lesion = current.record.lesions[0];
  assert.ok(lesion);
  lesion.sur_prostate_regions = ["pzpl_base_ls", "pzpl_base_rs"];
  current.proposal.record.lesions = structuredClone(current.record.lesions);
  const field = workflowView(current).fields.find(
    (field) => field.reference.scope === "lesion" && field.reference.field === "sur_prostate_regions",
  );
  assert.ok(field);
  const workflow: ReviewWorkflow = {
    ...current.workflow,
    decisions: [
      {
        id: randomUUID(),
        actorId: "owner",
        atRevision: 1,
        at: new Date().toISOString(),
        basisHash: field.basisHash,
        reference: field.reference,
        action: "accept",
        note: null,
        invalidatedAtRevision: null,
        invalidation: null,
      },
    ],
  };
  lesion.sur_prostate_regions.reverse();
  assert.equal(reconcileWorkflow({ ...current, workflow }, 2).decisions[0]?.invalidatedAtRevision, null);
  const changedEvidence = reconcileWorkflow(
    { ...current, workflow, baseline: { versionId: "v2", sha256: "b".repeat(64) } },
    2,
  );
  assert.equal(changedEvidence.decisions[0]?.invalidatedAtRevision, 2);
  const restored = reconcileWorkflow({ ...current, workflow: changedEvidence }, 3);
  assert.equal(restored.decisions[0]?.invalidatedAtRevision, 2);
});

void test("explicit field decisions cannot remove an unresolved source mark from section confirmation blockers", () => {
  const current = input();
  const evidence = mappingEvidenceFixture(current.record, current.lesionIds);
  const view = workflowView({ ...current, evidence });
  const decisions: ReviewWorkflow["decisions"] = view.fields
    .filter((field) => field.decisionRequired)
    .map((field) => ({
      id: randomUUID(),
      actorId: "owner",
      atRevision: 1,
      at: new Date().toISOString(),
      basisHash: field.basisHash,
      reference: field.reference,
      action: "accept",
      note: null,
      invalidatedAtRevision: null,
      invalidation: null,
    }));
  const resolved = workflowView({ ...current, evidence, workflow: { ...current.workflow, decisions } });
  const collection = resolved.sections.find((section) => section.reference.scope === "collection");
  const lesion = resolved.sections.find((section) => section.reference.scope === "lesion");
  assert.equal(collection?.unresolvedFieldCount, 0);
  assert.equal(collection.unresolvedMarkCount, 1);
  assert.equal(lesion?.unresolvedFieldCount, 0);
  assert.equal(lesion.unresolvedMarkCount, 1);
});

void test("conflicting evidence for an optional null value requires a decision and a note", () => {
  const current = input();
  assert.ok(current.record.lesions[0]);
  current.record.lesions[0].lesion_z_mm = null;
  assert.ok(current.proposal.record.lesions[0]);
  current.proposal.record.lesions[0].lesion_z_mm = null;
  const evidence = mappingEvidenceFixture(current.record, current.lesionIds);
  const assessment = evidence.assessments.find(
    (item) => item.reference.scope === "lesion" && item.reference.field === "lesion_z_mm",
  );
  assert.ok(assessment);
  assessment.reasonCodes.push("conflict");
  assert.ok(MappingReview.safeParse(evidence).success);
  const field = workflowView({ ...current, evidence }).fields.find(
    (item) => item.reference.scope === "lesion" && item.reference.field === "lesion_z_mm",
  );
  assert.ok(field);
  assert.equal(field.decisionRequired, true);
  assert.equal(field.noteRequired, true);
  assert.equal(field.resolved, false);
});
