import { z } from "zod";

/** The printed sheet's 40 sectors, in the order the label image numbers them: byte n is options[n - 1]. */
export const SectorId = z.enum([
  "apex_AS_L",
  "apex_AS_R",
  "apex_PZa_L",
  "apex_PZa_R",
  "apex_PZpl_L",
  "apex_PZpl_R",
  "apex_PZpm_L",
  "apex_PZpm_R",
  "apex_TZa_L",
  "apex_TZa_R",
  "apex_TZp_L",
  "apex_TZp_R",
  "base_AS_L",
  "base_AS_R",
  "base_CZ_L",
  "base_CZ_R",
  "base_PZa_L",
  "base_PZa_R",
  "base_PZpl_L",
  "base_PZpl_R",
  "base_PZpm_L",
  "base_PZpm_R",
  "base_TZa_L",
  "base_TZa_R",
  "base_TZp_L",
  "base_TZp_R",
  "mid_AS_L",
  "mid_AS_R",
  "mid_PZa_L",
  "mid_PZa_R",
  "mid_PZpl_L",
  "mid_PZpl_R",
  "mid_PZpm_L",
  "mid_PZpm_R",
  "mid_TZa_L",
  "mid_TZa_R",
  "mid_TZp_L",
  "mid_TZp_R",
  "sv_L",
  "sv_R",
]);
export type SectorId = z.infer<typeof SectorId>;

const Share = z.number().min(0).max(1);

/** One pen mark on the sheet: every sector it touches with how much of the mark lies there and how much
 * of the sector it covers, and the sectors it counts for after the marking thresholds. */
export const SectorFocus = z
  .object({
    sectors: z.array(z.object({ id: SectorId, share: Share, coverage: Share }).readonly()).min(1),
    marked: z.array(SectorId).min(1),
  })
  .readonly();
export type SectorFocus = z.infer<typeof SectorFocus>;

export const SectorMap = z
  .object({
    pages: z.array(z.object({ page: z.int().positive(), foci: z.array(SectorFocus) }).readonly()).min(1),
  })
  .readonly();
export type SectorMap = z.infer<typeof SectorMap>;
