import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { DOCUMENT_ACCEPT, DocumentContentType, DocumentKind } from "@prostapaper/contracts";

import { collectTessdata } from "#assets";
import {
  createPageReader,
  createSectorSheetDetector,
  extractors,
  loadSectorSheets,
  type SectorSheetDetector,
} from "#index";
import { loadCliReaderConfig } from "#scripts/env";

const usage =
  "Usage: pnpm --filter @prostapaper/extraction extract <file> [--kind text_description|sector_map] [--reader tesseract|bedrock-mantle] [--model <id>]\n" +
  "A report is read by the reader; a schema (sector sheet) by OpenCV alone.\n" +
  "The bedrock-mantle reader takes AWS_REGION and credentials from the environment.";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    kind: { type: "string", default: "text_description" },
    reader: { type: "string", default: "tesseract" },
    model: { type: "string" },
  },
});
const [file] = positionals;
if (file === undefined) {
  throw new Error(usage);
}

const extension = extname(file).toLowerCase();
const contentType = DocumentContentType.options.find((type) => DOCUMENT_ACCEPT[type].includes(extension));
if (contentType === undefined) {
  throw new Error(`Unsupported extension: ${extension}`);
}

const kind = DocumentKind.parse(values.kind);
const input = { bytes: await readFile(file), contentType };
const config = loadCliReaderConfig({ EXTRACTION_READER: values.reader, EXTRACTION_MODEL: values.model });
const tessdata = await mkdtemp(join(tmpdir(), "prostapaper-tessdata-"));
await collectTessdata(tessdata);
// Diagnostics on stderr: stdout stays a clean JSON document whatever the reader logs per page.
const reader = createPageReader(config, { tessdataDirectory: tessdata, log: console.error });
let detector: Promise<SectorSheetDetector> | undefined;
const sectorSheet = async (): Promise<SectorSheetDetector> =>
  (detector ??= loadSectorSheets(fileURLToPath(new URL("../templates", import.meta.url))).then(
    createSectorSheetDetector,
  ));

const started = Date.now();
try {
  const extracted = await extractors[kind](input, { reader, sectorSheet, log: console.error });
  console.error(`extracted ${extracted.pages.length} page(s) as ${kind} in ${Date.now() - started} ms`);
  console.info(JSON.stringify(extracted, null, 2));
} finally {
  const [loaded] = await Promise.allSettled([detector]);
  if (loaded.status === "fulfilled") loaded.value?.close();
  await reader.close?.();
}
