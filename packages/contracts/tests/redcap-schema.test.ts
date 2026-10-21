import assert from "node:assert/strict";
import test from "node:test";

import { redcapAllSegmentRegions, redcapSurgicalFields } from "#redcap-schema";
import { RegionCode } from "#region";

void test("dictionary snapshot has the surgical forms and the exact region vocabulary", () => {
  assert.equal(redcapSurgicalFields.length, 33);
  assert.deepEqual(
    new Set(redcapSurgicalFields.map((field) => field.form)),
    new Set(["surgery_c61", "surgery_c61_resected_lesion"]),
  );
  const regions = redcapSurgicalFields
    .find((field) => field.name === "sur_prostate_regions")
    ?.choices.map((choice) => choice.code);
  assert.equal(regions?.length, 41);
  assert.ok(regions.includes("urethra"));
  assert.deepEqual(new Set(RegionCode.options), new Set(regions));
  assert.equal(redcapAllSegmentRegions.length, 40);
  assert.equal(new Set(redcapAllSegmentRegions).size, 40);
  assert.ok(!new Set<string>(redcapAllSegmentRegions).has("urethra"));
});
