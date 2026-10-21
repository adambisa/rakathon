import { existsSync } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const LANGUAGES = ["ces"];
export interface SectorSheetFiles {
  sheet: string;
  template: string;
  labels: string;
}

/** The PI-RADS figure the hospital prints; a second form would go on this list. */
export const SECTOR_SHEETS: readonly SectorSheetFiles[] = [
  { sheet: "sector-map", template: "sector-map.jpg", labels: "sector-map-labels.u8.gz" },
];
export const SECTOR_SHEET_SETTINGS = "sector-sheet.json";

const MODEL_RELEASE = "4.0.0_best_int";

export const EXTRACTION_SETTINGS = {
  renderDpi: 300,
  languages: LANGUAGES,
  modelRelease: MODEL_RELEASE,
  engine: "LSTM_ONLY",
  pageSegmentation: "SINGLE_BLOCK (Tesseract.js default)",
  readingOrder: "coordinate-table-rows-v2",
} as const;

const CORE_VARIANTS = ["tesseract-core", "tesseract-core-simd", "tesseract-core-relaxedsimd"];

const TESSERACT_DEPENDENCIES = ["bmp-js", "is-url", "regenerator-runtime", "wasm-feature-detect"];

/** MuPDF hides its own package.json, and pnpm keeps a package's dependencies private to it. */
function packageDirectory(name: string, from: string = import.meta.url): string {
  let directory = dirname(createRequire(from).resolve(name));
  while (!existsSync(join(directory, "package.json"))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Cannot locate the package directory for ${name}`);
    }
    directory = parent;
  }

  return directory;
}

const copy = async (source: string, target: string): Promise<void> => cp(source, target, { recursive: true });

export async function collectTessdata(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  await Promise.all(
    LANGUAGES.map(async (language) => {
      const file = `${language}.traineddata.gz`;

      return copy(
        join(packageDirectory(`@tesseract.js-data/${language}`), MODEL_RELEASE, file),
        join(target, file),
      );
    }),
  );
}

export async function collectSectorSheetAssets(target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  await Promise.all(
    [SECTOR_SHEET_SETTINGS, ...SECTOR_SHEETS.flatMap(({ template, labels }) => [template, labels])].map(
      async (file) =>
        copy(fileURLToPath(new URL(`../templates/${file}`, import.meta.url)), join(target, file)),
    ),
  );
}

/** MuPDF and the Tesseract cores load WebAssembly from beside themselves; OpenCV exports a promise
 * from CommonJS, which an ESM bundle's interop breaks. None of them bundles. */
export async function collectAssets(target: string): Promise<void> {
  const modules = join(target, "node_modules");
  const mupdf = packageDirectory("mupdf");
  const tesseract = packageDirectory("tesseract.js");
  const core = packageDirectory("tesseract.js-core");
  const opencv = packageDirectory("@techstark/opencv-js");

  await Promise.all([
    collectTessdata(join(target, "tessdata")),
    collectSectorSheetAssets(target),
    copy(join(mupdf, "dist"), join(modules, "mupdf", "dist")),
    copy(join(mupdf, "package.json"), join(modules, "mupdf", "package.json")),
    copy(join(opencv, "dist", "opencv.js"), join(modules, "@techstark", "opencv-js", "dist", "opencv.js")),
    copy(join(opencv, "package.json"), join(modules, "@techstark", "opencv-js", "package.json")),
    copy(join(tesseract, "src"), join(modules, "tesseract.js", "src")),
    copy(join(tesseract, "package.json"), join(modules, "tesseract.js", "package.json")),
    copy(join(core, "package.json"), join(modules, "tesseract.js-core", "package.json")),
    ...CORE_VARIANTS.flatMap((variant) =>
      [`${variant}.js`, `${variant}.wasm`].map(async (file) =>
        copy(join(core, file), join(modules, "tesseract.js-core", file)),
      ),
    ),
    ...TESSERACT_DEPENDENCIES.map(async (dependency) =>
      copy(packageDirectory(dependency, join(tesseract, "package.json")), join(modules, dependency)),
    ),
  ]);
}
