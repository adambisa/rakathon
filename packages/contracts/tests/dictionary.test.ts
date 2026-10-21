import assert from "node:assert/strict";
import test from "node:test";

import { buildSurgicalDictionary } from "#scripts/dictionary";

const field = {
  field_name: "all_sgm",
  form_name: "surgery_c61_resected_lesion",
  field_type: "checkbox",
  field_label: "All segments",
  select_choices_or_calculations: "1, Yes",
  text_validation_type_or_show_slider_number: "",
  text_validation_min: "",
  text_validation_max: "",
  required_field: "",
  branching_logic: "",
  field_annotation: "@SETVALUE='region_a,region_b'",
};

void test("dictionary regeneration distinguishes choices from vocabulary, SQL and calculated metadata", () => {
  const result = buildSurgicalDictionary([
    { ...field, field_annotation: "@IF([sgm_affected]>'200', @SETVALUE='', '')" },
    {
      ...field,
      field_name: "sur_prostate_regions",
      select_choices_or_calculations: "region_a, A|region_b, B",
    },
    {
      ...field,
      field_name: "histol_post_surg_specify",
      field_type: "text",
      select_choices_or_calculations: "SIMPLE:MKN-O 3.2 (CZ)",
    },
    {
      ...field,
      field_name: "surgeon_query",
      field_type: "sql",
      select_choices_or_calculations: "SELECT name, code FROM users",
    },
    { ...field, field_name: "label", field_type: "descriptive", select_choices_or_calculations: "" },
    { ...field, field_name: "computed", field_type: "calc", select_choices_or_calculations: "[value]+1" },
    {
      ...field,
      field_name: "status",
      field_type: "radio",
      select_choices_or_calculations: "1, First, with comma|2, Second",
    },
  ]);
  assert.deepEqual(result.regions, ["region_a", "region_b"]);
  assert.deepEqual(
    result.fields.map((item) => item.name),
    ["all_sgm", "sur_prostate_regions", "histol_post_surg_specify", "status"],
  );
  assert.deepEqual(result.fields[2]?.choices, []);
  assert.deepEqual(result.fields[3]?.choices, [
    { code: "1", label: "First, with comma" },
    { code: "2", label: "Second" },
  ]);
  assert.throws(
    () => buildSurgicalDictionary([{ ...field, select_choices_or_calculations: "invalid choice" }]),
    /Invalid choices/,
  );
});

void test("dictionary regeneration rejects empty or invalid all-segment annotations before writing", () => {
  for (const annotation of ["@SETVALUE=''", "@SETVALUE='unknown'", "@SETVALUE='region_a,region_a'"]) {
    assert.throws(
      () =>
        buildSurgicalDictionary([
          {
            ...field,
            field_name: "sur_prostate_regions",
            select_choices_or_calculations: "region_a, A",
            field_annotation: annotation,
          },
        ]),
      /Invalid all-segment region annotation/,
    );
  }
});
