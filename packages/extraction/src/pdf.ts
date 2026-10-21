import { ColorSpace, Document, Matrix, type Page, Pixmap } from "mupdf";

import type { DocumentContentType } from "@prostapaper/contracts";

const POINTS_PER_INCH = 72;
const JPEG_QUALITY = 85;

/** Opens a PDF or a raster image; MuPDF treats images as single- or multi-frame documents. */
export function openDocument(bytes: Uint8Array, contentType: DocumentContentType): Document {
  const document = Document.openDocument(bytes, contentType);
  if (document.needsPassword()) {
    document.destroy();
    throw new Error("Encrypted documents are not supported");
  }

  return document;
}

export function renderPage(page: Page, dpi: number, format: "png" | "jpeg" = "png"): Uint8Array {
  const scale = dpi / POINTS_PER_INCH;
  const pixmap = page.toPixmap(Matrix.scale(scale, scale), ColorSpace.DeviceGray, false);
  try {
    return format === "png" ? pixmap.asPNG() : pixmap.asJPEG(JPEG_QUALITY);
  } finally {
    pixmap.destroy();
  }
}

/** Grayscale through a red filter: red pen marks turn paper white, where plain grayscale makes them dark blobs. */
export function renderPageWithoutRed(page: Page, dpi: number): Uint8Array {
  const scale = dpi / POINTS_PER_INCH;
  const color = page.toPixmap(Matrix.scale(scale, scale), ColorSpace.DeviceRGB, false);
  try {
    const columns = color.getWidth();
    const rows = color.getHeight();
    const components = color.getNumberOfComponents();
    const sourceStride = color.getStride();
    const [x0, y0, x1, y1] = color.getBounds();
    const gray = new Pixmap(ColorSpace.DeviceGray, [x0 ?? 0, y0 ?? 0, x1 ?? columns, y1 ?? rows], false);
    try {
      // Taken after both pixmaps exist: allocating the second can grow the WASM memory and detach an earlier view.
      const source = color.getPixels();
      const target = gray.getPixels();
      const targetStride = gray.getStride();
      for (let row = 0; row < rows; row += 1) {
        for (let column = 0; column < columns; column += 1) {
          target[row * targetStride + column] = source[row * sourceStride + column * components] ?? 255;
        }
      }

      return gray.asPNG();
    } finally {
      gray.destroy();
    }
  } finally {
    color.destroy();
  }
}

export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Renders a page in grayscale at a fixed pixel width, packed one byte per pixel. */
export function grayPixels(page: Page, width: number): GrayImage {
  const [x0, , x1] = page.getBounds();
  const scale = width / (x1 - x0);
  const pixmap = page.toPixmap(Matrix.scale(scale, scale), ColorSpace.DeviceGray, false);
  try {
    const columns = pixmap.getWidth();
    const rows = pixmap.getHeight();
    const stride = pixmap.getStride();
    const pixels = pixmap.getPixels();
    const data = new Uint8Array(columns * rows);
    for (let row = 0; row < rows; row += 1) {
      data.set(pixels.subarray(row * stride, row * stride + columns), row * columns);
    }

    return { width: columns, height: rows, data };
  } finally {
    pixmap.destroy();
  }
}

export interface RgbImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** Renders a page in RGB at a fixed pixel width, packed three bytes per pixel. */
export function rgbPixels(page: Page, width: number): RgbImage {
  const [x0, , x1] = page.getBounds();
  const scale = width / (x1 - x0);
  const pixmap = page.toPixmap(Matrix.scale(scale, scale), ColorSpace.DeviceRGB, false);
  try {
    const columns = pixmap.getWidth();
    const rows = pixmap.getHeight();
    const stride = pixmap.getStride();
    const pixels = pixmap.getPixels();
    const data = new Uint8Array(columns * rows * 3);
    for (let row = 0; row < rows; row += 1) {
      data.set(pixels.subarray(row * stride, row * stride + columns * 3), row * columns * 3);
    }

    return { width: columns, height: rows, data };
  } finally {
    pixmap.destroy();
  }
}

export function grayFromRgb({ width, height, data }: RgbImage): GrayImage {
  const gray = new Uint8Array(width * height);
  for (let index = 0; index < gray.length; index += 1) {
    const offset = index * 3;
    gray[index] = Math.round(
      0.299 * (data[offset] ?? 0) + 0.587 * (data[offset + 1] ?? 0) + 0.114 * (data[offset + 2] ?? 0),
    );
  }

  return { width, height, data: gray };
}
