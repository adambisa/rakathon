import assert from "node:assert/strict";
import test from "node:test";

import { Document, type Page } from "mupdf";

import { createMantleReader } from "#bedrock-mantle";
import { jpeg, settled } from "#tests/fixtures";

const config = {
  reader: "bedrock-mantle",
  model: "google.gemma-4-e2b",
  region: "eu-central-1",
  renderDpi: 72,
  timeoutMs: 1000,
  reasoning: "low",
} as const;
const token = async (): Promise<string> => settled("test-token");
const delay = async (): Promise<void> => settled(undefined);

async function withPage<T>(use: (page: Page) => Promise<T>): Promise<T> {
  const document = Document.openDocument(await jpeg(), "image/jpeg");
  const page = document.loadPage(0);
  try {
    return await use(page);
  } finally {
    page.destroy();
    document.destroy();
  }
}

interface Request {
  model: string;
  reasoning_effort?: string;
  messages: { content: { type: string; image_url?: { url: string } }[] }[];
}

await test("sends a JPEG of the page to Mantle's /openai/v1 route and returns the trimmed text", async () => {
  const calls: { url: string; headers: Headers; body: Request }[] = [];
  const logs: Record<string, unknown>[] = [];
  const send: typeof fetch = async (url, init = {}) => {
    if (typeof url !== "string" || typeof init.body !== "string") throw new TypeError("Unexpected request");
    calls.push({ url, headers: new Headers(init.headers), body: JSON.parse(init.body) as Request });

    return settled(
      Response.json({
        id: "resp-1",
        model: "google.gemma-4-e2b",
        choices: [{ message: { content: "  Biopsie prostaty\n" } }],
        usage: { prompt_tokens: 300, completion_tokens: 6 },
      }),
    );
  };
  const reader = createMantleReader(config, { token, send, delay, log: (entry) => logs.push(entry) });

  assert.equal(reader.source, "model");
  assert.equal(await withPage(reader.readPage), "Biopsie prostaty");
  const [call] = calls;
  assert.equal(call?.url, "https://bedrock-mantle.eu-central-1.api.aws/openai/v1/chat/completions");
  assert.equal(call.headers.get("authorization"), "Bearer test-token");
  assert.equal(call.body.model, "google.gemma-4-e2b");
  assert.equal(call.body.reasoning_effort, "low");
  const image = call.body.messages[0]?.content.find((part) => part.type === "image_url");
  assert.match(image?.image_url?.url ?? "", /^data:image\/jpeg;base64,\/9j\//);
  assert.equal(logs.length, 1);
  assert.deepEqual(Object.keys(logs[0] ?? {}).toSorted(), [
    "attempts",
    "inputTokens",
    "model",
    "ms",
    "outputTokens",
    "reader",
    "requestBytes",
    "responseId",
  ]);
});

await test("retries throttled and server errors, honouring Retry-After", async () => {
  const statuses = [429, 503];
  const waits: number[] = [];
  const send: typeof fetch = async () => {
    const status = statuses.shift();
    if (status === undefined) return settled(Response.json({ choices: [{ message: { content: "ok" } }] }));
    const headers = status === 429 ? { "retry-after": "2" } : {};

    return settled(new Response("busy", { status, headers }));
  };
  const reader = createMantleReader(config, {
    token,
    send,
    delay: async (ms) => {
      waits.push(ms);
      await settled(undefined);
    },
  });

  assert.equal(await withPage(reader.readPage), "ok");
  assert.deepEqual(waits, [2000, 4000]);
});

await test("gives up after the retry budget and reports the response detail", async () => {
  let calls = 0;
  const send: typeof fetch = async () => {
    calls += 1;

    return settled(new Response("Too many tokens per day", { status: 429 }));
  };
  const reader = createMantleReader(config, { token, send, delay });

  await assert.rejects(
    withPage(reader.readPage),
    /google\.gemma-4-e2b failed with HTTP 429: Too many tokens per day/,
  );
  assert.equal(calls, 3);
});

await test("does not retry client errors", async () => {
  let calls = 0;
  const send: typeof fetch = async () => {
    calls += 1;

    return settled(new Response("bad request", { status: 400 }));
  };
  const reader = createMantleReader(config, { token, send, delay });

  await assert.rejects(withPage(reader.readPage), /HTTP 400/);
  assert.equal(calls, 1);
});

await test("rejects a completion without text", async () => {
  const send: typeof fetch = async () =>
    settled(Response.json({ choices: [{ message: { content: null } }] }));
  const reader = createMantleReader(config, { token, send, delay });

  await assert.rejects(withPage(reader.readPage), /returned no text/);
});
