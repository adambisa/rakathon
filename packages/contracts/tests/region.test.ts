import assert from "node:assert/strict";
import test from "node:test";

import {
  lesionsFromRecord,
  lesionsFromRedcapRows,
  lesionsFromSectorMap,
  RegionCode,
  regionFromSectorId,
  SectorId,
} from "#index";
import { SurgeryRecord } from "#surgery";

void test("sheet sectors map bijectively to the 40 non-urethral regions", () => {
  const regions = SectorId.options.map(regionFromSectorId);
  assert.equal(new Set(regions).size, 40);
  assert.deepEqual(
    RegionCode.options.filter((code) => !regions.includes(code)),
    ["urethra"],
  );
  assert.equal(regionFromSectorId("base_PZpl_L"), "pzpl_base_ls");
  assert.equal(regionFromSectorId("mid_TZa_R"), "tza_mid_rs");
  assert.equal(regionFromSectorId("apex_AS_R"), "as_apex_rs");
  assert.equal(regionFromSectorId("sv_L"), "sv_base_ls");
});

void test("sheet foci keep marked sectors and their figures, grazed sectors become candidates", () => {
  const lesions = lesionsFromSectorMap({
    pages: [
      {
        page: 1,
        foci: [
          {
            sectors: [
              { id: "base_PZpl_L", share: 0.9, coverage: 0.4 },
              { id: "base_PZa_L", share: 0.1, coverage: 0.05 },
            ],
            marked: ["base_PZpl_L"],
          },
          { sectors: [{ id: "sv_L", share: 1, coverage: 0.2 }], marked: ["sv_L"] },
        ],
      },
    ],
  });

  assert.deepEqual(lesions, [
    {
      marked: ["pzpl_base_ls"],
      candidates: ["pza_base_ls"],
      detail: { pzpl_base_ls: { share: 0.9, coverage: 0.4 }, pza_base_ls: { share: 0.1, coverage: 0.05 } },
      gradeGroup: null,
    },
    {
      marked: ["sv_base_ls"],
      candidates: [],
      detail: { sv_base_ls: { share: 1, coverage: 0.2 } },
      gradeGroup: null,
    },
  ]);
});

void test("record regions are marked directly without candidate locations", () => {
  const record = SurgeryRecord.parse({
    surgery: Object.fromEntries(Object.keys(SurgeryRecord.shape.surgery.shape).map((name) => [name, null])),
    lesions: [
      {
        ...Object.fromEntries(
          Object.keys(SurgeryRecord.shape.lesions.element.shape).map((name) => [name, null]),
        ),
        sur_prostate_regions: ["pzpl_mid_ls", "urethra"],
        all_sgm: false,
      },
    ],
  });
  assert.deepEqual(lesionsFromRecord(record), [
    { marked: ["pzpl_mid_ls", "urethra"], candidates: [], detail: {}, gradeGroup: null },
  ]);
});

void test("REDCap lesion rows read ticked region checkboxes only", () => {
  const lesions = lesionsFromRedcapRows([
    { record_id: "CMP-1", redcap_repeat_instrument: "", redcap_repeat_instance: "" },
    {
      record_id: "CMP-1",
      redcap_repeat_instrument: "surgery_c61_resected_lesion",
      redcap_repeat_instance: "1",
      sur_prostate_regions___pzpl_base_ls: "1",
      sur_prostate_regions___urethra: "1",
      sur_prostate_regions___pza_base_ls: "0",
      lesion_x_mm: "1",
    },
  ]);

  assert.deepEqual(lesions, [
    { marked: ["pzpl_base_ls", "urethra"], candidates: [], detail: {}, gradeGroup: null },
  ]);
});
