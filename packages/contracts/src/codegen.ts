import { mkdir, writeFile } from "node:fs/promises";

import { z } from "zod";

import { Case } from "#case";
import { Document, ExtractedDocument } from "#document";
import { ReviewSnapshot } from "#review";
import { MappingOutput, ReviewDraftRecord, SurgeryRecord } from "#surgery";

const out = new URL("../generated/", import.meta.url);
await mkdir(out, { recursive: true });

const schemas = {
  "extracted-document": ExtractedDocument,
  case: Case,
  document: Document,
  "surgery-record": SurgeryRecord,
  "mapping-output": MappingOutput,
  "review-draft-record": ReviewDraftRecord,
  "review-snapshot": ReviewSnapshot,
};
const toJson = (schema: z.ZodType): string => `${JSON.stringify(z.toJSONSchema(schema), null, 2)}\n`;

await Promise.all(
  Object.entries(schemas).map(async ([name, schema]) =>
    writeFile(new URL(`${name}.schema.json`, out), toJson(schema)),
  ),
);
console.info(`contracts: wrote ${Object.keys(schemas).length} JSON Schemas to generated/`);
