import { z } from "zod";

import { bedrockMantle, type MantleSettings } from "#bedrock-mantle";
import type { PageReader, ReaderOptions, ReaderStrategy } from "#reader";
import { tesseract, type TesseractSettings } from "#tesseract";

interface ReaderSettings {
  tesseract: TesseractSettings;
  "bedrock-mantle": MantleSettings;
}
export type ReaderName = keyof ReaderSettings;
export type ReaderConfig = ReaderSettings[ReaderName];

const readers: { [Name in ReaderName]: ReaderStrategy<ReaderSettings[Name]> } = {
  tesseract,
  "bedrock-mantle": bedrockMantle,
};

const readerSchema = z.discriminatedUnion("EXTRACTION_READER", [tesseract.settings, bedrockMantle.settings]);

export function loadReaderConfig(source: NodeJS.ProcessEnv): ReaderConfig {
  const parsed = readerSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join("."));
    throw new Error(`Invalid extraction reader configuration: ${fields.join(", ")}`);
  }

  return parsed.data;
}

export function createPageReader<Name extends ReaderName>(
  config: ReaderSettings[Name] & { reader: Name },
  options: ReaderOptions,
): PageReader {
  return readers[config.reader].create(config, options);
}
