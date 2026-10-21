import assert from "node:assert/strict";
import test from "node:test";

import type { SurgeryRecord } from "@prostapaper/contracts";

import { applySectorMap, sectorMapMarks } from "#sector-map";
import { fixture } from "#test-fixtures";

const focus = (
  regions: SurgeryRecord["lesions"][number]["sur_prostate_regions"],
): SurgeryRecord["lesions"][number] => {
  const lesion = fixture().lesions[0];
  assert.ok(lesion);

  return { ...lesion, sur_prostate_regions: regions };
};
const record = (lesions: SurgeryRecord["lesions"]): SurgeryRecord => ({ ...fixture(), lesions });
const basePzplL = "pzpl_base_ls";
const svL = "sv_base_ls";
const apexTzaR = "tza_apex_rs";

void test("sheet marks come from sector-map documents only, in reading order, in record vocabulary", () => {
  const marks = sectorMapMarks([
    { kind: "text_description", extracted: { pages: [{ page: 1, text: "Závěr", source: "ocr" }] } },
    {
      kind: "sector_map",
      extracted: {
        pages: [{ page: 1, text: "…", source: "opencv" }],
        sectorMap: {
          pages: [
            {
              page: 1,
              foci: [
                { sectors: [{ id: "base_PZpl_L", share: 0.9, coverage: 0.4 }], marked: ["base_PZpl_L"] },
                { sectors: [{ id: "sv_L", share: 1, coverage: 0.2 }], marked: ["sv_L"] },
              ],
            },
          ],
        },
      },
    },
  ]);

  assert.deepEqual(marks, [[basePzplL], [svL]]);
});

const midPzplL = "pzpl_mid_ls";

void test("a report with one focus takes every mark, however many levels it was marked on", () => {
  const applied = applySectorMap(record([focus([apexTzaR])]), [[basePzplL, apexTzaR], [midPzplL]]);

  assert.deepEqual(applied.record.lesions, [focus([apexTzaR, basePzplL, midPzplL])]);
  assert.equal(applied.regionsAdded, 2);
  assert.deepEqual(applied.unplacedRegions, []);
});

void test("marks never add foci: the report's count stands and unplaced sectors go to review", () => {
  const original = record([focus([basePzplL]), focus([apexTzaR])]);
  const applied = applySectorMap(original, [[basePzplL], [midPzplL], [svL], [apexTzaR]]);

  assert.deepEqual(applied.record, original);
  assert.equal(applied.regionsAdded, 0);
  assert.deepEqual(applied.unplacedRegions, [midPzplL, svL]);
});

void test("a report without foci keeps none and every marked sector waits for review", () => {
  const applied = applySectorMap(record([]), [[basePzplL], [basePzplL, svL]]);

  assert.deepEqual(applied.record.lesions, []);
  assert.deepEqual(applied.unplacedRegions, [basePzplL, svL]);
});

void test("without a sheet the record is untouched", () => {
  const original = record([focus([apexTzaR])]);
  const applied = applySectorMap(original, []);

  assert.deepEqual(applied.record, original);
  assert.equal(applied.regionsAdded, 0);
  assert.deepEqual(applied.unplacedRegions, []);
});
