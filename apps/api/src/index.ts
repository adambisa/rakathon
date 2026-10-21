import { serve } from "@hono/node-server";

import { createApp } from "#app";
import { AuthService } from "#auth/service";
import { CaseService } from "#cases/service";
import { DatabaseService } from "#database/service";
import { DocumentService } from "#documents/service";
import { loadEnv } from "#env";
import { CaseIngestTrigger } from "#ingest/trigger";
import { RedcapClient } from "#redcap/client";
import { ReviewService } from "#review/service";
import { ObjectStorageService } from "#storage/service";

const env = loadEnv();
const database = new DatabaseService();
try {
  await database.migrate(env.MIGRATIONS_DIR);
  await database.check();
} catch (error) {
  const cause = error instanceof Error && "cause" in error ? error.cause : error;
  if (cause instanceof Error && "code" in cause) {
    console.error("Database initialization failed:", cause.code, cause.message);
  }
  await database.close();
  throw new Error("Database initialization failed");
}
const storage = new ObjectStorageService(env.AWS_REGION, env.S3_DOCUMENT_BUCKET);
const cases = new CaseService(storage, database, {
  ingest: new CaseIngestTrigger(env.AWS_REGION, env.DOCUMENT_INGEST_FUNCTION),
  redcap: new RedcapClient(env),
});
const app = createApp(env, {
  database,
  auth: new AuthService(env, database),
  cases,
  documents: new DocumentService(storage, database),
  reviews: new ReviewService(storage, database),
});

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.info(`api listening on http://localhost:${info.port}`);
});

const shutdownDeadlineMillis = 20_000;
const connectionDrainMillis = 5000;
let shuttingDown = false;

for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;

    shuttingDown = true;
    console.info(`${signal} received, closing`);

    const deadline = setTimeout(() => {
      console.error("Database/server shutdown exceeded its deadline");
      process.exit(1);
    }, shutdownDeadlineMillis).unref();

    const drain = setTimeout(() => {
      if ("closeAllConnections" in server) server.closeAllConnections();
    }, connectionDrainMillis).unref();

    async function closeDatabase() {
      try {
        await database.close();
        clearTimeout(deadline);
        clearTimeout(drain);
      } catch {
        console.error("Database shutdown failed");
        process.exitCode = 1;
      }
    }

    server.close(() => {
      void closeDatabase();
    });
  });
}
