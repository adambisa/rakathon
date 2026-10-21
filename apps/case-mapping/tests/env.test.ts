import assert from "node:assert/strict";
import test from "node:test";

import { loadEnv } from "#env";

const base = {
  PGHOST: "localhost",
  PGPORT: "5432",
  PGDATABASE: "prostapaper",
  PGUSER: "app",
  PGPASSWORD: "secret",
  PGSSLMODE: "disable",
  OPENAI_API_KEY_PARAMETER: "/prostapaper/demo/OPENAI_API_KEY",
};

void test("citation collection is off unless explicitly enabled", () => {
  assert.equal(loadEnv(base).citations, false);
  assert.equal(loadEnv({ ...base, MAPPING_CITATIONS: "false" }).citations, false);
  assert.equal(loadEnv({ ...base, MAPPING_CITATIONS: "true" }).citations, true);
  assert.throws(() => loadEnv({ ...base, MAPPING_CITATIONS: "yes" }), /MAPPING_CITATIONS/);
});
