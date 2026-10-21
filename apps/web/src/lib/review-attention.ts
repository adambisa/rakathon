import { reviewFieldKey, type ReviewWorkspace } from "@prostapaper/contracts";

import { formatMarkLabel } from "#lib/mapping-format";
import { type MappingAttention, mappingAttentionItems, type MappingFieldView } from "#lib/mapping-review";

/** Current worklist: model evidence informs priority, server bindings decide what remains unresolved. */
export function reviewAttention(workspace: ReviewWorkspace, fields: MappingFieldView[]): MappingAttention {
  const attention = mappingAttentionItems(workspace.record, workspace.evidence, fields);
  const requirements = new Map(
    workspace.workflowStatus.fields.map((field) => [reviewFieldKey(field.reference), field]),
  );
  attention.items = attention.items.filter(
    (item) =>
      !item.key.startsWith("mark:") &&
      (!item.key.startsWith("confidence:") ||
        !(requirements.get(reviewFieldKey(item.reference))?.resolved ?? false)),
  );
  for (const requirement of requirements.values()) {
    if (!requirement.decisionRequired || requirement.resolved) continue;
    const key = reviewFieldKey(requirement.reference);
    if (attention.items.some((item) => reviewFieldKey(item.reference) === key)) continue;
    const field = fields.find((item) => reviewFieldKey(item.reference) === key);
    if (field === undefined) continue;
    let label = field.definition?.label ?? "Počet ložisek";
    if (field.lesionIndex !== undefined) label = `Ložisko ${field.lesionIndex + 1} · ${label}`;
    attention.items.push({
      key: `decision:${key}`,
      reference: requirement.reference,
      fieldName: field.fieldName,
      ...indexProperty(field.lesionIndex),
      label,
      priority: 2,
      order: fields.indexOf(field),
      message: "Vyžaduje samostatnou lidskou kontrolu a rozhodnutí.",
    });
  }
  for (const [index, mark] of workspace.marks.entries()) {
    if (mark.status === "assigned" || mark.status === "dismissed") continue;
    const field =
      fields.find(
        (item) =>
          item.reference.scope === "lesion" &&
          item.reference.field === "sur_prostate_regions" &&
          mark.source.candidateLesionIds.includes(item.reference.lesionId),
      ) ?? fields.find((item) => item.reference.scope === "collection");
    if (field === undefined) continue;
    const source = workspace.evidence?.sources.find((source) => source.documentId === mark.source.documentId);
    attention.items.push({
      key: `mark:${mark.source.id}`,
      reference: field.reference,
      fieldName: field.fieldName,
      ...indexProperty(field.lesionIndex),
      label: `${formatMarkLabel(index)} · ${source?.filename ?? "Schéma"} · strana ${mark.source.page}`,
      priority: 1,
      order: fields.indexOf(field),
      message: "Značka vyžaduje přiřazení nebo odmítnutí s odůvodněním.",
    });
  }
  attention.items.sort((a, b) => a.priority - b.priority || a.order - b.order);

  return attention;
}
function indexProperty(index: number | undefined): { lesionIndex?: number } {
  if (index === undefined) return {};

  return { lesionIndex: index };
}
