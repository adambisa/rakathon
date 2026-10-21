import assert from "node:assert/strict";
import test from "node:test";

import { SectorId } from "#sector";

void test("sheet sector vocabulary retains the packed label image order", () => {
  assert.equal(SectorId.options.length, 40);
  assert.equal(SectorId.options[0], "apex_AS_L");
  assert.equal(SectorId.options[39], "sv_R");
});
