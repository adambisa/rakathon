import { z } from "zod";

import type { SectorId, SectorMap } from "#sector";
import type { SurgeryRecord } from "#surgery";

/** REDCap's `sur_prostate_regions` checkbox codes (project 64): the sheet's 40 sectors plus the urethra.
 * Each lesion row ticks `sur_prostate_regions___<code>` with "1". */
export const RegionCode = z.enum([
  "as_apex_rs",
  "as_apex_ls",
  "pza_apex_rs",
  "pza_apex_ls",
  "pzpl_apex_rs",
  "pzpl_apex_ls",
  "pzpm_apex_rs",
  "pzpm_apex_ls",
  "tza_apex_rs",
  "tza_apex_ls",
  "tzp_apex_rs",
  "tzp_apex_ls",
  "as_mid_rs",
  "as_mid_ls",
  "pza_mid_rs",
  "pza_mid_ls",
  "pzpl_mid_rs",
  "pzpl_mid_ls",
  "pzpm_mid_rs",
  "pzpm_mid_ls",
  "tza_mid_rs",
  "tza_mid_ls",
  "tzp_mid_rs",
  "tzp_mid_ls",
  "as_base_rs",
  "as_base_ls",
  "cz_base_rs",
  "cz_base_ls",
  "pza_base_rs",
  "pza_base_ls",
  "pzpl_base_rs",
  "pzpl_base_ls",
  "pzpm_base_rs",
  "pzpm_base_ls",
  "tza_base_rs",
  "tza_base_ls",
  "tzp_base_rs",
  "tzp_base_ls",
  "sv_base_rs",
  "sv_base_ls",
  "urethra",
]);
export type RegionCode = z.infer<typeof RegionCode>;

const REGION_FIELD_PREFIX = "sur_prostate_regions___";
const LESION_INSTRUMENT = "surgery_c61_resected_lesion";

const REGION_ZONES: Record<string, string> = {
  AS: "as",
  CZ: "cz",
  PZa: "pza",
  PZpl: "pzpl",
  PZpm: "pzpm",
  TZa: "tza",
  TZp: "tzp",
};

export const regionFromSectorId = (id: SectorId): RegionCode => {
  const parts = id.split("_");
  if (parts[0] === "sv") return RegionCode.parse(`sv_base_${parts[1] === "L" ? "ls" : "rs"}`);
  const [level, zone, side] = parts;

  return RegionCode.parse(`${REGION_ZONES[zone ?? ""]}_${level}_${side === "L" ? "ls" : "rs"}`);
};

/** Where one lesion lies. `marked` counts for REDCap; `candidates` are places it may also lie that do not
 * count: sheet sectors the mark only grazed, or every sector a partial record location could mean. */
export interface SectorLesion {
  readonly marked: readonly RegionCode[];
  readonly candidates: readonly RegionCode[];
  readonly detail: Readonly<
    Partial<Record<RegionCode, { readonly share: number; readonly coverage: number }>>
  >;
  readonly gradeGroup: number | null;
}

export const lesionsFromSectorMap = (map: SectorMap): SectorLesion[] =>
  map.pages.flatMap(({ foci }) =>
    foci.map((focus) => {
      const marked = focus.marked.map(regionFromSectorId);
      const touched = focus.sectors.map(
        ({ id, share, coverage }) => [regionFromSectorId(id), { share, coverage }] as const,
      );

      return {
        marked,
        candidates: touched.map(([code]) => code).filter((code) => !marked.includes(code)),
        detail: Object.fromEntries(touched),
        gradeGroup: null,
      };
    }),
  );

export const lesionsFromRecord = (record: SurgeryRecord): SectorLesion[] =>
  record.lesions.map((lesion) => ({
    marked: lesion.sur_prostate_regions,
    candidates: [],
    detail: {},
    gradeGroup: null,
  }));

/** Lesion rows of a REDCap export or import, in their given order; other instruments are skipped. */
export const lesionsFromRedcapRows = (rows: readonly Readonly<Record<string, string>>[]): SectorLesion[] =>
  rows
    .filter((row) => row["redcap_repeat_instrument"] === LESION_INSTRUMENT)
    .map((row) => ({
      marked: RegionCode.options.filter((code) => row[`${REGION_FIELD_PREFIX}${code}`] === "1"),
      candidates: [],
      detail: {},
      gradeGroup: null,
    }));
