import { z } from "zod";

import { type DatabaseConfig, loadDatabaseConfig } from "@prostapaper/db/config";
import { loadReaderConfig, type ReaderConfig } from "@prostapaper/extraction";

const settings = z.object({ CASE_MAPPING_FUNCTION: z.string().min(1) });

export function loadEnv(): { database: DatabaseConfig; caseMappingFunction: string } {
  const env = settings.parse(process.env);

  return { database: loadDatabaseConfig(process.env), caseMappingFunction: env.CASE_MAPPING_FUNCTION };
}

export function loadReaderEnv(): ReaderConfig {
  return loadReaderConfig(process.env);
}
