import { z } from "zod";

import { redcapSurgicalFields } from "#redcap-schema";
import { LesionFields, SurgeryFields, type SurgeryRecord } from "#surgery";

export const SurgeryFieldName = SurgeryFields.keyof();
export type SurgeryFieldName = z.infer<typeof SurgeryFieldName>;
export const LesionFieldName = LesionFields.keyof();
export type LesionFieldName = z.infer<typeof LesionFieldName>;
export const ReviewLesionId = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value === value.trim(), "Review IDs must not have surrounding whitespace");
export type ReviewLesionId = z.infer<typeof ReviewLesionId>;
export const ReviewMarkId = z
  .string()
  .min(1)
  .max(128)
  .refine((value) => value === value.trim(), "Review IDs must not have surrounding whitespace");
export type ReviewMarkId = z.infer<typeof ReviewMarkId>;

export const reviewSections = [
  { id: "operation", label: "Operace", scope: "surgery" },
  { id: "histology", label: "Histologie", scope: "surgery" },
  { id: "nodes", label: "Uzliny", scope: "surgery" },
  { id: "staging", label: "Staging a klasifikace", scope: "surgery" },
  { id: "lesions", label: "Ložiska", scope: "lesion" },
] as const;

export const SurgeryReviewSectionId = z.enum(["operation", "histology", "nodes", "staging"]);
export type SurgeryReviewSectionId = z.infer<typeof SurgeryReviewSectionId>;
export type ReviewSectionId = SurgeryReviewSectionId | "lesions";
export const ReviewSectionRef = z.union([
  z.strictObject({ scope: z.literal("surgery"), section: SurgeryReviewSectionId }),
  z.strictObject({ scope: z.literal("lesion"), lesionId: ReviewLesionId }),
  z.strictObject({ scope: z.literal("collection"), collection: z.literal("lesions") }),
]);
export type ReviewSectionRef = z.infer<typeof ReviewSectionRef>;

export const ReviewFieldRef = z.union([
  z.strictObject({ scope: z.literal("surgery"), field: SurgeryFieldName }),
  z.strictObject({ scope: z.literal("lesion"), lesionId: ReviewLesionId, field: LesionFieldName }),
  z.strictObject({ scope: z.literal("collection"), collection: z.literal("lesions") }),
]);
export type ReviewFieldRef = z.infer<typeof ReviewFieldRef>;

export interface ReviewField<Name extends string = string> {
  name: Name;
  section: ReviewSectionId;
  label: string;
  metadata: (typeof redcapSurgicalFields)[number];
}

const czechLabels: Record<SurgeryFieldName | LesionFieldName, string> = {
  surgery_date: "Datum operace",
  surgery_type: "Typ operace",
  lymphadenectomy: "Lymfadenektomie",
  node_no_surgery: "Počet vyšetřených uzlin",
  node_positive_no_surgery: "Počet pozitivních uzlin",
  pt_surg: "pT",
  pn_surg: "pN",
  pm_surg: "pM",
  classify_r_surg: "Resekční okraj (R)",
  classify_l_surg: "Lymfatická invaze (L)",
  vascular_inv: "Cévní invaze (V)",
  isup: "Grading ISUP",
  histol_post_surg: "Definitivní histologie (ICD-O)",
  histol_post_surg_specify: "Upřesnění histologie",
  surgery_text: "Histologický nález",
  sur_prostate_regions: "Postižené oblasti prostaty",
  all_sgm: "Postiženy všechny segmenty",
  hist_type_sur: "Typ histologie ložiska",
  lesion_x_mm: "Rozměr ložiska X (mm)",
  lesion_y_mm: "Rozměr ložiska Y (mm)",
  lesion_z_mm: "Rozměr ložiska Z (mm)",
  extracaps_ext: "Extraprostatická extenze",
  perineural_inv_sur: "Perineurální invaze",
  gleason_prim_grade: "Primární Gleasonovo skóre",
  gleason_prim_perc: "Primární Gleasonovo skóre (%)",
  gleason_sec_grade: "Sekundární Gleasonovo skóre",
  gleason_sec_perc: "Sekundární Gleasonovo skóre (%)",
  gleason_tert_grade: "Terciární Gleasonovo skóre",
  gleason_tert_perc: "Terciární Gleasonovo skóre (%)",
};

const surgeryGroups: readonly (readonly [SurgeryReviewSectionId, readonly SurgeryFieldName[]])[] = [
  ["operation", ["surgery_date", "surgery_type"]],
  ["histology", ["histol_post_surg", "histol_post_surg_specify", "isup", "surgery_text"]],
  ["nodes", ["lymphadenectomy", "node_no_surgery", "node_positive_no_surgery"]],
  ["staging", ["pt_surg", "pn_surg", "pm_surg", "classify_r_surg", "classify_l_surg", "vascular_inv"]],
];
const lesionNames: readonly LesionFieldName[] = [
  "sur_prostate_regions",
  "all_sgm",
  "hist_type_sur",
  "lesion_x_mm",
  "lesion_y_mm",
  "lesion_z_mm",
  "extracaps_ext",
  "perineural_inv_sur",
  "gleason_prim_grade",
  "gleason_prim_perc",
  "gleason_sec_grade",
  "gleason_sec_perc",
  "gleason_tert_grade",
  "gleason_tert_perc",
];

function field<Name extends SurgeryFieldName | LesionFieldName>(
  name: Name,
  section: ReviewSectionId,
): ReviewField<Name> {
  const metadata = redcapSurgicalFields.find((item) => item.name === name);
  if (!metadata) throw new Error(`Missing REDCap metadata for review field ${name}`);

  return { name, section, label: czechLabels[name], metadata };
}

export const surgeryReviewFields: ReviewField<SurgeryFieldName>[] = surgeryGroups.flatMap(
  ([section, names]) => names.map((name) => field(name, section)),
);
export const lesionReviewFields: ReviewField<LesionFieldName>[] = lesionNames.map((name) =>
  field(name, "lesions"),
);
export const reviewFieldRegistry = [...surgeryReviewFields, ...lesionReviewFields] as const;
export const lesionCollectionRef: ReviewFieldRef = { scope: "collection", collection: "lesions" };

export function reviewFieldRef(fieldName: SurgeryFieldName): ReviewFieldRef;
export function reviewFieldRef(fieldName: LesionFieldName, lesionId: ReviewLesionId): ReviewFieldRef;
export function reviewFieldRef(fieldName: string, lesionId?: string): ReviewFieldRef {
  if (lesionId === undefined) return ReviewFieldRef.parse({ scope: "surgery", field: fieldName });

  return ReviewFieldRef.parse({ scope: "lesion", lesionId, field: fieldName });
}

export type ReviewFieldValue = string | number | boolean | null | string[];

export interface ReviewRecordField {
  reference: ReviewFieldRef;
  value: ReviewFieldValue;
  definition: ReviewField | null;
  lesionIndex?: number;
}

/** A stable identity key for a typed field reference, independent of object property order. */
export function reviewFieldKey(reference: ReviewFieldRef): string {
  if (reference.scope === "surgery") return JSON.stringify([reference.scope, reference.field]);
  if (reference.scope === "lesion")
    return JSON.stringify([reference.scope, reference.lesionId, reference.field]);

  return JSON.stringify([reference.scope, reference.collection]);
}

/** The single current-schema field enumeration, in visible form order, including derived lesion count. */
export function reviewRecordFields(record: SurgeryRecord, lesionIds: readonly string[]): ReviewRecordField[] {
  if (lesionIds.length !== record.lesions.length || new Set(lesionIds).size !== lesionIds.length) {
    throw new Error("Every lesion requires a unique stable review ID");
  }
  const fields: ReviewRecordField[] = surgeryReviewFields.map((definition) => ({
    reference: reviewFieldRef(definition.name),
    value: record.surgery[definition.name],
    definition,
  }));
  fields.push({ reference: lesionCollectionRef, value: record.lesions.length, definition: null });
  for (const [index, lesion] of record.lesions.entries()) {
    const lesionId = ReviewLesionId.parse(lesionIds[index]);
    fields.push(
      ...lesionReviewFields.map((definition) => ({
        reference: reviewFieldRef(definition.name, lesionId),
        value: lesion[definition.name],
        definition,
        lesionIndex: index,
      })),
    );
  }

  return fields;
}

/** Clinical field equality: region order is immaterial; all other current fields are scalars. */
export function reviewValueKey(fieldName: string, value: z.infer<ReturnType<typeof z.json>>): string {
  if (fieldName === "sur_prostate_regions" && Array.isArray(value))
    return JSON.stringify(
      value.toSorted((left, right) => {
        const a = JSON.stringify(left);
        const b = JSON.stringify(right);
        if (a < b) return -1;
        if (a > b) return 1;

        return 0;
      }),
    );

  return JSON.stringify(value);
}

/** Stable section identity shared by workflow and UI. */
export function reviewSectionKey(reference: ReviewSectionRef): string {
  if (reference.scope === "surgery") return JSON.stringify([reference.scope, reference.section]);
  if (reference.scope === "lesion") return JSON.stringify([reference.scope, reference.lesionId]);

  return JSON.stringify([reference.scope, reference.collection]);
}
