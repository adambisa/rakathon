import { normalizeText } from "#eval/scoring";

export interface ReferenceTranscript {
  version: 1;
  quality: "silver" | "gold";
  text: string;
  provenance?: Record<string, unknown>;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a transcript JSON object");
  }

  return value as Record<string, unknown>;
}

export function parseReference(value: unknown): ReferenceTranscript {
  const reference = record(value);
  const text = reference["text"];
  const quality = reference["quality"];
  if (
    reference["version"] !== 1 ||
    typeof text !== "string" ||
    (quality !== "silver" && quality !== "gold")
  ) {
    throw new Error("Expected reference version 1, text, and quality silver or gold");
  }
  if (normalizeText(text) !== text) {
    throw new Error("Reference text changes under normalization; review or prepare it explicitly");
  }
  const result: ReferenceTranscript = { version: 1, quality, text };
  if (reference["provenance"] !== undefined) {
    result.provenance = record(reference["provenance"]);
  }

  return result;
}

/** Accept whole transcripts or adapt ordered page text; no extractor-specific fields are required. */
export function parseCandidate(value: unknown): { text: string; diagnostics: Record<string, unknown> } {
  const candidate = record(value);
  if (typeof candidate["text"] === "string") {
    let diagnostics: Record<string, unknown> = {};
    if (candidate["diagnostics"] !== undefined) {
      diagnostics = record(candidate["diagnostics"]);
    }

    return {
      text: candidate["text"],
      diagnostics,
    };
  }
  if (!Array.isArray(candidate["pages"]) || candidate["pages"].length === 0) {
    throw new Error("Expected candidate text or a nonempty pages array");
  }
  const numbers = new Set<number>();
  const pages = candidate["pages"]
    .map((value: unknown) => {
      const page = record(value);
      const number = page["page"];
      const text = page["text"];
      if (
        typeof number !== "number" ||
        !Number.isSafeInteger(number) ||
        number < 1 ||
        typeof text !== "string" ||
        numbers.has(number)
      ) {
        throw new Error("Candidate pages need unique positive numbers and text");
      }
      numbers.add(number);

      return { page: number, text, source: page["source"] };
    })
    .toSorted((a, b) => a.page - b.page);

  return {
    text: pages.map((page) => page.text).join("\n\n"),
    diagnostics: {
      pageCount: pages.length,
      pages: pages.map(({ text: _text, ...page }) => page),
      sources: [...new Set(pages.map((page) => page.source).filter((source) => typeof source === "string"))],
    },
  };
}
