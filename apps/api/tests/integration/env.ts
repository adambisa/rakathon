import { z } from "zod";

export const integration = z
  .object({
    NODE_ENV: z.literal("production"),
    INTEGRATION_URL: z.url(),
    COMPOSE_PROJECT_NAME: z.string().startsWith("prostapaper-test-"),
    SEED_USER_PASSWORD: z.string().min(12),
  })
  .parse(process.env);
