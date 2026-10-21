import assert from "node:assert/strict";
import test from "node:test";

import { loadReaderConfig } from "#index";

await test("tesseract needs nothing beyond the reader name", () => {
  assert.deepEqual(loadReaderConfig({ EXTRACTION_READER: "tesseract" }), { reader: "tesseract" });
});

await test("bedrock-mantle requires the model and the region and applies defaults", () => {
  assert.deepEqual(
    loadReaderConfig({
      EXTRACTION_READER: "bedrock-mantle",
      EXTRACTION_MODEL: "google.gemma-4-e2b",
      AWS_REGION: "eu-central-1",
    }),
    {
      reader: "bedrock-mantle",
      model: "google.gemma-4-e2b",
      region: "eu-central-1",
      renderDpi: 150,
      timeoutMs: 60_000,
      reasoning: "none",
    },
  );
  assert.throws(
    () => loadReaderConfig({ EXTRACTION_READER: "bedrock-mantle", EXTRACTION_MODEL: "google.gemma-4-e2b" }),
    /Invalid extraction reader configuration: AWS_REGION/,
  );
  assert.throws(() => loadReaderConfig({}), /Invalid extraction reader configuration: EXTRACTION_READER/);
});

await test("bedrock-mantle knobs are read and validated", () => {
  const config = loadReaderConfig({
    EXTRACTION_READER: "bedrock-mantle",
    EXTRACTION_MODEL: "google.gemma-4-e2b",
    AWS_REGION: "eu-central-1",
    EXTRACTION_MODEL_RENDER_DPI: "200",
    EXTRACTION_MODEL_TIMEOUT_MS: "30000",
    EXTRACTION_MODEL_REASONING: "low",
  });
  assert.deepEqual(config, {
    reader: "bedrock-mantle",
    model: "google.gemma-4-e2b",
    region: "eu-central-1",
    renderDpi: 200,
    timeoutMs: 30_000,
    reasoning: "low",
  });
  assert.throws(
    () =>
      loadReaderConfig({
        EXTRACTION_READER: "bedrock-mantle",
        EXTRACTION_MODEL: "google.gemma-4-e2b",
        AWS_REGION: "eu-central-1",
        EXTRACTION_MODEL_REASONING: "maximum",
      }),
    /EXTRACTION_MODEL_REASONING/,
  );
});
