import {
  assessmentConflicts,
  isPopulatedMappingValue,
  lesionCollectionRef,
  type MappingFieldAssessment,
  type MappingReview as MappingReviewType,
  reviewFieldKey,
  type ReviewFieldRef,
  reviewFieldRef,
  type ReviewRecordField,
  reviewRecordFields,
  reviewValidationIssues,
  type SurgeryRecord,
} from "@prostapaper/contracts";

export interface MappingFieldView extends ReviewRecordField {
  assessment: MappingFieldAssessment | undefined;
  fieldName: string;
}

export interface MappingAttentionItem {
  key: string;
  reference: ReviewFieldRef;
  fieldName: string;
  lesionIndex?: number;
  label: string;
  priority: 0 | 1 | 2 | 3;
  order: number;
  message: string;
}

export interface MappingAttention {
  items: MappingAttentionItem[];
  unavailablePopulatedCount: number;
}

export function mappingFieldViews(
  record: SurgeryRecord,
  review: MappingReviewType | null,
  currentLesionIds?: readonly string[],
): MappingFieldView[] {
  const assessments = new Map(review?.assessments.map((item) => [reviewFieldKey(item.reference), item]));
  const lesionIds =
    currentLesionIds ?? review?.lesionIds ?? record.lesions.map((_, index) => `lesion-${index + 1}`);

  return reviewRecordFields(record, lesionIds).map((field) => ({
    ...field,
    assessment: assessments.get(reviewFieldKey(field.reference)),
    fieldName: field.reference.scope === "collection" ? "lesions.length" : field.reference.field,
  }));
}

export function mappingAttentionItems(
  record: SurgeryRecord,
  review: MappingReviewType | null,
  fieldViews: MappingFieldView[] = mappingFieldViews(record, review),
): MappingAttention {
  const fields = fieldViews;
  const items: MappingAttentionItem[] = [];
  const lesionIds = fields.flatMap((field) =>
    field.reference.scope === "lesion" && field.reference.field === "all_sgm"
      ? [field.reference.lesionId]
      : [],
  );
  const fieldByKey = new Map(fields.map((field) => [reviewFieldKey(field.reference), field]));
  for (const issue of reviewValidationIssues(record, lesionIds)) {
    const field = fieldByKey.get(reviewFieldKey(issue.reference));
    const fieldName = issue.reference.scope === "collection" ? "lesions.length" : issue.reference.field;
    const lesionIndex = field?.lesionIndex;
    items.push(
      withLesionIndex(
        {
          key: `validation:${reviewFieldKey(issue.reference)}:${issue.source}:${issue.code}:${issue.message}`,
          reference: issue.reference,
          fieldName,
          label: fieldLabel(field?.definition?.label ?? "Počet ložisek", lesionIndex),
          priority: 0,
          order: fields.findIndex(
            (candidate) => reviewFieldKey(candidate.reference) === reviewFieldKey(issue.reference),
          ),
          message: issue.message,
        },
        lesionIndex,
      ),
    );
  }
  if (review !== null) {
    for (const [markIndex, mark] of review.marks.entries()) {
      if (mark.status === "assigned") continue;
      const candidateIndex = mark.candidateLesionIds
        .map((id) => review.lesionIds.indexOf(id))
        .find((index) => index >= 0);
      let reference: ReviewFieldRef = lesionCollectionRef;
      let fieldName = "lesions.length";
      let lesionIndex: number | undefined;
      if (candidateIndex !== undefined) {
        lesionIndex = candidateIndex;
        const lesionId = review.lesionIds[candidateIndex];
        if (lesionId !== undefined) {
          reference = reviewFieldRef("sur_prostate_regions", lesionId);
          fieldName = "sur_prostate_regions";
        }
      }
      let message = "Nepřiřazená značka na schématu";
      if (mark.status === "ambiguous") message = "Nejednoznačné přiřazení značky";
      const source = review.sources.find((item) => item.documentId === mark.documentId);
      items.push(
        withLesionIndex(
          {
            key: `mark:${mark.id}`,
            reference,
            fieldName,
            label: `Značka ${markIndex + 1} · ${source?.filename ?? "zdroj nedostupný"} · strana ${mark.page}`,
            priority: 1,
            order: (lesionIndex ?? 0) * 100,
            message,
          },
          lesionIndex,
        ),
      );
    }
  }
  let unavailablePopulatedCount = 0;
  for (const field of fields) {
    const assessment = field.assessment;
    const populated = isPopulatedMappingValue(field.value);
    if (assessment === undefined) {
      if (review === null && populated) unavailablePopulatedCount += 1;
      continue;
    }
    const notInstrumented = assessment.reasonCodes.includes("evidence_not_collected");
    if (populated && (notInstrumented || assessment.confidence === "unavailable"))
      unavailablePopulatedCount += 1;
    const priorityOne = assessmentConflicts(assessment);
    if (priorityOne) {
      items.push(
        withLesionIndex(
          {
            key: `confidence:${reviewFieldKey(field.reference)}`,
            reference: field.reference,
            fieldName: field.fieldName,
            label: fieldLabel(field.definition?.label ?? "Počet ložisek", field.lesionIndex),
            priority: 1,
            order: fields.indexOf(field),
            message: confidenceReasonText(assessment.reasonCodes),
          },
          field.lesionIndex,
        ),
      );
      continue;
    }
    if (assessment.confidence === "low" && populated && !notInstrumented) {
      items.push(
        withLesionIndex(
          {
            key: `confidence:${reviewFieldKey(field.reference)}`,
            reference: field.reference,
            fieldName: field.fieldName,
            label: fieldLabel(field.definition?.label ?? "Počet ložisek", field.lesionIndex),
            priority: 2,
            order: fields.indexOf(field),
            message: confidenceReasonText(assessment.reasonCodes),
          },
          field.lesionIndex,
        ),
      );
    } else if (assessment.confidence === "medium" && populated) {
      items.push(
        withLesionIndex(
          {
            key: `confidence:${reviewFieldKey(field.reference)}`,
            reference: field.reference,
            fieldName: field.fieldName,
            label: fieldLabel(field.definition?.label ?? "Počet ložisek", field.lesionIndex),
            priority: 3,
            order: fields.indexOf(field),
            message: "Střední jistota návrhu.",
          },
          field.lesionIndex,
        ),
      );
    }
  }

  return {
    items: items.toSorted((left, right) => left.priority - right.priority || left.order - right.order),
    unavailablePopulatedCount,
  };
}

function withLesionIndex<T extends object>(
  item: T,
  lesionIndex: number | undefined,
): T & { lesionIndex?: number } {
  if (lesionIndex === undefined) return item;

  return { ...item, lesionIndex };
}

function fieldLabel(label: string, lesionIndex: number | undefined): string {
  if (lesionIndex === undefined) return label;

  return `Ložisko ${lesionIndex + 1} · ${label}`;
}

export function confidenceReasonText(reasons: readonly string[]): string {
  const translations: Record<string, string> = {
    pass_disagreement: "Průchody mapování se neshodly.",
    evidence_unavailable: "Zdrojový podklad není k dispozici.",
    evidence_not_collected: "Původ a jistota nebyly pro toto mapování zaznamenány.",
    evidence_unverified: "Citace nebyla ověřena proti uloženému textu.",
    evidence_conflict: "Zdroj obsahuje rozporné podklady.",
    citation_invalid: "Citace neodpovídá uloženému textu.",
    citation_ambiguous: "Text citace se na straně vyskytuje vícekrát bez jednoznačné pozice.",
    citation_unavailable: "Citovaná strana nebo zdroj nejsou k dispozici.",
    incomplete_run: "Některé požadované průchody nedokončily mapování.",
    limited_pass_count: "Byl proveden jen omezený počet průchodů.",
    lesion_count_disagreement: "Průchody se lišily v počtu ložisek.",
    lesion_alignment_uncertain: "Nelze spolehlivě porovnat totožná ložiska mezi průchody.",
    sector_assignment_uncertain: "Přiřazení značky ke konkrétnímu ložisku není jisté.",
    sector_postprocessing: "Hodnota byla upravena podle schématu po hlasování průchodů.",
    repair_uncertainty: "Nejistota opravy jednoho z výstupů mapování.",
    closest_fallback: "Použit nejbližší úplný výstup po neplatném výsledku shody.",
    lesion_fallback: "Pro ložiska byl použit náhradní výstup kvůli nejistému zarovnání.",
    value_absent: "Hodnota chybí; tato jistota se vztahuje jen k návrhu, který existuje.",
    legacy_diagnostics_missing: "Jistota a původ hodnoty nejsou k dispozici.",
    pass_diagnostics_unavailable: "Údaje o průchodech mapování nejsou k dispozici.",
    high_priority_issue: "Hodnota vyžaduje zvláštní pozornost.",
  };

  if (reasons.length === 0) return "Bez dalších upozornění; shoda průchodů není pravděpodobnost správnosti.";

  return reasons.map((reason) => translations[reason] ?? "Další důvod není dostupný.").join(" ");
}
