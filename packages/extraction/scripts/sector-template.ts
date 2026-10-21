import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import * as mupdf from "mupdf";

import type { GrayImage } from "#pdf";
import {
  renderSectorFigure,
  SECTOR_FIGURE_PAGE,
  SECTOR_FIGURE_PDF,
  SECTOR_FIGURE_WIDTH,
} from "#scripts/sector-figure";

const usage =
  "Usage: node scripts/sector-template.ts [--pdf <file>] [--out <file>]\n" +
  "Renders the PI-RADS sector map figure as the blank grayscale template the detector matches against.";

const { values } = parseArgs({
  options: {
    pdf: { type: "string", default: SECTOR_FIGURE_PDF },
    out: { type: "string", default: fileURLToPath(new URL("../templates/sector-map.jpg", import.meta.url)) },
  },
});
if (values.pdf.length === 0) throw new Error(usage);

function jpeg(image: GrayImage, quality: number): Uint8Array {
  const pixmap = new mupdf.Pixmap(mupdf.ColorSpace.DeviceGray, [0, 0, image.width, image.height], false);
  pixmap.getPixels().set(image.data);

  return pixmap.asJPEG(quality, false);
}

const figure = await renderSectorFigure(SECTOR_FIGURE_WIDTH, values.pdf);
await writeFile(values.out, jpeg(figure.gray, 92));
console.info({
  page: SECTOR_FIGURE_PAGE,
  scale: Number(figure.scale.toFixed(3)),
  template: [figure.gray.width, figure.gray.height],
  out: values.out,
});
