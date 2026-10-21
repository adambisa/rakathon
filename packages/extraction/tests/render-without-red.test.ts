import assert from "node:assert/strict";
import test from "node:test";

import { Document, Image } from "mupdf";
import { PDFDocument, rgb } from "pdf-lib";

import { renderPageWithoutRed } from "#pdf";

const PAGE_SIZE = 2400;
const DPI = 72;

async function darkest(color: ReturnType<typeof rgb>): Promise<number> {
  const source = await PDFDocument.create();
  const page = source.addPage([PAGE_SIZE, PAGE_SIZE]);
  page.drawRectangle({ x: 10, y: 10, width: 80, height: 80, color });
  const document = Document.openDocument(await source.save(), "application/pdf");
  const loaded = document.loadPage(0);
  try {
    const pixmap = new Image(renderPageWithoutRed(loaded, DPI)).toPixmap();
    try {
      return pixmap.getPixels().reduce((lowest, value) => Math.min(lowest, value), 255);
    } finally {
      pixmap.destroy();
    }
  } finally {
    loaded.destroy();
    document.destroy();
  }
}

await test("red ink renders as paper white", async () => {
  assert.ok((await darkest(rgb(0.85, 0.1, 0.1))) > 180);
});

await test("black ink stays dark", async () => {
  assert.ok((await darkest(rgb(0, 0, 0))) < 40);
});
