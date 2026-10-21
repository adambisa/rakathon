import assert from "node:assert/strict";
import { test } from "node:test";

import {
  editorOperation,
  emptyReviewLesion,
  fieldChanged,
  fieldOperation,
  numericReviewInput,
} from "#lib/review-edit";

await test("Czech numeric inputs preserve zero, normalize comma, reject malformed values", () => {
  assert.equal(numericReviewInput("0"), 0);
  assert.equal(numericReviewInput(" 2,5 "), 2.5);
  assert.equal(numericReviewInput(""), null);
  for (const value of ["1,2,3", "Infinity", "1mm", "0x10", "1e2"])
    assert.throws(() => numericReviewInput(value));
  assert.throws(() =>
    fieldOperation({ scope: "surgery", field: "node_no_surgery" }, numericReviewInput("2,5")),
  );
  assert.deepEqual(
    fieldOperation(
      { scope: "lesion", lesionId: "stable-second", field: "lesion_x_mm" },
      numericReviewInput("0"),
    ),
    { kind: "update_lesion", lesionId: "stable-second", changes: { lesion_x_mm: 0 } },
  );
  assert.throws(() =>
    fieldOperation(
      { scope: "lesion", lesionId: "stable-second", field: "lesion_x_mm" },
      numericReviewInput("100,1"),
    ),
  );
});
await test("editor operations parse typed numbers and clear node counts only when requested", () => {
  assert.deepEqual(
    editorOperation({
      reference: { scope: "surgery", field: "node_no_surgery" },
      validation: "integer",
      value: " 12 ",
      clearNodes: false,
    }),
    { kind: "update_surgery", changes: { node_no_surgery: 12 } },
  );
  const lymph = { scope: "surgery", field: "lymphadenectomy" } as const;
  assert.deepEqual(editorOperation({ reference: lymph, validation: "", value: "2", clearNodes: false }), {
    kind: "update_surgery",
    changes: { lymphadenectomy: "2" },
  });
  assert.deepEqual(editorOperation({ reference: lymph, validation: "", value: "2", clearNodes: true }), {
    kind: "update_surgery",
    changes: { lymphadenectomy: "2", node_no_surgery: null, node_positive_no_surgery: null },
  });
  assert.deepEqual(editorOperation({ reference: lymph, validation: "", value: "1", clearNodes: true }), {
    kind: "update_surgery",
    changes: { lymphadenectomy: "1" },
  });
});
await test("field changes ignore region order and treat missing originals as changed", () => {
  assert.equal(fieldChanged("sur_prostate_regions", ["a", "b"], ["b", "a"]), false);
  assert.equal(fieldChanged("lesion_x_mm", 0, null), true);
  assert.equal(fieldChanged("lesion_x_mm", undefined, null), true);
});
await test("new lesions begin unknown, preserving the unmarked boolean and empty regions", () => {
  const lesion = emptyReviewLesion();
  assert.equal(lesion.all_sgm, false);
  assert.deepEqual(lesion.sur_prostate_regions, []);
  assert.equal(lesion.lesion_x_mm, null);
});
