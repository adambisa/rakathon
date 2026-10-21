import { sql } from "drizzle-orm";

import type { Database } from "#client";

/** A transition runs on the pool or inside a caller's transaction; the guard trigger enforces it either way. */
export type Executor = Database | Parameters<Parameters<Database["transaction"]>[0]>[0];

export const now = sql`clock_timestamp()`;
