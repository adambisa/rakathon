import { setTimeout as wait } from "node:timers/promises";

import { getTokenProvider } from "@aws/bedrock-token-generator";
import type { Page } from "mupdf";
import { z } from "zod";

import { renderPage } from "#pdf";
import type { PageReader, ReaderLog, ReaderStrategy } from "#reader";

const PROMPT =
  "Transcribe all text on this page exactly as written, in reading order. " +
  "Keep the original language. Output only the transcribed text.";
const MAX_TOKENS = 4096;
const MAX_REQUEST_BYTES = 3_500_000;
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRY_DELAYS_MS = [1000, 4000];

const settings = z
  .object({
    EXTRACTION_READER: z.literal("bedrock-mantle"),
    EXTRACTION_MODEL: z.string().min(1),
    AWS_REGION: z.string().min(1),
    EXTRACTION_MODEL_RENDER_DPI: z.coerce.number().int().min(72).max(300).default(150),
    EXTRACTION_MODEL_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
    EXTRACTION_MODEL_REASONING: z.enum(["none", "minimal", "low", "medium", "high"]).default("none"),
  })
  .transform((env) => ({
    reader: env.EXTRACTION_READER,
    model: env.EXTRACTION_MODEL,
    region: env.AWS_REGION,
    renderDpi: env.EXTRACTION_MODEL_RENDER_DPI,
    timeoutMs: env.EXTRACTION_MODEL_TIMEOUT_MS,
    reasoning: env.EXTRACTION_MODEL_REASONING,
  }));

export type MantleSettings = z.output<typeof settings>;

const ChatCompletion = z.object({
  id: z.string().optional(),
  model: z.string().optional(),
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
  usage: z
    .object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() })
    .optional(),
});

export interface MantleIo {
  token?: () => Promise<string>;
  send?: typeof fetch;
  delay?: (ms: number) => Promise<void>;
  log?: ReaderLog | undefined;
}

function retryAfterMs(response: Response): number | undefined {
  const seconds = Number(response.headers.get("retry-after"));
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;

  return seconds * 1000;
}

export function createMantleReader(config: MantleSettings, io: MantleIo = {}): PageReader {
  const { token = getTokenProvider({ region: config.region }), send = fetch, delay = wait, log } = io;
  // Gemma 4 is served under /openai/v1 only; plain /v1 rejects it as an unsupported route.
  const url = `https://bedrock-mantle.${config.region}.api.aws/openai/v1/chat/completions`;

  const post = async (body: string, attempt = 0): Promise<{ response: Response; attempts: number }> => {
    const response = await send(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    const backoff = RETRY_DELAYS_MS[attempt];
    if (response.ok || !RETRY_STATUSES.has(response.status) || backoff === undefined) {
      return { response, attempts: attempt + 1 };
    }
    await response.body?.cancel();
    await delay(retryAfterMs(response) ?? backoff);

    return post(body, attempt + 1);
  };

  const readPage = async (page: Page): Promise<string> => {
    const jpeg = renderPage(page, config.renderDpi, "jpeg");
    const body = JSON.stringify({
      model: config.model,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      reasoning_effort: config.reasoning,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: PROMPT },
            {
              type: "image_url",
              image_url: { url: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}` },
            },
          ],
        },
      ],
    });
    const bytes = Buffer.byteLength(body);
    if (bytes > MAX_REQUEST_BYTES) {
      throw new RangeError(
        `Page renders to ${bytes} request bytes at ${config.renderDpi} DPI; ${config.model} accepts at most ${MAX_REQUEST_BYTES}`,
      );
    }

    const started = Date.now();
    const { response, attempts } = await post(body);
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`${config.model} failed with HTTP ${response.status}: ${detail.slice(0, 300)}`);
    }

    const completion = ChatCompletion.safeParse(await response.json());
    if (!completion.success) {
      const fields = completion.error.issues.map((issue) => issue.path.join("."));
      throw new TypeError(`${config.model} returned an unexpected completion: ${fields.join(", ")}`);
    }
    const text = completion.data.choices[0]?.message.content;
    if (text === null || text === undefined) {
      throw new TypeError(`${config.model} returned no text`);
    }

    log?.({
      reader: "bedrock-mantle",
      model: completion.data.model ?? config.model,
      responseId: completion.data.id,
      ms: Date.now() - started,
      attempts,
      requestBytes: bytes,
      inputTokens: completion.data.usage?.prompt_tokens,
      outputTokens: completion.data.usage?.completion_tokens,
    });

    return text.trim();
  };

  return { source: "model", readPage };
}

export const bedrockMantle = {
  settings,
  create: (config: MantleSettings, options) => createMantleReader(config, { log: options.log }),
} satisfies ReaderStrategy<MantleSettings>;
