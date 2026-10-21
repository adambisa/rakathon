import type { RegionCode, SectorLesion } from "@prostapaper/contracts";

export type SectorTone = "marked" | "candidate" | "none";

/** How one region looks across every focus: marked, possibly involved but not counted, or clear. */
export interface SectorPaint {
  tone: SectorTone;
  detail: string;
}

const NBSP = String.fromCodePoint(0xa0);
const percent = (share: number) => `${Math.round(Math.min(share, 1) * 100)}${NBSP}%`;

export function sectorPaint(lesions: readonly SectorLesion[], code: RegionCode): SectorPaint {
  let tone: SectorTone = "none";
  let detail = "bez nálezu";
  if (lesions.some((lesion) => lesion.marked.includes(code))) {
    tone = "marked";
    detail = "vyznačeno";
  } else if (lesions.some((lesion) => lesion.candidates.includes(code))) {
    tone = "candidate";
    detail = "možná, nezapočteno";
  }
  const coverage = lesions.reduce((sum, lesion) => sum + (lesion.detail[code]?.coverage ?? 0), 0);
  if (coverage > 0) detail += `, pokrytí ${percent(coverage)}`;

  return { tone, detail };
}
