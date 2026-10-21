import assert from "node:assert/strict";
import { test } from "node:test";

import { TRPCClientError } from "@trpc/client";

import { fieldOperation, numericReviewInput } from "#lib/review-edit";
import { reviewErrorMessage } from "#lib/review-errors";

await test("editor input failures keep their Czech wording instead of the generic message", () => {
  let parseError: unknown;
  try {
    numericReviewInput("1mm");
  } catch (error) {
    parseError = error;
  }
  assert.equal(reviewErrorMessage(parseError), "Zadejte číslo (desetinná čárka je povolena).");
  let boundsError: unknown;
  try {
    fieldOperation({ scope: "surgery", field: "node_no_surgery" }, 2.5);
  } catch (error) {
    boundsError = error;
  }
  assert.equal(reviewErrorMessage(boundsError), "Hodnota má neplatný typ nebo je mimo povolený rozsah.");
});
await test("review service rejections translate by message and conflicts keep local input", () => {
  const conflict = new TRPCClientError("Review revision or mapping has changed; reload before saving", {
    result: { error: { code: -32_009, message: "", data: { code: "CONFLICT", httpStatus: 409 } } },
  });
  assert.match(reviewErrorMessage(conflict), /zůstal zachován/);
  const precondition = new TRPCClientError("Review is not editable", {
    result: { error: { code: -32_012, message: "", data: { code: "PRECONDITION_FAILED", httpStatus: 412 } } },
  });
  assert.match(reviewErrorMessage(precondition), /není otevřená/);
  const unknown = new TRPCClientError("Something else", {
    result: { error: { code: -32_012, message: "", data: { code: "PRECONDITION_FAILED", httpStatus: 412 } } },
  });
  assert.equal(reviewErrorMessage(unknown), "Služba není nakonfigurována. Kontaktujte správce.");
});
