import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { gzipSync } from "node:zlib";

import type { Mat } from "@techstark/opencv-js";
import * as mupdf from "mupdf";

import { SectorId } from "@prostapaper/contracts";

import { type Cv, loadOpenCv } from "#opencv";
import type { RgbImage } from "#pdf";
import {
  type Box,
  renderSectorFigure,
  SECTOR_FIGURE_PDF,
  SECTOR_FIGURE_WIDTH,
  type SectorFigure,
} from "#scripts/sector-figure";

const usage =
  "Usage: node scripts/sector-labels.ts [--pdf <file>] [--out <file>] [--overlay <png>] [--verbose]\n" +
  "Paints one sector id per template pixel from the figure's own zone colours.";

const { values } = parseArgs({
  options: {
    pdf: { type: "string", default: SECTOR_FIGURE_PDF },
    out: {
      type: "string",
      default: fileURLToPath(new URL("../templates/sector-map-labels.u8.gz", import.meta.url)),
    },
    overlay: { type: "string" },
    verbose: { type: "boolean", default: false },
  },
});
if (values.pdf.length === 0) throw new Error(usage);

type Zone = "PZ" | "CZ" | "TZ" | "AFS" | "US";
type Level = "base" | "mid" | "apex";
type Side = "L" | "R";
type Rgb = [number, number, number];
type Palette = Record<Zone, Rgb>;

const ZONES: Zone[] = ["PZ", "CZ", "TZ", "AFS", "US"];
const COLOUR_TOLERANCE = 60;
const DARK_LIMIT = 200;
const MIN_REGION_PX = 400;
const DASH_ANGLES = 18;
const DASH_CORE_PX = 15;
const DASH_BRIDGE_PX = 45;
const URETHRA_HALF_WIDTH = 0.15;
const MIN_SYMMETRY = 0.8;
const MIN_ZONE_PURITY = 0.6;
const MIN_ONE_PIECE = 0.95;

/** Byte n names SectorId.options[n - 1], the order the mark reader already expects. */
const LABEL_OF = new Map(SectorId.options.map((id, index) => [id, index + 1]));

interface Cut {
  x: number;
  y: number;
  degrees: number;
}

interface PanelCuts {
  /** Where the panel prints its midline dash, as a fraction of the panel box. */
  midline: number;
  /** The dashed line across the transition zone: TZa above, TZp below. */
  horizontal: number;
  /** Dashed lines that bound no two sectors of one colour but are printed; drawn only as barriers. */
  extra: number[];
  /** The PZa/PZpl boundary, left of the page first: level at mid, sloping down laterally at base and apex. */
  lateral: [Cut, Cut];
  /** The PZpl/PZpm boundary, left of the page first. */
  diagonal: [Cut, Cut];
}

/** Each dashed boundary fitted to its own dashes once, in box fractions with the angle in pixels;
 * the sides are kept apart because the artwork is not quite a mirror image. */
const CUTS: Record<Level, PanelCuts> = {
  base: {
    midline: 0.4889,
    horizontal: 0.5651,
    extra: [],
    lateral: [
      { x: 0.1285, y: 0.5889, degrees: 166.48 },
      { x: 0.8687, y: 0.5866, degrees: 13.52 },
    ],
    diagonal: [
      { x: 0.246, y: 0.7354, degrees: 70.14 },
      { x: 0.7567, y: 0.737, degrees: 109.63 },
    ],
  },
  mid: {
    midline: 0.5015,
    horizontal: 0.5293,
    extra: [],
    lateral: [
      { x: 0.0902, y: 0.5278, degrees: 0.87 },
      { x: 0.8927, y: 0.5277, degrees: 0.27 },
    ],
    diagonal: [
      { x: 0.201, y: 0.6862, degrees: 70.93 },
      { x: 0.8139, y: 0.6692, degrees: 109.45 },
    ],
  },
  apex: {
    midline: 0.5013,
    horizontal: 0.39,
    extra: [0.6467],
    lateral: [
      { x: 0.0981, y: 0.4448, degrees: 173.46 },
      { x: 0.8909, y: 0.4447, degrees: 0.09 },
    ],
    diagonal: [
      { x: 0.1983, y: 0.644, degrees: 71.48 },
      { x: 0.7961, y: 0.6688, degrees: 109.47 },
    ],
  },
};

interface Region {
  zone: Zone;
  area: number;
  cx: number;
  cy: number;
  pixels: number[];
}

interface Panel {
  box: Box;
  inside: Uint8Array;
  /** The authored cuts, drawn across this panel only; empty for the seminal vesicles. */
  cuts: Uint8Array;
}

const intAt = (mat: Mat, row: number, column: number): number =>
  (mat.intPtr(row, column) as Int32Array)[0] ?? 0;
const doubleAt = (mat: Mat, row: number, column: number): number =>
  (mat.doublePtr(row, column) as Float64Array)[0] ?? 0;
const ucharAt = (mat: Mat, row: number, column: number): number =>
  (mat.ucharPtr(row, column) as Uint8Array)[0] ?? 0;

function colourAt(image: RgbImage, x: number, y: number): Rgb {
  const index = (y * image.width + x) * 3;

  return [image.data[index] ?? 255, image.data[index + 1] ?? 255, image.data[index + 2] ?? 255];
}

function median(samples: Rgb[]): Rgb {
  const channel = (which: 0 | 1 | 2): number =>
    samples.map((sample) => sample[which]).toSorted((left, right) => left - right)[
      Math.floor(samples.length / 2)
    ] ?? 0;

  return [channel(0), channel(1), channel(2)];
}

/** The legend prints the five zone colours, so the palette comes from the figure itself. */
function legendPalette(figure: SectorFigure): Palette {
  const { colour } = figure;
  const window = { x: 90, y: 1000, width: 140, height: 200 };
  let left = window.x + window.width;
  let right = window.x;
  let top = window.y + window.height;
  let bottom = window.y;
  for (let y = window.y; y < window.y + window.height; y += 1) {
    for (let x = window.x; x < window.x + window.width; x += 1) {
      const [r, g, b] = colourAt(colour, x, y);
      if ((r > 245 && g > 245 && b > 245) || (r < 120 && g < 120 && b < 120)) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  const height = (bottom - top + 1) / ZONES.length;
  if (height < 10) throw new Error("The legend swatches were not found where the figure prints them");
  const palette: Partial<Palette> = {};
  for (const [index, zone] of ZONES.entries()) {
    const centre = Math.round(top + height * (index + 0.5));
    const samples: Rgb[] = [];
    for (let y = centre - 5; y <= centre + 5; y += 1) {
      for (let x = left + 6; x <= right - 6; x += 2) samples.push(colourAt(colour, x, y));
    }
    palette[zone] = median(samples);
  }

  return palette as Palette;
}

function zoneAt(palette: Palette, pixel: Rgb): Zone | undefined {
  let best: Zone | undefined;
  let distance = COLOUR_TOLERANCE * COLOUR_TOLERANCE * 3;
  for (const zone of ZONES) {
    const [r, g, b] = palette[zone];
    const found = (r - pixel[0]) ** 2 + (g - pixel[1]) ** 2 + (b - pixel[2]) ** 2;
    if (found < distance) {
      distance = found;
      best = zone;
    }
  }

  return best;
}

function lineKernel(cv: Cv, length: number, degrees: number): Mat {
  let size = length;
  if (size % 2 === 0) size += 1;
  const kernel = cv.Mat.zeros(size, size, cv.CV_8U as number);
  const centre = (size - 1) / 2;
  const radians = (degrees * Math.PI) / 180;
  const dx = (Math.cos(radians) * (length - 1)) / 2;
  const dy = (Math.sin(radians) * (length - 1)) / 2;
  cv.line(
    kernel,
    new cv.Point(Math.round(centre - dx), Math.round(centre - dy)),
    new cv.Point(Math.round(centre + dx), Math.round(centre + dy)),
    new cv.Scalar(1),
    1,
  );

  return kernel;
}

/** Opening along a direction keeps straight runs no letter has; closing along it joins dash to dash. */
function barriers(cv: Cv, figure: SectorFigure): Mat {
  const { gray } = figure;
  const source = cv.matFromArray(gray.height, gray.width, cv.CV_8UC1, gray.data);
  const dark = new cv.Mat();
  const opened = new cv.Mat();
  const bridged = new cv.Mat();
  const joined = new cv.Mat();
  try {
    cv.threshold(source, dark, DARK_LIMIT, 255, cv.THRESH_BINARY_INV as number);
    dark.copyTo(joined);
    for (let step = 0; step < DASH_ANGLES; step += 1) {
      const degrees = (step * 180) / DASH_ANGLES;
      const core = lineKernel(cv, DASH_CORE_PX, degrees);
      const bridge = lineKernel(cv, DASH_BRIDGE_PX, degrees);
      try {
        cv.morphologyEx(dark, opened, cv.MORPH_OPEN as number, core);
        cv.morphologyEx(opened, bridged, cv.MORPH_CLOSE as number, bridge);
        cv.bitwise_or(joined, bridged, joined);
      } finally {
        core.delete();
        bridge.delete();
      }
    }

    return joined.clone();
  } finally {
    source.delete();
    dark.delete();
    opened.delete();
    bridged.delete();
    joined.delete();
  }
}

/** The outline is solid, so whatever the paper outside cannot reach is the panel. */
function interiorOf(box: Box, sealed: Mat): Uint8Array {
  const outside = new Uint8Array(box.width * box.height);
  const queue: number[] = [];
  const reach = (x: number, y: number): void => {
    const index = y * box.width + x;
    if (outside[index] === 1 || ucharAt(sealed, box.y + y, box.x + x) > 0) return;
    outside[index] = 1;
    queue.push(index);
  };
  for (let x = 0; x < box.width; x += 1) {
    reach(x, 0);
    reach(x, box.height - 1);
  }
  for (let y = 0; y < box.height; y += 1) {
    reach(0, y);
    reach(box.width - 1, y);
  }
  for (const element of queue) {
    const index = element;
    const x = index % box.width;
    const y = Math.floor(index / box.width);
    if (x > 0) reach(x - 1, y);
    if (y > 0) reach(x, y - 1);
    if (x < box.width - 1) reach(x + 1, y);
    if (y < box.height - 1) reach(x, y + 1);
  }

  return outside.map((value) => (value === 1 ? 0 : 1));
}

/** Every panel is a closed outline; the five largest in the right-hand column are the sectors. */
function findPanels(cv: Cv, figure: SectorFigure, sealed: Mat): Panel[] {
  const { gray } = figure;
  const source = cv.matFromArray(gray.height, gray.width, cv.CV_8UC1, gray.data);
  const binary = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.threshold(source, binary, DARK_LIMIT, 255, cv.THRESH_BINARY_INV as number);
    cv.findContours(
      binary,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL as number,
      cv.CHAIN_APPROX_SIMPLE as number,
    );
    const found: Box[] = [];
    for (let index = 0; index < contours.size(); index += 1) {
      const rect = cv.boundingRect(contours.get(index));
      if (rect.x < gray.width * 0.5 || rect.width * rect.height < 20_000) continue;
      found.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
    }
    const largest = found
      .toSorted((left, right) => right.width * right.height - left.width * left.height)
      .slice(0, 5)
      .toSorted((left, right) => left.y - right.y);
    if (largest.length !== 5) throw new Error(`Expected five sector panels, found ${largest.length}`);
    // The two seminal vesicles share a row; the one further left on the page is the patient's right.
    const vesicles = largest.slice(0, 2).toSorted((left, right) => left.x - right.x);
    const panels = [...vesicles, ...largest.slice(2)];

    return panels.map((box) => {
      const margin = 2;
      const padded = {
        x: box.x - margin,
        y: box.y - margin,
        width: box.width + 2 * margin,
        height: box.height + 2 * margin,
      };

      return {
        box: padded,
        inside: interiorOf(padded, sealed),
        cuts: new Uint8Array(padded.width * padded.height),
      };
    });
  } finally {
    source.delete();
    binary.delete();
    contours.delete();
    hierarchy.delete();
  }
}

interface Stroke {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/** A cut as a stroke across the panel, in panel pixels. */
function across(cut: Cut, box: Box): Stroke {
  const radians = (cut.degrees * Math.PI) / 180;
  const reach = box.width + box.height;
  const x = cut.x * box.width;
  const y = cut.y * box.height;

  return {
    from: { x: x - Math.cos(radians) * reach, y: y - Math.sin(radians) * reach },
    to: { x: x + Math.cos(radians) * reach, y: y + Math.sin(radians) * reach },
  };
}

/** The point on a cut at a given x, in panel pixels; undefined for a vertical cut. */
function pointAtX(cut: Cut, box: Box, x: number): { x: number; y: number } | undefined {
  const radians = (cut.degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  if (Math.abs(cosine) < 1e-3) return undefined;
  const along = (x - cut.x * box.width) / cosine;

  return { x, y: cut.y * box.height + Math.sin(radians) * along };
}

/** From a point on the cut outward to the panel's edge, on the side asked for. */
function outward(
  cut: Cut,
  box: Box,
  from: { start: { x: number; y: number }; towardsLeft: boolean },
): Stroke {
  const { start, towardsLeft } = from;
  const radians = (cut.degrees * Math.PI) / 180;
  let dx = Math.cos(radians);
  let dy = Math.sin(radians);
  if (dx < 0 !== towardsLeft) {
    dx = -dx;
    dy = -dy;
  }
  const reach = box.width + box.height;

  return { from: start, to: { x: start.x + dx * reach, y: start.y + dy * reach } };
}

const TZ_MARGIN_PX = 8;

/** The transition zone's line spans the yellow (`tz` is where it starts and ends on that row); from
 * its two ends the lateral dashes take over and run out to the capsule. */
function strokesOf(level: Level, box: Box, tz: { left: number; right: number }): Stroke[] {
  const { midline, horizontal, extra, lateral, diagonal } = CUTS[level];
  const [lateralLeft, lateralRight] = lateral;
  const y = horizontal * box.height;
  const startLeft = pointAtX(lateralLeft, box, tz.left) ?? { x: tz.left, y };
  const startRight = pointAtX(lateralRight, box, tz.right) ?? { x: tz.right, y };

  return [
    across({ x: midline, y: 0.5, degrees: 90 }, box),
    { from: { x: tz.left - TZ_MARGIN_PX, y }, to: { x: tz.right + TZ_MARGIN_PX, y } },
    ...extra.map((extraY) => across({ x: 0.5, y: extraY, degrees: 0 }, box)),
    outward(lateralLeft, box, { start: startLeft, towardsLeft: true }),
    outward(lateralRight, box, { start: startRight, towardsLeft: false }),
    ...diagonal.map((cut) => across(cut, box)),
  ];
}

/** Where the transition zone's yellow starts and ends along the row the transition zone's line is drawn on. */
function transitionSpan(
  level: Level,
  panel: Panel,
  { figure, palette }: Segmentation,
): { left: number; right: number } {
  const { box, inside } = panel;
  const y = Math.round(CUTS[level].horizontal * box.height);
  let left = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  for (let x = 0; x < box.width; x += 1) {
    if (inside[y * box.width + x] === 0) continue;
    if (zoneAt(palette, colourAt(figure.colour, box.x + x, box.y + y)) !== "TZ") continue;
    left = Math.min(left, x);
    right = Math.max(right, x);
  }
  if (!Number.isFinite(left) || !Number.isFinite(right))
    throw new Error(`${level}: no transition zone on its line`);

  return { left, right };
}

/** Each cut is drawn across its own panel and no further; one byte per panel pixel. */
function cutMask(cv: Cv, strokes: Stroke[], box: Box): Uint8Array {
  const mask = cv.Mat.zeros(box.height, box.width, cv.CV_8UC1 as number);
  try {
    for (const { from, to } of strokes) {
      cv.line(
        mask,
        new cv.Point(Math.round(from.x), Math.round(from.y)),
        new cv.Point(Math.round(to.x), Math.round(to.y)),
        new cv.Scalar(255),
        3,
      );
    }

    return Uint8Array.from(mask.data);
  } finally {
    mask.delete();
  }
}

interface Segmentation {
  figure: SectorFigure;
  barrier: Mat;
  palette: Palette;
}

function regionsOf(cv: Cv, { figure, barrier, palette }: Segmentation, panel: Panel): Region[] {
  const { box, inside } = panel;
  const zones = new Uint8Array(box.width * box.height);
  for (let y = 0; y < box.height; y += 1) {
    for (let x = 0; x < box.width; x += 1) {
      const at = y * box.width + x;
      if (inside[at] === 0 || panel.cuts[at] !== 0 || ucharAt(barrier, box.y + y, box.x + x) > 0) continue;
      const zone = zoneAt(palette, colourAt(figure.colour, box.x + x, box.y + y));
      if (zone !== undefined) zones[at] = ZONES.indexOf(zone) + 1;
    }
  }

  const regions: Region[] = [];
  const mask = new cv.Mat(box.height, box.width, cv.CV_8UC1, new cv.Scalar(0));
  const labels = new cv.Mat();
  const stats = new cv.Mat();
  const centroids = new cv.Mat();
  try {
    for (const [index, zone] of ZONES.entries()) {
      mask.setTo(new cv.Scalar(0));
      let any = false;
      for (const [at, value] of zones.entries()) {
        if (value !== index + 1) continue;
        (mask.ucharPtr(Math.floor(at / box.width), at % box.width) as Uint8Array)[0] = 255;
        any = true;
      }
      if (!any) continue;
      const count = cv.connectedComponentsWithStats(mask, labels, stats, centroids, 4, cv.CV_32S as number);
      const pixels = new Map<number, number[]>();
      for (let y = 0; y < box.height; y += 1) {
        for (let x = 0; x < box.width; x += 1) {
          const label = intAt(labels, y, x);
          if (label === 0) continue;
          const bucket = pixels.get(label);
          if (bucket === undefined) pixels.set(label, [y * box.width + x]);
          else bucket.push(y * box.width + x);
        }
      }
      for (let label = 1; label < count; label += 1) {
        const area = intAt(stats, label, 4);
        if (area < MIN_REGION_PX) continue;
        regions.push({
          zone,
          area,
          cx: doubleAt(centroids, label, 0),
          cy: doubleAt(centroids, label, 1),
          pixels: pixels.get(label) ?? [],
        });
      }
    }

    return regions;
  } finally {
    mask.delete();
    labels.delete();
    stats.delete();
    centroids.delete();
  }
}

/** Which side of a cut a point lies on, as a sign; the angle is drawn in pixels, so compared in pixels. */
function sideOfLine(line: Cut, box: Box, point: { x: number; y: number }): number {
  const radians = (line.degrees * Math.PI) / 180;
  const dx = point.x - line.x * box.width;
  const dy = point.y - line.y * box.height;

  return Math.sign(-Math.sin(radians) * dx + Math.cos(radians) * dy);
}

/** A sector is where it sits against the cuts: side of the midline, before or behind its boundary lines. */
function nameAxial(level: Level, regions: Region[], box: Box): Map<SectorId, Region[]> {
  const { midline, horizontal, lateral, diagonal } = CUTS[level];
  const named = new Map<SectorId, Region[]>();
  const add = (name: string, region: Region): void => {
    const id = SectorId.parse(name);
    const bucket = named.get(id);
    if (bucket === undefined) named.set(id, [region]);
    else bucket.push(region);
  };
  const anteriorOf = (line: Cut, point: { x: number; y: number }): boolean =>
    sideOfLine(line, box, point) === sideOfLine(line, box, { x: line.x * box.width, y: 0 });
  for (const region of regions) {
    if (region.zone === "US") continue;
    const centroid = { x: region.cx, y: region.cy };
    const side: Side = region.cx < midline * box.width ? "R" : "L";
    const [lateralCut, diagonalCut] = side === "R" ? [lateral[0], diagonal[0]] : [lateral[1], diagonal[1]];
    if (region.zone === "AFS") add(`${level}_AS_${side}`, region);
    if (region.zone === "TZ")
      add(`${level}_${region.cy < horizontal * box.height ? "TZa" : "TZp"}_${side}`, region);
    // Only the base has a central zone; a green cast elsewhere is shading and gets filled from around it.
    if (region.zone === "CZ" && level === "base") add(`${level}_CZ_${side}`, region);
    if (region.zone !== "PZ") continue;
    if (anteriorOf(lateralCut, centroid)) {
      // The urethra is drawn in the peripheral zone's pink at the top of the midline; it is no sector.
      if (Math.abs(region.cx - midline * box.width) < URETHRA_HALF_WIDTH * box.width) continue;
      add(`${level}_PZa_${side}`, region);
      continue;
    }
    const medial =
      sideOfLine(diagonalCut, box, centroid) ===
      sideOfLine(diagonalCut, box, { x: midline * box.width, y: region.cy });
    add(`${level}_${medial ? "PZpm" : "PZpl"}_${side}`, region);
  }
  const missing = SectorId.options.filter((id) => id.startsWith(`${level}_`) && !named.has(id));
  if (missing.length > 0) throw new Error(`${level}: no region for ${missing.join(", ")}`);

  return named;
}

/** Outlines, dashes and words carry no colour and join the sector beside them; the cuts hold the
 * first pass back so nothing grows across a boundary, then they are filled in themselves. */
function spread(seeded: Uint8Array, panel: Panel): Uint8Array {
  const { box, inside, cuts } = panel;
  const labels = Uint8Array.from(seeded);
  const grow = (acrossCuts: boolean): void => {
    const queue: number[] = [];
    for (const [index, value] of labels.entries()) if (value !== 0) queue.push(index);
    for (const index of queue) {
      const label = labels[index] ?? 0;
      const x = index % box.width;
      const y = Math.floor(index / box.width);
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as [number, number][]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= box.width || ny >= box.height) continue;
        const next = ny * box.width + nx;
        if (inside[next] === 0 || labels[next] !== 0) continue;
        if (!acrossCuts && cuts[next] !== 0) continue;
        labels[next] = label;
        queue.push(next);
      }
    }
  };
  grow(false);
  grow(true);

  return labels;
}

/** The share of a sector that hangs together in one piece. */
function largestPieceShare(pixels: number[], stride: number): number {
  const set = new Set(pixels);
  let largest = 0;
  while (set.size > 0) {
    const [first] = set;
    if (first === undefined) break;
    const queue = [first];
    set.delete(first);
    for (const index of queue) {
      const row = Math.floor(index / stride);
      for (const step of [1, -1, stride, -stride, stride + 1, stride - 1, -stride + 1, -stride - 1]) {
        const next = index + step;
        if (!set.has(next)) continue;
        if (Math.abs(Math.floor(next / stride) - row) > 1 || Math.abs((next % stride) - (index % stride)) > 1)
          continue;
        set.delete(next);
        queue.push(next);
      }
    }
    largest = Math.max(largest, queue.length);
  }

  return largest / pixels.length;
}

const EXPECTED_ZONE: Record<string, Zone> = {
  AS: "AFS",
  CZ: "CZ",
  PZa: "PZ",
  PZpl: "PZ",
  PZpm: "PZ",
  TZa: "TZ",
  TZp: "TZ",
};

const MIDLINE_TOLERANCE_PX = 2;

/** No sector may reach across the midline its panel prints. */
function midlineFaults(canvas: Uint8Array, stride: number, axial: [Level, Panel | undefined][]): string[] {
  const faults: string[] = [];
  for (const [level, panel] of axial) {
    if (panel === undefined) continue;
    const { box } = panel;
    const midline = box.x + CUTS[level].midline * box.width;
    let strays = 0;
    for (let y = box.y; y < box.y + box.height; y += 1) {
      for (let x = box.x; x < box.x + box.width; x += 1) {
        const id = SectorId.options[(canvas[y * stride + x] ?? 0) - 1];
        if (id === undefined) continue;
        if (!id.startsWith(`${level}_`)) continue;
        const right = id.endsWith("_R");
        if (right && x > midline + MIDLINE_TOLERANCE_PX) strays += 1;
        if (!right && x < midline - MIDLINE_TOLERANCE_PX) strays += 1;
      }
    }
    if (strays > 0) faults.push(`${level}: ${strays} pixels sit on the wrong side of the midline`);
  }

  return faults;
}

/** Every sector present and whole, mostly its own colour, and a fair mirror of its other side. */
function faultsIn(canvas: Uint8Array, { figure, palette }: Segmentation): string[] {
  const painted = new Map<SectorId, number[]>();
  for (const [index, value] of canvas.entries()) {
    if (value === 0) continue;
    const id = SectorId.options[value - 1];
    if (id === undefined) continue;
    const bucket = painted.get(id);
    if (bucket === undefined) painted.set(id, [index]);
    else bucket.push(index);
  }
  const faults = SectorId.options.filter((id) => !painted.has(id)).map((id) => `${id} has no pixels`);
  for (const [id, pixels] of painted) {
    const piece = largestPieceShare(pixels, figure.gray.width);
    if (piece < MIN_ONE_PIECE)
      faults.push(`${id} has only ${(piece * 100).toFixed(0)}% of itself in one piece`);
    const zone = EXPECTED_ZONE[id.split("_", 2)[1] ?? ""];
    if (zone === undefined) continue;
    let matching = 0;
    let coloured = 0;
    for (const pixel of pixels) {
      const found = zoneAt(
        palette,
        colourAt(figure.colour, pixel % figure.gray.width, Math.floor(pixel / figure.gray.width)),
      );
      if (found === undefined) continue;
      coloured += 1;
      if (found === zone) matching += 1;
    }
    let purity = 0;
    if (coloured > 0) purity = matching / coloured;
    if (purity < MIN_ZONE_PURITY) faults.push(`${id} is only ${(purity * 100).toFixed(0)}% ${zone}`);
  }
  for (const id of SectorId.options) {
    if (!id.endsWith("_L")) continue;
    const left = painted.get(id)?.length ?? 0;
    const right = painted.get(SectorId.parse(`${id.slice(0, -2)}_R`))?.length ?? 0;
    const ratio = Math.min(left, right) / Math.max(left, right);
    if (ratio < MIN_SYMMETRY)
      faults.push(`${id.slice(0, -2)} is only ${(ratio * 100).toFixed(0)}% symmetric`);
  }

  return faults;
}

function symmetryReport(canvas: Uint8Array): string[] {
  const areas = new Map<string, number>();
  for (const value of canvas) {
    if (value === 0) continue;
    const id = SectorId.options[value - 1] ?? "?";
    areas.set(id, (areas.get(id) ?? 0) + 1);
  }

  return SectorId.options
    .filter((id) => id.endsWith("_L"))
    .map((id) => {
      const left = areas.get(id) ?? 0;
      const right = areas.get(`${id.slice(0, -2)}_R`) ?? 0;
      const ratio = Math.min(left, right) / Math.max(left, right);

      return `${id.slice(0, -2).padEnd(12)} L ${String(left).padStart(6)}  R ${String(right).padStart(6)}  ratio ${ratio.toFixed(2)}`;
    });
}

const figure = await renderSectorFigure(SECTOR_FIGURE_WIDTH, values.pdf);
const cv = await loadOpenCv();
const palette = legendPalette(figure);
const barrier = barriers(cv, figure);
// A printed outline thins out here and there; the flood that finds the interior needs it sealed.
const sealed = new cv.Mat();
const seal = cv.getStructuringElement(cv.MORPH_ELLIPSE as number, new cv.Size(3, 3));
cv.dilate(barrier, sealed, seal);
seal.delete();
const panels = findPanels(cv, figure, sealed);
const segmentation: Segmentation = { figure, barrier, palette };
const canvas = new Uint8Array(figure.gray.width * figure.gray.height);
const [seminalLeft, seminalRight, base, mid, apex] = panels;
if ([seminalLeft, seminalRight, base, mid, apex].includes(undefined)) {
  throw new Error("Expected two seminal vesicles and three axial panels");
}
const axial: [Level, Panel | undefined][] = [
  ["base", base],
  ["mid", mid],
  ["apex", apex],
];

function paint(panel: Panel, named: Map<SectorId, Region[]>): void {
  const { box } = panel;
  const seeded = new Uint8Array(box.width * box.height);
  for (const [id, parts] of named) {
    const value = LABEL_OF.get(id);
    if (value === undefined) throw new Error(`Unknown sector ${id}`);
    for (const region of parts) for (const pixel of region.pixels) seeded[pixel] = value;
  }
  const labels = spread(seeded, panel);
  for (const [index, value] of labels.entries()) {
    if (value === 0) continue;
    canvas[(box.y + Math.floor(index / box.width)) * figure.gray.width + box.x + (index % box.width)] = value;
  }
}

for (const [level, panel] of axial) {
  if (panel === undefined) continue;
  panel.cuts = cutMask(
    cv,
    strokesOf(level, panel.box, transitionSpan(level, panel, segmentation)),
    panel.box,
  );
  const regions = regionsOf(cv, segmentation, panel);
  if (values.verbose) {
    const tally: Record<string, number> = {};
    for (const region of regions) {
      if (region.area < 1000) continue;
      const key = `${region.cx < CUTS[level].midline * panel.box.width ? "R" : "L"}.${region.zone}`;
      tally[key] = (tally[key] ?? 0) + 1;
    }
    console.info(level, JSON.stringify(tally));
  }
  paint(panel, nameAxial(level, regions, panel.box));
}

for (const [panel, id] of [
  [seminalLeft, "sv_R"],
  [seminalRight, "sv_L"],
] as [Panel | undefined, SectorId][]) {
  if (panel === undefined) continue;
  const value = LABEL_OF.get(id);
  if (value === undefined) throw new Error(`Unknown sector ${id}`);
  for (const [index, inside] of panel.inside.entries()) {
    if (inside === 0) continue;
    canvas[
      (panel.box.y + Math.floor(index / panel.box.width)) * figure.gray.width +
        panel.box.x +
        (index % panel.box.width)
    ] = value;
  }
}

const faults = [...faultsIn(canvas, segmentation), ...midlineFaults(canvas, figure.gray.width, axial)];
if (faults.length > 0) throw new Error(`The label map does not hold up:\n  ${faults.join("\n  ")}`);

const header = Buffer.alloc(8);
header.writeUInt32LE(figure.gray.width, 0);
header.writeUInt32LE(figure.gray.height, 4);
await writeFile(values.out, gzipSync(Buffer.concat([header, Buffer.from(canvas)]), { level: 9 }));
if (values.verbose) for (const line of symmetryReport(canvas)) console.info(line);
console.info({
  out: values.out,
  size: [figure.gray.width, figure.gray.height],
  painted: canvas.filter((value) => value !== 0).length,
});

if (values.overlay !== undefined) {
  const view = new Uint8Array(figure.gray.width * figure.gray.height * 3);
  for (const [index, value] of canvas.entries()) {
    const grey = figure.gray.data[index] ?? 255;
    let tint: Rgb = [grey, grey, grey];
    if (value !== 0) tint = [(value * 97) % 256, (value * 151) % 256, (value * 199) % 256];
    view[index * 3] = Math.round((tint[0] + grey) / 2);
    view[index * 3 + 1] = Math.round((tint[1] + grey) / 2);
    view[index * 3 + 2] = Math.round((tint[2] + grey) / 2);
  }
  const pixmap = new mupdf.Pixmap(
    mupdf.ColorSpace.DeviceRGB,
    [0, 0, figure.gray.width, figure.gray.height],
    false,
  );
  pixmap.getPixels().set(view);
  await writeFile(values.overlay, pixmap.asPNG());
  console.info({ overlay: values.overlay });
}
