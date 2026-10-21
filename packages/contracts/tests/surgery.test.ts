import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import { prepareRedcapUpload } from "#redcap";
import { toRedcapRows } from "#redcap-rows";
import { redcapAllSegmentRegions, redcapSurgicalFields } from "#redcap-schema";
import { SurgeryRecord } from "#surgery";

function fixture(): SurgeryRecord {
  return SurgeryRecord.parse({
    surgery: {
      surgery_date: "2026-10-01",
      surgery_type: "2",
      lymphadenectomy: "1",
      node_no_surgery: 8,
      node_positive_no_surgery: 1,
      pt_surg: "8",
      pn_surg: "2",
      pm_surg: "5",
      classify_r_surg: "1",
      classify_l_surg: "1",
      vascular_inv: "1",
      isup: "2",
      histol_post_surg: "1",
      histol_post_surg_specify: "Acinar adenocarcinoma",
      surgery_text: "Histological finding",
    },
    lesions: [
      {
        sur_prostate_regions: ["pzpl_base_ls"],
        all_sgm: false,
        hist_type_sur: "2",
        lesion_x_mm: 12,
        lesion_y_mm: 8,
        lesion_z_mm: 6,
        extracaps_ext: "1",
        perineural_inv_sur: "1",
        gleason_prim_grade: "3",
        gleason_prim_perc: 80,
        gleason_sec_grade: "4",
        gleason_sec_perc: 20,
        gleason_tert_grade: null,
        gleason_tert_perc: null,
      },
    ],
  });
}

interface JsonNode {
  properties?: Record<string, JsonNode>;
  items?: JsonNode;
  anyOf?: JsonNode[];
  enum?: string[];
}

void test("record fields and literal choices match the REDCap dictionary", () => {
  const schema = z.toJSONSchema(SurgeryRecord) as unknown as JsonNode;
  const surgery = schema.properties?.["surgery"]?.properties ?? {};
  const lesions = schema.properties?.["lesions"]?.items?.properties ?? {};
  const properties = { ...surgery, ...lesions };
  for (const [name, node] of Object.entries(properties)) {
    const field = redcapSurgicalFields.find((field) => field.name === name);
    assert.ok(field, name);
    assert.ok(field.form === (name in surgery ? "surgery_c61" : "surgery_c61_resected_lesion"));
    if (name === "all_sgm" || name === "sur_prostate_regions") continue;
    if (field.choices.length > 0) {
      const enumeration = node.enum ?? node.anyOf?.find((node) => node.enum !== undefined)?.enum;
      assert.deepEqual(new Set(enumeration), new Set(field.choices.map((choice) => choice.code)), name);
    }
  }
  for (const field of redcapSurgicalFields) {
    if (field.required && field.name !== "total_number_lesion_surg")
      assert.ok(field.name in properties, field.name);
  }
});

void test("full record serializes all region checkboxes and validates for REDCap upload", () => {
  const result = prepareRedcapUpload(toRedcapRows(fixture(), "CMP-fixture"));
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 2);
  assert.ok(result.rows[1]);
  assert.equal(result.rows[1]["redcap_repeat_instance"], "1");
  assert.equal(result.rows[1]["sur_prostate_regions___pzpl_base_ls"], "1");
  assert.equal(result.rows[1]["sur_prostate_regions___urethra"], "0");
  assert.equal(result.rows[1]["all_sgm___1"], "0");
});

void test("zero and more than six lesions preserve repeat instances without writing parent counts", () => {
  const record = fixture();
  for (const count of [0, 7, 8]) {
    const lesions = Array.from({ length: count }, () => record.lesions[0]);
    const input = toRedcapRows(SurgeryRecord.parse({ ...record, lesions }), "CMP-fixture");
    assert.equal(input.surgery, undefined);
    assert.equal(input.lesions.length, count);
    assert.deepEqual(
      input.lesions.map((lesion) => lesion.instance),
      Array.from({ length: count }, (_, index) => String(index + 1)),
    );
    assert.deepEqual(prepareRedcapUpload(input).errors, []);
  }
});

void test("cross-field validation rejects contradictory nodes, grades and all-segment regions", () => {
  const record = fixture();
  const lesion = record.lesions[0];
  assert.ok(lesion);
  assert.equal(
    SurgeryRecord.safeParse({ ...record, surgery: { ...record.surgery, lymphadenectomy: "2" } }).success,
    false,
  );
  assert.equal(
    SurgeryRecord.safeParse({ ...record, surgery: { ...record.surgery, node_positive_no_surgery: 9 } })
      .success,
    false,
  );
  for (const changed of [
    { gleason_prim_grade: null },
    { gleason_prim_perc: 90 },
    { all_sgm: true },
    { all_sgm: true, sur_prostate_regions: [...redcapAllSegmentRegions, "urethra"] },
  ])
    assert.equal(SurgeryRecord.safeParse({ ...record, lesions: [{ ...lesion, ...changed }] }).success, false);
  assert.equal(
    SurgeryRecord.safeParse({
      ...record,
      lesions: [{ ...lesion, all_sgm: true, sur_prostate_regions: [...redcapAllSegmentRegions] }],
    }).success,
    true,
  );
});
