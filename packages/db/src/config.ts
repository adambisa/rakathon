import { z } from "zod";

const connectionFields = z.object({
  PGHOST: z.string().min(1),
  PGPORT: z.coerce.number().int().min(1).max(65_535),
  PGDATABASE: z.string().min(1),
  PGUSER: z.string().min(1),
  PGPASSWORD: z.string().min(1),
  DATABASE_URL: z.never().optional(),
});

const localConnection = connectionFields.extend({
  PGSSLMODE: z.literal("disable"),
  PGHOST: z.enum(["localhost", "127.0.0.1", "db"]),
});

const verifiedConnection = connectionFields.extend({
  PGSSLMODE: z.literal("verify-full"),
  NODE_EXTRA_CA_CERTS: z.string().min(1),
});

const connectionSchema = z
  .discriminatedUnion("PGSSLMODE", [localConnection, verifiedConnection])
  .transform((settings) => ({
    host: settings.PGHOST,
    port: settings.PGPORT,
    database: settings.PGDATABASE,
    user: settings.PGUSER,
    password: settings.PGPASSWORD,
    ssl: settings.PGSSLMODE === "verify-full",
  }));

export function loadDatabaseConfig(source: NodeJS.ProcessEnv): DatabaseConfig {
  const parsed = connectionSchema.safeParse(source);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join("."));
    throw new Error(`Invalid database configuration: ${fields.join(", ")}`);
  }

  return parsed.data;
}
export type DatabaseConfig = z.output<typeof connectionSchema>;
