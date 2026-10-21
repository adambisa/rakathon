import { serveStatic } from "@hono/node-server/serve-static";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { logger } from "hono/logger";
import { requestId } from "hono/request-id";

import type { Env } from "#env";
import { type AppEnv, type AppServices, createContextFactory } from "#trpc/context";
import { appRouter } from "#trpc/router";

export function createApp(env: Env, services: AppServices): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.use("*", requestId());
  if (env.NODE_ENV === "development") {
    app.use("*", logger());
  }

  app.get("/api/health", (c) => c.json({ ok: true, at: new Date().toISOString() }));

  app.get("/api/ready", async (c) => {
    try {
      await services.database.check();
    } catch {
      throw new HTTPException(503, { message: "Database unavailable" });
    }

    return c.json({ ok: true });
  });

  app.use("/api/trpc/*", bodyLimit({ maxSize: 1024 * 1024 }));
  app.use(
    "/api/trpc/*",
    trpcServer({
      endpoint: "/api/trpc",
      router: appRouter,
      createContext: createContextFactory(services),
      // Fail-closed paths (checksum, pointer and identity mismatches) are otherwise invisible to operators.
      onError: ({ error, path, type }) => {
        if (error.code === "INTERNAL_SERVER_ERROR" || error.code === "PRECONDITION_FAILED")
          console.error(
            JSON.stringify({ event: "trpc_error", type, path, code: error.code, cause: error.cause?.name }),
          );
      },
    }),
  );

  app.all("/api/*", (c) => c.json({ error: "not found" }, 404));
  if (env.NODE_ENV === "production") {
    app.get(
      "/assets/*",
      serveStatic({
        root: "./public",
        onFound: (_path, c) => {
          c.header("Cache-Control", "public, max-age=31536000, immutable");
        },
      }),
    );
    app.all("/assets/*", async (c) => c.notFound());

    app.get(
      "*",
      serveStatic({
        root: "./public",
        onFound: (_path, c) => {
          c.header("Cache-Control", "no-store");
        },
      }),
    );

    app.get(
      "*",
      serveStatic({
        path: "./public/index.html",
        onFound: (_path, c) => {
          c.header("Cache-Control", "no-store");
        },
      }),
    );
  }

  app.notFound((c) => c.json({ error: "not found" }, 404));

  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      return err.getResponse();
    }
    console.error(`[${c.get("requestId")}] Request failed (${err.name})`);

    return c.json({ error: "internal error" }, 500);
  });

  return app;
}
