import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { normalizeText, REFERENCE_NORMALIZATION_VERSION } from "#eval/scoring";
import { parseReference } from "#eval/transcripts";
import { parseDataset, type QaExample, string } from "#qa/contracts";

const { values } = parseArgs({ options: { source: { type: "string" }, dataset: { type: "string" } } });
const source = resolve(string(values.source));
const datasetPath = resolve(
  values.dataset ?? fileURLToPath(new URL("../../../qa/dataset.json", import.meta.url)),
);
const directory = dirname(datasetPath);

async function readOptional(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}
const entries = await readdir(source);
const names = entries.filter((name) => name.endsWith(".txt")).toSorted();
if (names.length === 0) {
  throw new Error("No .txt transcripts found in the source directory");
}
const prepared = await Promise.all(
  names.map(async (name) => {
    const stem = name.slice(0, -4);
    const raw = await readFile(join(source, name));
    const scan = join(source, "scan", `${stem}.jpg`);
    const input = await readFile(scan);
    const reference = parseReference({
      version: 1,
      quality: "silver",
      text: normalizeText(raw.toString("utf8")),
      provenance: {
        transcriptFilename: name,
        transcriptSha256: createHash("sha256").update(raw).digest("hex"),
        normalization: REFERENCE_NORMALIZATION_VERSION,
      },
    });

    return {
      input,
      reference,
      example: {
        id: stem.toLowerCase().replaceAll(/[^\da-z_-]/gu, "-"),
        inputKey: `qa/input/${stem}.jpg`,
        referenceKey: `qa/reference/${stem}.json`,
        contentType: "image/jpeg",
      },
    };
  }),
);
const dataset = { version: 1, examples: prepared.map((item) => item.example) };
parseDataset(dataset);
const priorDataset = await readOptional(datasetPath);
let existing: QaExample[] = [];
if (priorDataset !== undefined) {
  existing = parseDataset(JSON.parse(priorDataset.toString("utf8")) as unknown);
}
if (existing.length > 0 && JSON.stringify(existing) !== JSON.stringify(dataset.examples)) {
  throw new Error("Refusing to replace a different populated dataset");
}
await mkdir(join(directory, "input"), { recursive: true });
await mkdir(join(directory, "reference"), { recursive: true });
const files = prepared.flatMap(({ input, reference, example }) => [
  { path: join(directory, example.inputKey.slice(3)), bytes: input },
  {
    path: join(directory, example.referenceKey.slice(3)),
    bytes: Buffer.from(`${JSON.stringify(reference, null, 2)}\n`),
  },
]);
const writes = await Promise.all(
  files.map(async (file) => {
    const existing = await readOptional(file.path);
    if (existing !== undefined && !existing.equals(file.bytes)) {
      throw new Error(`Refusing to overwrite a changed input/reference: ${file.path}`);
    }

    return { ...file, exists: existing !== undefined };
  }),
);
await Promise.all(
  writes
    .filter((file) => !file.exists)
    .map(async (file) => {
      await writeFile(file.path, file.bytes, { flag: "wx" });
    }),
);
await writeFile(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`);
console.info(
  `Prepared ${prepared.length} silver JSON transcripts and PDF inputs. Original source files were preserved.`,
);
