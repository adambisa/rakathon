import assert from "node:assert/strict";
import test from "node:test";

import { redcapSurgicalFields } from "#redcap-schema";
import {
  lesionCollectionRef,
  lesionReviewFields,
  reviewFieldKey,
  ReviewFieldRef,
  reviewFieldRef,
  reviewFieldRegistry,
  reviewRecordFields,
  ReviewSectionRef,
  reviewSections,
  reviewValueKey,
  surgeryReviewFields,
} from "#review-fields";
import { SurgeryRecord } from "#surgery";

void test("review field registry covers every SurgeryRecord field exactly once", () => {
  assert.equal(surgeryReviewFields.length, 15);
  assert.equal(lesionReviewFields.length, 14);
  assert.equal(reviewFieldRegistry.length, 29);
  assert.equal(new Set(reviewFieldRegistry.map(({ name }) => name)).size, 29);
  assert.deepEqual(
    surgeryReviewFields.map(({ name }) => name).toSorted(),
    [
      "surgery_date",
      "surgery_type",
      "lymphadenectomy",
      "node_no_surgery",
      "node_positive_no_surgery",
      "pt_surg",
      "pn_surg",
      "pm_surg",
      "classify_r_surg",
      "classify_l_surg",
      "vascular_inv",
      "isup",
      "histol_post_surg",
      "histol_post_surg_specify",
      "surgery_text",
    ].toSorted(),
  );
  assert.deepEqual(
    lesionReviewFields.map(({ name }) => name).toSorted(),
    [
      "sur_prostate_regions",
      "all_sgm",
      "hist_type_sur",
      "lesion_x_mm",
      "lesion_y_mm",
      "lesion_z_mm",
      "extracaps_ext",
      "perineural_inv_sur",
      "gleason_prim_grade",
      "gleason_prim_perc",
      "gleason_sec_grade",
      "gleason_sec_perc",
      "gleason_tert_grade",
      "gleason_tert_perc",
    ].toSorted(),
  );
});

void test("registry uses Czech labels, planned sections, and generated REDCap metadata", () => {
  assert.deepEqual(
    reviewSections.map(({ label }) => label),
    ["Operace", "Histologie", "Uzliny", "Staging a klasifikace", "Ložiska"],
  );
  for (const item of reviewFieldRegistry) {
    assert.ok(item.label.length > 0);
    const generated = redcapSurgicalFields.find(({ name }) => name === item.name);
    assert.ok(generated);
    assert.equal(item.metadata, generated);
    assert.deepEqual(item.metadata.choices, generated.choices);
    assert.ok(["operation", "histology", "nodes", "staging", "lesions"].includes(item.section));
  }
  assert.ok(surgeryReviewFields.every(({ metadata }) => metadata.form === "surgery_c61"));
  assert.ok(lesionReviewFields.every(({ metadata }) => metadata.form === "surgery_c61_resected_lesion"));
  assert.deepEqual(lesionCollectionRef, { scope: "collection", collection: "lesions" });
});

void test("field references use stable lesion IDs rather than array positions", () => {
  assert.deepEqual(reviewFieldRef("surgery_date"), { scope: "surgery", field: "surgery_date" });
  assert.deepEqual(reviewFieldRef("lesion_x_mm", "lesion-stable-42"), {
    scope: "lesion",
    lesionId: "lesion-stable-42",
    field: "lesion_x_mm",
  });
  assert.throws(() => reviewFieldRef("not_a_field" as never));
  assert.throws(() => reviewFieldRef("surgery_date" as never, "lesion-stable-42"));
  assert.throws(() => reviewFieldRef("lesion_x_mm", ""));
  assert.throws(() => ReviewFieldRef.parse({ scope: "surgery", field: "surgery_date", extra: true }));
  assert.throws(() => ReviewFieldRef.parse({ scope: "lesion", lesionId: "l1", field: "surgery_date" }));
});

void test("section references identify surgery sections, stable lesion cards, and collection completeness", () => {
  assert.deepEqual(ReviewSectionRef.parse({ scope: "surgery", section: "nodes" }), {
    scope: "surgery",
    section: "nodes",
  });
  assert.deepEqual(ReviewSectionRef.parse({ scope: "lesion", lesionId: "lesion-abc" }), {
    scope: "lesion",
    lesionId: "lesion-abc",
  });
  assert.deepEqual(ReviewSectionRef.parse({ scope: "collection", collection: "lesions" }), {
    scope: "collection",
    collection: "lesions",
  });
  assert.throws(() => ReviewSectionRef.parse({ scope: "surgery", section: "lesions" }));
  assert.throws(() => ReviewSectionRef.parse({ scope: "lesion", lesionId: "  " }));
});

void test("field reference keys preserve identity without depending on property order", () => {
  assert.equal(
    reviewFieldKey({ scope: "lesion", lesionId: "a:b", field: "lesion_x_mm" }),
    reviewFieldKey({ field: "lesion_x_mm", scope: "lesion", lesionId: "a:b" }),
  );
  assert.notEqual(
    reviewFieldKey({ scope: "lesion", lesionId: "a:b", field: "lesion_x_mm" }),
    reviewFieldKey({ scope: "lesion", lesionId: "a", field: "lesion_x_mm" }),
  );
  assert.equal(
    reviewValueKey("sur_prostate_regions", ["a", "b"]),
    reviewValueKey("sur_prostate_regions", ["b", "a"]),
  );
  assert.notEqual(reviewValueKey("node_no_surgery", 0), reviewValueKey("node_no_surgery", null));
});

void test("shared field enumeration covers the record in form order with stable lesion identities", () => {
  const surgery = Object.fromEntries(surgeryReviewFields.map((field) => [field.name, null]));
  const lesion: Record<string, unknown> = Object.fromEntries(
    lesionReviewFields.map((field) => [field.name, null]),
  );
  lesion["sur_prostate_regions"] = [];
  lesion["all_sgm"] = false;
  const record = SurgeryRecord.parse({ surgery, lesions: [lesion] });
  const fields = reviewRecordFields(record, ["stable-a"]);
  assert.equal(fields.length, 30);
  assert.deepEqual(fields[15]?.reference, lesionCollectionRef);
  assert.equal(fields[15].value, 1);
  assert.ok(
    fields
      .slice(16)
      .every((field) => field.reference.scope === "lesion" && field.reference.lesionId === "stable-a"),
  );
  assert.throws(() => reviewRecordFields(record, []));
});
