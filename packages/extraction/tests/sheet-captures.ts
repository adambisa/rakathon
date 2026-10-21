import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Mat } from "@techstark/opencv-js";
import { ColorSpace, Pixmap } from "mupdf";

import { type Cv, loadOpenCv } from "#opencv";
import { openDocument, type RgbImage, rgbPixels } from "#pdf";
import { SECTOR_SHEET_WIDTH } from "#sector-sheet";

/** Pen colours as RGB. */
/** The Czech form the synthetic captures are drawn on; it is a test fixture, not a shipped sheet. */
export const CZECH_SHEET = {
  sheet: "sector-sheet",
  template: "sector-sheet.jpg",
  labels: "sector-sheet-labels.u8.gz",
} as const;

export const PEN = { blue: [25, 45, 160], red: [190, 25, 25], black: [35, 35, 40] } as const;
type Colour = readonly number[];

export interface Lesion {
  x: number;
  y: number;
  rx: number;
  ry: number;
  colour: Colour;
  /** Diagonal hatching instead of a solid fill. */
  hatched?: boolean;
}

/** Positions are in the blank form's native pixels (962 wide). */
const FORM_WIDTH = 962;

const scalar = (cv: Cv, [red = 0, green = 0, blue = 0]: Colour): InstanceType<Cv["Scalar"]> =>
  new cv.Scalar(red, green, blue);

/** Same noise on every run, so a capture is reproducible. */
function seeded(seed: number): () => number {
  let state = seed;

  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 2 ** 32;

    return state / 2 ** 32;
  };
}

function drawLesion(cv: Cv, sheet: Mat, { x, y, rx, ry, colour, hatched = false }: Lesion): void {
  const centre = new cv.Point(x, y);
  const axes = new cv.Size(rx, ry);
  if (!hatched) {
    cv.ellipse(sheet, centre, axes, 0, 0, 360, scalar(cv, colour), -1);

    return;
  }
  const area = cv.Mat.zeros(sheet.rows, sheet.cols, cv.CV_8UC1 as number);
  const strokes = cv.Mat.zeros(sheet.rows, sheet.cols, cv.CV_8UC1 as number);
  try {
    cv.ellipse(area, centre, axes, 0, 0, 360, new cv.Scalar(255), -1);
    for (let offset = -2 * ry; offset < 2 * (rx + ry); offset += 7) {
      const top = new cv.Point(x - rx + offset, y - ry);
      cv.line(strokes, top, new cv.Point(top.x - 2 * ry, y + ry), new cv.Scalar(255), 2);
    }
    cv.bitwise_and(strokes, area, strokes);
    sheet.setTo(scalar(cv, colour), strokes);
  } finally {
    area.delete();
    strokes.delete();
  }
}

/** Paper tone and lighting: brightness runs from `from` to `to` across the diagonal, times a per-channel tint. */
function paper(
  sheet: Mat,
  { from, to, tint = [1, 1, 1] }: { from: number; to: number; tint?: Colour },
): void {
  const { data, rows, cols } = sheet;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      const light = (from + ((to - from) * (column / cols + row / rows)) / 2) / 255;
      const offset = (row * cols + column) * 3;
      for (let channel = 0; channel < 3; channel += 1) {
        data[offset + channel] = Math.min(255, (data[offset + channel] ?? 0) * light * (tint[channel] ?? 1));
      }
    }
  }
}

function noise(sheet: Mat, sigma: number, random: () => number): void {
  const { data } = sheet;
  for (let index = 0; index < data.length; index += 1) {
    const sample = (random() + random() + random() - 1.5) * 2 * sigma;
    data[index] = Math.max(0, Math.min(255, (data[index] ?? 0) + sample));
  }
}

/** A phone held at a slight angle: the page is a trapezoid on a darker table. */
function tilt(cv: Cv, sheet: Mat, table: Colour): Mat {
  const { cols: width, rows: height } = sheet;
  const from = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, width, 0, width, height, 0, height]);
  const to = cv.matFromArray(4, 1, cv.CV_32FC2, [
    width * 0.06,
    height * 0.03,
    width * 0.98,
    0,
    width,
    height,
    0,
    height * 0.976,
  ]);
  const transform = cv.getPerspectiveTransform(from, to);
  const tilted = new cv.Mat();
  try {
    cv.warpPerspective(
      sheet,
      tilted,
      transform,
      new cv.Size(width, height),
      cv.INTER_LINEAR as number,
      cv.BORDER_CONSTANT as number,
      scalar(cv, table),
    );

    return tilted;
  } finally {
    from.delete();
    to.delete();
    transform.delete();
  }
}

/** One bit per pixel with Floyd–Steinberg dithering, like a fax or a black-and-white scanner mode. */
function dither(sheet: Mat): void {
  const { data, rows, cols } = sheet;
  const gray = new Float32Array(rows * cols);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 3;
    gray[index] =
      0.299 * (data[offset] ?? 0) + 0.587 * (data[offset + 1] ?? 0) + 0.114 * (data[offset + 2] ?? 0);
  }
  const spread = (index: number, error: number): void => {
    gray[index] = (gray[index] ?? 0) + error;
  };
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < cols; column += 1) {
      const index = row * cols + column;
      const value = (gray[index] ?? 0) < 128 ? 0 : 255;
      const error = (gray[index] ?? 0) - value;
      gray[index] = value;
      if (column + 1 < cols) spread(index + 1, (error * 7) / 16);
      if (row + 1 < rows) {
        if (column > 0) spread(index + cols - 1, (error * 3) / 16);
        spread(index + cols, (error * 5) / 16);
        if (column + 1 < cols) spread(index + cols + 1, error / 16);
      }
    }
  }
  for (const [index, value] of gray.entries()) data.fill(value, index * 3, index * 3 + 3);
}

function jpeg(sheet: Mat, quality: number): Uint8Array {
  const pixmap = new Pixmap(ColorSpace.DeviceRGB, [0, 0, sheet.cols, sheet.rows], false);
  try {
    pixmap.getPixels().set(sheet.data);

    return pixmap.asJPEG(quality);
  } finally {
    pixmap.destroy();
  }
}

/** Decodes the capture the way the pipeline does: as an uploaded JPEG, rendered at the working width. */
function decode(bytes: Uint8Array): RgbImage {
  const document = openDocument(bytes, "image/jpeg");
  const page = document.loadPage(0);
  try {
    return rgbPixels(page, SECTOR_SHEET_WIDTH);
  } finally {
    page.destroy();
    document.destroy();
  }
}

export type Capture = "phone photo" | "dithered fax" | "yellow copy paper";

/** The blank form with `lesions` drawn on it, captured badly in one of a few realistic ways. */
export async function capture(templates: string, kind: Capture, lesions: Lesion[]): Promise<RgbImage> {
  const cv = await loadOpenCv();
  const document = openDocument(await readFile(join(templates, CZECH_SHEET.template)), "image/jpeg");
  const page = document.loadPage(0);
  const blank = rgbPixels(page, FORM_WIDTH);
  page.destroy();
  document.destroy();

  let sheet = cv.matFromArray(blank.height, blank.width, cv.CV_8UC3, blank.data);
  const random = seeded(7);
  try {
    for (const lesion of lesions) drawLesion(cv, sheet, lesion);
    if (kind === "phone photo") {
      paper(sheet, { from: 150, to: 230, tint: [1, 0.97, 0.88] });
      const tilted = tilt(cv, sheet, [90, 80, 70]);
      sheet.delete();
      sheet = tilted;
      cv.GaussianBlur(sheet, sheet, new cv.Size(5, 5), 1.2);
      noise(sheet, 6, random);

      return decode(jpeg(sheet, 70));
    }
    if (kind === "dithered fax") {
      dither(sheet);

      return decode(jpeg(sheet, 85));
    }
    paper(sheet, { from: 250, to: 250, tint: [1, 0.96, 0.72] });
    noise(sheet, 3, random);

    return decode(jpeg(sheet, 85));
  } finally {
    sheet.delete();
  }
}
