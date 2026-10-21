import { z } from "zod";

import { DocumentKind, DocumentPageSource } from "#document";
import { MappingSectorMark, MappingTransformation } from "#mapping-marks";
import {
  reviewFieldKey,
  ReviewFieldRef,
  ReviewLesionId,
  reviewRecordFields,
  reviewValueKey,
} from "#review-fields";
import type { SurgeryRecord } from "#surgery";

export type JsonValue = z.infer<ReturnType<typeof z.json>>;

export const MAX_CITATION_QUOTE_LENGTH = 2000;
const CONTEXT_CHARS = 80;

const OpaqueId = z.string().min(1).max(128);
const Count = z.int().nonnegative().max(100);
const BoundedStringList = z.array(z.string().min(1).max(128)).max(100);

export const PinnedSourcePage = z.strictObject({
  page: z.int().positive(),
  text: z.string().max(200_000),
  source: DocumentPageSource,
});
export type PinnedSourcePage = z.infer<typeof PinnedSourcePage>;

export const PinnedSource = z
  .strictObject({
    documentId: OpaqueId,
    filename: z.string().min(1).max(255),
    kind: DocumentKind,
    sourceVersion: z.string().min(1).max(256),
    extractionIdentity: z.string().min(1).max(256),
    pages: z.array(PinnedSourcePage).min(1).max(500),
  })
  .superRefine(({ pages }, context) => {
    const seen = new Set<number>();
    for (const [index, { page }] of pages.entries()) {
      if (seen.has(page))
        context.addIssue({
          code: "custom",
          path: ["pages", index, "page"],
          message: "Duplicate page number",
        });
      seen.add(page);
    }
  });
export type PinnedSource = z.infer<typeof PinnedSource>;

export const FieldCitation = z.strictObject({
  documentId: OpaqueId,
  extractionIdentity: z.string().min(1).max(256),
  page: z.int().positive(),
  quote: z.string().min(1).max(MAX_CITATION_QUOTE_LENGTH),
  start: z.int().nonnegative().optional(),
});
export type FieldCitation = z.infer<typeof FieldCitation>;

export const CitationVerification = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("verified"),
    documentId: OpaqueId,
    page: z.int().positive(),
    start: z.int().nonnegative(),
    end: z.int().positive(),
    quote: z.string().max(MAX_CITATION_QUOTE_LENGTH),
    // The context includes the retained quote plus up to 80 characters on each side.
    context: z.string().max(MAX_CITATION_QUOTE_LENGTH + 2 * CONTEXT_CHARS),
  }),
  z.strictObject({
    status: z.literal("ambiguous"),
    documentId: OpaqueId,
    page: z.int().positive(),
    occurrences: z.int().min(2).max(100),
  }),
  z.strictObject({ status: z.literal("unavailable"), reason: z.enum(["document_missing", "page_missing"]) }),
  z.strictObject({
    status: z.literal("invalid"),
    reason: z.enum(["source_mismatch", "quote_not_found", "offset_mismatch", "offset_out_of_bounds"]),
  }),
]);
export type CitationVerification = z.infer<typeof CitationVerification>;

type PinnedPageIndex = Map<string, { extractionIdentity: string; pages: Map<number, PinnedSourcePage> }>;

function verifyParsedCitation(
  citation: FieldCitation,
  pagesByDocument: PinnedPageIndex,
): CitationVerification {
  const source = pagesByDocument.get(citation.documentId);
  if (source === undefined) return { status: "unavailable", reason: "document_missing" };
  if (source.extractionIdentity !== citation.extractionIdentity)
    return { status: "invalid", reason: "source_mismatch" };
  const page = source.pages.get(citation.page);
  if (!page) return { status: "unavailable", reason: "page_missing" };
  const { text } = page;
  if (citation.start !== undefined) {
    const end = citation.start + citation.quote.length;
    if (end > text.length) return { status: "invalid", reason: "offset_out_of_bounds" };
    if (text.slice(citation.start, end) !== citation.quote)
      return { status: "invalid", reason: "offset_mismatch" };

    return {
      status: "verified",
      documentId: citation.documentId,
      page: page.page,
      start: citation.start,
      end,
      quote: citation.quote,
      context: text.slice(
        Math.max(0, citation.start - CONTEXT_CHARS),
        Math.min(text.length, end + CONTEXT_CHARS),
      ),
    };
  }
  const first = text.indexOf(citation.quote);
  if (first === -1) return { status: "invalid", reason: "quote_not_found" };
  const second = text.indexOf(citation.quote, first + 1);
  if (second !== -1) {
    let occurrences = 2;
    let next = text.indexOf(citation.quote, second + 1);
    while (next >= 0 && occurrences < 100) {
      occurrences += 1;
      next = text.indexOf(citation.quote, next + 1);
    }

    return { status: "ambiguous", documentId: citation.documentId, page: page.page, occurrences };
  }
  const end = first + citation.quote.length;

  return {
    status: "verified",
    documentId: citation.documentId,
    page: page.page,
    start: first,
    end,
    quote: citation.quote,
    context: text.slice(Math.max(0, first - CONTEXT_CHARS), Math.min(text.length, end + CONTEXT_CHARS)),
  };
}

/** Validates/indexes pinned pages once; reuse for all citations from one mapping. */
export function createCitationVerifier(sourcesInput: readonly PinnedSource[]) {
  const sources = z.array(PinnedSource).parse(sourcesInput);
  const pagesByDocument: PinnedPageIndex = new Map();
  for (const source of sources) {
    if (pagesByDocument.has(source.documentId))
      throw new TypeError("Pinned source document IDs must be unique");
    pagesByDocument.set(source.documentId, {
      extractionIdentity: source.extractionIdentity,
      pages: new Map(source.pages.map((page) => [page.page, page])),
    });
  }

  return (citationInput: FieldCitation): CitationVerification =>
    verifyParsedCitation(FieldCitation.parse(citationInput), pagesByDocument);
}

/** Verifies exact source text only. It does not assess whether the quote supports the clinical value. */
export function verifyFieldCitation(
  citationInput: FieldCitation,
  sourcesInput: readonly PinnedSource[],
): CitationVerification {
  return createCitationVerifier(sourcesInput)(citationInput);
}

export const MappingEvidence = z.strictObject({
  id: OpaqueId,
  reference: ReviewFieldRef,
  citation: FieldCitation,
  verification: CitationVerification,
  relation: z.enum(["supports", "conflicts"]),
  attribution: z.enum(["mapping_pass", "retrospective"]),
});
export type MappingEvidence = z.infer<typeof MappingEvidence>;

/** Absence defaults carry no claim of an explicitly documented negative. Numeric zero is a value. */
export function isPopulatedMappingValue(value: JsonValue): boolean {
  if (value === null || value === false) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;

  return true;
}

export const ConfidenceLabel = z.enum(["high", "medium", "low", "unavailable"]);
export type ConfidenceLabel = z.infer<typeof ConfidenceLabel>;
export const EvidenceStatus = z.enum(["verified", "unverified", "unavailable", "conflicting"]);
export type EvidenceStatus = z.infer<typeof EvidenceStatus>;
/** One derivation for both artifact construction and validation; conflicts take precedence. */
export function mappingEvidenceStatus(
  evidence: readonly MappingEvidence[],
  collected: boolean,
): EvidenceStatus {
  if (evidence.some((item) => item.relation === "conflicts" && item.verification.status === "verified"))
    return "conflicting";
  if (evidence.some((item) => item.relation === "supports" && item.verification.status === "verified"))
    return "verified";
  if (!collected) return "unavailable";

  return "unverified";
}

export const ConfidenceInput = z.strictObject({
  selectedSupport: Count,
  comparablePassCount: Count,
  totalPassCount: Count,
  requestedPassCount: Count,
  evidenceStatus: EvidenceStatus,
  reasonCodes: BoundedStringList,
  populated: z.boolean(),
});
export type ConfidenceInput = z.infer<typeof ConfidenceInput>;
export const ConfidenceAssessment = z.strictObject({
  label: ConfidenceLabel,
  reasonCodes: BoundedStringList,
});
export type ConfidenceAssessment = z.infer<typeof ConfidenceAssessment>;

const LOW_PRIORITY_CAPS = new Set([
  "citation_invalid",
  "citation_ambiguous",
  "citation_unavailable",
  "lesion_count_disagreement",
  "repair_uncertainty",
  "lesion_fallback",
  "sector_assignment_uncertain",
  "count_disagreement",
  "repair",
  "closest_fallback",
  "sector_postprocessing",
  "transformation",
]);
const HIGH_PRIORITY_FLAGS = new Set([
  "conflict",
  "lesion_alignment_uncertain",
  "alignment_uncertain",
  "legacy_diagnostics_missing",
  "diagnostics_missing",
]);
export const REVIEW_CONFLICT_REASONS = [
  "conflict",
  "evidence_conflict",
  "high_priority_issue",
  "lesion_alignment_uncertain",
  "alignment_uncertain",
  "lesion_count_disagreement",
  "count_disagreement",
] as const;
interface AssessmentLike {
  confidence: string;
  evidenceStatus?: string | undefined;
  reasonCodes: readonly string[];
}
/** Conflicts and alignment uncertainty need an explicit human decision regardless of the value. */
export function assessmentConflicts(assessment: AssessmentLike): boolean {
  return (
    assessment.evidenceStatus === "conflicting" ||
    assessment.reasonCodes.some((code) => (REVIEW_CONFLICT_REASONS as readonly string[]).includes(code))
  );
}
/** Deliberately uncollected or legacy provenance is covered by section confirmation, not per-field decisions. */
export function assessmentRequiresDecision(
  assessment: AssessmentLike | undefined,
  populated: boolean,
): boolean {
  if (assessment === undefined) return false;
  if (assessmentConflicts(assessment)) return true;
  if (!populated) return false;
  if (assessment.confidence === "low") return true;
  if (assessment.confidence === "unavailable")
    return !assessment.reasonCodes.includes("evidence_not_collected");

  return false;
}

/** Explainable agreement policy; repeated passes are agreement signals, not calibrated probabilities. */
export function assessMappingConfidence(inputValue: ConfidenceInput): ConfidenceAssessment {
  const input = ConfidenceInput.parse(inputValue);
  const reasons = new Set(input.reasonCodes);
  const completed = input.totalPassCount > 0 && input.totalPassCount <= input.requestedPassCount;
  const countsValid =
    input.selectedSupport <= input.comparablePassCount && input.comparablePassCount <= input.totalPassCount;
  if (
    !input.populated ||
    !completed ||
    !countsValid ||
    input.totalPassCount === 0 ||
    input.evidenceStatus === "unavailable" ||
    reasons.has("lesion_alignment_uncertain") ||
    reasons.has("alignment_uncertain") ||
    reasons.has("legacy_diagnostics_missing") ||
    reasons.has("diagnostics_missing")
  ) {
    if (!input.populated) reasons.add("value_absent");
    if (!completed || !countsValid || input.totalPassCount === 0) reasons.add("pass_diagnostics_unavailable");
    if (input.evidenceStatus === "unavailable") reasons.add("evidence_unavailable");
    if (reasons.has("lesion_alignment_uncertain") || reasons.has("alignment_uncertain"))
      reasons.add("lesion_alignment_uncertain");
    if (reasons.has("legacy_diagnostics_missing") || reasons.has("diagnostics_missing"))
      reasons.add("pass_diagnostics_unavailable");

    return { label: "unavailable", reasonCodes: [...reasons] };
  }
  if (input.evidenceStatus !== "verified")
    reasons.add(input.evidenceStatus === "conflicting" ? "evidence_conflict" : "evidence_unverified");
  if (input.totalPassCount < input.requestedPassCount) reasons.add("incomplete_run");
  if (
    input.evidenceStatus === "conflicting" ||
    [...reasons].some((reason) => HIGH_PRIORITY_FLAGS.has(reason))
  ) {
    reasons.add("high_priority_issue");

    return { label: "low", reasonCodes: [...reasons] };
  }
  if (input.evidenceStatus !== "verified") return { label: "low", reasonCodes: [...reasons] };
  if (input.totalPassCount < input.requestedPassCount) return { label: "low", reasonCodes: [...reasons] };
  if ([...reasons].some((reason) => LOW_PRIORITY_CAPS.has(reason)))
    return { label: "low", reasonCodes: [...reasons] };
  if (
    input.totalPassCount >= 3 &&
    input.requestedPassCount === input.totalPassCount &&
    input.comparablePassCount === input.totalPassCount &&
    input.selectedSupport === input.totalPassCount
  ) {
    return { label: "high", reasonCodes: [...reasons] };
  }
  const strictMajority =
    input.selectedSupport > input.totalPassCount / 2 && input.selectedSupport > input.comparablePassCount / 2;
  if (strictMajority && input.comparablePassCount > 0) {
    if (input.totalPassCount < 3) reasons.add("limited_pass_count");

    return { label: "medium", reasonCodes: [...reasons] };
  }
  reasons.add("pass_disagreement");

  return { label: "low", reasonCodes: [...reasons] };
}

const MappingAlternative = z.strictObject({ value: z.json(), count: z.int().positive().max(100) });
export const MappingFieldAssessment = z
  .strictObject({
    reference: ReviewFieldRef,
    selectedValue: z.json(),
    selectedSupport: Count,
    comparablePassCount: Count,
    totalPassCount: Count,
    requestedPassCount: Count,
    alternatives: z.array(MappingAlternative).max(100),
    selectionMethod: z.enum(["majority", "closest", "lesion_fallback", "sector"]),
    evidenceStatus: EvidenceStatus,
    confidence: ConfidenceLabel,
    reasonCodes: BoundedStringList,
    evidenceIds: z.array(OpaqueId).max(100),
  })
  .superRefine((assessment, context) => {
    if (
      assessment.selectedSupport > assessment.comparablePassCount ||
      assessment.comparablePassCount > assessment.totalPassCount ||
      assessment.totalPassCount > assessment.requestedPassCount
    ) {
      context.addIssue({
        code: "custom",
        path: ["selectedSupport"],
        message: "Pass counts must satisfy selected ≤ comparable ≤ completed ≤ requested",
      });
    }

    const fieldName =
      assessment.reference.scope === "collection" ? "lesions.length" : assessment.reference.field;
    const alternativeKeys = assessment.alternatives.map(({ value }) => reviewValueKey(fieldName, value));
    if (new Set(alternativeKeys).size !== alternativeKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["alternatives"],
        message: "Alternative values must be unique",
      });
    }
    if (
      assessment.alternatives.reduce((sum, alternative) => sum + alternative.count, 0) !==
      assessment.comparablePassCount
    )
      context.addIssue({
        code: "custom",
        path: ["alternatives"],
        message: "Alternative counts must sum to comparable passes",
      });
    const selectedKey = reviewValueKey(fieldName, assessment.selectedValue);
    const selectedCount =
      assessment.alternatives.find((alternative, index) => alternativeKeys[index] === selectedKey)?.count ??
      0;
    if (assessment.selectedSupport !== selectedCount)
      context.addIssue({
        code: "custom",
        path: ["selectedSupport"],
        message: "Selected support must match the count for the selected value",
      });
  });
export type MappingFieldAssessment = z.infer<typeof MappingFieldAssessment>;

const MappingReviewShape = z.strictObject({
  schemaVersion: z.literal(1),
  policyVersion: z.literal(1),
  mappingIdentity: z.string().min(1).max(512),
  lesionIds: z.array(ReviewLesionId).max(100),
  sources: z.array(PinnedSource).max(2),
  assessments: z.array(MappingFieldAssessment).max(1500),
  evidence: z.array(MappingEvidence).max(1000),
  marks: z.array(MappingSectorMark).max(1000),
  transformations: z.array(MappingTransformation).max(1000),
});
export const MappingReview = MappingReviewShape.superRefine((review, context) => {
  // Nonfatal child errors must remain validation results rather than exceptions in verifier calls.
  if (!MappingReviewShape.safeParse(review).success) return;
  if (new Set(review.lesionIds).size !== review.lesionIds.length)
    context.addIssue({ code: "custom", path: ["lesionIds"], message: "Lesion IDs must be unique" });
  if (new Set(review.sources.map((source) => source.documentId)).size !== review.sources.length)
    context.addIssue({ code: "custom", path: ["sources"], message: "Document IDs must be unique" });
  const evidenceIds = review.evidence.map((item) => item.id);
  if (new Set(evidenceIds).size !== evidenceIds.length)
    context.addIssue({ code: "custom", path: ["evidence"], message: "Evidence IDs must be unique" });
  const availableIds = new Set(evidenceIds);
  const assessmentRefs = review.assessments.map((item) => reviewFieldKey(item.reference));
  if (new Set(assessmentRefs).size !== assessmentRefs.length)
    context.addIssue({
      code: "custom",
      path: ["assessments"],
      message: "Assessment field references must be unique",
    });
  const markIds = review.marks.map((mark) => mark.id);
  if (new Set(markIds).size !== markIds.length)
    context.addIssue({ code: "custom", path: ["marks"], message: "Mark IDs must be unique" });
  for (const [index, assessment] of review.assessments.entries()) {
    if (assessment.evidenceIds.some((id) => !availableIds.has(id)))
      context.addIssue({
        code: "custom",
        path: ["assessments", index, "evidenceIds"],
        message: "Assessment references missing evidence",
      });
    const fieldEvidence = review.evidence.filter((item) => assessment.evidenceIds.includes(item.id));
    const expectedEvidenceStatus = mappingEvidenceStatus(
      fieldEvidence,
      review.sources.length > 0 && !assessment.reasonCodes.includes("evidence_not_collected"),
    );
    if (assessment.evidenceStatus !== expectedEvidenceStatus) {
      context.addIssue({
        code: "custom",
        path: ["assessments", index, "evidenceStatus"],
        message: "Evidence status does not match its verified citations",
      });
    }
    const expectedConfidence = assessMappingConfidence({
      selectedSupport: assessment.selectedSupport,
      comparablePassCount: assessment.comparablePassCount,
      totalPassCount: assessment.totalPassCount,
      requestedPassCount: assessment.requestedPassCount,
      evidenceStatus: assessment.evidenceStatus,
      reasonCodes: assessment.reasonCodes,
      populated: isPopulatedMappingValue(assessment.selectedValue),
    });
    if (assessment.confidence !== expectedConfidence.label) {
      context.addIssue({
        code: "custom",
        path: ["assessments", index, "confidence"],
        message: "Confidence does not match the versioned policy",
      });
    }
    for (const evidenceId of assessment.evidenceIds) {
      const evidence = review.evidence.find((item) => item.id === evidenceId);
      if (evidence && reviewFieldKey(evidence.reference) !== reviewFieldKey(assessment.reference))
        context.addIssue({
          code: "custom",
          path: ["assessments", index, "evidenceIds"],
          message: "Evidence reference does not match assessment",
        });
    }
    if (assessment.reference.scope === "lesion" && !review.lesionIds.includes(assessment.reference.lesionId))
      context.addIssue({
        code: "custom",
        path: ["assessments", index, "reference"],
        message: "Unknown lesion ID",
      });
  }
  const uniqueSourceIds =
    new Set(review.sources.map((source) => source.documentId)).size === review.sources.length;
  let sourcesForVerification: PinnedSource[] = [];
  if (uniqueSourceIds) sourcesForVerification = review.sources;
  const verifyCitation = createCitationVerifier(sourcesForVerification);
  for (const [index, item] of review.evidence.entries()) {
    const expected = verifyCitation(item.citation);
    if (JSON.stringify(item.verification) !== JSON.stringify(expected))
      context.addIssue({
        code: "custom",
        path: ["evidence", index, "verification"],
        message: "Citation verification does not match its pinned source",
      });
    if (item.reference.scope === "lesion" && !review.lesionIds.includes(item.reference.lesionId))
      context.addIssue({
        code: "custom",
        path: ["evidence", index, "reference"],
        message: "Unknown lesion ID",
      });
  }
  for (const [index, mark] of review.marks.entries()) {
    if (
      !review.sources.some(
        (source) =>
          source.documentId === mark.documentId &&
          source.sourceVersion === mark.sourceVersion &&
          source.extractionIdentity === mark.extractionIdentity &&
          source.pages.some((page) => page.page === mark.page),
      )
    )
      context.addIssue({
        code: "custom",
        path: ["marks", index],
        message: "Mark must reference a pinned source page",
      });
    if (mark.lesionId !== null && !review.lesionIds.includes(mark.lesionId))
      context.addIssue({
        code: "custom",
        path: ["marks", index, "lesionId"],
        message: "Unknown lesion ID",
      });
    if (mark.candidateLesionIds.some((id) => !review.lesionIds.includes(id)))
      context.addIssue({
        code: "custom",
        path: ["marks", index, "candidateLesionIds"],
        message: "Unknown candidate lesion ID",
      });
  }
  for (const [index, transformation] of review.transformations.entries()) {
    if (
      transformation.reference.scope === "lesion" &&
      !review.lesionIds.includes(transformation.reference.lesionId)
    )
      context.addIssue({
        code: "custom",
        path: ["transformations", index, "reference"],
        message: "Unknown lesion ID",
      });
    if (transformation.sourceMarkIds.some((id) => !review.marks.some((mark) => mark.id === id)))
      context.addIssue({
        code: "custom",
        path: ["transformations", index, "sourceMarkIds"],
        message: "Transformation references missing mark",
      });
  }
});
export type MappingReview = z.infer<typeof MappingReview>;

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Accept complete lesion assessments or a complete legacy sidecar for this exact record. */
export function parseMappingReview(value: unknown, record: SurgeryRecord): MappingReview | null {
  const parsed = MappingReview.safeParse(value);
  if (!parsed.success) return null;
  const review = parsed.data;
  if (review.lesionIds.length !== record.lesions.length) return null;
  const includesParentFields = review.assessments.some((item) => item.reference.scope === "surgery");
  const expected = reviewRecordFields(record, review.lesionIds).filter(
    (item) => includesParentFields || item.reference.scope !== "surgery",
  );
  const assessments = new Map(
    review.assessments.map((assessment) => [reviewFieldKey(assessment.reference), assessment]),
  );
  if (assessments.size !== expected.length) return null;
  for (const item of expected) {
    const assessment = assessments.get(reviewFieldKey(item.reference));
    if (assessment === undefined || !same(assessment.selectedValue, item.value)) return null;
  }

  return review;
}
