import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

import { createDatabaseClient, type Database } from "@prostapaper/db";
import { loadDatabaseConfig } from "@prostapaper/db/config";

const poolPolicy = {
  max: 5,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30_000,
  statement_timeout: 10_000,
  query_timeout: 12_000,
  options: "-c timezone=UTC",
  application_name: "prostapaper-api",
};

export class DatabaseService {
  readonly db: Database;

  constructor(source: NodeJS.ProcessEnv = process.env) {
    this.db = createDatabaseClient({ ...loadDatabaseConfig(source), ...poolPolicy });
    this.db.$client.on("error", () => console.error("Database idle connection failed"));
  }

  async migrate(migrationsFolder: string): Promise<void> {
    await migrate(this.db, { migrationsFolder });
  }

  async check(): Promise<void> {
    await this.db.execute(sql`SELECT 1`);
  }

  async close(): Promise<void> {
    await this.db.$client.end();
  }
}

export type DatabaseTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
