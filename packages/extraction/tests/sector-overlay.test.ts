import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { type GrayImage, grayPixels, openDocument } from "#pdf";
import { measureSheetOverlay, type SheetOverlay } from "#sector-overlay";
import { createSectorSheetDetector, SECTOR_SHEET_WIDTH, type SectorSheetDetector } from "#sector-sheet";
import { SectorSheetSettings } from "#sector-sheet-settings";
import { schemaScans } from "#tests/env";
import { settled } from "#tests/fixtures";

const templates = fileURLToPath(new URL("../templates", import.meta.url));
const NUDGE_PX = 8;

async function gray(path: string, width: number): Promise<GrayImage> {
  const document = openDocument(await readFile(path), "image/jpeg");
  const page = document.loadPage(0);
  try {
    return await settled(grayPixels(page, width));
  } finally {
    page.destroy();
    document.destroy();
  }
}

async function sectorMapDetector(template: GrayImage): Promise<SectorSheetDetector> {
  const settings = SectorSheetSettings.parse(
    JSON.parse(await readFile(join(templates, "sector-sheet.json"), "utf8")),
  );

  return createSectorSheetDetector({
    sheet: "sector-map",
    template,
    labels: new Uint8Array(template.width * template.height),
    settings,
  });
}

await test("the sector map template matches a smaller print of itself", async () => {
  const template = await gray(join(templates, "sector-map.jpg"), SECTOR_SHEET_WIDTH);
  const smaller = await gray(join(templates, "sector-map.jpg"), Math.round(SECTOR_SHEET_WIDTH * 0.8));
  const detector = await sectorMapDetector(template);
  try {
    const match = detector.detect(smaller);
    assert.ok(match.sectorSheet, `expected a match, got ${match.inliers} inliers`);
    assert.ok(match.matrix !== undefined);
    const overlay = await measureSheetOverlay(template, smaller, match.matrix);
    assert.ok(overlay.within2px >= 0.9, `overlay within 2px was ${overlay.within2px}`);
    assert.ok(overlay.scale > 1.15 && overlay.scale < 1.35, `scale was ${overlay.scale}`);
  } finally {
    detector.close();
  }
});

const missing = "set SECTOR_SHEET_SCANS to the schema scan directory";

await test(
  "every schema scan aligns to the sector map template",
  { skip: schemaScans === undefined && missing },
  async () => {
    const directory = schemaScans ?? "";
    const entries = await readdir(directory);
    const files = entries
      .filter((name) => [".jpg", ".jpeg"].includes(extname(name).toLowerCase()))
      .toSorted((left, right) => left.localeCompare(right));
    assert.ok(files.length > 0, `no scans in ${directory}`);

    const template = await gray(join(templates, "sector-map.jpg"), SECTOR_SHEET_WIDTH);
    const detector = await sectorMapDetector(template);
    type Measured = SheetOverlay & { scan: string; inliers: number; control: number };
    const measure = async (name: string): Promise<Measured> => {
      const scan = await gray(join(directory, name), SECTOR_SHEET_WIDTH);
      const match = detector.detect(scan);
      assert.ok(match.sectorSheet, `${name} was not recognised (${match.inliers} inliers)`);
      assert.ok(match.matrix !== undefined);
      const overlay = await measureSheetOverlay(template, scan, match.matrix);
      const nudged = [...match.matrix];
      nudged[2] = (nudged[2] ?? 0) + NUDGE_PX;
      nudged[5] = (nudged[5] ?? 0) + NUDGE_PX;
      const control = await measureSheetOverlay(template, scan, nudged);

      return { ...overlay, scan: name, inliers: match.inliers, control: control.within2px };
    };

    let overlays: Measured[] = [];
    try {
      // One scan at a time: OpenCV holds one WebAssembly heap for the whole process.
      overlays = await files.reduce(async (previous, name) => {
        const collected = await previous;

        return [...collected, await measure(name)];
      }, Promise.resolve<Measured[]>([]));
    } finally {
      detector.close();
    }

    for (const overlay of overlays) {
      assert.ok(overlay.inliers >= 80, `${overlay.scan} matched on only ${overlay.inliers} inliers`);
      assert.ok(overlay.within2px >= 0.9, `${overlay.scan} overlaid ${overlay.within2px} within 2px`);
      assert.ok(
        overlay.p90DistancePx <= 2,
        `${overlay.scan} had a p90 edge distance of ${overlay.p90DistancePx}px`,
      );
      assert.ok(overlay.scale > 0.9 && overlay.scale < 1.1, `${overlay.scan} scaled by ${overlay.scale}`);
      assert.ok(Math.abs(overlay.rotationDegrees) <= 3, `${overlay.scan} turned ${overlay.rotationDegrees}°`);
      // A nudged homography has to score far worse, or the overlay measure says nothing.
      assert.ok(
        overlay.control <= overlay.within2px - 0.3,
        `${overlay.scan} scored ${overlay.control} for a homography off by 8px`,
      );
    }
  },
);
