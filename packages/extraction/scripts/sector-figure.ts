import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import * as mupdf from "mupdf";

import { loadOpenCv } from "#opencv";
import type { GrayImage, RgbImage } from "#pdf";

export const SECTOR_FIGURE_PDF = fileURLToPath(
  new URL("../../../docs/reference/PI-RADS_v2.1_2019.pdf", import.meta.url),
);
export const SECTOR_FIGURE_PAGE = 75;
/** The artwork's width in template pixels; the label map's cuts and windows are measured at this size. */
export const SECTOR_FIGURE_WIDTH = 1600;

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SectorFigure {
  gray: GrayImage;
  colour: RgbImage;
  /** Multiplies PDF points to render pixels; the origin is the template's top left. */
  scale: number;
  origin: { x: number; y: number };
}

interface Rendered {
  gray: GrayImage;
  colour: RgbImage;
}

export function cropGray(image: GrayImage, box: Box): GrayImage {
  const data = new Uint8Array(box.width * box.height);
  for (let y = 0; y < box.height; y += 1) {
    const from = (box.y + y) * image.width + box.x;
    data.set(image.data.subarray(from, from + box.width), y * box.width);
  }

  return { width: box.width, height: box.height, data };
}

export function cropRgb(image: RgbImage, box: Box): RgbImage {
  const data = new Uint8Array(box.width * box.height * 3);
  for (let y = 0; y < box.height; y += 1) {
    const from = ((box.y + y) * image.width + box.x) * 3;
    data.set(image.data.subarray(from, from + box.width * 3), y * box.width * 3);
  }

  return { width: box.width, height: box.height, data };
}

function render(bytes: Uint8Array, page: number, scale: number): Rendered {
  const document = mupdf.Document.openDocument(bytes, "application/pdf");
  const loaded = document.loadPage(page - 1);
  try {
    const matrix = mupdf.Matrix.scale(scale, scale);
    const grey = loaded.toPixmap(matrix, mupdf.ColorSpace.DeviceGray, false, true);
    const colour = loaded.toPixmap(matrix, mupdf.ColorSpace.DeviceRGB, false, true);

    return {
      gray: { width: grey.getWidth(), height: grey.getHeight(), data: Uint8Array.from(grey.getPixels()) },
      colour: {
        width: colour.getWidth(),
        height: colour.getHeight(),
        data: Uint8Array.from(colour.getPixels()),
      },
    };
  } finally {
    loaded.destroy();
  }
}

/** The figure stands alone inside a ruled box, the largest dark outline on the page. */
async function figureFrame(image: GrayImage): Promise<Box> {
  const cv = await loadOpenCv();
  const gray = cv.matFromArray(image.height, image.width, cv.CV_8UC1, image.data);
  const binary = new cv.Mat();
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();
  try {
    cv.threshold(gray, binary, 200, 255, cv.THRESH_BINARY_INV as number);
    cv.findContours(
      binary,
      contours,
      hierarchy,
      cv.RETR_EXTERNAL as number,
      cv.CHAIN_APPROX_SIMPLE as number,
    );
    let best: Box | undefined;
    for (let index = 0; index < contours.size(); index += 1) {
      const rect = cv.boundingRect(contours.get(index));
      if (best === undefined || rect.width * rect.height > best.width * best.height) {
        best = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }
    }
    if (best === undefined) throw new Error("No figure frame on the page");

    return best;
  } finally {
    gray.delete();
    binary.delete();
    contours.delete();
    hierarchy.delete();
  }
}

/** A rule runs the whole way along an edge, unlike artwork that starts further in. */
function withoutRules(image: GrayImage, ink: number, share: number): Box {
  const dark = (x: number, y: number): boolean => (image.data[y * image.width + x] ?? 255) <= ink;
  let left = 0;
  let right = image.width - 1;
  let top = 0;
  let bottom = image.height - 1;
  const column = (x: number): number => {
    let count = 0;
    for (let y = top; y <= bottom; y += 1) if (dark(x, y)) count += 1;

    return count;
  };
  const row = (y: number): number => {
    let count = 0;
    for (let x = left; x <= right; x += 1) if (dark(x, y)) count += 1;

    return count;
  };
  while (left < right && column(left) / (bottom - top + 1) >= share) left += 1;
  while (right > left && column(right) / (bottom - top + 1) >= share) right -= 1;
  while (top < bottom && row(top) / (right - left + 1) >= share) top += 1;
  while (bottom > top && row(bottom) / (right - left + 1) >= share) bottom -= 1;

  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

/** The hospital prints the artwork alone, so the paper around it leaves the template. */
function inkBox(image: GrayImage, ink: number, margin: number): Box {
  let left = image.width;
  let right = -1;
  let top = image.height;
  let bottom = -1;
  for (let y = 0; y < image.height; y += 1) {
    const row = y * image.width;
    for (let x = 0; x < image.width; x += 1) {
      if ((image.data[row + x] ?? 255) > ink) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) throw new Error("The cropped figure holds no ink");
  const x = Math.max(0, left - margin);
  const y = Math.max(0, top - margin);

  return {
    x,
    y,
    width: Math.min(image.width, right + margin + 1) - x,
    height: Math.min(image.height, bottom + margin + 1) - y,
  };
}

/** One crop, shared by the template and the label map, so both stand in the same pixels. */
export async function renderSectorFigure(width: number, pdf = SECTOR_FIGURE_PDF): Promise<SectorFigure> {
  const bytes = await readFile(pdf);
  const probeScale = 2;
  const probed = render(bytes, SECTOR_FIGURE_PAGE, probeScale);
  const probe = await figureFrame(probed.gray);
  const frame = {
    x: probe.x / probeScale,
    y: probe.y / probeScale,
    width: probe.width / probeScale,
    height: probe.height / probeScale,
  };
  const scale = width / (frame.width - 2);
  const full = render(bytes, SECTOR_FIGURE_PAGE, scale);
  const inside = {
    x: Math.round((frame.x + 1) * scale),
    y: Math.round((frame.y + 1) * scale),
    width: Math.round((frame.width - 2) * scale),
    height: Math.round((frame.height - 2) * scale),
  };
  const ruled = withoutRules(cropGray(full.gray, inside), 160, 0.5);
  const artwork = inkBox(cropGray(cropGray(full.gray, inside), ruled), 245, Math.round(scale));
  const box = {
    x: inside.x + ruled.x + artwork.x,
    y: inside.y + ruled.y + artwork.y,
    width: artwork.width,
    height: artwork.height,
  };

  return {
    gray: cropGray(full.gray, box),
    colour: cropRgb(full.colour, box),
    scale,
    origin: { x: box.x, y: box.y },
  };
}
