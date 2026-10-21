import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { redcapAllSegmentRegions, ReviewSave } from "@prostapaper/contracts";

import { fixture } from "#fixtures/surgery";
import { applyReviewOperations, ReviewArtifact } from "#review/model";

void test("review commands reject arbitrary paths, unknown fields, invalid codes and empty edits", () => {
  const input = {
    caseId: randomUUID(),
    mappingIdentity: "mapping/test.json",
    expectedRevision: 0,
    requestId: randomUUID(),
  };
  for (const operation of [
    { kind: "update_surgery", changes: { arbitrary: "value" } },
    { kind: "update_surgery", changes: {} },
    { kind: "update_surgery", changes: { surgery_type: "invalid" } },
    { kind: "update_surgery", changes: { node_no_surgery: 999 } },
    { kind: "update_lesion", lesionId: "lesion-1", changes: { lesion_x_mm: -1 } },
    { kind: "set", path: "__proto__.bad", value: true },
  ]) {
    assert.equal(ReviewSave.safeParse({ ...input, operations: [operation] }).success, false);
  }
  assert.ok(
    ReviewSave.safeParse({
      ...input,
      operations: [{ kind: "update_surgery", changes: { surgery_date: null, node_no_surgery: 0 } }],
    }).success,
  );
  assert.ok(ReviewSave.safeParse({ ...input, expectedRevision: 0, operations: [] }).success);
  assert.equal(ReviewSave.safeParse({ ...input, expectedRevision: 1, operations: [] }).success, false);
});

void test("lesion edits use stable identities, preserve the proposal and cannot reuse deleted identities", () => {
  const record = fixture();
  const lesion = record.lesions[0];
  assert.ok(lesion);
  const current = { record, lesionIds: ["first"], retiredLesionIds: [] };
  const operations = ReviewSave.shape.operations.parse([
    { kind: "add_lesion", lesionId: "second", lesion },
    { kind: "delete_lesion", lesionId: "first" },
    { kind: "update_lesion", lesionId: "second", changes: { lesion_x_mm: 0 } },
    { kind: "update_surgery", changes: { surgery_date: null } },
  ]);
  const changed = applyReviewOperations(current, operations);
  assert.deepEqual(changed.lesionIds, ["second"]);
  assert.deepEqual(changed.retiredLesionIds, ["first"]);
  assert.equal(changed.record.lesions[0]?.lesion_x_mm, 0);
  assert.equal(changed.record.surgery.surgery_date, null);
  assert.equal(record.lesions[0]?.lesion_x_mm, 12);
  assert.equal(record.surgery.surgery_date, "2026-10-01");
  assert.throws(
    () => applyReviewOperations(changed, [{ kind: "add_lesion", lesionId: "first", lesion }]),
    /identity already used/,
  );
  assert.throws(
    () => applyReviewOperations(changed, [{ kind: "delete_lesion", lesionId: "first" }]),
    /Unknown lesion/,
  );
  assert.throws(
    () =>
      applyReviewOperations(changed, [
        { kind: "update_lesion", lesionId: "first", changes: { lesion_x_mm: 4 } },
      ]),
    /Unknown lesion/,
  );
});

void test("old saved artifacts decode to an empty workflow; decisions require a pinned baseline", () => {
  const legacy = {
    caseId: randomUUID(),
    snapshot: {
      schemaVersion: 1,
      mappingIdentity: "mapping/legacy",
      revision: 1,
      record: fixture(),
      lesionIds: ["first"],
    },
    retiredLesionIds: [],
  };
  const parsed = ReviewArtifact.parse(legacy);
  assert.deepEqual(parsed.workflow, { policyVersion: 3, decisions: [], confirmations: [] });
  assert.equal(parsed.baseline, undefined);
  assert.equal(parsed.note, "");
  assert.equal(ReviewArtifact.parse({ ...legacy, note: "  Poznámka  " }).note, "Poznámka");
  assert.equal(ReviewArtifact.safeParse({ ...legacy, note: "x".repeat(4001) }).success, false);
  const decision = {
    id: randomUUID(),
    actorId: "owner",
    atRevision: 1,
    at: new Date().toISOString(),
    basisHash: "a".repeat(64),
    invalidatedAtRevision: null,
    invalidation: null,
    reference: { scope: "surgery", field: "surgery_date" },
    action: "accept",
    note: null,
  };
  assert.equal(
    ReviewArtifact.safeParse({ ...legacy, workflow: { ...parsed.workflow, decisions: [decision] } }).success,
    false,
  );
});

void test("all-segment changes are atomic and deleted original lesions restore identity without allowing arbitrary reuse", () => {
  const record = fixture();
  const current = { record, lesionIds: ["original"], retiredLesionIds: [] };
  const all = applyReviewOperations(current, [
    { kind: "update_lesion", lesionId: "original", changes: { all_sgm: true } },
  ]);
  assert.equal(all.record.lesions[0]?.sur_prostate_regions.length, redcapAllSegmentRegions.length);
  const partial = applyReviewOperations(all, [
    { kind: "update_lesion", lesionId: "original", changes: { sur_prostate_regions: ["pzpl_base_ls"] } },
  ]);
  assert.equal(partial.record.lesions[0]?.all_sgm, false);
  const removed = applyReviewOperations(partial, [{ kind: "delete_lesion", lesionId: "original" }]);
  const restored = applyReviewOperations(
    removed,
    [{ kind: "restore_lesion", lesionId: "original" }],
    current,
  );
  assert.deepEqual(restored, current);
  assert.throws(
    () => applyReviewOperations(restored, [{ kind: "restore_lesion", lesionId: "original" }], current),
    /deleted original/,
  );
});

void test("case review notes allow standalone save and clear with trimmed bounded text", () => {
  const input = {
    caseId: randomUUID(),
    mappingIdentity: "mapping/test.json",
    expectedRevision: 1,
    requestId: randomUUID(),
    operations: [],
  };
  assert.equal(
    ReviewSave.parse({ ...input, note: "  Poznámka\nke kontrole  " }).note,
    "Poznámka\nke kontrole",
  );
  assert.equal(ReviewSave.parse({ ...input, note: " ".repeat(3) }).note, "");
  assert.equal(ReviewSave.parse({ ...input, note: "x".repeat(4000) }).note?.length, 4000);
  assert.equal(ReviewSave.safeParse({ ...input, note: "x".repeat(4001) }).success, false);
  assert.equal(ReviewSave.safeParse({ ...input, note: null }).success, false);
  assert.equal(ReviewSave.safeParse(input).success, false);
});
