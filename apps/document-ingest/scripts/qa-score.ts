import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { type EvaluationResult, reportCsv, summarizeResults, transcriptDiff } from "#eval/reporting";
import { NORMALIZATION_VERSION, scoreTranscript } from "#eval/scoring";
import { parseCandidate, parseReference } from "#eval/transcripts";
import { parseDataset, string } from "#qa/contracts";

const { values } = parseArgs({
  options: {
    dataset: { type: "string" },
    outputs: { type: "string" },
    report: { type: "string" },
    method: { type: "string" },
  },
});
const datasetPath = resolve(
  values.dataset ?? fileURLToPath(new URL("../../../qa/dataset.json", import.meta.url)),
);
const outputDirectory = resolve(string(values.outputs));
const reportDirectory = resolve(string(values.report));
const dataset = parseDataset(JSON.parse(await readFile(datasetPath, "utf8")) as unknown);
if (dataset.length === 0) {
  throw new Error("QA dataset is empty");
}
const prepared = await Promise.all(
  dataset.map(async (example) => {
    const bytes = await readFile(join(dirname(datasetPath), example.referenceKey.slice(3)));

    return {
      example,
      reference: parseReference(JSON.parse(bytes.toString("utf8")) as unknown),
      referenceSha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }),
);
await mkdir(reportDirectory, { recursive: true });
await writeFile(
  join(reportDirectory, "manifest.json"),
  JSON.stringify(
    {
      method: values.method ?? "unspecified",
      normalization: NORMALIZATION_VERSION,
      datasetPath,
      outputDirectory,
      startedAt: new Date().toISOString(),
      references: prepared.map(({ example, reference, referenceSha256 }) => ({
        id: example.id,
        referenceQuality: reference.quality,
        referenceSha256,
      })),
    },
    null,
    2,
  ),
  { flag: "wx" },
);
const results: EvaluationResult[] = [];
await prepared.reduce(async (previous, { example, reference }) => {
  await previous;
  try {
    const bytes = await readFile(join(outputDirectory, `${example.id}.json`));
    const candidate = parseCandidate(JSON.parse(bytes.toString("utf8")) as unknown);
    const score = scoreTranscript(reference.text, candidate.text);
    await writeFile(join(reportDirectory, `${example.id}.diff.txt`), transcriptDiff(score), { flag: "wx" });
    results.push({
      id: example.id,
      referenceQuality: reference.quality,
      status: "ok",
      score,
      diagnostics: candidate.diagnostics,
      extraction: { outputSha256: createHash("sha256").update(bytes).digest("hex") },
    });
  } catch (error) {
    results.push({
      id: example.id,
      referenceQuality: reference.quality,
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}, Promise.resolve());
const report = {
  method: values.method ?? "unspecified",
  finishedAt: new Date().toISOString(),
  ...summarizeResults(results),
  results,
};
await writeFile(join(reportDirectory, "report.json"), JSON.stringify(report, null, 2), { flag: "wx" });
await writeFile(join(reportDirectory, "report.csv"), reportCsv(results), { flag: "wx" });
console.info(`Report: ${join(reportDirectory, "report.json")}`);
if (report.failed > 0) {
  throw new Error("Some outputs could not be scored; see report.json");
}
