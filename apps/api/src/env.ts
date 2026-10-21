import { z } from "zod";

const EnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    BETTER_AUTH_SECRET: z.string().min(32),
    BETTER_AUTH_URL: z.url().default("http://localhost:5173"),
    AWS_REGION: z.string().min(1).default("eu-central-1"),
    S3_DOCUMENT_BUCKET: z.string().min(3),
    DOCUMENT_INGEST_FUNCTION: z.string().min(1),
    REDCAP_API_URL: z.url().default("https://redcap.mou.cz/api/"),
    REDCAP_API_TOKEN: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{32}$/i)
      .optional(),
    REDCAP_GATEWAY_COOKIE_FILE: z.string().min(1).optional(),
    REDCAP_RELAY_URL: z.url().optional(),
    REDCAP_RELAY_SECRET: z
      .string()
      .regex(/^[\w-]{40,256}$/)
      .optional(),
    MIGRATIONS_DIR: z.string().min(1).default("../../packages/db/migrations"),
  })
  .superRefine((env, ctx) => {
    if ((env.REDCAP_RELAY_URL === undefined) !== (env.REDCAP_RELAY_SECRET === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["REDCAP_RELAY_SECRET"],
        message: "Relay URL and secret must be configured together",
      });
    }
    if (env.REDCAP_RELAY_URL !== undefined && URL.canParse(env.REDCAP_RELAY_URL)) {
      const url = new URL(env.REDCAP_RELAY_URL);
      if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
        ctx.addIssue({
          code: "custom",
          path: ["REDCAP_RELAY_URL"],
          message: "Relay requires a credential-free HTTPS URL",
        });
      }
      if (env.REDCAP_GATEWAY_COOKIE_FILE !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["REDCAP_GATEWAY_COOKIE_FILE"],
          message: "Gateway cookies belong on the relay",
        });
      }
    }
  })
  .readonly();

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(
      `Invalid environment: ${parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")}`,
    );
  }

  return parsed.data;
}
