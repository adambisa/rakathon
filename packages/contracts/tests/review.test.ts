import assert from "node:assert/strict";
import test from "node:test";

import { prepareRedcapUpload } from "#redcap";
import { toRedcapRows } from "#redcap-rows";
import { redcapAllSegmentRegions } from "#redcap-schema";
import { ReviewReadyRecord, ReviewSnapshot, reviewValidationIssues, validateReviewRecord } from "#review";
import { ReviewOperation } from "#review-commands";
import { MappingOutput, ReviewDraftRecord, SurgeryRecord } from "#surgery";

function fixture(): ReviewDraftRecord {
  return {
    surgery: {
      surgery_date: "2024-02-29",
      surgery_type: "2",
      lymphadenectomy: "1",
      node_no_surgery: 8,
      node_positive_no_surgery: 1,
      pt_surg: null,
      pn_surg: null,
      pm_surg: null,
      classify_r_surg: "1",
      classify_l_surg: "1",
      vascular_inv: "1",
      isup: "2",
      histol_post_surg: "1",
      histol_post_surg_specify: null,
      surgery_text: null,
    },
    lesions: [
      {
        sur_prostate_regions: [],
        all_sgm: false,
        hist_type_sur: "2",
        lesion_x_mm: 0,
        lesion_y_mm: null,
        lesion_z_mm: null,
        extracaps_ext: "3",
        perineural_inv_sur: "1",
        gleason_prim_grade: "3",
        gleason_prim_perc: 80,
        gleason_sec_grade: "4",
        gleason_sec_perc: 20,
        gleason_tert_grade: null,
        gleason_tert_perc: null,
      },
    ],
  };
}

void test("lesion review can save and approve without parent-form data", () => {
  const record = fixture();
  for (const name of Object.keys(record.surgery) as (keyof typeof record.surgery)[])
    record.surgery[name] = null;
  assert.equal(
    ReviewSnapshot.safeParse({
      schemaVersion: 1,
      mappingIdentity: "mapping-v1",
      revision: 1,
      record,
      lesionIds: ["first"],
    }).success,
    true,
  );
  assert.deepEqual(reviewValidationIssues(record, ["first"]), []);
  assert.equal(ReviewReadyRecord.safeParse(record).success, true);
});

void test("multiple out-of-scope parent values cannot trap the first lesion correction", () => {
  const record = fixture();
  record.surgery.surgery_date = "2099-01-01";
  record.surgery.node_no_surgery = 21;
  assert.equal(MappingOutput.safeParse({ record }).success, true);
  assert.ok(record.lesions[0]);
  record.lesions[0].lesion_x_mm = 5;
  assert.equal(ReviewDraftRecord.safeParse(record).success, true);
  assert.equal(ReviewReadyRecord.safeParse(record).success, true);
});

void test("legacy long text remains readable and does not block lesion edits; new text edits stay bounded", () => {
  const record = fixture();
  record.surgery.surgery_text = "x".repeat(20_001);
  record.surgery.histol_post_surg_specify = "x".repeat(1001);
  assert.equal(MappingOutput.safeParse({ record }).success, true);
  assert.equal(ReviewDraftRecord.safeParse(record).success, true);
  assert.equal(ReviewReadyRecord.safeParse(record).success, true);
  for (const changes of [
    { surgery_text: record.surgery.surgery_text },
    { histol_post_surg_specify: record.surgery.histol_post_surg_specify },
  ])
    assert.equal(ReviewOperation.safeParse({ kind: "update_surgery", changes }).success, false);
});

void test("separate draft saves permit inconsistent Gleason percentages; readiness rejects until corrected", () => {
  const record = fixture();
  assert.ok(record.lesions[0]);
  record.lesions[0].gleason_sec_perc = 30;
  const saved = ReviewDraftRecord.parse(record);
  assert.equal(SurgeryRecord.safeParse(saved).success, false);
  assert.equal(ReviewReadyRecord.safeParse(saved).success, false);
  assert.ok(
    validateReviewRecord(saved, ["lesion-a"]).some(
      (issue) => issue.reference.scope === "lesion" && issue.reference.field === "gleason_prim_perc",
    ),
  );
  assert.ok(saved.lesions[0]);
  saved.lesions[0].gleason_prim_perc = 70;
  assert.equal(ReviewReadyRecord.safeParse(saved).success, true);
});

void test("drafts still enforce individual types, codes, bounds and field allowlists", () => {
  const record = fixture();
  for (const change of [
    { node_no_surgery: -1 },
    { node_no_surgery: 1.5 },
    { node_no_surgery: "0" },
    { surgery_type: "99" },
    { surgery_date: "2025-02-29" },
    { unexpected: "value" },
  ])
    assert.equal(
      ReviewDraftRecord.safeParse({ ...record, surgery: { ...record.surgery, ...change } }).success,
      false,
    );
  for (const change of [
    { lesion_x_mm: 101 },
    { gleason_prim_perc: 101 },
    { all_sgm: null },
    { unknown: 1 },
  ]) {
    assert.equal(
      ReviewDraftRecord.safeParse({ ...record, lesions: [{ ...record.lesions[0], ...change }] }).success,
      false,
    );
  }
});

void test("temporary grade and all-segment issues survive drafts but block readiness", () => {
  const record = fixture();
  for (const change of [{ gleason_prim_grade: null }, { gleason_prim_perc: 90 }, { all_sgm: true }]) {
    const changed = { ...record, lesions: [{ ...record.lesions[0], ...change }] };
    assert.equal(ReviewDraftRecord.safeParse(changed).success, true);
    assert.equal(ReviewReadyRecord.safeParse(changed).success, false);
  }
  const lesion = record.lesions[0];
  assert.ok(lesion);
  lesion.all_sgm = true;
  lesion.sur_prostate_regions = [...redcapAllSegmentRegions];
  assert.equal(ReviewReadyRecord.safeParse(record).success, true);
});

void test("required unknowns block readiness while optional null, zero, false and empty regions survive", () => {
  const record = fixture();
  assert.deepEqual(validateReviewRecord(record, ["lesion-a"]), []);
  const parsed = ReviewReadyRecord.parse(record);
  assert.equal(parsed.lesions[0]?.lesion_x_mm, 0);
  assert.equal(parsed.lesions[0].all_sgm, false);
  assert.deepEqual(parsed.lesions[0].sur_prostate_regions, []);
  assert.equal(parsed.surgery.pt_surg, null);
  assert.ok(record.lesions[0]);
  record.lesions[0].hist_type_sur = null;
  assert.equal(ReviewDraftRecord.safeParse(record).success, true);
  assert.equal(ReviewReadyRecord.safeParse(record).success, false);
  assert.ok(
    validateReviewRecord(record, ["lesion-a"]).some(
      (issue) =>
        issue.code === "required" &&
        issue.reference.scope === "lesion" &&
        issue.reference.field === "hist_type_sur",
    ),
  );
});

void test("snapshots reject duplicate/missing stable IDs and issues retain IDs after deletion", () => {
  const record = fixture();
  const lesion = record.lesions[0];
  assert.ok(lesion);
  record.lesions.push({ ...lesion, hist_type_sur: null });
  const snapshot = {
    schemaVersion: 1,
    mappingIdentity: "mapping-v1",
    revision: 1,
    record,
    lesionIds: ["a", "b"],
  };
  assert.equal(ReviewSnapshot.safeParse(snapshot).success, true);
  for (const lesionIds of [["a"], ["a", "a"], ["a", ""]])
    assert.equal(ReviewSnapshot.safeParse({ ...snapshot, lesionIds }).success, false);
  assert.ok(
    validateReviewRecord(record, ["a", "b"]).some(
      (issue) =>
        issue.reference.scope === "lesion" &&
        issue.reference.lesionId === "b" &&
        issue.reference.field === "hist_type_sur",
    ),
  );
  record.lesions.shift();
  assert.ok(
    validateReviewRecord(record, ["b"]).some(
      (issue) => issue.reference.scope === "lesion" && issue.reference.lesionId === "b",
    ),
  );
  assert.equal(toRedcapRows(record, "test").lesions[0]?.instance, "1");
});

void test("structured export issues preserve existing messages and identify exact fields/instances", () => {
  const record = fixture();
  record.surgery.surgery_date = null;
  const lesion = record.lesions[0];
  assert.ok(lesion);
  lesion.hist_type_sur = null;
  const result = prepareRedcapUpload(toRedcapRows(record, "test"));
  assert.deepEqual(
    result.errors,
    result.issues.map((issue) => issue.message),
  );
  assert.deepEqual(result.rows, []);
  assert.ok(result.issues.every((issue) => issue.scope !== "surgery"));
  assert.ok(
    result.issues.some(
      (issue) => issue.scope === "lesion" && issue.instance === "1" && issue.field === "hist_type_sur",
    ),
  );
});

void test("legacy mapping records remain readable while review limits the lesion collection", () => {
  const record = fixture();
  record.surgery.node_no_surgery = 21;
  record.surgery.surgery_date = "1899-12-31";
  assert.equal(SurgeryRecord.safeParse(record).success, true);
  const lesion = record.lesions[0];
  assert.ok(lesion);
  const legacyCollection = { ...record, lesions: Array.from({ length: 101 }, () => lesion) };
  assert.equal(SurgeryRecord.safeParse(legacyCollection).success, true);
  assert.equal(ReviewDraftRecord.safeParse(legacyCollection).success, false);
  assert.equal(ReviewDraftRecord.safeParse(record).success, true);
  assert.equal(ReviewReadyRecord.safeParse(record).success, true);
});

void test("opaque review IDs reject surrounding whitespace rather than silently alias identities", () => {
  assert.throws(() => validateReviewRecord(fixture(), [" lesion-a "]));
});

void test("shared review issues report cross-field lesion errors against stable identities", () => {
  const record = fixture();
  assert.ok(record.lesions[0]);
  record.lesions[0].gleason_prim_grade = null;
  const issues = reviewValidationIssues(record, ["stable-a"]);
  assert.ok(
    issues.some(
      (issue) =>
        issue.reference.scope === "lesion" &&
        issue.reference.lesionId === "stable-a" &&
        issue.reference.field === "gleason_prim_perc",
    ),
  );
  assert.deepEqual(validateReviewRecord(record, ["stable-a"]), issues);
});
