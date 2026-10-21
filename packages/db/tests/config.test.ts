import assert from "node:assert/strict";
import { test } from "node:test";

import { loadDatabaseConfig } from "#config";

const local = {
  PGHOST: "localhost",
  PGPORT: "5432",
  PGDATABASE: "synthetic",
  PGUSER: "app",
  PGPASSWORD: "synthetic-password",
  PGSSLMODE: "disable",
};

await test("local connection is normalized and complete", () => {
  assert.deepEqual(loadDatabaseConfig(local), {
    host: "localhost",
    port: 5432,
    database: "synthetic",
    user: "app",
    password: "synthetic-password",
    ssl: false,
  });
});

await test("remote connection requires verified TLS and startup CA configuration", () => {
  const remote = { ...local, PGHOST: "private.example", PGSSLMODE: "verify-full" };
  assert.throws(() => loadDatabaseConfig(remote), /NODE_EXTRA_CA_CERTS/);
  assert.equal(loadDatabaseConfig({ ...remote, NODE_EXTRA_CA_CERTS: "/certs/ca.pem" }).ssl, true);
  assert.throws(() => loadDatabaseConfig({ ...remote, PGSSLMODE: "require" }), /PGSSLMODE/);
  assert.throws(() => loadDatabaseConfig({ ...remote, PGSSLMODE: "disable" }), /PGHOST/);
});

await test("legacy URLs cannot override host or TLS settings", () => {
  for (const DATABASE_URL of [
    "postgres://user:secret@remote/db?ssl=no-verify",
    "postgres://user:secret@localhost/db?host=remote",
  ]) {
    assert.throws(() => loadDatabaseConfig({ ...local, DATABASE_URL }), /DATABASE_URL/);
  }
});

await test("configuration errors do not include secrets and missing fields are rejected", () => {
  assert.throws(
    () => loadDatabaseConfig({ ...local, PGPORT: "secret-invalid-port" }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /PGPORT/);
      assert.ok(!error.message.includes("secret-invalid-port"));
      assert.ok(!error.message.includes(local.PGPASSWORD));

      return true;
    },
  );
  assert.throws(() => loadDatabaseConfig({ ...local, PGUSER: "" }), /PGUSER/);
});
