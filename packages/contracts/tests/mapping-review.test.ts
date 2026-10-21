import assert from "node:assert/strict";
import test from "node:test";

import {
  assessMappingConfidence,
  CitationVerification,
  type ConfidenceInput,
  createCitationVerifier,
  MappingFieldAssessment,
  MappingReview,
  parseMappingReview,
  PinnedSource,
  verifyFieldCitation,
} from "#mapping-review";
import { reviewRecordFields } from "#review-fields";
import { LesionFields, SurgeryFields, SurgeryRecord } from "#surgery";

const source = (text: string) => ({
  documentId: "cli-document-1",
  filename: "synthetic.txt",
  kind: "text_description" as const,
  sourceVersion: "sha256:test",
  extractionIdentity: "extract-1",
  pages: [{ page: 1, text, source: "ocr" as const }],
});
const confidence = (overrides: Partial<ConfidenceInput> = {}): ConfidenceInput => ({
  selectedSupport: 3,
  comparablePassCount: 3,
  totalPassCount: 3,
  requestedPassCount: 3,
  evidenceStatus: "verified",
  reasonCodes: [],
  populated: true,
  ...overrides,
});

void test("pinned sources accept synthetic IDs and reject duplicate document/page IDs", () => {
  assert.equal(PinnedSource.safeParse(source("text")).success, true);
  assert.equal(
    PinnedSource.safeParse({
      ...source("text"),
      pages: [
        { page: 1, text: "a", source: "ocr" },
        { page: 1, text: "b", source: "ocr" },
      ],
    }).success,
    false,
  );
});

void test("citation verifier returns exact quote offsets and bounded context", () => {
  const pinned = source(`${"x".repeat(100)} exact quote ${"y".repeat(200)}`);
  const result = verifyFieldCitation(
    {
      documentId: pinned.documentId,
      extractionIdentity: pinned.extractionIdentity,
      page: 1,
      quote: "exact quote",
    },
    [pinned],
  );
  assert.equal(result.status, "verified");
  assert.equal(result.start, 101);
  assert.equal(result.end - result.start, 11);
  assert.ok(result.context.length <= 171);
});

void test("long valid citations remain verifiable and can be checked through a reused index", () => {
  const quote = "clinical finding ".repeat(20);
  const pinned = source(`${"x".repeat(100)}${quote}${"y".repeat(100)}`);
  const citation = {
    documentId: pinned.documentId,
    extractionIdentity: pinned.extractionIdentity,
    page: 1,
    quote,
  };
  const verify = createCitationVerifier([pinned]);
  const indexedResult = verify(citation);

  assert.equal(indexedResult.status, "verified");
  assert.ok(indexedResult.context.length > 240);
  assert.equal(CitationVerification.safeParse(indexedResult).success, true);
  assert.deepEqual(verifyFieldCitation(citation, [pinned]), indexedResult);
});

void test("citation verifier distinguishes missing source/page, source mismatch and invented text", () => {
  const pinned = source("present");
  const base = {
    documentId: pinned.documentId,
    extractionIdentity: pinned.extractionIdentity,
    page: 1,
    quote: "present",
  };
  assert.deepEqual(verifyFieldCitation({ ...base, documentId: "missing" }, [pinned]), {
    status: "unavailable",
    reason: "document_missing",
  });
  assert.deepEqual(verifyFieldCitation({ ...base, page: 2 }, [pinned]), {
    status: "unavailable",
    reason: "page_missing",
  });
  assert.deepEqual(verifyFieldCitation({ ...base, extractionIdentity: "other" }, [pinned]), {
    status: "invalid",
    reason: "source_mismatch",
  });
  assert.deepEqual(verifyFieldCitation({ ...base, quote: "invented" }, [pinned]), {
    status: "invalid",
    reason: "quote_not_found",
  });
});

void test("repeated quotes are ambiguous without an offset and verified at a valid offset", () => {
  const pinned = source("same then same");
  const base = {
    documentId: pinned.documentId,
    extractionIdentity: pinned.extractionIdentity,
    page: 1,
    quote: "same",
  };
  assert.deepEqual(verifyFieldCitation(base, [pinned]), {
    status: "ambiguous",
    documentId: pinned.documentId,
    page: 1,
    occurrences: 2,
  });
  assert.equal(verifyFieldCitation({ ...base, start: 10 }, [pinned]).status, "verified");
  assert.deepEqual(verifyFieldCitation({ ...base, start: 2 }, [pinned]), {
    status: "invalid",
    reason: "offset_mismatch",
  });
});

void test("three unanimous comparable passes with verified evidence are high", () => {
  assert.equal(assessMappingConfidence(confidence()).label, "high");
});

void test("two of three agreeing passes are medium, while one of three is low", () => {
  assert.equal(assessMappingConfidence(confidence({ selectedSupport: 2 })).label, "medium");
  assert.equal(assessMappingConfidence(confidence({ selectedSupport: 1 })).label, "low");
});

void test("incomplete requested passes cannot receive high confidence", () => {
  assert.notEqual(assessMappingConfidence(confidence({ requestedPassCount: 4 })).label, "high");
});

void test("repair and conflicting evidence take precedence over agreement", () => {
  assert.equal(assessMappingConfidence(confidence({ reasonCodes: ["repair_uncertainty"] })).label, "low");
  assert.equal(
    assessMappingConfidence(confidence({ reasonCodes: ["lesion_count_disagreement"] })).label,
    "low",
  );
  const conflict = assessMappingConfidence(confidence({ evidenceStatus: "conflicting" }));
  assert.equal(conflict.label, "low");
  assert.ok(conflict.reasonCodes.includes("high_priority_issue"));
});

void test("a two-pass split cannot claim medium confidence", () => {
  assert.equal(
    assessMappingConfidence(
      confidence({
        selectedSupport: 1,
        comparablePassCount: 2,
        totalPassCount: 2,
        requestedPassCount: 2,
      }),
    ).label,
    "low",
  );
});

void test("region alternatives compare as sets when validating vote distributions", () => {
  const assessment = {
    reference: { scope: "lesion" as const, lesionId: "lesion-1", field: "sur_prostate_regions" as const },
    selectedValue: ["pzpl_base_ls", "pzpl_mid_ls"],
    selectedSupport: 3,
    comparablePassCount: 3,
    totalPassCount: 3,
    requestedPassCount: 3,
    alternatives: [{ value: ["pzpl_mid_ls", "pzpl_base_ls"], count: 3 }],
    selectionMethod: "majority" as const,
    evidenceStatus: "unverified" as const,
    confidence: "low" as const,
    reasonCodes: ["evidence_unverified"],
    evidenceIds: [],
  };
  assert.equal(MappingFieldAssessment.safeParse(assessment).success, true);
  assert.equal(
    MappingFieldAssessment.safeParse({
      ...assessment,
      alternatives: [
        { value: ["pzpl_mid_ls", "pzpl_base_ls"], count: 2 },
        { value: ["pzpl_base_ls", "pzpl_mid_ls"], count: 1 },
      ],
    }).success,
    false,
  );
});

void test("MappingReview rejects forged citation verification and duplicate assessment refs", () => {
  const pinned = source("quoted text");
  const citation = {
    documentId: pinned.documentId,
    extractionIdentity: pinned.extractionIdentity,
    page: 1,
    quote: "quoted text",
  };
  const reference = { scope: "surgery" as const, field: "surgery_date" as const };
  const assessment = {
    reference,
    selectedValue: "2025-01-01",
    selectedSupport: 3,
    comparablePassCount: 3,
    totalPassCount: 3,
    requestedPassCount: 3,
    alternatives: [{ value: "2025-01-01", count: 3 }],
    selectionMethod: "majority" as const,
    evidenceStatus: "verified" as const,
    confidence: "high" as const,
    reasonCodes: [],
    evidenceIds: ["evidence-1"],
  };
  const evidence = {
    id: "evidence-1",
    reference,
    citation,
    verification: verifyFieldCitation(citation, [pinned]),
    relation: "supports" as const,
    attribution: "mapping_pass" as const,
  };
  const review = {
    schemaVersion: 1 as const,
    policyVersion: 1 as const,
    mappingIdentity: "mapping-1",
    lesionIds: [],
    sources: [pinned],
    assessments: [assessment],
    evidence: [evidence],
    marks: [],
    transformations: [],
  };
  assert.equal(MappingReview.safeParse(review).success, true);
  assert.equal(
    MappingReview.safeParse({
      ...review,
      evidence: [evidence, { ...evidence, id: "conflict", relation: "conflicts" }],
      assessments: [{ ...assessment, evidenceIds: ["evidence-1", "conflict"] }],
    }).success,
    false,
    "Verified conflicting evidence cannot be hidden behind a verified/high status",
  );
  assert.equal(
    MappingReview.safeParse({
      ...review,
      evidence: [{ ...evidence, citation: { ...citation, quote: "x".repeat(2001) } }],
    }).success,
    false,
  );
  assert.equal(
    MappingReview.safeParse({ ...review, evidence: [], assessments: [{ ...assessment, evidenceIds: [] }] })
      .success,
    false,
  );
  assert.equal(
    MappingReview.safeParse({
      ...review,
      evidence: [
        {
          ...evidence,
          verification: {
            status: "verified",
            documentId: pinned.documentId,
            page: 1,
            start: 1,
            end: 12,
            quote: "quoted text",
            context: "quoted text",
          },
        },
      ],
    }).success,
    false,
  );
  assert.equal(MappingReview.safeParse({ ...review, assessments: [assessment, assessment] }).success, false);
  assert.equal(
    MappingReview.safeParse({
      ...review,
      assessments: [{ ...assessment, alternatives: [{ value: "2025-01-01", count: 2 }] }],
    }).success,
    false,
  );
  assert.equal(
    MappingReview.safeParse({
      ...review,
      assessments: [
        {
          ...assessment,
          alternatives: [
            { value: "2025-01-01", count: 1 },
            { value: "2025-01-01", count: 2 },
          ],
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    MappingReview.safeParse({
      ...review,
      assessments: [
        {
          ...assessment,
          selectedSupport: 2,
          alternatives: [
            { value: "2025-01-01", count: 1 },
            { value: null, count: 2 },
          ],
        },
      ],
    }).success,
    false,
  );
});

void test("unpopulated values and unavailable diagnostics/evidence never receive confidence", () => {
  assert.equal(assessMappingConfidence(confidence({ populated: false })).label, "unavailable");
  assert.equal(
    assessMappingConfidence(confidence({ totalPassCount: 0, comparablePassCount: 0, selectedSupport: 0 }))
      .label,
    "unavailable",
  );
  assert.equal(assessMappingConfidence(confidence({ evidenceStatus: "unavailable" })).label, "unavailable");
});

void test("mapping review accepts complete lesion or legacy assessments and rejects partial coverage", () => {
  const record = SurgeryRecord.parse({
    surgery: Object.fromEntries(Object.keys(SurgeryFields.shape).map((name) => [name, null])),
    lesions: [
      {
        ...Object.fromEntries(Object.keys(LesionFields.shape).map((name) => [name, null])),
        all_sgm: false,
        sur_prostate_regions: [],
      },
    ],
  });
  const legacy = MappingReview.parse({
    schemaVersion: 1,
    policyVersion: 1,
    mappingIdentity: "mapping-1",
    lesionIds: ["lesion-1"],
    sources: [],
    assessments: reviewRecordFields(record, ["lesion-1"]).map(({ reference, value }) => ({
      reference,
      selectedValue: value,
      selectedSupport: 1,
      comparablePassCount: 1,
      totalPassCount: 1,
      requestedPassCount: 1,
      alternatives: [{ value, count: 1 }],
      selectionMethod: "majority",
      evidenceStatus: "unavailable",
      confidence: "unavailable",
      reasonCodes: ["evidence_not_collected"],
      evidenceIds: [],
    })),
    evidence: [],
    marks: [],
    transformations: [],
  });
  const lesionOnly = {
    ...legacy,
    assessments: legacy.assessments.filter((item) => item.reference.scope !== "surgery"),
  };
  assert.deepEqual(parseMappingReview(legacy, record), legacy);
  assert.deepEqual(parseMappingReview(lesionOnly, record), lesionOnly);
  for (const assessments of [
    lesionOnly.assessments.filter((item) => item.reference.scope !== "collection"),
    lesionOnly.assessments.filter(
      (item) => item.reference.scope !== "lesion" || item.reference.field !== "lesion_x_mm",
    ),
    legacy.assessments.filter(
      (item) => item.reference.scope !== "surgery" || item.reference.field !== "surgery_date",
    ),
    legacy.assessments.filter(
      (item) => item.reference.scope !== "surgery" || item.reference.field === "surgery_date",
    ),
  ]) {
    const partial = { ...legacy, assessments };
    assert.equal(MappingReview.safeParse(partial).success, true);
    assert.equal(parseMappingReview(partial, record), null);
  }
  const wrongValue = {
    ...lesionOnly,
    assessments: lesionOnly.assessments.map((item) => {
      if (item.reference.scope !== "lesion" || item.reference.field !== "lesion_x_mm") return item;

      return { ...item, selectedValue: 12, alternatives: [{ value: 12, count: 1 }] };
    }),
  };
  assert.equal(MappingReview.safeParse(wrongValue).success, true);
  assert.equal(parseMappingReview(wrongValue, record), null);
});
