import { z } from "zod";

import { type DatabaseConfig, loadDatabaseConfig } from "@prostapaper/db/config";

const settings = z.object({
  OPENAI_API_KEY_PARAMETER: z.string().min(1),
  MAPPING_PASSES: z.coerce.number().int().min(1).max(9).default(3),
  MAPPING_MODEL: z.string().min(1).optional(),
  MAPPING_CITATIONS: z.enum(["true", "false"]).default("false"),
});

export interface Env {
  database: DatabaseConfig;
  openaiApiKeyParameter: string;
  passes: number;
  model: string | undefined;
  citations: boolean;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = settings.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid mapping configuration: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  }

  return {
    database: loadDatabaseConfig(source),
    openaiApiKeyParameter: parsed.data.OPENAI_API_KEY_PARAMETER,
    passes: parsed.data.MAPPING_PASSES,
    model: parsed.data.MAPPING_MODEL,
    citations: parsed.data.MAPPING_CITATIONS === "true",
  };
}
