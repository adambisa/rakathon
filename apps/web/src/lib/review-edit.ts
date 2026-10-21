import {
  lesionReviewFields,
  ReviewDraftRecord,
  type ReviewFieldRef,
  type ReviewFieldValue,
  ReviewOperation,
  reviewValueKey,
} from "@prostapaper/contracts";

/** Keep locale parsing at the input boundary; validate actual writes with the shared command schema. */
export function numericReviewInput(text: string): number | null {
  const value = text.trim();
  if (value === "") return null;
  if (!/^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)$/.test(value))
    throw new Error("Zadejte číslo (desetinná čárka je povolena).");

  return Number(value.replace(",", "."));
}
export function fieldOperation(reference: ReviewFieldRef, value: ReviewFieldValue): ReviewOperation {
  if (reference.scope === "collection")
    throw new Error("Počet ložisek se mění přidáním nebo odebráním ložiska.");
  if (reference.scope === "surgery")
    return ReviewOperation.parse({ kind: "update_surgery", changes: { [reference.field]: value } });

  return ReviewOperation.parse({
    kind: "update_lesion",
    lesionId: reference.lesionId,
    changes: { [reference.field]: value },
  });
}
export interface EditorInput {
  reference: ReviewFieldRef;
  validation: string;
  value: ReviewFieldValue;
  clearNodes: boolean;
}
/** Builds the single save operation for an editor, including the lymphadenectomy dependent clear. */
export function editorOperation(input: EditorInput): ReviewOperation {
  let parsed = input.value;
  if (typeof parsed === "string" && ["integer", "number"].includes(input.validation))
    parsed = numericReviewInput(parsed);
  const operation = fieldOperation(input.reference, parsed);
  if (
    operation.kind === "update_surgery" &&
    input.reference.scope === "surgery" &&
    input.reference.field === "lymphadenectomy" &&
    parsed !== "1" &&
    input.clearNodes
  ) {
    operation.changes.node_no_surgery = null;
    operation.changes.node_positive_no_surgery = null;
  }

  return operation;
}
export function fieldChanged(
  fieldName: string,
  original: ReviewFieldValue | undefined,
  current: ReviewFieldValue,
): boolean {
  if (original === undefined) return true;

  return reviewValueKey(fieldName, original) !== reviewValueKey(fieldName, current);
}
export function fieldValueOf(
  record: ReviewDraftRecord,
  lesionIds: readonly string[],
  reference: ReviewFieldRef,
) {
  if (reference.scope === "surgery") return record.surgery[reference.field];
  if (reference.scope === "lesion")
    return record.lesions[lesionIds.indexOf(reference.lesionId)]?.[reference.field];

  return record.lesions.length;
}
export function emptyReviewLesion(): ReviewDraftRecord["lesions"][number] {
  return ReviewDraftRecord.shape.lesions.element.parse(
    Object.fromEntries(
      lesionReviewFields.map(({ name }) => {
        if (name === "all_sgm") return [name, false];
        if (name === "sur_prostate_regions") return [name, []];

        return [name, null];
      }),
    ),
  );
}
