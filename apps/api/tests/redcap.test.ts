import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { prepareRedcapUpload, toRedcapRows } from "@prostapaper/contracts";

import { loadEnv } from "#env";
import { fixture } from "#fixtures/surgery";
import { prepareRedcapSubmission, RedcapClient } from "#redcap/client";

const config = { REDCAP_API_URL: "https://redcap.example/api/", REDCAP_API_TOKEN: "a".repeat(32) };
const insecureRelayUrl = new URL("https://app.example/internal/redcap/api/");
insecureRelayUrl.protocol = "http:";

await test("relay preflight and import authenticate only to the relay and preserve the attempt ID", async () => {
  const secret = "synthetic-relay-secret-".repeat(3);
  const url = "https://app.example/internal/redcap/api/";
  const calls: URLSearchParams[] = [];
  const client = new RedcapClient(
    { ...config, REDCAP_RELAY_URL: url, REDCAP_RELAY_SECRET: secret },
    async (endpoint, init) => {
      await setImmediate();
      assert.equal(endpoint.href, url);
      assert.equal(init.redirect, "error");
      const headers = new Headers(init.headers);
      assert.equal(headers.get("Authorization"), `Bearer ${secret}`);
      assert.equal(headers.has("Cookie"), false);
      assert.ok(init.body instanceof URLSearchParams);
      calls.push(init.body);

      return init.body.get("content") === "project"
        ? Response.json({ project_id: 64, record_autonumbering_enabled: 1 })
        : Response.json(["synthetic-receipt"]);
    },
  );
  assert.deepEqual(await client.upload(fixture(), "synthetic-attempt"), { recordId: "synthetic-receipt" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1]?.get("token"), config.REDCAP_API_TOKEN);
  const rows = z.array(z.object({ record_id: z.string() })).parse(JSON.parse(calls[1].get("data") ?? "null"));
  assert.ok(rows.every((row) => row.record_id === "synthetic-attempt"));
});

await test("partial relay configuration, unsafe endpoints and gateway cookies fail before network", async () => {
  const noNetwork = () => {
    throw new Error("Unexpected network");
  };
  const relay = {
    REDCAP_RELAY_URL: "https://app.example/internal/redcap/api/",
    REDCAP_RELAY_SECRET: "s".repeat(64),
  };
  const invalid = [
    { REDCAP_RELAY_URL: relay.REDCAP_RELAY_URL },
    { REDCAP_RELAY_SECRET: relay.REDCAP_RELAY_SECRET },
    { ...relay, REDCAP_RELAY_URL: insecureRelayUrl.href },
    { ...relay, REDCAP_RELAY_URL: "https://app.example/api/?secret=oops" },
    { ...relay, REDCAP_RELAY_SECRET: "injected\r\nheader" },
    { ...relay, REDCAP_GATEWAY_COOKIE_FILE: "/private/cookies.json" },
  ];
  await Promise.all(
    invalid.map(async (overrides) => {
      await assert.rejects(
        new RedcapClient({ ...config, ...overrides }, noNetwork).checkProject(),
        /Invalid REDCap/,
      );
    }),
  );
});

await test("relay failures never fall back to MOÚ, retry imports or reveal either credential", async () => {
  const secret = "s".repeat(64);
  let calls = 0;
  const client = new RedcapClient(
    { ...config, REDCAP_RELAY_URL: "https://app.example/internal/redcap/api/", REDCAP_RELAY_SECRET: secret },
    async (url) => {
      await setImmediate();
      assert.equal(url.hostname, "app.example");
      calls++;

      return calls === 1
        ? Response.json({ project_id: 64, record_autonumbering_enabled: 1 })
        : Response.json({ error: `relay error ${secret} ${config.REDCAP_API_TOKEN}` }, { status: 502 });
    },
  );
  await assert.rejects(client.upload(fixture(), "synthetic-attempt"), (error: Error) => {
    assert.match(error.message, /Reconcile/);
    assert.ok(!error.message.includes(secret));
    assert.ok(!error.message.includes(config.REDCAP_API_TOKEN));

    return true;
  });
  assert.equal(calls, 2);
});

await test("environment validates paired HTTPS relay credentials without exposing values", () => {
  const base = {
    BETTER_AUTH_SECRET: "a".repeat(32),
    S3_DOCUMENT_BUCKET: "synthetic-bucket",
    DOCUMENT_INGEST_FUNCTION: "synthetic-ingest",
  };
  const relay = {
    REDCAP_RELAY_URL: "https://app.example/internal/redcap/api/",
    REDCAP_RELAY_SECRET: "s".repeat(64),
  };
  assert.equal(loadEnv({ ...base, ...relay }).REDCAP_RELAY_URL, relay.REDCAP_RELAY_URL);
  for (const overrides of [
    { REDCAP_RELAY_URL: relay.REDCAP_RELAY_URL },
    { REDCAP_RELAY_SECRET: relay.REDCAP_RELAY_SECRET },
    { ...relay, REDCAP_RELAY_URL: "invalid" },
    { ...relay, REDCAP_RELAY_URL: insecureRelayUrl.href },
    { ...relay, REDCAP_GATEWAY_COOKIE_FILE: "/private/cookies.json" },
  ])
    assert.throws(() => loadEnv({ ...base, ...overrides }), /^Error: Invalid environment:/);
});

await test("lesion submission ignores unavailable or invalid parent data and never completes the parent form", () => {
  const record = fixture();
  record.surgery.surgery_date = null;
  record.surgery.surgery_type = null;
  record.surgery.node_no_surgery = 999;
  record.surgery.surgery_text = "x".repeat(20_001);
  const prepared = prepareRedcapSubmission(record, "lesions-only");
  const rows = z.array(z.record(z.string(), z.string())).parse(JSON.parse(prepared.data));
  assert.deepEqual(rows[0], {
    record_id: "lesions-only",
    redcap_repeat_instrument: "",
    redcap_repeat_instance: "",
  });
  assert.equal(rows[1]?.["lesion_x_mm"], "12");
  assert.equal(rows[1]["surgery_c61_resected_lesion_complete"], "2");
  assert.ok(
    rows.every(
      (row) => !("surgery_date" in row) && !("surgery_text" in row) && !("surgery_c61_complete" in row),
    ),
  );
});

await test("projection produces record identity and validated repeating lesion rows", () => {
  const result = prepareRedcapUpload(toRedcapRows(fixture(), "CMP-test"));
  assert.deepEqual(result.errors, []);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows[1]?.["sur_prostate_regions___pzpl_base_ls"], "1");
});

await test("POST verifies project and auto-numbering, marks only lesion forms complete and returns the allocated ID", async () => {
  const calls: URLSearchParams[] = [];
  const record = fixture();
  const expected = prepareRedcapUpload(toRedcapRows(record, "CMP-test")).rows.map((row) =>
    row["redcap_repeat_instrument"] === "surgery_c61_resected_lesion"
      ? { ...row, surgery_c61_resected_lesion_complete: "2" }
      : row,
  );
  const client = new RedcapClient(config, async (input, init) => {
    await setImmediate();
    assert.equal(input.href, config.REDCAP_API_URL);
    assert.equal(init.method, "POST");
    assert.equal(init.redirect, "error");
    assert.ok(init.signal);
    assert.ok(init.body instanceof URLSearchParams);
    const form = init.body;
    calls.push(form);
    if (form.get("content") === "project") {
      assert.ok(record.lesions[0]);
      record.lesions[0].lesion_x_mm = 20;

      return Response.json({ project_id: 64, record_autonumbering_enabled: 1 });
    }

    return Response.json(["21"]);
  });
  assert.deepEqual(await client.upload(record, "CMP-test"), { recordId: "21" });
  assert.equal(calls.length, 2);
  const form = calls[1];
  assert.ok(form);
  assert.equal(form.get("action"), "import");
  assert.equal(form.get("token"), config.REDCAP_API_TOKEN);
  assert.equal(form.get("overwriteBehavior"), "normal");
  assert.equal(form.get("forceAutoNumber"), "true");
  assert.equal(form.get("returnContent"), "ids");
  assert.deepEqual(JSON.parse(form.get("data") ?? "null"), expected);
});

await test("wrong project and malformed rows stop before any import", async () => {
  let calls = 0;
  const client = new RedcapClient(config, async () => {
    await setImmediate();
    calls++;

    return Response.json({ project_id: 12 });
  });
  await assert.rejects(client.upload(fixture(), "CMP-test"), /project 64/);
  assert.equal(calls, 1);
  await assert.rejects(client.upload(fixture(), ""), TRPCError);
  assert.equal(calls, 1);
});

await test("unconfigured token and unsafe endpoint stop before network", async () => {
  const noNetwork = () => {
    throw new Error("Unexpected network");
  };
  await assert.rejects(
    new RedcapClient({ ...config, REDCAP_API_TOKEN: undefined }, noNetwork).checkProject(),
    /not configured/,
  );
  await assert.rejects(
    new RedcapClient(
      { ...config, REDCAP_API_URL: "https://user:password@redcap.example/api/" },
      noNetwork,
    ).checkProject(),
    /Invalid REDCap API URL/,
  );
});

await test("import failures never retry or reveal remote bodies and require reconciliation", async () => {
  const outcomes = [
    () => Response.json({ error: `clinical data ${config.REDCAP_API_TOKEN}` }),
    () => new Response("gateway CAPTCHA", { status: 200 }),
    () => new Response("sensitive server error", { status: 500 }),
    () => Response.json([]),
    () => {
      throw new Error(`timeout ${config.REDCAP_API_TOKEN}`);
    },
  ];
  await Promise.all(
    outcomes.map(async (outcome) => {
      let calls = 0;
      const client = new RedcapClient(config, async () => {
        await setImmediate();
        calls++;

        return calls === 1 ? Response.json({ project_id: 64, record_autonumbering_enabled: 1 }) : outcome();
      });
      await assert.rejects(client.upload(fixture(), "CMP-test"), (error: Error) => {
        assert.match(error.message, /Reconcile the target/);
        assert.ok(!error.message.includes(config.REDCAP_API_TOKEN));
        assert.ok(!error.message.includes("clinical"));

        return true;
      });
      assert.equal(calls, 2);
    }),
  );
});

await test("disabled auto-numbering stops before import", async () => {
  let calls = 0;
  const client = new RedcapClient(config, async () => {
    await setImmediate();
    calls++;

    return Response.json({ project_id: 64, record_autonumbering_enabled: 0 });
  });
  await assert.rejects(client.upload(fixture(), "case-id"), /automatic record numbering/);
  assert.equal(calls, 1);
});

await test("gateway cookies stay allowlisted, rotate privately and exclude login cookies", async () => {
  const directory = await mkdtemp(join(tmpdir(), "redcap-cookie-test-"));
  const file = join(directory, "gateway.json");
  try {
    await writeFile(file, JSON.stringify({ BNIS_vid: "gateway-fixture" }), { mode: 0o600 });
    let calls = 0;
    const client = new RedcapClient({ ...config, REDCAP_GATEWAY_COOKIE_FILE: file }, async (_url, init) => {
      await setImmediate();
      calls++;
      const headers = new Headers(init.headers);
      if (calls === 1) {
        assert.equal(headers.get("Cookie"), "BNIS_vid=gateway-fixture");

        return Response.json(
          { project_id: 64, record_autonumbering_enabled: 1 },
          { headers: { "Set-Cookie": "BNIS_vid=rotated-fixture; Path=/; Secure" } },
        );
      }
      assert.equal(headers.get("Cookie"), "BNIS_vid=rotated-fixture");

      return Response.json(["22"], {
        headers: { "Set-Cookie": "PHPSESSID=ignored-fixture; Path=/; Secure" },
      });
    });
    assert.deepEqual(await client.upload(fixture(), "temporary-id"), { recordId: "22" });
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { BNIS_vid: "rotated-fixture" });
    const permissions = await stat(file);
    assert.equal(permissions.mode & 0o777, 0o600);
    await writeFile(file, JSON.stringify({ PHPSESSID: "must-not-send" }));
    await assert.rejects(client.checkProject(), /Invalid REDCap gateway configuration/);
    assert.equal(calls, 2);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

await test("cookie rotations survive read-only mounts and an expired preflight never imports", async () => {
  const directory = await mkdtemp(join(tmpdir(), "redcap-readonly-test-"));
  const file = join(directory, "gateway.json");
  try {
    await writeFile(file, JSON.stringify({ BNIS_vid: "old-fixture" }), { mode: 0o600 });
    await chmod(directory, 0o500);
    const cookies: (string | null)[] = [];
    const client = new RedcapClient({ ...config, REDCAP_GATEWAY_COOKIE_FILE: file }, async (_url, init) => {
      await setImmediate();
      cookies.push(new Headers(init.headers).get("Cookie"));
      if (cookies.length === 1)
        return Response.json(
          { project_id: 64, record_autonumbering_enabled: 1 },
          { headers: { "Set-Cookie": "BNIS_vid=new-fixture; Path=/; Secure" } },
        );

      return Response.json(["23"]);
    });
    assert.deepEqual(await client.upload(fixture(), "submission-fixture"), { recordId: "23" });
    assert.deepEqual(cookies, ["BNIS_vid=old-fixture", "BNIS_vid=new-fixture"]);
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), { BNIS_vid: "old-fixture" });
    const controller = new AbortController();
    let calls = 0;
    const aborting = new RedcapClient(config, async () => {
      await setImmediate();
      calls++;
      controller.abort();

      return Response.json({ project_id: 64, record_autonumbering_enabled: 1 });
    });
    await assert.rejects(aborting.upload(fixture(), "submission-fixture", controller.signal), /abort/i);
    assert.equal(calls, 1);
  } finally {
    await chmod(directory, 0o700);
    await rm(directory, { recursive: true, force: true });
  }
});

await test("audit hashes describe exactly the serialized import payload", () => {
  const prepared = prepareRedcapSubmission(fixture(), "audit-attempt");
  assert.equal(prepared.payloadHash, createHash("sha256").update(prepared.data).digest("hex"));
  const rows = z.array(z.record(z.string(), z.string())).parse(JSON.parse(prepared.data));
  assert.equal(rows[0]?.["surgery_c61_complete"], undefined);
  assert.equal(rows[1]?.["surgery_c61_resected_lesion_complete"], "2");
});
