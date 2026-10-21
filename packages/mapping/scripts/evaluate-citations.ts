import { readFile, writeFile } from "node:fs/promises";

import { z } from "zod";

import { DocumentKind, ExtractedDocument, MappingReview, PinnedSource } from "@prostapaper/contracts";

import { DEFAULT_MODEL, mapCaseDocuments } from "#index";

const [inputFile, outputFile, model = DEFAULT_MODEL, passesArg = "3"] = process.argv.slice(2);
if (inputFile === undefined || outputFile === undefined) {
  throw new Error(
    "Usage: node scripts/evaluate-citations.ts <pinned-documents.json> <private-output.json> [model] [passes]",
  );
}
const documents = z
  .array(
    z.object({
      documentId: PinnedSource.shape.documentId,
      sourceVersion: PinnedSource.shape.sourceVersion,
      extractionIdentity: PinnedSource.shape.extractionIdentity,
      filename: PinnedSource.shape.filename,
      kind: DocumentKind,
      extracted: ExtractedDocument,
    }),
  )
  .min(1)
  .max(2)
  .parse(JSON.parse(await readFile(inputFile, "utf8")));
const passes = z.coerce.number().int().min(1).max(9).parse(passesArg);
const run = async (citations: boolean) => {
  const started = Date.now();
  const output = await mapCaseDocuments(documents, { model, passes, citations });

  return { elapsedMs: Date.now() - started, output };
};
// Runs sequentially to avoid confusing increased request concurrency with format latency.
const baseline = await run(false);
const enriched = await run(true);
const before = MappingReview.parse(baseline.output.diagnostics?.["review"]);
const after = MappingReview.parse(enriched.output.diagnostics?.["review"]);
const metrics = {
  baselineMs: baseline.elapsedMs,
  enrichedMs: enriched.elapsedMs,
  // Different records need clinical evaluation; this count is not an accuracy score.
  recordChanged: JSON.stringify(baseline.output.record) !== JSON.stringify(enriched.output.record),
  baselineRepairedPasses: baseline.output.diagnostics?.["repairedPasses"],
  enrichedRepairedPasses: enriched.output.diagnostics?.["repairedPasses"],
  assessedFields: after.assessments.length,
  citedFields: after.assessments.filter((field) => field.evidenceIds.length > 0).length,
  verifiedExcerpts: after.evidence.filter((item) => item.verification.status === "verified").length,
  rejectedOrAmbiguousExcerpts: after.evidence.filter((item) => item.verification.status !== "verified")
    .length,
  baselineAssessedFields: before.assessments.length,
};
// Contains clinical data: caller must choose private storage. No clinical values go to console.
await writeFile(outputFile, `${JSON.stringify({ metrics, baseline, enriched }, null, 2)}\n`, {
  mode: 0o600,
  flag: "wx",
});
console.info(JSON.stringify(metrics));
