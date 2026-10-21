import assert from "node:assert/strict";
import test from "node:test";

import { extractDocument, type PageReader } from "#index";
import { jpeg, settled } from "#tests/fixtures";

function fakeReader(text: string): PageReader & { calls: number; closed: boolean } {
  const reader = {
    source: "model" as const,
    calls: 0,
    closed: false,
    readPage: async (): Promise<string> => {
      reader.calls += 1;

      return settled(text);
    },
    close: async (): Promise<void> => {
      reader.closed = true;
      await settled(undefined);
    },
  };

  return reader;
}

await test("the scan goes to the reader and keeps its source", async () => {
  const reader = fakeReader("Biopsie prostaty");
  const extracted = await extractDocument({ bytes: await jpeg(), contentType: "image/jpeg" }, reader);

  assert.deepEqual(extracted.pages, [{ page: 1, text: "Biopsie prostaty", source: "model" }]);
  assert.equal(reader.calls, 1);
  assert.equal(reader.closed, false);
});
