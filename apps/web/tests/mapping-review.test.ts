import assert from "node:assert/strict";
import test from "node:test";

import {
  lesionCollectionRef,
  lesionReviewFields,
  MappingReview,
  parseMappingReview,
  reviewFieldRef,
  SurgeryRecord,
  surgeryReviewFields,
} from "@prostapaper/contracts";

import { mappingAttentionItems } from "#lib/mapping-review";

const record = SurgeryRecord.parse({
  surgery: {
    surgery_date: null,
    surgery_type: null,
    lymphadenectomy: null,
    node_no_surgery: null,
    node_positive_no_surgery: null,
    pt_surg: null,
    pn_surg: null,
    pm_surg: null,
    classify_r_surg: null,
    classify_l_surg: null,
    vascular_inv: null,
    isup: null,
    histol_post_surg: null,
    histol_post_surg_specify: null,
    surgery_text: null,
  },
  lesions: [
    {
      sur_prostate_regions: [],
      all_sgm: false,
      hist_type_sur: null,
      lesion_x_mm: null,
      lesion_y_mm: null,
      lesion_z_mm: null,
      extracaps_ext: null,
      perineural_inv_sur: null,
      gleason_prim_grade: null,
      gleason_prim_perc: null,
      gleason_sec_grade: null,
      gleason_sec_perc: null,
      gleason_tert_grade: null,
      gleason_tert_perc: null,
    },
  ],
});

function makeReview() {
  const assessments = [
    ...surgeryReviewFields.map((field) => ({
      reference: reviewFieldRef(field.name),
      selectedValue: record.surgery[field.name],
    })),
    ...record.lesions.flatMap((lesion, index) => {
      const lesionId = `lesion-${index + 1}`;

      return lesionReviewFields.map((field) => ({
        reference: reviewFieldRef(field.name, lesionId),
        selectedValue: lesion[field.name],
      }));
    }),
    { reference: lesionCollectionRef, selectedValue: record.lesions.length },
  ].map((item) => ({
    ...item,
    selectedSupport: 0,
    comparablePassCount: 0,
    totalPassCount: 0,
    requestedPassCount: 0,
    alternatives: [],
    selectionMethod: "majority" as const,
    evidenceStatus: "unavailable" as const,
    confidence: "unavailable" as const,
    reasonCodes: [],
    evidenceIds: [],
  }));

  return MappingReview.parse({
    schemaVersion: 1,
    policyVersion: 1,
    mappingIdentity: "mapping-test",
    lesionIds: ["lesion-1"],
    sources: [],
    assessments,
    evidence: [],
    marks: [],
    transformations: [],
  });
}

void test("mapping sidecar is accepted only when every supported field is covered and matches", () => {
  const review = makeReview();
  assert.ok(parseMappingReview(review, record));

  const wrongValue = structuredClone(review);
  const target = wrongValue.assessments.find(
    (item) => item.reference.scope === "surgery" && item.reference.field === "surgery_date",
  );
  assert.ok(target);
  target.selectedValue = "2026-01-02";
  assert.equal(parseMappingReview(wrongValue, record), null);

  const missing = structuredClone(review);
  missing.assessments.pop();
  assert.equal(parseMappingReview(missing, record), null);
});

void test("sidecar rejects lesion identity mismatch and legacy artifacts stay unavailable", () => {
  const review = makeReview();
  const wrongIds = { ...review, lesionIds: ["wrong-lesion"] };
  assert.equal(parseMappingReview(wrongIds, record), null);
  assert.equal(parseMappingReview(undefined, record), null);
});

void test("legacy worklist omits absent defaults and summarizes populated provenance", () => {
  const attention = mappingAttentionItems(record, null);
  assert.equal(
    attention.items.some((item) => item.key.includes("all_sgm") || item.key.includes("sur_prostate_regions")),
    false,
  );
  assert.equal(
    attention.items.some((item) => item.key.startsWith("unavailable:")),
    false,
  );
  assert.ok(attention.unavailablePopulatedCount > 0);
});

void test("legacy populated values are summarized once instead of flooding the worklist", () => {
  const withZero = SurgeryRecord.parse({
    ...record,
    lesions: [{ ...record.lesions[0], lesion_x_mm: 0 }],
  });

  const attention = mappingAttentionItems(withZero, null);
  assert.equal(
    attention.items.some((item) => item.key.startsWith("unavailable:")),
    false,
  );
  assert.equal(
    attention.items.some((item) => item.key.startsWith("confidence:")),
    false,
  );
  assert.ok(attention.unavailablePopulatedCount > 0);
});

void test("unavailable evidence instrumentation is informational while real uncertainty remains", () => {
  const review = makeReview();
  const dateAssessment = review.assessments.find(
    (item) => item.reference.scope === "surgery" && item.reference.field === "surgery_date",
  );
  assert.ok(dateAssessment);
  dateAssessment.selectedValue = "2026-01-02";
  review.assessments = review.assessments.map((item) =>
    item === dateAssessment
      ? { ...item, confidence: "unavailable", reasonCodes: ["evidence_not_collected"] }
      : item,
  );
  const attention = mappingAttentionItems(
    SurgeryRecord.parse({ ...record, surgery: { ...record.surgery, surgery_date: "2026-01-02" } }),
    review,
  );
  assert.equal(
    attention.items.some((item) => item.fieldName === "surgery_date"),
    false,
  );
  assert.ok(attention.unavailablePopulatedCount > 0);
});

void test("instrumented uncertainty keeps its clinical priority even when confidence is unavailable", () => {
  const review = makeReview();
  const changed = review.assessments.map((assessment) => {
    if (assessment.reference.scope !== "surgery" || assessment.reference.field !== "surgery_date")
      return assessment;

    return {
      ...assessment,
      selectedValue: "2026-01-02",
      confidence: "unavailable" as const,
      reasonCodes: ["lesion_alignment_uncertain"],
    };
  });
  review.assessments = changed;
  const attention = mappingAttentionItems(
    SurgeryRecord.parse({ ...record, surgery: { ...record.surgery, surgery_date: "2026-01-02" } }),
    review,
  );
  assert.ok(attention.items.some((item) => item.fieldName === "surgery_date" && item.priority === 1));
});

void test("low instrumented fields stay below validation and high priority issues", () => {
  const review = makeReview();
  review.assessments = review.assessments.map((assessment) => {
    if (assessment.reference.scope !== "surgery" || assessment.reference.field !== "surgery_date")
      return assessment;

    return {
      ...assessment,
      selectedValue: "2026-01-02",
      confidence: "low" as const,
      reasonCodes: ["citation_invalid"],
    };
  });
  const attention = mappingAttentionItems(
    SurgeryRecord.parse({ ...record, surgery: { ...record.surgery, surgery_date: "2026-01-02" } }),
    review,
  );
  assert.ok(attention.items.some((item) => item.fieldName === "surgery_date" && item.priority === 2));
});

void test("sidecar accepts arbitrary stable lesion IDs when all references agree", () => {
  const review = makeReview();
  review.lesionIds = ["stable-original-lesion"];
  for (const assessment of review.assessments) {
    if (assessment.reference.scope === "lesion") assessment.reference.lesionId = "stable-original-lesion";
  }
  assert.ok(parseMappingReview(review, record));
});

void test("distinct unassigned marks remain attention items after blocking data and open collection evidence", () => {
  const review = makeReview();
  review.sources = [
    {
      documentId: "sheet",
      filename: "mapa.jpg",
      kind: "sector_map",
      sourceVersion: "v1",
      extractionIdentity: "extract-v1",
      pages: [{ page: 1, text: "sheet", source: "opencv" }],
    },
  ];
  const mark = {
    id: "mark-a",
    documentId: "sheet",
    sourceVersion: "v1",
    extractionIdentity: "extract-v1",
    page: 1,
    focus: {
      sectors: [{ id: "base_PZpl_L" as const, share: 1, coverage: 0.2 }],
      marked: ["base_PZpl_L" as const],
    },
    regions: ["pzpl_base_ls" as const],
    status: "unassigned" as const,
    lesionId: null,
    candidateLesionIds: [],
    ruleVersion: 1 as const,
  };
  review.marks = [mark, { ...mark, id: "mark-b" }];
  const attention = mappingAttentionItems(record, review);
  const marks = attention.items.filter((item) => item.key.startsWith("mark:"));
  assert.equal(marks.length, 2);
  assert.notEqual(marks[0]?.key, marks[1]?.key);
  assert.ok(
    marks.every((item) => item.reference.scope === "collection" && item.fieldName === "lesions.length"),
  );
  assert.equal(attention.items[0]?.priority, 0);
  assert.ok(marks.every((item) => item.priority === 1));
});

void test("null optional fields do not hide conflicting evidence from attention", () => {
  const review = makeReview();
  const field = review.assessments.find(
    (field) => field.reference.scope === "surgery" && field.reference.field === "histol_post_surg_specify",
  );
  assert.ok(field);
  field.reasonCodes = ["conflict"];
  const attention = mappingAttentionItems(record, review);
  assert.ok(
    attention.items.some((item) => item.fieldName === "histol_post_surg_specify" && item.priority === 1),
  );
});
