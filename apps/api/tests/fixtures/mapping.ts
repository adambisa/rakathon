import assert from "node:assert/strict";

import { MappingReview, reviewRecordFields, type SurgeryRecord } from "@prostapaper/contracts";

export function mappingEvidenceFixture(record: SurgeryRecord, lesionIds: string[]): MappingReview {
  const source = {
    documentId: "sheet",
    filename: "sheet.jpg",
    kind: "sector_map",
    sourceVersion: "version-1",
    extractionIdentity: "extraction-1",
    pages: [{ page: 1, text: "Synthetic sheet", source: "ocr" }],
  };
  const parsedEvidence = MappingReview.safeParse({
    schemaVersion: 1,
    policyVersion: 1,
    mappingIdentity: "synthetic",
    lesionIds,
    sources: [source],
    assessments: reviewRecordFields(record, lesionIds).map((field) => ({
      reference: field.reference,
      selectedValue: field.value,
      selectedSupport: 0,
      comparablePassCount: 0,
      totalPassCount: 0,
      requestedPassCount: 0,
      alternatives: [],
      selectionMethod: "majority",
      evidenceStatus: "unavailable",
      confidence: "unavailable",
      reasonCodes: ["evidence_not_collected"],
      evidenceIds: [],
    })),
    evidence: [],
    transformations: [],
    marks: [
      {
        id: "mark-1",
        documentId: "sheet",
        sourceVersion: "version-1",
        extractionIdentity: "extraction-1",
        page: 1,
        focus: { sectors: [{ id: "base_PZpl_L", share: 1, coverage: 0.5 }], marked: ["base_PZpl_L"] },
        regions: ["pzpl_base_ls"],
        status: "unassigned",
        lesionId: null,
        candidateLesionIds: [],
        ruleVersion: 1,
      },
    ],
  });
  assert.ok(parsedEvidence.success, JSON.stringify(parsedEvidence.error?.issues));

  return parsedEvidence.data;
}
