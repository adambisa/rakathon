import { setImmediate as tick } from "node:timers/promises";

import { Document } from "mupdf";
import { PDFDocument, StandardFonts } from "pdf-lib";

import { renderPage } from "#pdf";

const PAGE_SIZE = 300;
const FONT_SIZE = 10;
const LINE_HEIGHT = 12;
const MARGIN = 20;

export async function settled<T>(value: T): Promise<T> {
  await tick();

  return value;
}

export async function pdf(lines: string[] = []): Promise<Uint8Array> {
  const document = await PDFDocument.create();
  const font = await document.embedFont(StandardFonts.Helvetica);
  const page = document.addPage([PAGE_SIZE, PAGE_SIZE]);
  for (const [index, line] of lines.entries()) {
    page.drawText(line, { x: MARGIN, y: PAGE_SIZE - MARGIN - index * LINE_HEIGHT, size: FONT_SIZE, font });
  }

  return document.save();
}

const RENDER_DPI = 150;

/** The same drawn page as a scan would deliver it: rendered and JPEG-encoded. */
export async function jpeg(lines: string[] = []): Promise<Uint8Array> {
  const document = Document.openDocument(await pdf(lines), "application/pdf");
  const page = document.loadPage(0);
  try {
    return renderPage(page, RENDER_DPI, "jpeg");
  } finally {
    page.destroy();
    document.destroy();
  }
}
