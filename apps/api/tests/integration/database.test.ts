import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { promisify } from "node:util";

import { createTRPCClient, httpBatchLink, httpLink } from "@trpc/client";
import { z } from "zod";

import { DatabaseService } from "#database/service";
import { integration } from "#integration/env";
import type { AppRouter } from "#trpc/router";

const execute = promisify(execFile);
const repository = new URL("../../../../", import.meta.url);

async function compose(...args: string[]): Promise<string> {
  const result = await execute(
    "docker",
    ["compose", "--project-name", integration.COMPOSE_PROJECT_NAME, ...args],
    { cwd: repository, timeout: 120_000 },
  );

  return result.stdout.trim();
}

function client(url: string, cookie = "") {
  return createTRPCClient<AppRouter>({
    links: [httpLink({ url: `${url}/api/trpc`, headers: { cookie, connection: "close" } })],
  });
}

async function signIn(url: string): Promise<string> {
  const response = await fetch(`${url}/api/trpc/auth.signIn`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url, connection: "close" },
    body: JSON.stringify({
      email: "reviewer@prostapaper.local",
      password: integration.SEED_USER_PASSWORD,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  assert.ok(response.ok, `Sign-in failed with ${response.status}`);

  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(";", 1)[0] ?? entry)
    .join("; ");
}

async function status(url: string, path: string): Promise<number> {
  const response = await fetch(`${url}${path}`, {
    signal: AbortSignal.timeout(15_000),
    headers: { connection: "close" },
  });

  return response.status;
}

const emailMigration = await readFile(
  new URL("packages/db/migrations/0003_funny_steel_serpent.sql", repository),
  "utf8",
);

await test("email migration preserves display addresses and canonicalizes existing accounts", async () => {
  const database = new DatabaseService();
  const connection = await database.db.$client.connect();
  try {
    await connection.query("BEGIN");
    await connection.query('DROP TRIGGER user_display_email ON auth."user"');
    await connection.query('ALTER TABLE auth."user" DROP COLUMN display_email');
    await connection.query(`INSERT INTO auth."user" (id, name, email) VALUES
      ('migration-gmail', 'Legacy', 'Migration.Test+legacy@GoogleMail.com'),
      ('migration-yahoo', 'Legacy', 'migration-base-legacy@yahoo.com'),
      ('migration-outlook', 'Legacy', 'migration+legacy@outlook.com'),
      ('migration-icloud', 'Legacy', 'migration+legacy@icloud.com'),
      ('migration-yandex', 'Legacy', 'Migration@ya.ru'),
      ('migration-hospital', 'Legacy', 'Migration.Name+legacy@hospital.cz')`);
    await connection.query(emailMigration);
    const result = await connection.query<{ id: string; email: string; display_email: string }>(
      `SELECT id, email, display_email FROM auth."user" WHERE id LIKE 'migration-%' ORDER BY id`,
    );
    assert.deepEqual(result.rows, [
      {
        id: "migration-gmail",
        email: "migrationtest@gmail.com",
        display_email: "Migration.Test+legacy@GoogleMail.com",
      },
      {
        id: "migration-hospital",
        email: "migration.name+legacy@hospital.cz",
        display_email: "Migration.Name+legacy@hospital.cz",
      },
      { id: "migration-icloud", email: "migration@icloud.com", display_email: "migration+legacy@icloud.com" },
      {
        id: "migration-outlook",
        email: "migration@outlook.com",
        display_email: "migration+legacy@outlook.com",
      },
      {
        id: "migration-yahoo",
        email: "migration-base@yahoo.com",
        display_email: "migration-base-legacy@yahoo.com",
      },
      { id: "migration-yandex", email: "migration@yandex.ru", display_email: "Migration@ya.ru" },
    ]);
  } finally {
    await connection.query("ROLLBACK");
    connection.release();
    await database.close();
  }
});

await test("email migration refuses to merge existing alias accounts", async () => {
  const database = new DatabaseService();
  const connection = await database.db.$client.connect();
  try {
    await connection.query("BEGIN");
    await connection.query('DROP TRIGGER user_display_email ON auth."user"');
    await connection.query('ALTER TABLE auth."user" DROP COLUMN display_email');
    await connection.query(`INSERT INTO auth."user" (id, name, email) VALUES
      ('collision-first', 'Legacy', 'migrationcollision+first@gmail.com'),
      ('collision-second', 'Legacy', 'migrationcollision+second@gmail.com')`);
    await assert.rejects(connection.query(emailMigration), /Email aliases collide/);
  } finally {
    await connection.query("ROLLBACK");
    connection.release();
    await database.close();
  }
});

async function authRequest(path: string, body: object, ip: string): Promise<Response> {
  const url = integration.INTEGRATION_URL;

  return fetch(`${url}/api/trpc/auth.${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url, "x-forwarded-for": ip, connection: "close" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
}

function sessionCookie(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((entry) => entry.split(";", 1)[0] ?? entry)
    .join("; ");
}

await test("registration preserves display addresses, rejects aliases and signs in to one reviewer", async () => {
  const prefix = randomUUID().replaceAll("-", "");
  const mailboxes = [
    {
      display: `${prefix}.Review+signup@GoogleMail.com`,
      alias: `${prefix}review+signin@gmail.com`,
      canonical: `${prefix}review@gmail.com`,
    },
    {
      display: `${prefix}-signup@yahoo.com`,
      alias: `${prefix}-signin@yahoo.com`,
      canonical: `${prefix}@yahoo.com`,
    },
    {
      display: `${prefix}-base-signup@ymail.com`,
      alias: `${prefix}-base-signin@ymail.com`,
      canonical: `${prefix}-base@ymail.com`,
    },
    {
      display: `${prefix}+signup@outlook.com`,
      alias: `${prefix}+signin@outlook.com`,
      canonical: `${prefix}@outlook.com`,
    },
    {
      display: `${prefix}+signup@icloud.com`,
      alias: `${prefix}+signin@icloud.com`,
      canonical: `${prefix}@icloud.com`,
    },
  ];
  await Promise.all(
    mailboxes.map(async ({ display, alias, canonical }, index) => {
      const ip = `192.0.2.${index + 1}`;
      const created = await authRequest(
        "signUp",
        { email: display, name: " Registered Reviewer ", password: integration.SEED_USER_PASSWORD },
        ip,
      );
      assert.equal(created.status, 200);
      const result = z
        .object({
          result: z.object({
            data: z.object({
              user: z.object({
                id: z.string(),
                email: z.email(),
                displayEmail: z.email(),
                role: z.string(),
                name: z.string(),
              }),
            }),
          }),
        })
        .parse(await created.json()).result.data;
      assert.equal(result.user.email, canonical);
      assert.equal(result.user.displayEmail, display);
      assert.equal(result.user.role, "reviewer");
      assert.equal(result.user.name, "Registered Reviewer");
      const cookie = sessionCookie(created);
      assert.ok(cookie.includes("prostapaper.session_token"));
      const registeredUser = await client(integration.INTEGRATION_URL, cookie).me.query();
      assert.equal(registeredUser.id, result.user.id);
      const duplicate = await authRequest(
        "signUp",
        { email: alias, name: "Duplicate", password: integration.SEED_USER_PASSWORD },
        ip,
      );
      assert.equal(duplicate.status, 409);
      const signedIn = await authRequest(
        "signIn",
        { email: alias, password: integration.SEED_USER_PASSWORD },
        ip,
      );
      assert.equal(signedIn.status, 200);
      const signedInUser = await client(integration.INTEGRATION_URL, sessionCookie(signedIn)).me.query();
      assert.equal(signedInUser.id, result.user.id);
    }),
  );
});

await test("registration rejects invalid input and server-owned fields", async () => {
  const invalid = [
    {},
    { email: " spaced@example.com", name: "Reviewer", password: integration.SEED_USER_PASSWORD },
    { email: "spaced@example.com ", name: "Reviewer", password: integration.SEED_USER_PASSWORD },
    { email: 42, name: "Reviewer", password: integration.SEED_USER_PASSWORD },
    { email: null, name: "Reviewer", password: integration.SEED_USER_PASSWORD },
    { email: "invalid", name: "Reviewer", password: integration.SEED_USER_PASSWORD },
    { email: "invalid@prostapaper.local", name: " ", password: integration.SEED_USER_PASSWORD },
    { email: "invalid@prostapaper.local", name: "Reviewer", password: "short" },
    { email: "invalid@prostapaper.local", name: "Reviewer", password: "x".repeat(129) },
    {
      email: "invalid@prostapaper.local",
      name: "Reviewer",
      password: integration.SEED_USER_PASSWORD,
      role: "admin",
    },
    {
      email: "invalid@prostapaper.local",
      name: "Reviewer",
      password: integration.SEED_USER_PASSWORD,
      displayEmail: "spoofed@example.com",
    },
  ];
  await Promise.all(
    invalid.map(async (body, index) => {
      const response = await authRequest("signUp", body, `192.0.2.${index + 10}`);
      assert.equal(response.status, 400);
      assert.equal(sessionCookie(response), "");
    }),
  );
});

await test("concurrent aliases cannot create two accounts for one inbox", async () => {
  const base = randomUUID().replaceAll("-", "");
  const responses = await Promise.all(
    ["first", "second"].map(async (tag, index) =>
      authRequest(
        "signUp",
        { email: `${base}+${tag}@gmail.com`, name: "Concurrent", password: integration.SEED_USER_PASSWORD },
        `192.0.2.${index + 30}`,
      ),
    ),
  );
  assert.equal(responses.filter((response) => response.ok).length, 1);
  assert.equal(responses.filter((response) => !response.ok).length, 1);
});

await test("registration rate limits repeated attempts", async () => {
  const responses = await Promise.all(
    Array.from({ length: 6 }, async () =>
      authRequest("signUp", { email: "invalid", name: "Reviewer", password: "short" }, "192.0.2.40"),
    ),
  );
  assert.equal(responses.filter((response) => response.status === 400).length, 5);
  assert.equal(responses.filter((response) => response.status === 429).length, 1);
});

await test("guest sign-in creates an isolated reviewer without credentials", async () => {
  const url = integration.INTEGRATION_URL;
  const response = await authRequest("signInAsGuest", {}, "192.0.2.70");
  assert.equal(response.status, 200);
  const cookie = sessionCookie(response);
  assert.ok(cookie.includes("prostapaper.session_token"));
  const api = client(url, cookie);
  const guest = await api.me.query();
  assert.equal(guest.isAnonymous, true);
  assert.equal(guest.name, "Host");
  assert.equal(guest.role, "reviewer");
  assert.match(guest.email, /@anonymous\.placeholder\.invalid$/);
  assert.equal(guest.displayEmail, guest.email);
  await assert.rejects(
    api.case.create.mutate({ name: "Hostovský případ" }),
    /Guests can only use example cases/,
  );
  await assert.rejects(
    api.document.register.mutate({
      caseId: randomUUID(),
      documentId: randomUUID(),
      kind: "text_description",
      file: { filename: "custom.jpg", contentType: "image/jpeg", size: 100 },
    }),
    /Guests can only use example cases/,
  );
  await assert.rejects(
    api.document.presign.mutate({ documentId: randomUUID() }),
    /Guests can only use example cases/,
  );
  const { cases } = await api.case.list.query({ limit: 20 });
  assert.deepEqual(cases, []);
  const reviewer = await client(url, await signIn(url)).me.query();
  assert.equal(reviewer.isAnonymous, false);
  const repeated = await fetch(`${url}/api/trpc/auth.signInAsGuest`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url, cookie, "x-forwarded-for": "192.0.2.70" },
    body: "{}",
  });
  assert.equal(repeated.status, 400);
  const limited = await Promise.all(
    Array.from({ length: 4 }, async () => authRequest("signInAsGuest", {}, "192.0.2.70")),
  );
  assert.equal(limited.filter((entry) => entry.status === 429).length, 1);
});

await test("tRPC auth rejects whitespace, protects origins and revokes sessions on sign-out", async () => {
  const url = integration.INTEGRATION_URL;
  await Promise.all(
    [" reviewer@prostapaper.local", "reviewer@prostapaper.local "].map(async (email) => {
      const response = await authRequest(
        "signIn",
        { email, password: integration.SEED_USER_PASSWORD },
        "192.0.2.50",
      );
      assert.equal(response.status, 400);
    }),
  );
  await Promise.all(
    [undefined, "https://untrusted.example"].map(async (origin) => {
      const headers = new Headers({ "content-type": "application/json" });
      if (origin !== undefined) {
        headers.set("origin", origin);
      }
      const response = await fetch(`${url}/api/trpc/auth.signIn`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          email: "reviewer@prostapaper.local",
          password: integration.SEED_USER_PASSWORD,
        }),
      });
      assert.equal(response.status, 403);
    }),
  );
  assert.equal(await status(url, "/api/auth/sign-in/email"), 404);
  const cookie = await signIn(url);
  const response = await fetch(`${url}/api/trpc/auth.signOut`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: url, cookie },
  });
  assert.equal(response.status, 200);
  assert.ok(response.headers.getSetCookie().some((entry) => entry.includes("Max-Age=0")));
  assert.equal(await client(url, cookie).session.get.query(), null);
});

await test("active sessions renew the browser cookie after a day", async () => {
  const url = integration.INTEGRATION_URL;
  const cookie = await signIn(url);
  const reviewer = await client(url, cookie).me.query();
  const database = new DatabaseService();
  try {
    await database.db.$client.query(
      `UPDATE auth.session SET updated_at = now() - interval '2 days',
        expires_at = now() + interval '5 days' WHERE user_id = $1`,
      [reviewer.id],
    );
    const response = await fetch(`${url}/api/trpc/session.get`, {
      headers: { cookie, connection: "close" },
    });
    assert.equal(response.status, 200);
    assert.ok(
      response.headers
        .getSetCookie()
        .some((entry) => entry.startsWith("prostapaper.session_token=") && entry.includes("Max-Age=604800")),
    );
    const renewed = await client(url, sessionCookie(response)).me.query();
    assert.equal(renewed.id, reviewer.id);
  } finally {
    await database.close();
  }
});

await test("the frontend batch transport forwards auth cookies", async () => {
  const url = integration.INTEGRATION_URL;
  let cookie = "";
  const api = createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `${url}/api/trpc`,
        headers: () => ({ origin: url, cookie, "x-forwarded-for": "192.0.2.60" }),
        fetch: async (input: unknown, init) => {
          assert.ok(typeof input === "string" || input instanceof URL);
          const response = await fetch(input, { ...init, signal: init?.signal ?? null });
          if (response.headers.getSetCookie().length > 0) {
            cookie = sessionCookie(response);
          }

          return response;
        },
      }),
    ],
  });
  const registered = await api.auth.signUp.mutate({
    email: `${randomUUID()}@example.com`,
    name: "Batch Reviewer",
    password: integration.SEED_USER_PASSWORD,
  });
  const reviewer = await api.me.query();
  assert.equal(reviewer.id, registered.user.id);
  await api.auth.signOut.mutate();
  assert.equal(await api.session.get.query(), null);
});

await test("cases persist across an API restart and startup migrations rerun safely", async () => {
  const anonymous = client(integration.INTEGRATION_URL);

  assert.equal(await anonymous.session.get.query(), null);

  await assert.rejects(anonymous.case.list.query({ limit: 20 }), {
    data: { code: "UNAUTHORIZED", httpStatus: 401, path: "case.list" },
  });

  await assert.rejects(anonymous.document.presignGet.query({ documentId: randomUUID() }), {
    data: { code: "UNAUTHORIZED", httpStatus: 401, path: "document.presignGet" },
  });

  const cookie = await signIn(integration.INTEGRATION_URL);
  const api = client(integration.INTEGRATION_URL, cookie);

  const session = await api.session.get.query();

  assert.ok(session !== null);
  assert.deepEqual(await api.me.query(), session.user);

  const item = await api.case.create.mutate({ name: "Synthetic integration case" });
  assert.equal(item.status, "draft");

  const { cases: listed } = await api.case.list.query({ limit: 20 });
  assert.ok(listed.some((row) => row.id === item.id));

  await assert.rejects(api.case.get.query({ caseId: randomUUID() }), {
    data: { code: "NOT_FOUND", httpStatus: 404, path: "case.get" },
  });

  const registration = await authRequest(
    "signUp",
    {
      email: `${randomUUID()}@example.com`,
      name: "Other owner",
      password: integration.SEED_USER_PASSWORD,
    },
    "192.0.2.70",
  );
  assert.ok(registration.ok);
  const other = client(integration.INTEGRATION_URL, sessionCookie(registration));
  const { cases: otherCases } = await other.case.list.query({ limit: 20 });
  assert.ok(!otherCases.some((row) => row.id === item.id));
  await assert.rejects(other.case.get.query({ caseId: item.id }), {
    data: { code: "NOT_FOUND", httpStatus: 404, path: "case.get" },
  });

  await compose("restart", "app");

  await compose("up", "-d", "--no-build", "--wait", "app");

  const url = `http://${await compose("port", "app", "3000")}`;

  assert.deepEqual(await client(url, cookie).case.get.query({ caseId: item.id }), item);
});

await test("database outage preserves liveness, hides SQL errors and recovers", async () => {
  const url = `http://${await compose("port", "app", "3000")}`;
  // Sign in first: an outage must read as a server error, not as a signed-out user.
  const cookie = await signIn(url);
  await compose("stop", "db");

  try {
    assert.equal(await status(url, "/api/health"), 200);
    assert.equal(await status(url, "/api/ready"), 503);
    await assert.rejects(client(url, cookie).case.list.query({ limit: 20 }), {
      message: "Internal server error",
      data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500, path: "case.list" },
    });
  } finally {
    await compose("start", "db");
    await compose("up", "-d", "--wait", "db");
  }

  assert.equal(await status(url, "/api/ready"), 200);
});
