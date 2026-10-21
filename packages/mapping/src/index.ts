import { randomUUID } from "node:crypto";

import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";

import {
  FieldCitation,
  type MappingOutput,
  MAX_CITATION_QUOTE_LENGTH,
  SurgeryRecord,
} from "@prostapaper/contracts";

import { consensus } from "#consensus";
import { INSTRUCTIONS } from "#prompt";
import { buildMappingReview, type PassCitation } from "#review";
import { applySectorMap, sectorMapMarks } from "#sector-map";
import { assembleCaseText, type CaseDocumentText } from "#text";

export { applySectorMap, sectorMapMarks } from "#sector-map";
export { assembleCaseText, type CaseDocumentText } from "#text";

export const DEFAULT_MODEL = "gpt-5-mini";
export const DEFAULT_EFFORT = "medium";
const REQUEST_TIMEOUT_MS = 90_000;

const FORMAT = zodTextFormat(SurgeryRecord, "surgery_record");
const CitationResponse = FieldCitation.extend({
  path: z.string().min(1).max(128),
  // Structured model responses require a nullable key; storage omits unknown offsets.
  start: FieldCitation.shape.start.unwrap().nullable(),
  relation: z.enum(["supports", "conflicts"]),
});
const CitedResponse = z.object({ record: SurgeryRecord, citations: z.array(CitationResponse).max(100) });
const CITED_FORMAT = zodTextFormat(CitedResponse, "cited_surgery_record");
const CITATION_INSTRUCTIONS = `
Return the record plus compact field citations for directly supporting or conflicting text.
Use paths lesions.INDEX.FIELD (zero-based lesion index). Cite only source pages
with explicit document/extraction/page headers; copy those identifiers exactly. Quotes must be exact,
unmodified substrings of the canonical page text, at most ${MAX_CITATION_QUOTE_LENGTH} characters. Set start to a zero-based
UTF-16 text offset only when known, otherwise null. A repeated quote needs a disambiguating offset
or longer unique quote. Do not cite silence or infer a negative from absence. Quote existence does
not prove clinical interpretation. Do not cite synthesized sector text as extracted report text.`;

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

export interface MapOptions {
  model?: string | undefined;
  effort?: ReasoningEffort | undefined;
  /** Experimental enriched format; enable only for a measured quality/latency evaluation. */
  citations?: boolean | undefined;
  /** Falls back to OPENAI_API_KEY when absent, which is how the scripts authenticate. */
  apiKey?: string | undefined;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
}

export interface PassDiagnostics {
  model: string;
  usage: Usage;
  repaired: boolean;
}

export interface Pass {
  record: SurgeryRecord;
  diagnostics: PassDiagnostics;
  citations?: PassCitation[];
}

function createClient(options: MapOptions): OpenAI {
  return new OpenAI({ apiKey: options.apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });
}

function usageOf(response: { usage?: { input_tokens: number; output_tokens: number } | undefined }): Usage {
  return {
    input_tokens: response.usage?.input_tokens ?? 0,
    output_tokens: response.usage?.output_tokens ?? 0,
  };
}

async function runPass(client: OpenAI, text: string, options: MapOptions): Promise<Pass> {
  const model = options.model ?? DEFAULT_MODEL;
  const instructions = options.citations === true ? INSTRUCTIONS + CITATION_INSTRUCTIONS : INSTRUCTIONS;
  const format = options.citations === true ? CITED_FORMAT : FORMAT;
  const reasoning = { effort: options.effort ?? DEFAULT_EFFORT };
  const first = await client.responses.create({
    model,
    instructions,
    input: text,
    reasoning,
    text: { format },
  });
  const decode = (text: string) => {
    const json: unknown = JSON.parse(text);
    if (options.citations === true) return CitedResponse.safeParse(json);
    const record = SurgeryRecord.safeParse(json);
    if (!record.success) return record;

    return { success: true as const, data: { record: record.data, citations: [] } };
  };
  const citationsOf = (citations: z.infer<typeof CitationResponse>[]): PassCitation[] =>
    citations.map(({ start, ...citation }) => {
      if (start === null) return citation;

      return { ...citation, start };
    });
  const parsed = decode(first.output_text);
  if (parsed.success) {
    const pass: Pass = {
      record: parsed.data.record,
      diagnostics: { model: first.model, usage: usageOf(first), repaired: false },
    };
    if (options.citations === true) pass.citations = citationsOf(parsed.data.citations);

    return pass;
  }

  const repair = await client.responses.create({
    model,
    instructions,
    previous_response_id: first.id,
    input: `The record you produced violates these schema rules:\n${JSON.stringify(parsed.error.issues, null, 2)}\nReturn the corrected full record. Change only what the rules require and keep every other value as it was.`,
    reasoning,
    text: { format },
  });
  const repaired = decode(repair.output_text);
  if (!repaired.success) throw new Error("Mapping repair did not return a valid record");
  const record = repaired.data.record;
  const usage = usageOf(repair);
  const before = usageOf(first);
  usage.input_tokens += before.input_tokens;
  usage.output_tokens += before.output_tokens;

  const pass: Pass = { record, diagnostics: { model: repair.model, usage, repaired: true } };
  if (options.citations === true) pass.citations = citationsOf(repaired.data.citations);

  return pass;
}

export async function mapReportText(text: string, options: MapOptions = {}): Promise<Pass> {
  return runPass(createClient(options), text, options);
}

export interface PassSummary {
  usage: Usage;
  repairedPasses: number;
}

export function summarizePasses(passes: readonly Pass[]): PassSummary {
  return {
    usage: {
      input_tokens: passes.reduce((sum, pass) => sum + pass.diagnostics.usage.input_tokens, 0),
      output_tokens: passes.reduce((sum, pass) => sum + pass.diagnostics.usage.output_tokens, 0),
    },
    repairedPasses: passes.filter((pass) => pass.diagnostics.repaired).length,
  };
}

export interface MapPassesOptions extends MapOptions {
  passes?: number | undefined;
}

async function runConsensus(text: string, options: MapPassesOptions) {
  const passes = options.passes ?? 3;
  if (!Number.isInteger(passes) || passes < 1 || passes > 9)
    throw new Error("Mapping passes must be between 1 and 9");
  const client = createClient(options);
  const outputs = await Promise.all(
    Array.from({ length: passes }, async () => runPass(client, text, options)),
  );
  const result = consensus(outputs.map((output) => output.record));

  return {
    outputs,
    result,
    diagnostics: {
      model: outputs[0]?.diagnostics.model,
      passes,
      requestedPassCount: passes,
      completedPassCount: outputs.length,
      citationsEnabled: options.citations === true,
      consensusSource: result.source,
      lesionAlignment: result.lesionAlignment,
      stableFields: result.stable,
      fields: result.fields,
      unstable: result.unstable,
      ...summarizePasses(outputs),
    },
  };
}

function optionalReview(input: Parameters<typeof buildMappingReview>[0]) {
  try {
    return buildMappingReview(input);
  } catch (error) {
    // Report the failure category without logging clinical values, excerpts or the error payload.
    if (error instanceof z.ZodError) {
      console.warn({
        outcome: "mapping_review_unavailable",
        kind: "invalid_review_contract",
        codes: [...new Set(error.issues.map((issue) => issue.code))],
      });
    } else {
      console.warn({ outcome: "mapping_review_unavailable", kind: "review_build_failed" });
    }

    return;
  }
}

function reviewAvailability(review: ReturnType<typeof optionalReview>): "available" | "failed" {
  if (review === undefined) return "failed";

  return "available";
}

/** Runs independent passes. Diagnostics describe support for the actual selected values. */
export async function mapReportByConsensus(
  text: string,
  options: MapPassesOptions = {},
): Promise<MappingOutput> {
  const { result, outputs, diagnostics } = await runConsensus(text, options);
  const review = optionalReview({
    mappingIdentity: randomUUID(),
    record: result.record,
    consensus: result,
    passes: outputs,
    requestedPassCount: options.passes ?? 3,
    documents: [],
  });

  return {
    record: result.record,
    diagnostics: {
      ...diagnostics,
      review,
      reviewAvailability: reviewAvailability(review),
    },
  };
}

/** Text and sheet are read together; provenance records the subsequent sector enforcement. */
export async function mapCaseDocuments(
  documents: readonly CaseDocumentText[],
  options: MapPassesOptions = {},
): Promise<MappingOutput> {
  const { result, outputs, diagnostics } = await runConsensus(
    assembleCaseText(documents, { citations: options.citations }),
    options,
  );
  const marks = sectorMapMarks(documents);
  const applied = applySectorMap(result.record, marks);
  const review = optionalReview({
    mappingIdentity: randomUUID(),
    record: applied.record,
    consensus: result,
    passes: outputs,
    requestedPassCount: options.passes ?? 3,
    documents,
  });

  return {
    record: applied.record,
    diagnostics: {
      ...diagnostics,
      review,
      reviewAvailability: reviewAvailability(review),
      sectorMap: {
        marks: marks.length,
        regionsAdded: applied.regionsAdded,
        unplacedRegions: applied.unplacedRegions,
      },
    },
  };
}
