import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { DOCUMENT_ACCEPT, DocumentContentType } from "@prostapaper/contracts";

import { openDocument, rgbPixels } from "#pdf";
import { describeMarks } from "#sector-marks";
import { createSectorSheetDetector, loadSectorSheets, SECTOR_SHEET_WIDTH } from "#sector-sheet";

const usage =
  "Usage: pnpm --filter @prostapaper/extraction sheet <file>... [--verbose]\n" +
  "Runs only the OpenCV sector-sheet reader on each page; no reader, S3 or model.";
const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { verbose: { type: "boolean", short: "v", default: false } },
});
if (positionals.length === 0) throw new Error(usage);

function contentTypeOf(file: string): DocumentContentType {
  const extension = extname(file).toLowerCase();
  const found = DocumentContentType.options.find((type) => DOCUMENT_ACCEPT[type].includes(extension));
  if (found === undefined) throw new Error(`Unsupported extension: ${extension}`);

  return found;
}

const detector = await createSectorSheetDetector(
  await loadSectorSheets(fileURLToPath(new URL("../templates", import.meta.url))),
);
const files = await Promise.all(positionals.map(async (file) => ({ file, bytes: await readFile(file) })));
try {
  for (const { file, bytes } of files) {
    const document = openDocument(bytes, contentTypeOf(file));
    for (let index = 0; index < document.countPages(); index += 1) {
      const page = document.loadPage(index);
      const started = Date.now();
      const { sectorSheet, inliers, marks } = detector.read(rgbPixels(page, SECTOR_SHEET_WIDTH));
      const ms = Date.now() - started;
      page.destroy();
      const where = `${basename(file)} p${index + 1}`;
      if (!sectorSheet || marks === undefined) {
        console.info(`${where}: not a sector sheet (${inliers} inliers, ${ms} ms)`);
        continue;
      }
      console.info(`${where}: sector sheet (${inliers} inliers), ${marks.foci.length} foci, ${ms} ms`);
      console.info(`  ${describeMarks(marks.foci)}`);
      if (values.verbose) {
        for (const [index, focus] of marks.foci.entries()) {
          console.info(`  značka ${index + 1}`);
          for (const sector of focus.sectors) {
            let flag = " ".repeat(6);
            if (focus.marked.includes(sector.id)) flag = "marked";
            console.info(
              `    ${flag} ${sector.id.padEnd(12)} share ${sector.share}  coverage ${sector.coverage}`,
            );
          }
        }
      }
    }
    document.destroy();
  }
} finally {
  detector.close();
}
