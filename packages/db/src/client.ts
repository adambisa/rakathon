import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool, PoolConfig } from "pg";

import * as authSchema from "#auth-schema";
import * as appSchema from "#schema";

const schema = { ...appSchema, ...authSchema };

export function createDatabaseClient(connection: PoolConfig): Database {
  return drizzle({ connection, schema });
}
export type Database = NodePgDatabase<typeof schema> & { $client: Pool };
