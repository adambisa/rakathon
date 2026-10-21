import assert from "node:assert/strict";
import test from "node:test";

import { MappingEvent } from "#trigger";

void test("only a valid case request starts mapping", () => {
  const caseId = "97a046bd-6918-4f11-bc2e-a620fd173b43";
  assert.deepEqual(MappingEvent.parse({ caseId }), { caseId });
  for (const event of [null, {}, { caseId: "bad" }, { Records: [] }])
    assert.equal(MappingEvent.safeParse(event).success, false);
});
