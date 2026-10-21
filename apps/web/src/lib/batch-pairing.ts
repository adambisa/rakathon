import type { DocumentKind } from "@prostapaper/contracts";

import { fileBasename, fileKey } from "#lib/file-key";

export type Staged = Record<DocumentKind | "unknown", File[]>;

export const EMPTY_STAGED: Staged = { text_description: [], sector_map: [], unknown: [] };

export function mergeStaged(current: Staged, incoming: Staged): Staged {
  const known = new Set(Object.values(current).flat().map(fileKey));
  const merged = (kind: keyof Staged) => [
    ...current[kind],
    ...incoming[kind].filter((file) => !known.has(fileKey(file))),
  ];

  return {
    text_description: merged("text_description"),
    sector_map: merged("sector_map"),
    unknown: merged("unknown"),
  };
}

export function unstage(current: Staged, files: readonly (File | undefined)[]): Staged {
  const gone = new Set(files.filter((file) => file !== undefined).map(fileKey));
  const kept = (kind: keyof Staged) => current[kind].filter((file) => !gone.has(fileKey(file)));

  return {
    text_description: kept("text_description"),
    sector_map: kept("sector_map"),
    unknown: kept("unknown"),
  };
}

export interface BatchCase {
  stem: string;
  name: string;
  report: File;
  sheet: File | undefined;
}

export type PairingIssue = "orphan" | "duplicate" | "unknown";

export interface BatchPairing {
  /** One entry per report, sorted by stem. */
  cases: BatchCase[];
  problems: { file: File; issue: PairingIssue }[];
}

const TRAILING_NUMBER = /(\d+)(?:\s*\(\d+\))?$/u;
const SHEET_WORDS = /sch[eé]ma|sector|sektor|\bmapa?\b/iu;
const REPORT_WORDS = /report|scan|sken|n[aá]lez|popis|text/iu;

const basename = (filename: string) => fileBasename(filename.normalize("NFC"));

/** `Scan_0005.jpg`, `schema-5.jpg` and `Scan_0005 (1).jpg` share stem `5`; a name without a number is its own stem. */
export function caseStem(filename: string): string {
  const name = basename(filename);
  const digits = TRAILING_NUMBER.exec(name)?.[1];
  if (digits === undefined) return name;

  return String(Number(digits));
}

export function caseName(stem: string): string {
  if (/^\d+$/u.test(stem)) return `Rakathon ${stem}`;

  return stem;
}

export function slotOf(filename: string): DocumentKind | undefined {
  const name = basename(filename);
  if (SHEET_WORDS.test(name)) return "sector_map";
  if (REPORT_WORDS.test(name)) return "text_description";

  return undefined;
}

export function sortFiles(files: readonly File[]): Staged {
  const sorted: Staged = { text_description: [], sector_map: [], unknown: [] };
  for (const file of files) sorted[slotOf(file.name) ?? "unknown"].push(file);

  return sorted;
}

/** The names in `names` were typed by the user and win over the ones derived from the stems. */
export function pairFiles(staged: Staged, names: Readonly<Record<string, string>> = {}): BatchPairing {
  const problems: BatchPairing["problems"] = [];
  const byStem = (files: File[]) => {
    const map = new Map<string, File>();
    for (const file of files) {
      const stem = caseStem(file.name);
      if (map.has(stem)) problems.push({ file, issue: "duplicate" });
      else map.set(stem, file);
    }

    return map;
  };
  const reports = byStem(staged.text_description);
  const sheets = byStem(staged.sector_map);
  const cases = [...reports]
    .map(([stem, report]) => ({ stem, name: names[stem] ?? caseName(stem), report, sheet: sheets.get(stem) }))
    .toSorted((a, b) => a.stem.localeCompare(b.stem, "cs", { numeric: true }));
  for (const [stem, file] of sheets) if (!reports.has(stem)) problems.push({ file, issue: "orphan" });
  for (const file of staged.unknown) problems.push({ file, issue: "unknown" });

  return { cases, problems };
}

export function isSubmittable({ cases, problems }: BatchPairing): boolean {
  return cases.length > 0 && problems.length === 0 && cases.every(({ name }) => name.trim() !== "");
}
