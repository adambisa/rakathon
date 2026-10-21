import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

import type { Mat } from "@techstark/opencv-js";

import { SECTOR_SHEET_SETTINGS, SECTOR_SHEETS, type SectorSheetFiles } from "#assets";
import { type Cv, loadOpenCv } from "#opencv";
import { grayFromRgb, type GrayImage, grayPixels, openDocument, type RgbImage } from "#pdf";
import { createMarkReader, type MarkReader, type SectorMarks } from "#sector-marks";
import { SectorSheetSettings } from "#sector-sheet-settings";

/** Pages and the template are compared at the same width, so keypoint scales line up. */
export const SECTOR_SHEET_WIDTH = 800;

export interface SectorSheetMatch {
  /** Which blank form the page was matched against. */
  sheet: string;
  sectorSheet: boolean;
  goodMatches: number;
  inliers: number;
  /** Row-major page-to-template homography, present once the page is recognised. */
  matrix?: readonly number[];
}

export interface SectorSheetReading extends SectorSheetMatch {
  marks?: SectorMarks;
}

export interface SectorSheetDetector {
  detect: (image: GrayImage) => SectorSheetMatch;
  read: (page: RgbImage) => SectorSheetReading;
  close: () => void;
}

export interface SectorSheetAssets {
  sheet: string;
  template: GrayImage;
  /** One sector label per template pixel, at the template's working size. */
  labels: Uint8Array;
  settings: SectorSheetSettings;
}

type Detection = SectorSheetSettings["detection"];

interface Features {
  keypoints: InstanceType<Cv["KeyPointVector"]>;
  descriptors: Mat;
}

/** The opencv.js typings return `any` from vector accessors; these views name the fields used here. */
interface Vector<Item> {
  size: () => number;
  get: (index: number) => Item;
}
interface Deletable {
  delete: () => void;
}
interface KeyPoint {
  pt: { x: number; y: number };
}
interface DMatch {
  queryIdx: number;
  trainIdx: number;
  distance: number;
}

function features(cv: Cv, image: GrayImage, orbFeatures: number): Features {
  const gray = cv.matFromArray(image.height, image.width, cv.CV_8UC1, image.data);
  const orb = new cv.ORB(orbFeatures);
  const noMask = new cv.Mat();
  const keypoints = new cv.KeyPointVector();
  const descriptors = new cv.Mat();
  try {
    orb.detectAndCompute(gray, noMask, keypoints, descriptors);

    return { keypoints, descriptors };
  } finally {
    gray.delete();
    noMask.delete();
    orb.delete();
  }
}

function release({ keypoints, descriptors }: Features): void {
  keypoints.delete();
  descriptors.delete();
}

/** A homography that shrinks, grows or mirrors the page beyond any plausible scan is a false match. */
function plausible(homography: Mat, { minScale, maxScale }: Detection): boolean {
  if (homography.rows !== 3) return false;
  const [a = 0, b = 0, , d = 0, e = 0] = homography.data64F;
  const determinant = a * e - b * d;

  return determinant >= minScale && determinant <= maxScale;
}

type Matched = SectorSheetMatch & { pageToTemplate?: Mat };

function match(
  cv: Cv,
  detection: Detection,
  { reference, page }: { reference: Features; page: Features },
): Matched {
  if (page.descriptors.rows < 2) return { sheet: "", sectorSheet: false, goodMatches: 0, inliers: 0 };

  const pairs = new cv.DMatchVectorVector();
  const matcher = new cv.BFMatcher(cv.NORM_HAMMING as number, false);
  const from: number[] = [];
  const to: number[] = [];
  try {
    matcher.knnMatch(page.descriptors, reference.descriptors, pairs, 2);
    const candidates = pairs as unknown as Vector<Vector<DMatch> & Deletable>;
    const pageKeypoints = page.keypoints as unknown as Vector<KeyPoint>;
    const referenceKeypoints = reference.keypoints as unknown as Vector<KeyPoint>;
    for (let index = 0; index < candidates.size(); index += 1) {
      // The accessor hands back a copy that opencv.js never frees on its own.
      const pair = candidates.get(index);
      try {
        if (pair.size() < 2) continue;
        const best = pair.get(0);
        if (best.distance >= detection.ratio * pair.get(1).distance) continue;
        const source = pageKeypoints.get(best.queryIdx).pt;
        const target = referenceKeypoints.get(best.trainIdx).pt;
        from.push(source.x, source.y);
        to.push(target.x, target.y);
      } finally {
        pair.delete();
      }
    }
  } finally {
    pairs.delete();
    matcher.delete();
  }

  const goodMatches = from.length / 2;
  if (goodMatches < 4) return { sheet: "", sectorSheet: false, goodMatches, inliers: 0 };

  const sources = cv.matFromArray(goodMatches, 1, cv.CV_32FC2, from);
  const targets = cv.matFromArray(goodMatches, 1, cv.CV_32FC2, to);
  const inlierMask = new cv.Mat();
  const homography = cv.findHomography(
    sources,
    targets,
    cv.RANSAC as number,
    detection.ransacThresholdPx,
    inlierMask,
  );
  try {
    const inliers = inlierMask.rows > 0 ? cv.countNonZero(inlierMask) : 0;
    const sectorSheet =
      inliers >= detection.minInliers &&
      inliers / goodMatches >= detection.minInlierShare &&
      plausible(homography, detection);
    if (sectorSheet) {
      return {
        sheet: "",
        sectorSheet,
        goodMatches,
        inliers,
        matrix: [...homography.data64F],
        pageToTemplate: homography.clone(),
      };
    }

    return { sheet: "", sectorSheet, goodMatches, inliers };
  } finally {
    sources.delete();
    targets.delete();
    inlierMask.delete();
    homography.delete();
  }
}

interface Sheet {
  assets: SectorSheetAssets;
  reference: Features;
  marks: MarkReader;
}

/** A recognised sheet beats an unrecognised one; among those, the more inliers the better. */
function better(left: SectorSheetMatch, right: SectorSheetMatch): boolean {
  if (left.sectorSheet !== right.sectorSheet) return left.sectorSheet;

  return left.inliers > right.inliers;
}

/** Matches the page's ORB keypoints, found once, against every blank form given and reads the page
 * against the form it matches best. */
export async function createSectorSheetDetector(
  assets: SectorSheetAssets | readonly SectorSheetAssets[],
): Promise<SectorSheetDetector> {
  let list: readonly SectorSheetAssets[] = [assets as SectorSheetAssets];
  if (Array.isArray(assets)) list = assets as readonly SectorSheetAssets[];
  const [first] = list;
  if (first === undefined) throw new Error("At least one sector sheet is needed");
  const cv = await loadOpenCv();
  const sheets: Sheet[] = list.map((each) => ({
    assets: each,
    reference: features(cv, each.template, each.settings.detection.orbFeatures),
    marks: createMarkReader(cv, each),
  }));

  // One ORB pass over the page serves every form; the forms share the detection settings.
  const align = (image: GrayImage): Matched & { winner: Sheet } => {
    const page = features(cv, image, first.settings.detection.orbFeatures);
    try {
      let chosen: (Matched & { winner: Sheet }) | undefined;
      for (const sheet of sheets) {
        const found = {
          ...match(cv, sheet.assets.settings.detection, { reference: sheet.reference, page }),
          sheet: sheet.assets.sheet,
          winner: sheet,
        };
        if (chosen === undefined || better(found, chosen)) {
          chosen?.pageToTemplate?.delete();
          chosen = found;
        } else {
          found.pageToTemplate?.delete();
        }
      }
      if (chosen === undefined) throw new Error("No sheet to match against");

      return chosen;
    } finally {
      release(page);
    }
  };

  const detect = (image: GrayImage): SectorSheetMatch => {
    const { pageToTemplate, winner: _winner, ...result } = align(image);
    pageToTemplate?.delete();

    return result;
  };

  const read = (page: RgbImage): SectorSheetReading => {
    const { pageToTemplate, winner, ...result } = align(grayFromRgb(page));
    if (pageToTemplate === undefined) return result;
    try {
      return { ...result, marks: winner.marks.read(page, pageToTemplate) };
    } finally {
      pageToTemplate.delete();
    }
  };

  return {
    detect,
    read,
    close: () => {
      for (const sheet of sheets) {
        release(sheet.reference);
        sheet.marks.close();
      }
    },
  };
}

/** Packed as gzip(uint32 width, uint32 height, one uint8 label per pixel) at the template's native size. */
function unpackLabels(cv: Cv, packed: Uint8Array, template: GrayImage): Uint8Array {
  const bytes = gunzipSync(packed);
  const width = bytes.readUInt32LE(0);
  const height = bytes.readUInt32LE(4);
  const native = cv.matFromArray(height, width, cv.CV_8UC1, bytes.subarray(8));
  const resized = new cv.Mat();
  try {
    const size = new cv.Size(template.width, template.height);
    cv.resize(native, resized, size, 0, 0, cv.INTER_NEAREST as number);

    return Uint8Array.from(resized.data);
  } finally {
    native.delete();
    resized.delete();
  }
}

export async function loadSectorSheetAssets(
  directory: string,
  files: SectorSheetFiles,
  settingsPath = join(directory, SECTOR_SHEET_SETTINGS),
): Promise<SectorSheetAssets> {
  const document = openDocument(await readFile(join(directory, files.template)), "image/jpeg");
  const page = document.loadPage(0);
  try {
    const template = grayPixels(page, SECTOR_SHEET_WIDTH);
    const cv = await loadOpenCv();

    const settings = SectorSheetSettings.parse(JSON.parse(await readFile(settingsPath, "utf8")));

    return {
      sheet: files.sheet,
      template,
      labels: unpackLabels(cv, await readFile(join(directory, files.labels)), template),
      settings,
    };
  } finally {
    page.destroy();
    document.destroy();
  }
}

/** Every blank form shipped beside the handler, in the order the detector should prefer them. */
export async function loadSectorSheets(directory: string): Promise<SectorSheetAssets[]> {
  return Promise.all(SECTOR_SHEETS.map(async (files) => loadSectorSheetAssets(directory, files)));
}
