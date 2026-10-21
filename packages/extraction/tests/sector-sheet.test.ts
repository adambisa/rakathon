import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { ExtractedDocument, SectorId } from "@prostapaper/contracts";

import { extractors, type PageReader } from "#index";
import { loadOpenCv } from "#opencv";
import { type GrayImage, grayPixels, openDocument, type RgbImage, rgbPixels } from "#pdf";
import { createSectorSheetDetector, loadSectorSheetAssets, SECTOR_SHEET_WIDTH } from "#sector-sheet";
import { jpeg, settled } from "#tests/fixtures";
import { capture, CZECH_SHEET, PEN } from "#tests/sheet-captures";

const czechTemplates = fileURLToPath(new URL("fixtures/czech", import.meta.url));
const settingsPath = fileURLToPath(new URL("../templates/sector-sheet.json", import.meta.url));
const unusedReader: PageReader = {
  source: "ocr",
  readPage: async () => {
    await settled(undefined);
    throw new Error("the sector sheet never reads text");
  },
};
const markedPath = fileURLToPath(new URL("fixtures/sector-sheet-marked.jpg", import.meta.url));

async function gray(bytes: Uint8Array, contentType: "image/jpeg"): Promise<GrayImage> {
  const document = openDocument(bytes, contentType);
  const page = document.loadPage(0);
  try {
    return await settled(grayPixels(page, SECTOR_SHEET_WIDTH));
  } finally {
    page.destroy();
    document.destroy();
  }
}

/** Rotates and scales about the centre on a white background, like a crooked scan. */
async function crooked(image: GrayImage, degrees: number, scale: number): Promise<GrayImage> {
  const cv = await loadOpenCv();
  const source = cv.matFromArray(image.height, image.width, cv.CV_8UC1, image.data);
  const transform = cv.getRotationMatrix2D(new cv.Point(image.width / 2, image.height / 2), degrees, scale);
  const target = new cv.Mat();
  try {
    const size = new cv.Size(image.width, image.height);
    cv.warpAffine(
      source,
      target,
      transform,
      size,
      cv.INTER_LINEAR as number,
      cv.BORDER_CONSTANT as number,
      new cv.Scalar(255),
    );

    return { width: target.cols, height: target.rows, data: new Uint8Array(target.data) };
  } finally {
    source.delete();
    transform.delete();
    target.delete();
  }
}

const detector = await createSectorSheetDetector(
  await loadSectorSheetAssets(czechTemplates, CZECH_SHEET, settingsPath),
);
const marked = await gray(await readFile(markedPath), "image/jpeg");

await test("a hand-marked sector sheet is recognised", () => {
  const match = detector.detect(marked);

  assert.equal(match.sectorSheet, true);
  assert.ok(match.inliers >= 40, `inliers ${match.inliers}`);
});

await test("a rotated and shrunken scan of the sheet is still recognised", async () => {
  const match = detector.detect(await crooked(marked, -15, 0.85));

  assert.equal(match.sectorSheet, true);
});

await test("a text page is not a sector sheet", async () => {
  const lines = Array.from({ length: 20 }, (_, index) => `Mikroskopicky: acinarni adenokarcinom ${index}`);
  const match = detector.detect(await gray(await jpeg(lines), "image/jpeg"));

  assert.equal(match.sectorSheet, false);
});

await test("a blank page is not a sector sheet", () => {
  const blank = { width: 800, height: 1200, data: new Uint8Array(800 * 1200).fill(255) };

  assert.deepEqual(detector.detect(blank), {
    sheet: CZECH_SHEET.sheet,
    sectorSheet: false,
    goodMatches: 0,
    inliers: 0,
  });
});

await test("the marks on the example sheet map to their sectors", async () => {
  const document = openDocument(await readFile(markedPath), "image/jpeg");
  const page = document.loadPage(0);
  try {
    const reading = detector.read(rgbPixels(page, SECTOR_SHEET_WIDTH));

    const { sectorSheet, marks } = reading;
    assert.equal(sectorSheet, true);
    assert.ok(marks);
    assert.deepEqual(
      marks.foci.map((focus) => focus.marked),
      [["base_PZpl_L"], ["sv_L"]],
    );
  } finally {
    page.destroy();
    document.destroy();
  }
});

/** The blank form with one solid blue lesion drawn on it, at the working width. */
async function withLesion(lesion: { x: number; y: number; rx: number; ry: number }): Promise<RgbImage> {
  const document = openDocument(await readFile(join(czechTemplates, CZECH_SHEET.template)), "image/jpeg");
  const page = document.loadPage(0);
  const cv = await loadOpenCv();
  try {
    const blank = rgbPixels(page, SECTOR_SHEET_WIDTH);
    const sheet = cv.matFromArray(blank.height, blank.width, cv.CV_8UC3, blank.data);
    try {
      const { x, y, rx, ry } = lesion;
      cv.ellipse(sheet, new cv.Point(x, y), new cv.Size(rx, ry), 0, 0, 360, new cv.Scalar(25, 45, 160), -1);

      return { width: blank.width, height: blank.height, data: new Uint8Array(sheet.data) };
    } finally {
      sheet.delete();
    }
  } finally {
    page.destroy();
    document.destroy();
  }
}

await test("a lesion spread over the whole apex marks each sector it covers", async () => {
  const { marks } = detector.read(await withLesion({ x: 391, y: 1023, rx: 166, ry: 91 }));

  assert.ok(marks);
  const marked = marks.foci.flatMap((focus) => focus.marked);
  assert.ok(
    marked.every((name) => name.startsWith("apex_")),
    marked.join(", "),
  );
  for (const sector of ["PZa_R", "PZa_L", "PZpm_R", "PZpm_L", "PZpl_R", "PZpl_L"]) {
    assert.ok(marked.includes(SectorId.parse(`apex_${sector}`)), sector);
  }
});

await test("a lesion over the left half of the base marks the left sectors it covers", async () => {
  const { marks } = detector.read(await withLesion({ x: 524, y: 432, rx: 125, ry: 125 }));

  assert.ok(marks);
  const marked = marks.foci.flatMap((focus) => focus.marked);
  assert.ok(
    marked.every((name) => name.startsWith("base_") && name.endsWith("_L")),
    marked.join(", "),
  );
  for (const zone of ["PZa", "PZpl", "TZa", "CZ"])
    assert.ok(marked.includes(SectorId.parse(`base_${zone}_L`)), zone);
});

await test("a phone photo on grey, unevenly lit paper reads the same marks as a clean scan", async () => {
  const { marks } = detector.read(
    await capture(czechTemplates, "phone photo", [
      { x: 700, y: 600, rx: 45, ry: 38, colour: PEN.blue, hatched: true },
      { x: 380, y: 835, rx: 32, ry: 26, colour: PEN.red },
    ]),
  );

  assert.deepEqual(
    marks?.foci.flatMap((focus) => focus.marked),
    ["base_PZpl_L", "mid_TZa_R"],
  );
});

await test("a one-bit dithered fax does not read the form's grey zones as marks", async () => {
  const { marks } = detector.read(
    await capture(czechTemplates, "dithered fax", [
      { x: 700, y: 600, rx: 45, ry: 38, colour: PEN.blue, hatched: true },
    ]),
  );

  assert.deepEqual(
    marks?.foci.flatMap((focus) => focus.marked),
    ["base_PZpl_L"],
  );
});

await test("yellow carbon-copy paper is not read as coloured ink", async () => {
  const { marks } = detector.read(
    await capture(czechTemplates, "yellow copy paper", [
      { x: 700, y: 600, rx: 45, ry: 38, colour: PEN.black, hatched: true },
    ]),
  );

  assert.deepEqual(
    marks?.foci.flatMap((focus) => focus.marked),
    ["base_PZpl_L"],
  );
});

await test("a sector sheet is read by OpenCV alone: one focus per pen mark, sectors in the shared vocabulary", async () => {
  const logged: Record<string, unknown>[] = [];
  const extracted = await extractors.sector_map(
    { bytes: await readFile(markedPath), contentType: "image/jpeg" },
    {
      reader: unusedReader,
      sectorSheet: async () => settled(detector),
      log: (entry) => logged.push(entry),
    },
  );

  assert.deepEqual(extracted.pages, [
    {
      page: 1,
      text: "Sektorová mapa, vyznačeno: značka 1: báze PZpl L; značka 2: semenný váček L.",
      source: "opencv",
    },
  ]);
  const [sectorPage] = extracted.sectorMap?.pages ?? [];
  assert.ok(sectorPage);
  assert.equal(sectorPage.page, 1);
  assert.deepEqual(
    sectorPage.foci.map((focus) => focus.marked),
    [["base_PZpl_L"], ["sv_L"]],
  );
  for (const focus of sectorPage.foci) {
    for (const sector of focus.sectors) {
      assert.ok(
        sector.share > 0 && sector.share <= 1 && sector.coverage > 0 && sector.coverage <= 1,
        sector.id,
      );
    }
    assert.ok(focus.marked.every((id) => focus.sectors.some((sector) => sector.id === id)));
  }
  assert.deepEqual(ExtractedDocument.parse(extracted), extracted);
  const [entry] = logged;
  assert.ok(entry);
  assert.equal(entry["sectorSheet"], true);
});

await test("a page that is not a sector sheet fails the extraction instead of mapping as nothing", async () => {
  await assert.rejects(
    extractors.sector_map(
      { bytes: await jpeg(), contentType: "image/jpeg" },
      { reader: unusedReader, sectorSheet: async () => settled(detector) },
    ),
    /not the sector sheet/u,
  );
});
