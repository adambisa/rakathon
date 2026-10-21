import { type scoreTranscript, sumScores } from "#eval/scoring";
import type { ReferenceTranscript } from "#eval/transcripts";

export interface EvaluationResult {
  id: string;
  referenceQuality: ReferenceTranscript["quality"];
  status: "ok" | "failed";
  error?: string;
  extraction?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
  score?: ReturnType<typeof scoreTranscript>;
}

function aggregate(results: readonly EvaluationResult[]): {
  examples: number;
  succeeded: number;
  failed: number;
  raw: ReturnType<typeof sumScores>;
  normalized: ReturnType<typeof sumScores>;
} {
  const scores = results.flatMap((result) => {
    if (result.score === undefined) {
      return [];
    }

    return [result.score];
  });

  return {
    examples: results.length,
    succeeded: scores.length,
    failed: results.length - scores.length,
    raw: sumScores(scores.map((score) => score.raw)),
    normalized: sumScores(scores.map((score) => score.normalized)),
  };
}

export function summarizeResults(results: readonly EvaluationResult[]): ReturnType<typeof aggregate> & {
  aggregateScope: string;
  byReferenceQuality: Record<ReferenceTranscript["quality"], ReturnType<typeof aggregate>>;
  bySource: Record<string, ReturnType<typeof aggregate>>;
} {
  const sourceGroup = (result: EvaluationResult): string => {
    const value = result.diagnostics?.["sources"];
    if (!Array.isArray(value)) {
      return "unspecified";
    }
    const sources = [
      ...new Set(value.filter((source: unknown): source is string => typeof source === "string")),
    ];
    if (sources.length === 0) {
      return "unspecified";
    }
    if (sources.length > 1) {
      return "mixed";
    }

    return sources[0] ?? "unspecified";
  };
  const groups = [...new Set(results.map(sourceGroup))].toSorted();

  return {
    ...aggregate(results),
    aggregateScope: "successful reports only; inspect failed count separately",
    byReferenceQuality: {
      silver: aggregate(results.filter((result) => result.referenceQuality === "silver")),
      gold: aggregate(results.filter((result) => result.referenceQuality === "gold")),
    },
    bySource: Object.fromEntries(
      groups.map((group) => [group, aggregate(results.filter((result) => sourceGroup(result) === group))]),
    ),
  };
}

export function reportCsv(results: readonly EvaluationResult[]): string {
  const rows = results.map((result) =>
    [
      result.id,
      result.referenceQuality,
      result.status,
      result.score?.raw.cer,
      result.score?.raw.wer,
      result.score?.normalized.cer,
      result.score?.normalized.wer,
      result.extraction?.["durationMs"],
    ].join(","),
  );

  return [
    "id,reference_quality,status,raw_cer,raw_wer,normalized_cer,normalized_wer,duration_ms",
    ...rows,
    "",
  ].join("\n");
}

export function transcriptDiff(result: ReturnType<typeof scoreTranscript>): string {
  return `REFERENCE:\n${result.expected}\n\nACTUAL:\n${result.actual}\n\nCER: ${String(result.normalized.cer)}; WER: ${String(result.normalized.wer)}\n`;
}
