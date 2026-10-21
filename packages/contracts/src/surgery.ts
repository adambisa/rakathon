import { z } from "zod";

import { redcapAllSegmentRegions, redcapSurgicalFields } from "#redcap-schema";
import { RegionCode } from "#region";

type Field = (typeof redcapSurgicalFields)[number];
type ChoiceCode<Name extends Field["name"]> = Extract<Field, { name: Name }>["choices"][number]["code"];

function choice<Name extends Field["name"]>(name: Name) {
  const field = redcapSurgicalFields.find((field) => field.name === name);
  if (field === undefined || field.choices.length === 0) throw new Error(`No choices for ${name}`);

  return z.enum(field.choices.map((item) => item.code) as ChoiceCode<Name>[]).nullable();
}

function count(name: "node_no_surgery" | "node_positive_no_surgery") {
  const field = redcapSurgicalFields.find((field) => field.name === name);
  const maximum = Number(field?.max);
  const schema = z.int().nonnegative();

  if (Number.isFinite(maximum)) return schema.max(maximum).nullable();

  return schema.nullable();
}

const SurgeryDate = z.iso
  .date()
  .refine((value) => {
    const minimum = redcapSurgicalFields.find((field) => field.name === "surgery_date")?.min;
    const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Prague" }).format(new Date());

    return minimum !== undefined && value >= minimum && value <= today;
  }, "Surgery date must be within dictionary bounds")
  .nullable();
const Millimetres = z.number().min(0).max(100).nullable();
const Percent = z.number().min(0).max(100).nullable();

export const SurgeryFields = z.object({
  surgery_date: z.iso.date().nullable(),
  surgery_type: choice("surgery_type"),
  lymphadenectomy: choice("lymphadenectomy"),
  node_no_surgery: z.int().nonnegative().nullable(),
  node_positive_no_surgery: z.int().nonnegative().nullable(),
  pt_surg: choice("pt_surg"),
  pn_surg: choice("pn_surg"),
  pm_surg: choice("pm_surg"),
  classify_r_surg: choice("classify_r_surg"),
  classify_l_surg: choice("classify_l_surg"),
  vascular_inv: choice("vascular_inv"),
  isup: choice("isup"),
  histol_post_surg: choice("histol_post_surg"),
  histol_post_surg_specify: z.string().nullable(),
  surgery_text: z.string().nullable(),
});

// Legacy parent edits remain bounded; stored parent data is outside the lesion review scope.
export const ReviewSurgeryFields = z.strictObject({
  ...SurgeryFields.shape,
  surgery_date: SurgeryDate,
  node_no_surgery: count("node_no_surgery"),
  node_positive_no_surgery: count("node_positive_no_surgery"),
  histol_post_surg_specify: z.string().max(1000).nullable(),
  surgery_text: z.string().max(20_000).nullable(),
});

export const LesionFields = z.object({
  sur_prostate_regions: z.array(RegionCode),
  all_sgm: z.boolean(),
  hist_type_sur: choice("hist_type_sur"),
  lesion_x_mm: Millimetres,
  lesion_y_mm: Millimetres,
  lesion_z_mm: Millimetres,
  extracaps_ext: choice("extracaps_ext"),
  perineural_inv_sur: choice("perineural_inv_sur"),
  gleason_prim_grade: choice("gleason_prim_grade"),
  gleason_prim_perc: Percent,
  gleason_sec_grade: choice("gleason_sec_grade"),
  gleason_sec_perc: Percent,
  gleason_tert_grade: choice("gleason_tert_grade"),
  gleason_tert_perc: Percent,
});

// Drafts enforce individual fields while allowing edits across dependent fields in separate saves.
// Unknown fields are rejected rather than silently lost in the review workspace.
export const ReviewDraftRecord = z.strictObject({
  surgery: z.strictObject(SurgeryFields.shape),
  lesions: z.array(z.strictObject(LesionFields.shape)).max(100),
});
export type ReviewDraftRecord = z.infer<typeof ReviewDraftRecord>;

export const SurgeryRecord = z.object({
  surgery: SurgeryFields.refine(
    ({ lymphadenectomy, node_no_surgery, node_positive_no_surgery }) =>
      lymphadenectomy === "1" || (node_no_surgery === null && node_positive_no_surgery === null),
    { message: "Node counts require lymphadenectomy", path: ["lymphadenectomy"] },
  ).refine(
    ({ node_no_surgery, node_positive_no_surgery }) =>
      node_no_surgery === null ||
      node_positive_no_surgery === null ||
      node_positive_no_surgery <= node_no_surgery,
    { message: "Positive nodes cannot exceed nodes examined", path: ["node_positive_no_surgery"] },
  ),
  lesions: z.array(
    LesionFields.superRefine((lesion, context) => {
      let total = 0;
      for (const part of ["prim", "sec", "tert"] as const) {
        const percent = lesion[`gleason_${part}_perc`];
        if (percent === null) continue;
        total += percent;
        if (lesion[`gleason_${part}_grade`] === null) {
          context.addIssue({
            code: "custom",
            message: "Gleason percentage requires its grade",
            path: [`gleason_${part}_perc`],
          });
        }
      }
      if (total > 100)
        context.addIssue({
          code: "custom",
          message: "Gleason percentages cannot exceed 100",
          path: ["gleason_prim_perc"],
        });
      const regions = new Set(lesion.sur_prostate_regions);
      if (
        lesion.all_sgm &&
        (regions.size !== redcapAllSegmentRegions.length ||
          !redcapAllSegmentRegions.every((region) => regions.has(region)))
      ) {
        context.addIssue({
          code: "custom",
          message: "All segments requires exactly the annotated regions",
          path: ["sur_prostate_regions"],
        });
      }
    }),
  ),
});
export type SurgeryRecord = z.infer<typeof SurgeryRecord>;

export const MappingOutput = z
  .object({
    record: SurgeryRecord,
    diagnostics: z.record(z.string(), z.unknown()).optional(),
  })
  .readonly();
export type MappingOutput = z.infer<typeof MappingOutput>;
