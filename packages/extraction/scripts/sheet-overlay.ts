import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { type GrayImage, grayPixels, openDocument } from "#pdf";
import { measureSheetOverlay, type SheetOverlay } from "#sector-overlay";
import { createSectorSheetDetector, SECTOR_SHEET_WIDTH } from "#sector-sheet";
import { SectorSheetSettings } from "#sector-sheet-settings";

const usage =
  "Usage: node scripts/sheet-overlay.ts --scans <dir> [--template <jpg>] [--settings <json>] [--json <file>]\n" +
  "Reports how well each scan aligns to the blank template: detection, inliers and edge overlay.";

const { values } = parseArgs({
  options: {
    scans: { type: "string" },
    template: {
      type: "string",
      default: fileURLToPath(new URL("../templates/sector-map.jpg", import.meta.url)),
    },
    settings: {
      type: "string",
      default: fileURLToPath(new URL("../templates/sector-sheet.json", import.meta.url)),
    },
    json: { type: "string" },
    control: { type: "string", default: "8" },
  },
});
if (values.scans === undefined) {
  throw new Error(usage);
}
const directory = values.scans;

async function gray(path: string, width: number): Promise<GrayImage> {
  const document = openDocument(await readFile(path), "image/jpeg");
  const page = document.loadPage(0);
  try {
    return grayPixels(page, width);
  } finally {
    page.destroy();
    document.destroy();
  }
}

interface Row {
  scan: string;
  detected: boolean;
  inliers: number;
  goodMatches: number;
  overlay?: SheetOverlay;
  /** The same measurement against a deliberately nudged homography, so a flat metric shows up. */
  control?: SheetOverlay;
}

const template = await gray(values.template, SECTOR_SHEET_WIDTH);
const settings = SectorSheetSettings.parse(JSON.parse(await readFile(values.settings, "utf8")));
const detector = await createSectorSheetDetector({
  sheet: "sector-map",
  template,
  labels: new Uint8Array(template.width * template.height),
  settings,
});

const entries = await readdir(directory);
const files = entries
  .filter((name) => [".jpg", ".jpeg"].includes(extname(name).toLowerCase()))
  .toSorted((left, right) => left.localeCompare(right));
if (files.length === 0) throw new Error(`No JPEG scans in ${directory}`);

const nudge = Number(values.control);
if (Number.isNaN(nudge) || nudge < 0) throw new Error(usage);

/** One scan at a time: OpenCV holds one WebAssembly heap for the whole process. */
async function measure(name: string): Promise<Row> {
  const scan = await gray(join(directory, name), SECTOR_SHEET_WIDTH);
  const match = detector.detect(scan);
  const row: Row = {
    scan: basename(name, extname(name)),
    detected: match.sectorSheet,
    inliers: match.inliers,
    goodMatches: match.goodMatches,
  };
  if (match.matrix === undefined) return row;
  row.overlay = await measureSheetOverlay(template, scan, match.matrix);
  if (nudge > 0) {
    const shifted = [...match.matrix];
    shifted[2] = (shifted[2] ?? 0) + nudge;
    shifted[5] = (shifted[5] ?? 0) + nudge;
    row.control = await measureSheetOverlay(template, scan, shifted);
  }

  return row;
}

function control(row: Row): string {
  if (row.control === undefined) return "";

  return `ctrl ${(row.control.within2px * 100).toFixed(1).padStart(5)}%`;
}

let rows: Row[] = [];
try {
  rows = await files.reduce(async (previous, name) => {
    const collected = await previous;
    const row = await measure(name);
    console.info(
      [
        row.scan.padEnd(14),
        (row.detected ? "ok " : "MISS").padEnd(5),
        `inliers ${String(row.inliers).padStart(5)}`,
        `of ${String(row.goodMatches).padStart(5)}`,
        row.overlay
          ? `| within2px ${(row.overlay.within2px * 100).toFixed(1).padStart(5)}% median ${row.overlay.medianDistancePx.toFixed(2).padStart(5)}px p90 ${row.overlay.p90DistancePx.toFixed(2).padStart(6)}px scale ${row.overlay.scale.toFixed(3)} rot ${row.overlay.rotationDegrees.toFixed(2)}°`
          : "| no homography",
        control(row),
      ].join(" "),
    );

    return [...collected, row];
  }, Promise.resolve<Row[]>([]));
} finally {
  detector.close();
}

const detected = rows.filter((row) => row.detected);
if (detected.length === 0) throw new Error("No scan was recognised as the sector sheet");
const controls: number[] = [];
for (const row of detected) if (row.control !== undefined) controls.push(row.control.within2px);
const median = (numbers: number[]): number => {
  const sorted = numbers.toSorted((left, right) => left - right);

  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
};
const summary = {
  scans: rows.length,
  detected: detected.length,
  medianInliers: median(detected.map((row) => row.inliers)),
  minInliers: Math.min(...detected.map((row) => row.inliers)),
  medianWithin2px: Number(median(detected.map((row) => row.overlay?.within2px ?? 0)).toFixed(4)),
  worstWithin2px: Number(Math.min(...detected.map((row) => row.overlay?.within2px ?? 0)).toFixed(4)),
  medianMedianDistancePx: Number(
    median(detected.map((row) => row.overlay?.medianDistancePx ?? Number.NaN)).toFixed(2),
  ),
  medianControlWithin2px: Number(median(controls).toFixed(4)),
};
console.info(summary);
if (values.json !== undefined) {
  await writeFile(
    values.json,
    `${JSON.stringify({ template: values.template, summary, rows }, undefined, 2)}\n`,
  );
}
