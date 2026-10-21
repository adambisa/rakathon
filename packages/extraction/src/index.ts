import {
  type DocumentContentType,
  type DocumentKind,
  type DocumentPage,
  ExtractedDocument,
  type SectorFocus,
} from "@prostapaper/contracts";

import { openDocument, rgbPixels } from "#pdf";
import type { PageReader, ReaderLog } from "#reader";
import { describeMarks } from "#sector-marks";
import { SECTOR_SHEET_WIDTH, type SectorSheetDetector } from "#sector-sheet";

export type { PageReader, ReaderLog, ReaderOptions } from "#reader";
export { createPageReader, loadReaderConfig, type ReaderConfig, type ReaderName } from "#readers";
export { describeMarks, type SectorMarks } from "#sector-marks";
export {
  createSectorSheetDetector,
  loadSectorSheetAssets,
  loadSectorSheets,
  type SectorSheetAssets,
  type SectorSheetDetector,
  type SectorSheetMatch,
  type SectorSheetReading,
} from "#sector-sheet";

export interface ExtractionSource {
  bytes: Uint8Array;
  contentType: DocumentContentType;
}

/** Every page of a scan goes to `reader`; the caller owns the reader's lifecycle. */
export async function extractDocument(
  source: ExtractionSource,
  reader: PageReader,
): Promise<ExtractedDocument> {
  const document = openDocument(source.bytes, source.contentType);
  const pages: DocumentPage[] = [];

  const readPage = async (index: number): Promise<void> => {
    const page = document.loadPage(index);
    try {
      pages.push({ page: index + 1, text: await reader.readPage(page), source: reader.source });
    } finally {
      page.destroy();
    }
  };

  try {
    // Pages run in sequence so peak memory stays at one rendered page.
    await Array.from({ length: document.countPages() }, (_, index) => index).reduce(
      async (previous, index) => {
        await previous;
        await readPage(index);
      },
      Promise.resolve(),
    );

    return ExtractedDocument.parse({ pages });
  } finally {
    document.destroy();
  }
}

export function extractSectorSheet(
  source: ExtractionSource,
  detector: SectorSheetDetector,
  log?: ReaderLog,
): ExtractedDocument {
  const document = openDocument(source.bytes, source.contentType);
  const pages: DocumentPage[] = [];
  const sectorPages: { page: number; foci: SectorFocus[] }[] = [];

  try {
    for (let index = 0; index < document.countPages(); index += 1) {
      const page = document.loadPage(index);
      try {
        const started = Date.now();
        const reading = detector.read(rgbPixels(page, SECTOR_SHEET_WIDTH));
        log?.({
          detector: "sector-sheet",
          sheet: reading.sheet,
          page: index + 1,
          sectorSheet: reading.sectorSheet,
          inliers: reading.inliers,
          foci: reading.marks?.foci.length,
          ms: Date.now() - started,
        });
        if (reading.marks === undefined) {
          throw new Error(`Page ${index + 1} is not the sector sheet (${reading.inliers} inliers)`);
        }
        const { foci } = reading.marks;
        pages.push({ page: index + 1, text: describeMarks(foci), source: "opencv" });
        sectorPages.push({ page: index + 1, foci });
      } finally {
        page.destroy();
      }
    }

    return ExtractedDocument.parse({ pages, sectorMap: { pages: sectorPages } });
  } finally {
    document.destroy();
  }
}

export interface ExtractionTools {
  reader: PageReader;
  /** Loaded on first use, so a report never pays for OpenCV. */
  sectorSheet: () => Promise<SectorSheetDetector>;
  log?: ReaderLog | undefined;
}

export type Extractor = (source: ExtractionSource, tools: ExtractionTools) => Promise<ExtractedDocument>;

/** The uploader's kind picks the extractor; adding a kind means adding an entry here and nowhere else. */
export const extractors: Record<DocumentKind, Extractor> = {
  text_description: async (source, { reader }) => extractDocument(source, reader),
  sector_map: async (source, { sectorSheet, log }) => extractSectorSheet(source, await sectorSheet(), log),
};
