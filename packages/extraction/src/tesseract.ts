import type { Page } from "mupdf";
import { createWorker, OEM, type Worker } from "tesseract.js";
import { z } from "zod";

import { EXTRACTION_SETTINGS, LANGUAGES } from "#assets";
import { renderPageWithoutRed } from "#pdf";
import type { PageReader, ReaderStrategy } from "#reader";
import { reconstructPage } from "#reading-order";

const RENDER_DPI = EXTRACTION_SETTINGS.renderDpi;

const settings = z
  .object({ EXTRACTION_READER: z.literal("tesseract") })
  .transform((env) => ({ reader: env.EXTRACTION_READER }));

export type TesseractSettings = z.output<typeof settings>;

/** Tesseract throws from a worker event on failure, then never settles `createWorker`. */
async function startWorker(tessdataDirectory: string): Promise<Worker> {
  let onError!: (error: Error) => void;
  const failed = new Promise<never>((_, reject) => {
    onError = reject;
  });
  // `cacheMethod: "none"` keeps Tesseract from writing into a read-only deployment bundle.
  const starting = createWorker(LANGUAGES, OEM.LSTM_ONLY, {
    langPath: tessdataDirectory,
    cacheMethod: "none",
    errorHandler: (error: unknown) => {
      onError(new Error(`Tesseract failed: ${String(error)}`));
    },
  });

  return Promise.race([starting, failed]);
}

function createTesseractReader(tessdataDirectory: string): PageReader {
  let worker: Worker | undefined;

  const readPage = async (page: Page): Promise<string> => {
    worker ??= await startWorker(tessdataDirectory);
    const { data } = await worker.recognize(
      Buffer.from(renderPageWithoutRed(page, RENDER_DPI)),
      {},
      { blocks: true },
    );
    if (data.blocks !== null) {
      const reconstructed = reconstructPage(data.blocks);
      if (reconstructed.diagnostics.wordCount > 0) return reconstructed.text;
    }

    return data.text.trim();
  };

  return {
    source: "ocr",
    readPage,
    close: async () => {
      await worker?.terminate();
    },
  };
}

export const tesseract = {
  settings,
  create: (_: TesseractSettings, options) => createTesseractReader(options.tessdataDirectory),
} satisfies ReaderStrategy<TesseractSettings>;
