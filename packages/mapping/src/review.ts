import { createHash } from "node:crypto";

import {
  assessMappingConfidence,
  createCitationVerifier,
  type FieldCitation,
  isPopulatedMappingValue,
  type JsonValue,
  LesionFieldName,
  type MappingEvidence,
  mappingEvidenceStatus,
  type MappingFieldAssessment,
  MappingReview,
  type MappingSectorMark,
  type MappingTransformation,
  PinnedSource,
  regionFromSectorId,
  type ReviewFieldRef,
  reviewFieldRef,
  type SurgeryRecord,
} from "@prostapaper/contracts";

import { type Consensus, type ConsensusFieldDiagnostic, consensusValueKey } from "#consensus";
import type { CaseDocumentText } from "#text";

export interface PassCitation extends FieldCitation {
  path: string;
  relation: "supports" | "conflicts";
}

export interface ReviewPass {
  record: SurgeryRecord;
  citations?: PassCitation[];
  diagnostics: { repaired: boolean };
}

function fieldReference(path: string, lesionIds: readonly string[]): ReviewFieldRef {
  if (path === "lesions.length") return { scope: "collection", collection: "lesions" };
  const parts = path.split(".");
  const lesionId = lesionIds[Number(parts[1])];
  if (parts[0] !== "lesions" || lesionId === undefined) throw new Error("Invalid assessment path");

  return reviewFieldRef(LesionFieldName.parse(parts[2]), lesionId);
}

function pinnedSources(documents: readonly CaseDocumentText[]): PinnedSource[] {
  return documents.flatMap((document) => {
    if (document.documentId === undefined) return [];
    if (document.extractionIdentity === undefined) return [];
    if (document.sourceVersion === undefined) return [];

    return [
      PinnedSource.parse({
        documentId: document.documentId,
        filename: document.filename,
        kind: document.kind,
        extractionIdentity: document.extractionIdentity,
        sourceVersion: document.sourceVersion,
        pages: document.extracted.pages,
      }),
    ];
  });
}

const digest = (value: string): string => createHash("sha256").update(value).digest("hex");

/** Every source pen mark keeps its own identity even if several touch exactly the same regions. */
function identifySectorMarks(
  documents: readonly CaseDocumentText[],
  record: SurgeryRecord,
  lesionIds: readonly string[],
): MappingSectorMark[] {
  return documents.flatMap((document) => {
    if (document.kind !== "sector_map") return [];
    const source = pinnedSources([document])[0];
    if (source === undefined) return [];

    return (document.extracted.sectorMap?.pages ?? []).flatMap((page) =>
      page.foci.map((focus, index) => {
        const regions = focus.marked.map(regionFromSectorId);
        const candidates = record.lesions.flatMap((lesion, position) => {
          const id = lesionIds[position];
          if (id === undefined || !regions.some((region) => lesion.sur_prostate_regions.includes(region)))
            return [];

          return [id];
        });
        let status: MappingSectorMark["status"] = "unassigned";
        let lesionId: string | null = null;
        // Existing postprocessing assigns sheet regions only for an explicitly single-lesion record.
        if (record.lesions.length === 1 && lesionIds[0] !== undefined) {
          status = "assigned";
          lesionId = lesionIds[0];
        } else if (candidates.length > 0) status = "ambiguous";

        return {
          id: `mark-${digest(JSON.stringify([source.documentId, source.sourceVersion, source.extractionIdentity, page.page, index]))}`,
          documentId: source.documentId,
          sourceVersion: source.sourceVersion,
          extractionIdentity: source.extractionIdentity,
          page: page.page,
          focus,
          regions,
          status,
          lesionId,
          candidateLesionIds: candidates,
          ruleVersion: 1 as const,
        };
      }),
    );
  });
}

// Kept separate from selected-value votes: after sector processing, the displayed value may have no votes.
function finalDiagnostic(
  diagnostic: ConsensusFieldDiagnostic,
  record: SurgeryRecord,
): ConsensusFieldDiagnostic {
  const parts = diagnostic.path.split(".");
  let selected = diagnostic.selectedValue;
  if (parts[0] === "lesions" && parts[1] !== "length") {
    const lesion = record.lesions[Number(parts[1])];
    if (lesion !== undefined && (parts[2] === "sur_prostate_regions" || parts[2] === "all_sgm"))
      selected = lesion[parts[2]];
  }
  if (
    consensusValueKey(diagnostic.path, selected) ===
    consensusValueKey(diagnostic.path, diagnostic.selectedValue)
  )
    return diagnostic;
  const support =
    diagnostic.alternatives.find(
      (alternative) =>
        consensusValueKey(diagnostic.path, alternative.value) ===
        consensusValueKey(diagnostic.path, selected),
    )?.count ?? 0;

  return {
    ...diagnostic,
    selectedValue: selected,
    selectedSupport: support,
    reasonCodes: [...diagnostic.reasonCodes, "sector_postprocessing"],
  };
}

export function buildMappingReview(input: {
  mappingIdentity: string;
  record: SurgeryRecord;
  consensus: Consensus;
  passes: readonly ReviewPass[];
  requestedPassCount: number;
  documents: readonly CaseDocumentText[];
}): MappingReview {
  const { record, documents } = input;
  const lesionIds = record.lesions.map((_, index) => `lesion-${index + 1}`);
  const sources = pinnedSources(documents);
  const verifyCitation = createCitationVerifier(sources);
  const evidenceCollected = input.passes.some((pass) => pass.citations !== undefined);
  const marks = identifySectorMarks(documents, record, lesionIds);
  const evidence: MappingEvidence[] = [];
  const transformations: MappingTransformation[] = [];
  const diagnostics = input.consensus.fieldDiagnostics.filter(({ path }) => path.startsWith("lesions."));
  const assessments: MappingFieldAssessment[] = diagnostics.map((original) => {
    const diagnostic = finalDiagnostic(original, record);
    const reference = fieldReference(diagnostic.path, lesionIds);
    const reasons = [...diagnostic.reasonCodes];
    if (input.passes.some((pass) => pass.diagnostics.repaired)) reasons.push("repair_uncertainty");
    const changed = reasons.includes("sector_postprocessing");
    if (changed) {
      transformations.push({
        id: `sector-${diagnostic.path}`,
        ruleId: "single-lesion-sector-enforcement",
        ruleVersion: 1,
        reference,
        before: original.selectedValue,
        after: diagnostic.selectedValue,
        sourceMarkIds: marks
          .filter(
            (mark) =>
              mark.lesionId !== null && reference.scope === "lesion" && mark.lesionId === reference.lesionId,
          )
          .map((mark) => mark.id),
      });
    }
    const fieldEvidence: MappingEvidence[] = [];
    if (!changed && !reasons.includes("lesion_alignment_uncertain")) {
      for (const [passIndex, pass] of input.passes.entries()) {
        // Count-disagreeing lesion passes cannot attribute evidence to a selected lesion identity.
        if (reference.scope === "lesion" && pass.record.lesions.length !== record.lesions.length) continue;
        const parts = diagnostic.path.split(".");
        let value: unknown = null;
        if (reference.scope === "lesion") value = pass.record.lesions[Number(parts[1])]?.[reference.field];
        const supportsSelected =
          value !== undefined &&
          consensusValueKey(diagnostic.path, value as JsonValue) ===
            consensusValueKey(diagnostic.path, diagnostic.selectedValue);
        for (const citation of pass.citations ?? []) {
          if (citation.path !== diagnostic.path) continue;
          // A conflict with a losing value does not establish a conflict with the selected value.
          if (!supportsSelected && citation.relation === "conflicts") continue;
          // A pass's support for a losing value is conflicting evidence for the selected value.
          let relation = citation.relation;
          if (!supportsSelected && relation === "supports") relation = "conflicts";
          const { path: _path, relation: _relation, ...quote } = citation;
          const item: MappingEvidence = {
            id: `evidence-${evidence.length + fieldEvidence.length + 1}-${passIndex}`,
            reference,
            citation: quote,
            verification: verifyCitation(quote),
            relation,
            attribution: "mapping_pass",
          };
          fieldEvidence.push(item);
        }
      }
    }
    evidence.push(...fieldEvidence);
    for (const item of fieldEvidence) {
      if (item.verification.status !== "verified") reasons.push(`citation_${item.verification.status}`);
    }
    if (!evidenceCollected) reasons.push("evidence_not_collected");
    const evidenceStatus = mappingEvidenceStatus(fieldEvidence, evidenceCollected && sources.length > 0);
    if (
      reference.scope === "lesion" &&
      (reference.field === "sur_prostate_regions" || reference.field === "all_sgm") &&
      marks.some((mark) => mark.status !== "assigned" && mark.candidateLesionIds.includes(reference.lesionId))
    )
      reasons.push("sector_assignment_uncertain");
    const populated = isPopulatedMappingValue(diagnostic.selectedValue);
    const confidence = assessMappingConfidence({
      selectedSupport: diagnostic.selectedSupport,
      comparablePassCount: diagnostic.comparablePassCount,
      totalPassCount: diagnostic.totalPassCount,
      requestedPassCount: input.requestedPassCount,
      evidenceStatus,
      reasonCodes: reasons,
      populated,
    });

    let selectionMethod: MappingFieldAssessment["selectionMethod"] = diagnostic.selectionMethod;
    if (changed) selectionMethod = "sector";

    return {
      reference,
      selectedValue: diagnostic.selectedValue,
      selectedSupport: diagnostic.selectedSupport,
      comparablePassCount: diagnostic.comparablePassCount,
      totalPassCount: diagnostic.totalPassCount,
      requestedPassCount: input.requestedPassCount,
      alternatives: diagnostic.alternatives,
      selectionMethod,
      evidenceStatus,
      confidence: confidence.label,
      reasonCodes: confidence.reasonCodes,
      evidenceIds: fieldEvidence.map((item) => item.id),
    };
  });

  return MappingReview.parse({
    schemaVersion: 1,
    policyVersion: 1,
    mappingIdentity: input.mappingIdentity,
    lesionIds,
    sources,
    assessments,
    evidence,
    marks,
    transformations,
  });
}
