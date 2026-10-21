import { DocumentKind, type ExtractedDocument, regionFromSectorId } from "@prostapaper/contracts";

export interface CaseDocumentText {
  documentId?: string | undefined;
  sourceVersion?: string | undefined;
  extractionIdentity?: string | undefined;
  filename: string;
  kind: DocumentKind;
  extracted: ExtractedDocument;
}

const LABELS: Record<DocumentKind, string> = {
  text_description: "textový popis",
  sector_map: "sektorová mapa",
};

const SECTOR_MAP_HEADING = "[Sektorová mapa, strojově přečtená: značky lokalizují ložiska popsaná v textu]";

const heading = (kind: DocumentKind, position: number, filename: string): string =>
  `=== Dokument ${position} (${LABELS[kind]}): ${filename} ===`;

/** The sheet goes to the model as structured marks in the record's own vocabulary, never as prose. */
function sectorMapBlock(extracted: ExtractedDocument): string[] {
  const marks = (extracted.sectorMap?.pages ?? []).flatMap((page) => page.foci);
  if (marks.length === 0) {
    return [];
  }
  const lines = marks.map((focus, index) => {
    const figures = new Map(focus.sectors.map((sector) => [sector.id, sector]));
    const sectors = focus.marked.map((id) => ({
      id: regionFromSectorId(id),
      share: figures.get(id)?.share ?? null,
      coverage: figures.get(id)?.coverage ?? null,
    }));

    return `značka ${index + 1}: ${JSON.stringify(sectors)}`;
  });

  return [[SECTOR_MAP_HEADING, ...lines].join("\n")];
}

/** One prompt input per case: the textual description before the sector map, each page in reading order. */
export function assembleCaseText(
  documents: readonly CaseDocumentText[],
  options: { citations?: boolean | undefined } = {},
): string {
  return documents
    .toSorted(
      (left, right) => DocumentKind.options.indexOf(left.kind) - DocumentKind.options.indexOf(right.kind),
    )
    .map(({ filename, kind, extracted, documentId, extractionIdentity }, index) => {
      let body = sectorMapBlock(extracted);
      if (extracted.sectorMap === undefined) {
        body = extracted.pages.flatMap((page) => {
          if (page.text.trim() === "") return [];
          if (options.citations === true && documentId !== undefined && extractionIdentity !== undefined) {
            return [
              `[document=${JSON.stringify(documentId)} extraction=${JSON.stringify(extractionIdentity)} page=${page.page}]\n${page.text}`,
            ];
          }

          return [page.text.trim()];
        });
      }

      return [heading(kind, index + 1, filename), ...body].join("\n\n");
    })
    .join("\n\n");
}
