import { buildLambda } from "@prostapaper/config/esbuild/lambda";
import { collectAssets } from "@prostapaper/extraction/assets";

const outdir = await buildLambda({
  external: ["mupdf", "tesseract.js", "tesseract.js-core", "@techstark/opencv-js"],
});
await collectAssets(outdir);
console.info(`document-ingest: collected extraction assets into ${outdir}/`);
