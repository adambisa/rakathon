import {
  type DocumentKind,
  type ExtractedDocument,
  type RegionCode,
  regionFromSectorId,
  type SurgeryRecord,
} from "@prostapaper/contracts";

export interface SectorMapSource {
  kind: DocumentKind;
  extracted: ExtractedDocument;
}

export function sectorMapMarks(documents: readonly SectorMapSource[]): RegionCode[][] {
  return documents
    .filter((document) => document.kind === "sector_map")
    .flatMap((document) => document.extracted.sectorMap?.pages ?? [])
    .flatMap((page) => page.foci)
    .map((focus) => focus.marked.map(regionFromSectorId));
}

export interface SectorMapApplied {
  record: SurgeryRecord;
  regionsAdded: number;
  unplacedRegions: RegionCode[];
}

export function applySectorMap(record: SurgeryRecord, marks: readonly RegionCode[][]): SectorMapApplied {
  const marked = [...new Set(marks.flat())];
  const [only] = record.lesions;
  if (only !== undefined && record.lesions.length === 1) {
    const missing = marked.filter((region) => !only.sur_prostate_regions.includes(region));
    const regions = [...only.sur_prostate_regions, ...missing];

    return {
      record: {
        ...record,
        lesions: [
          { ...only, sur_prostate_regions: regions, all_sgm: only.all_sgm && !regions.includes("urethra") },
        ],
      },
      regionsAdded: missing.length,
      unplacedRegions: [],
    };
  }
  const placed = new Set(record.lesions.flatMap((lesion) => lesion.sur_prostate_regions));

  return { record, regionsAdded: 0, unplacedRegions: marked.filter((region) => !placed.has(region)) };
}
