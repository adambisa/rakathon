import type { Mat } from "@techstark/opencv-js";

import { type SectorFocus, SectorId } from "@prostapaper/contracts";

import type { Cv } from "#opencv";
import type { GrayImage, RgbImage } from "#pdf";
import type { SectorSheetSettings } from "#sector-sheet-settings";

/** Label ids in the packed sector map; index 0 is outside every sector. */
/** Label byte n of the packed labels names SectorId.options[n - 1]; 0 is background. */
const LABELS: readonly (SectorId | "")[] = ["", ...SectorId.options];

type Ink = SectorSheetSettings["ink"];

const PAPER_SAMPLE_STEP = 4;
const PAPER_FIT_ROUNDS = 3;
/** Paper samples this much darker than the fitted surface are ink, and leave the next fit. */
const INK_BELOW_PAPER = 15;
type Marking = SectorSheetSettings["marking"];

export interface SectorMarks {
  foci: SectorFocus[];
}

export interface Inspection extends SectorMarks {
  inkMask: Uint8Array;
  focusMask: Uint8Array;
  warpedRgb: Uint8Array;
}

export interface MarkReader {
  read: (page: RgbImage, pageToTemplate: Mat) => SectorMarks;
  /** The same reading, with the ink and focus masks handed back for inspection. */
  inspect: (page: RgbImage, pageToTemplate: Mat) => Inspection;
  close: () => void;
}

/** Pixel-to-sector map at template size, plus where the template's own printed lines are. */
function lineMask(cv: Cv, template: GrayImage, { whiteTemplate, lineMarginPx }: Ink): Mat {
  const gray = cv.matFromArray(template.height, template.width, cv.CV_8UC1, template.data);
  const lines = new cv.Mat();
  const kernel = cv.getStructuringElement(
    cv.MORPH_ELLIPSE as number,
    new cv.Size(lineMarginPx * 2 + 1, lineMarginPx * 2 + 1),
  );
  try {
    cv.threshold(gray, lines, whiteTemplate, 255, cv.THRESH_BINARY_INV as number);
    cv.dilate(lines, lines, kernel);

    return lines;
  } finally {
    gray.delete();
    kernel.delete();
  }
}

/** Where the template is blank paper, away from its lines; sampled sparsely to measure the page's own paper. */
function paperSamples(template: GrayImage, lines: Mat, { paperTemplate }: Ink): number[] {
  const samples: number[] = [];
  for (let row = 0; row < template.height; row += PAPER_SAMPLE_STEP) {
    for (let column = 0; column < template.width; column += PAPER_SAMPLE_STEP) {
      const index = row * template.width + column;
      if ((template.data[index] ?? 0) >= paperTemplate && lines.data[index] === 0) samples.push(index);
    }
  }

  return samples;
}

/** A pivot of zero only arises from a degenerate fit; dividing by one keeps it finite. */
function nonZero(value: number | undefined): number {
  if (value === undefined || value === 0) return 1;

  return value;
}

/** Least squares by Gaussian elimination with partial pivoting; the systems here are 6 × 6. */
function solve(matrix: number[][], vector: number[]): number[] {
  const rows = matrix.map((row, index) => [...row, vector[index] ?? 0]);
  const size = rows.length;
  for (let pivot = 0; pivot < size; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < size; row += 1) {
      if (Math.abs(rows[row]?.[pivot] ?? 0) > Math.abs(rows[best]?.[pivot] ?? 0)) best = row;
    }
    [rows[pivot], rows[best]] = [rows[best] ?? [], rows[pivot] ?? []];
    const lead = rows[pivot] ?? [];
    for (let row = pivot + 1; row < size; row += 1) {
      const current = rows[row] ?? [];
      const factor = (current[pivot] ?? 0) / nonZero(lead[pivot]);
      for (let column = pivot; column <= size; column += 1) {
        current[column] = (current[column] ?? 0) - factor * (lead[column] ?? 0);
      }
    }
  }
  const solution = Array.from({ length: size }, () => 0);
  for (let row = size - 1; row >= 0; row -= 1) {
    const current = rows[row] ?? [];
    let sum = current[size] ?? 0;
    for (let column = row + 1; column < size; column += 1)
      sum -= (current[column] ?? 0) * (solution[column] ?? 0);
    solution[row] = sum / nonZero(current[row]);
  }

  return solution;
}

/** Brightness as a quadratic surface over the page: smooth enough for lighting, too stiff to follow ink. */
const surfaceTerms = (u: number, v: number): number[] => [1, u, v, u * u, u * v, v * v];

function fitSurface(points: { u: number; v: number; value: number }[]): number[] {
  const size = 6;
  const normal = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
  const target = Array.from({ length: size }, () => 0);
  for (const { u, v, value } of points) {
    const terms = surfaceTerms(u, v);
    for (let row = 0; row < size; row += 1) {
      const term = terms[row] ?? 0;
      target[row] = (target[row] ?? 0) + term * value;
      const line = normal[row] ?? [];
      for (let column = 0; column < size; column += 1)
        line[column] = (line[column] ?? 0) + term * (terms[column] ?? 0);
    }
  }

  return solve(normal, target);
}

const surfaceAt = (coefficients: number[], u: number, v: number): number =>
  surfaceTerms(u, v).reduce((sum, term, index) => sum + term * (coefficients[index] ?? 0), 0);

/** Grey or tinted paper and uneven lighting: per channel, fit the paper's brightness where the template is blank,
 * refitting without darker outliers (ink), and divide it out so paper reads as white again. */
function flattenPaper(
  rgb: Uint8Array,
  { width, height, paper }: { width: number; height: number; paper: number[] },
): Uint8Array {
  const flat = new Uint8Array(rgb.length);
  for (let channel = 0; channel < 3; channel += 1) {
    const at = (index: number): { u: number; v: number; value: number } => ({
      u: (index % width) / width,
      v: Math.floor(index / width) / height,
      value: rgb[index * 3 + channel] ?? 255,
    });
    let points = paper.map(at);
    let coefficients = fitSurface(points);
    for (let round = 1; round < PAPER_FIT_ROUNDS; round += 1) {
      const fitted = coefficients;
      points = points.filter(({ u, v, value }) => value >= surfaceAt(fitted, u, v) - INK_BELOW_PAPER);
      coefficients = fitSurface(points);
    }
    for (let index = 0; index < width * height; index += 1) {
      const surface = Math.max(
        1,
        surfaceAt(coefficients, (index % width) / width, Math.floor(index / width) / height),
      );
      flat[index * 3 + channel] = Math.min(
        255,
        Math.round(((rgb[index * 3 + channel] ?? 255) / surface) * 255),
      );
    }
  }

  return flat;
}

function smoothedGray(
  cv: Cv,
  gray: Uint8Array,
  { width, height, kernelPx }: { width: number; height: number; kernelPx: number },
): Uint8Array {
  const source = cv.matFromArray(height, width, cv.CV_8UC1, gray);
  const smoothed = new cv.Mat();
  try {
    cv.GaussianBlur(source, smoothed, new cv.Size(kernelPx, kernelPx), 0);

    return Uint8Array.from(smoothed.data);
  } finally {
    source.delete();
    smoothed.delete();
  }
}

interface InkReference {
  template: GrayImage;
  /** The template smoothed like the page, so grey zones compare as tones rather than dot patterns. */
  smoothTemplate: Uint8Array;
  lines: Mat;
  paper: number[];
  ink: Ink;
}

/** Pen marks: coloured pixels, or pixels much darker than the template away from its lines. Grey zones compare
 * smoothed images, since a dithered fax prints them as black dots; blank paper compares pixel by pixel. */
function inkMask(cv: Cv, warped: Mat, { template, smoothTemplate, lines, paper, ink }: InkReference): Mat {
  const { width, height } = template;
  const rgb = flattenPaper(warped.data, { width, height, paper });
  const gray = new Uint8Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 3;
    gray[index] = Math.round(
      ((rgb[offset] ?? 255) + (rgb[offset + 1] ?? 255) + (rgb[offset + 2] ?? 255)) / 3,
    );
  }
  const smoothPage = smoothedGray(cv, gray, { width, height, kernelPx: ink.smoothingPx });
  const nearLine = lines.data;
  const mask = new Uint8Array(width * height);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 3;
    const red = rgb[offset] ?? 255;
    const green = rgb[offset + 1] ?? 255;
    const blue = rgb[offset + 2] ?? 255;
    const chroma = Math.max(red, green, blue) - Math.min(red, green, blue);
    let darkness = (smoothTemplate[index] ?? 255) - (smoothPage[index] ?? 255);
    if ((template.data[index] ?? 0) >= ink.paperTemplate)
      darkness = (template.data[index] ?? 255) - (gray[index] ?? 255);
    // Scanner colour fringing sits on printed lines, so colour alone counts for less there.
    const awayFromLines = nearLine[index] === 0;
    let needed = ink.chromaOnLines;
    if (awayFromLines) needed = ink.chroma;
    if (chroma >= needed || (darkness >= ink.darkerThanTemplate && awayFromLines)) mask[index] = 255;
  }

  return cv.matFromArray(height, width, cv.CV_8UC1, mask);
}

const STROKE_PX = 9;
const GROUP_PX = 31;
const SPECK_PX = 40;

/** Pen strokes become foci: specks drop out, closed loops fill, open arcs keep a thickened footprint. */
function foci(cv: Cv, ink: Mat, { closeKernelPx, minFocusAreaPx }: Ink): Mat {
  const closed = new cv.Mat();
  const thick = new cv.Mat();
  const kernel = cv.getStructuringElement(
    cv.MORPH_ELLIPSE as number,
    new cv.Size(closeKernelPx, closeKernelPx),
  );
  const stroke = cv.getStructuringElement(cv.MORPH_ELLIPSE as number, new cv.Size(STROKE_PX, STROKE_PX));
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  const filled = cv.Mat.zeros(ink.rows, ink.cols, cv.CV_8UC1 as number);
  const labels = new cv.Mat();
  const stats = new cv.Mat();
  const centroids = new cv.Mat();
  try {
    const cull = (mask: Mat, below: number): void => {
      const count = cv.connectedComponentsWithStats(mask, labels, stats, centroids, 8, cv.CV_32S as number);
      const keep = new Uint8Array(count);
      for (let label = 1; label < count; label += 1) {
        if (((stats.intPtr(label, 4) as Int32Array)[0] ?? 0) >= below) keep[label] = 1;
      }
      const pixels = mask.data;
      const owners = labels.data32S;
      for (const [index, owner] of owners.entries()) if (keep[owner] === 0) pixels[index] = 0;
    };
    cv.morphologyEx(ink, closed, cv.MORPH_CLOSE as number, kernel);
    // A fax's dither and JPEG grain are specks; they go before any stroke is thickened.
    cull(closed, SPECK_PX);
    cv.findContours(
      closed,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL as number,
      cv.CHAIN_APPROX_SIMPLE as number,
    );
    cv.drawContours(filled, contours, -1, new cv.Scalar(255), -1);
    cv.dilate(closed, thick, stroke);
    cv.bitwise_or(filled, thick, filled);
    cull(filled, minFocusAreaPx);

    return filled;
  } finally {
    closed.delete();
    thick.delete();
    kernel.delete();
    stroke.delete();
    contours.delete();
    hierarchy.delete();
    labels.delete();
    stats.delete();
    centroids.delete();
  }
}

/** Per focus: how many of its pixels fall in each sector, counting only pixels inside some sector.
 * Strokes close together are one focus (a ring the scan only half caught), counted on their own pixels. */
function focusSectors(cv: Cv, drawn: Mat, labels: Uint8Array): Map<number, number>[] {
  const grouped = new cv.Mat();
  const components = new cv.Mat();
  const reach = cv.getStructuringElement(cv.MORPH_ELLIPSE as number, new cv.Size(GROUP_PX, GROUP_PX));
  try {
    cv.dilate(drawn, grouped, reach);
    const count = cv.connectedComponents(grouped, components);
    const perFocus = Array.from({ length: count }, () => new Map<number, number>());
    const ids = components.data32S;
    const marked = drawn.data;
    for (const [index, label] of labels.entries()) {
      const focus = ids[index] ?? 0;
      if (focus === 0 || label === 0 || marked[index] === 0) continue;
      const sectors = perFocus[focus];
      sectors?.set(label, (sectors.get(label) ?? 0) + 1);
    }

    return perFocus.slice(1).filter((sectors) => sectors.size > 0);
  } finally {
    grouped.delete();
    components.delete();
    reach.delete();
  }
}

/** Pixels per sector label at template size. */
function sectorAreas(labels: Uint8Array): number[] {
  const areas = LABELS.map(() => 0);
  for (const label of labels) areas[label] = (areas[label] ?? 0) + 1;

  return areas;
}

const rounded = (share: number): number => Math.round(share * 1000) / 1000;

/** Each focus marks its main sector, any sector holding a fair share of it, and any sector it largely covers. */
function summarise(
  perFocus: Map<number, number>[],
  areas: readonly number[],
  { markedShare, coveredShare }: Marking,
): SectorMarks {
  const area = (pixelsBySector: Map<number, number>): number =>
    [...pixelsBySector.values()].reduce((sum, pixels) => sum + pixels, 0);
  // Largest mark first: the index lesion is usually the biggest, and the order is what mapping zips on.
  const foci = perFocus
    .toSorted((left, right) => area(right) - area(left))
    .map((pixelsBySector): SectorFocus => {
      const total = area(pixelsBySector);
      const main = Math.max(...pixelsBySector.values());
      const sectors: { id: SectorId; share: number; coverage: number; marked: boolean }[] = [];
      for (const [label, pixels] of pixelsBySector) {
        const id = LABELS[label];
        if (id === undefined || id === "") continue;
        const share = pixels / total;
        const coverage = pixels / (areas[label] ?? pixels);
        sectors.push({
          id,
          share: rounded(share),
          coverage: rounded(coverage),
          marked: pixels === main || share >= markedShare || coverage >= coveredShare,
        });
      }
      sectors.sort((left, right) => right.share - left.share);

      return {
        sectors: sectors.map(({ id, share, coverage }) => ({ id, share, coverage })),
        marked: sectors.filter((sector) => sector.marked).map((sector) => sector.id),
      };
    });

  return { foci };
}

export function createMarkReader(
  cv: Cv,
  { template, labels, settings }: { template: GrayImage; labels: Uint8Array; settings: SectorSheetSettings },
): MarkReader {
  const lines = lineMask(cv, template, settings.ink);
  const reference: InkReference = {
    template,
    smoothTemplate: smoothedGray(cv, template.data, {
      width: template.width,
      height: template.height,
      kernelPx: settings.ink.smoothingPx,
    }),
    lines,
    paper: paperSamples(template, lines, settings.ink),
    ink: settings.ink,
  };
  const areas = sectorAreas(labels);

  interface Masks {
    warped: Mat;
    ink: Mat;
    drawn: Mat;
  }

  const masks = (page: RgbImage, pageToTemplate: Mat): Masks => {
    const source = cv.matFromArray(page.height, page.width, cv.CV_8UC3, page.data);
    const warped = new cv.Mat();
    try {
      cv.warpPerspective(
        source,
        warped,
        pageToTemplate,
        new cv.Size(template.width, template.height),
        cv.INTER_LINEAR as number,
        cv.BORDER_CONSTANT as number,
        new cv.Scalar(255, 255, 255),
      );
      const ink = inkMask(cv, warped, reference);
      try {
        return { warped, ink, drawn: foci(cv, ink, settings.ink) };
      } catch (error) {
        ink.delete();
        throw error;
      }
    } catch (error) {
      warped.delete();
      throw error;
    } finally {
      source.delete();
    }
  };

  const release = ({ warped, ink, drawn }: Masks): void => {
    warped.delete();
    ink.delete();
    drawn.delete();
  };

  const read = (page: RgbImage, pageToTemplate: Mat): SectorMarks => {
    const found = masks(page, pageToTemplate);
    try {
      return summarise(focusSectors(cv, found.drawn, labels), areas, settings.marking);
    } finally {
      release(found);
    }
  };

  const inspect = (page: RgbImage, pageToTemplate: Mat): Inspection => {
    const found = masks(page, pageToTemplate);
    try {
      return {
        ...summarise(focusSectors(cv, found.drawn, labels), areas, settings.marking),
        inkMask: Uint8Array.from(found.ink.data),
        focusMask: Uint8Array.from(found.drawn.data),
        warpedRgb: Uint8Array.from(found.warped.data),
      };
    } finally {
      release(found);
    }
  };

  return {
    read,
    inspect,
    close: () => {
      lines.delete();
    },
  };
}

const LEVELS: Record<string, string> = { base: "báze", mid: "střed", apex: "apex" };

/** Czech one-liner for the mapping step, in the form's own vocabulary and R/L sides. */
/** The page's human-readable line; the record gets the structured foci, never this sentence. */
export function describeMarks(foci: readonly SectorFocus[]): string {
  if (foci.length === 0) return "Sektorová mapa: bez značek.";
  const described = foci.map((focus, index) => {
    const sectors = focus.marked.map((id) => {
      const [level = "", zone = "", side = ""] = id.split("_");
      if (level === "sv") return `semenný váček ${zone}`;

      return `${LEVELS[level] ?? level} ${zone} ${side}`;
    });

    return `značka ${index + 1}: ${sectors.join(", ")}`;
  });

  return `Sektorová mapa, vyznačeno: ${described.join("; ")}.`;
}
