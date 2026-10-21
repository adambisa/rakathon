import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import { ExtractedDocument } from "@prostapaper/contracts";

import { DEFAULT_MODEL, mapReportText } from "#index";
import { assembleCaseText } from "#text";

const [file, model = DEFAULT_MODEL] = process.argv.slice(2);
if (file === undefined) {
  throw new Error("Usage: pnpm --filter @prostapaper/mapping map <report.txt | extracted.json> [model]");
}

let text = await readFile(file, "utf8");
if (extname(file) === ".json") {
  text = assembleCaseText([
    {
      filename: basename(file),
      kind: "text_description",
      extracted: ExtractedDocument.parse(JSON.parse(text)),
    },
  ]);
}

const started = Date.now();
const output = await mapReportText(text, { model });
console.error(`mapped ${file} with ${model} in ${Date.now() - started} ms`);
console.info(JSON.stringify(output, null, 2));
