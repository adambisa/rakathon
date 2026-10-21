import assert from "node:assert/strict";
import { test } from "node:test";

import {
  isRedcapFieldVisible,
  prepareRedcapUpload,
  type RedcapUploadInput,
  type RedcapValues,
} from "#redcap";
import { redcapAllSegmentRegions, redcapSurgicalFields } from "#redcap-schema";

const surgery = {
  surgery_date: "2026-10-01",
  surgery_type: "2",
  total_number_lesion_surg: "1",
  lymphadenectomy: "2",
  classify_r_surg: "1",
  classify_l_surg: "1",
  vascular_inv: "1",
  histol_post_surg: "1",
  isup: "2",
};
const lesion = { hist_type_sur: "2", extracaps_ext: "3", perineural_inv_sur: "1" };

function prepare(overrides: Partial<RedcapUploadInput> = {}) {
  return prepareRedcapUpload({
    recordId: "TEST-ONLY",
    surgery,
    lesions: [{ instance: "4", values: lesion }],
    ...overrides,
  });
}

function rejects(overrides: Partial<RedcapUploadInput>, reason: RegExp) {
  const result = prepare(overrides);
  assert.ok(
    result.errors.some((error) => reason.test(error)),
    result.errors.join("\n"),
  );
  assert.deepEqual(result.rows, [], "Invalid inputs must never yield an importable payload");
}

void test("exact choice codes, row scopes and explicit target instances survive serialization", () => {
  const result = prepare({
    lesions: [
      { instance: "4", values: { ...lesion, lesion_x_mm: "12", sur_prostate_regions___pzpl_apex_rs: "1" } },
    ],
  });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.rows, [
    { record_id: "TEST-ONLY", redcap_repeat_instrument: "", redcap_repeat_instance: "", ...surgery },
    {
      record_id: "TEST-ONLY",
      redcap_repeat_instrument: "surgery_c61_resected_lesion",
      redcap_repeat_instance: "4",
      ...lesion,
      lesion_x_mm: "12",
      sur_prostate_regions___pzpl_apex_rs: "1",
    },
  ]);
});

void test("rejects unsupported pT2, unknown fields and invalid invasion codes", () => {
  rejects({ surgery: { ...surgery, pt_surg: "pT2" } }, /neplatný kód/);
  rejects({ surgery: { ...surgery, token: "invalid" } }, /Neznámé pole/);
  rejects({ lesions: [{ instance: "4", values: { ...lesion, extracaps_ext: "0" } }] }, /neplatný kód/);
});

void test("requires explicit ID and every required field without applying REDCap defaults", () => {
  rejects({ recordId: "" }, /record_id/);
  rejects({ recordId: "TEST\u0000ONLY" }, /record_id/);
  for (const field of redcapSurgicalFields.filter((field) => field.required && field.branching === "")) {
    if (field.form === "surgery_c61") {
      rejects({ surgery: { ...surgery, [field.name]: "" } }, /Chybí/);
    } else {
      rejects({ lesions: [{ instance: "4", values: { ...lesion, [field.name]: "" } }] }, /Chybí/);
    }
  }
});

void test("validates calendar dates and dictionary date bounds", () => {
  for (const date of [
    "2026-02-30",
    "2025-02-29",
    "16.10.2026",
    "2026-1-01",
    "1899-12-31",
    "9999-12-31",
    "0000-01-01",
  ]) {
    rejects({ surgery: { ...surgery, surgery_date: date } }, /datum|Datum|Date/);
  }
  assert.deepEqual(prepare({ surgery: { ...surgery, surgery_date: "2024-02-29" } }).errors, []);
});

void test("decimal grammar rejects JS numeric coercions and non-integer node counts", () => {
  for (const value of ["0x10", "0b10", "0o10", "1e1", "Infinity", "NaN", "1,5", "101", "-1"]) {
    rejects({ lesions: [{ instance: "4", values: { ...lesion, lesion_x_mm: value } }] }, /rozsah|desítkovém/);
  }
  for (const value of ["2.0", "1.5", "1e1", "0x10", "9007199254740993"]) {
    rejects(
      {
        surgery: { ...surgery, lymphadenectomy: "1", node_no_surgery: value, node_positive_no_surgery: "0" },
      },
      /rozsah|desítkovém/,
    );
  }
  assert.deepEqual(
    prepare({
      lesions: [
        { instance: "4", values: { ...lesion, lesion_x_mm: "0", lesion_y_mm: ".5", lesion_z_mm: "100" } },
      ],
    }).errors,
    [],
  );
});

void test("resolves the dictionary's dynamic node-count maximum and requires conditional fields", () => {
  rejects({ surgery: { ...surgery, lymphadenectomy: "1" } }, /Chybí/);
  rejects(
    { surgery: { ...surgery, lymphadenectomy: "1", node_no_surgery: "20", node_positive_no_surgery: "21" } },
    /rozsah/,
  );
  rejects(
    { surgery: { ...surgery, lymphadenectomy: "1", node_no_surgery: "21", node_positive_no_surgery: "0" } },
    /rozsah/,
  );
  assert.deepEqual(
    prepare({
      surgery: { ...surgery, lymphadenectomy: "1", node_no_surgery: "20", node_positive_no_surgery: "20" },
    }).errors,
    [],
  );
});

void test("does not silently discard populated fields when their branch becomes false", () => {
  rejects({ surgery: { ...surgery, node_no_surgery: "2" } }, /podmínce/);
  rejects({ surgery: { ...surgery, surgeon_other: "Named surgeon" } }, /podmínce/);
  rejects({ surgery: { ...surgery, total_number_lesion_surg_oth: "5" } }, /podmínce/);
});

void test("normalizes before evaluating branching and cross-field rules", () => {
  const result = prepare({
    surgery: { ...surgery, lymphadenectomy: " 1 ", node_no_surgery: " 2 ", node_positive_no_surgery: " 1 " },
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[0]?.["node_no_surgery"], "2");
  rejects(
    { surgery: { ...surgery, lymphadenectomy: " 1 ", node_no_surgery: "2", node_positive_no_surgery: "3" } },
    /rozsah/,
  );
});

void test("Other requires an explicit count; blank cannot silently become zero", () => {
  for (const value of ["", " "]) {
    rejects(
      {
        surgery: { ...surgery, total_number_lesion_surg: "7", total_number_lesion_surg_oth: value },
        lesions: [],
      },
      /výslovný počet/,
    );
  }
  const result = prepare({
    surgery: { ...surgery, total_number_lesion_surg: "7", total_number_lesion_surg_oth: "0" },
    lesions: [],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 1);
  rejects({ surgery: { ...surgery, total_number_lesion_surg: "2" } }, /Počet ložisek/);
});

void test("instances cannot be blank, zero, negative, fractional, ambiguous or duplicated", () => {
  for (const instance of ["", "0", "-1", "1.5", "01", "1e1", "9007199254740993"]) {
    rejects({ lesions: [{ instance, values: lesion }] }, /cílové instance/);
  }
  rejects(
    {
      surgery: { ...surgery, total_number_lesion_surg: "2" },
      lesions: [
        { instance: "4", values: lesion },
        { instance: " 4 ", values: lesion },
      ],
    },
    /duplicitní/,
  );
});

void test("deleting or reordering lesions never changes remaining target identities", () => {
  const a = { instance: "4", values: lesion };
  const b = { instance: "9", values: { ...lesion, extracaps_ext: "1" } };
  const both = prepare({ surgery: { ...surgery, total_number_lesion_surg: "2" }, lesions: [b, a] });
  const remaining = prepare({ lesions: [b] });
  assert.deepEqual(both.errors, []);
  assert.deepEqual(remaining.errors, []);
  assert.deepEqual(both.rows[1], remaining.rows[1]);
  assert.equal(both.rows[2]?.["redcap_repeat_instance"], "4");
});

void test("checkbox unknown, positive and explicit negative remain distinct", () => {
  const result = prepare({
    lesions: [
      {
        instance: "4",
        values: {
          ...lesion,
          sur_prostate_regions___pzpl_apex_rs: "1",
          sur_prostate_regions___pzpl_apex_ls: "0",
        },
      },
    ],
  });
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows[1]?.["sur_prostate_regions___pzpl_apex_rs"], "1");
  assert.equal(result.rows[1]["sur_prostate_regions___pzpl_apex_ls"], "0");
  assert.equal(result.rows[1]["sur_prostate_regions___urethra"], undefined);
  rejects(
    { lesions: [{ instance: "4", values: { ...lesion, sur_prostate_regions___urethra: "false" } }] },
    /0 nebo 1/,
  );
});

void test("all-segments expands the exact 40 annotated regions, without inventing urethral involvement", () => {
  const result = prepare({ lesions: [{ instance: "4", values: { ...lesion, all_sgm___1: "1" } }] });
  assert.deepEqual(result.errors, []);
  assert.equal(redcapAllSegmentRegions.length, 40);
  assert.equal(new Set(redcapAllSegmentRegions).size, 40);
  assert.equal(
    Object.keys(result.rows[1] ?? {}).filter((key) => key.startsWith("sur_prostate_regions___")).length,
    40,
  );
  for (const code of redcapAllSegmentRegions)
    assert.equal(result.rows[1]?.[`sur_prostate_regions___${code}`], "1");
  assert.equal(result.rows[1]?.["sur_prostate_regions___urethra"], undefined);
  rejects(
    {
      lesions: [
        { instance: "4", values: { ...lesion, all_sgm___1: "1", sur_prostate_regions___pzpl_apex_rs: "0" } },
      ],
    },
    /výslovně negativní/,
  );
});

void test("Gleason percentages require their own grades and cannot total over 100", () => {
  rejects(
    { lesions: [{ instance: "4", values: { ...lesion, gleason_prim_perc: "20" } }] },
    /odpovídající stupeň/,
  );
  rejects(
    {
      lesions: [
        {
          instance: "4",
          values: {
            ...lesion,
            gleason_prim_grade: "3",
            gleason_prim_perc: "90",
            gleason_sec_grade: "4",
            gleason_sec_perc: "90",
          },
        },
      ],
    },
    /100 %/,
  );
  const result = prepare({
    lesions: [
      {
        instance: "4",
        values: {
          ...lesion,
          gleason_prim_grade: "3",
          gleason_prim_perc: "90",
          gleason_sec_grade: "4",
          gleason_sec_perc: "10",
        },
      },
    ],
  });
  assert.deepEqual(result.errors, []);
});

void test("dictionary choice codes round trip without universal yes/no assumptions", () => {
  for (const name of [
    "pt_surg",
    "pn_surg",
    "pm_surg",
    "classify_r_surg",
    "classify_l_surg",
    "vascular_inv",
    "histol_post_surg",
    "isup",
    "hist_type_sur",
    "extracaps_ext",
    "perineural_inv_sur",
  ]) {
    const field = redcapSurgicalFields.find((item) => item.name === name);
    assert.ok(field);
    for (const choice of field.choices) {
      const overrides: Partial<RedcapUploadInput> = {};
      if (field.form === "surgery_c61") overrides.surgery = { ...surgery, [name]: choice.code };
      else overrides.lesions = [{ instance: "4", values: { ...lesion, [name]: choice.code } }];
      const result = prepare(overrides);
      assert.deepEqual(result.errors, [], `${name}=${choice.code}`);
      const row: RedcapValues | undefined = result.rows.find(
        (item) => item["redcap_repeat_instrument"] === (field.form === "surgery_c61" ? "" : field.form),
      );
      assert.equal(row?.[name], choice.code);
    }
  }
});

void test("all supported branching expressions evaluate precisely, and unsupported ones fail closed", () => {
  for (const field of redcapSurgicalFields) {
    if (field.branching === "") continue;
    const match = /^\[(\w+)\]\s*=\s*'([^']+)'$/.exec(field.branching);
    assert.ok(match);
    const values: RedcapValues = { [match[1] ?? ""]: match[2] ?? "" };
    assert.equal(isRedcapFieldVisible(field.branching, values), true);
    assert.equal(isRedcapFieldVisible(field.branching, {}), false);
  }
  assert.equal(isRedcapFieldVisible("[missing] > 1", {}), false);
});
