# LLM configuration — iterate on config, not code

> Future design, reconciled 2026-10-06: the LLM, extraction, mapping and evaluation
> packages/configurations described here are not implemented. Current checks do not
> call LLM providers or score clinical records. Use the [roadmap](07-skeleton-runbook.md)
> for delivery order.

Goal: provider, model, generation settings, speed/price tier, input handling and prompt variant are all **data**, validated once, hashed into every eval run, and selectable by name. We do not write provider clients: **Vercel AI SDK 7** (`ai` + `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai`) is the abstraction, and our config file is mostly _its_ options, extracted.

---

## 1. Why the AI SDK and not our own `LlmPort`

| Need                             | AI SDK 7 gives us                                                                                                                                                                                                       | What's still ours                                        |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Switch provider/model mid-run    | `createProviderRegistry({ anthropic, google, openai })` → `registry.languageModel("anthropic:claude-opus-5")`. The model is **resolved from a string per call**, so an eval cell or a fallback just changes the string. | the allowlist of strings we trust, with capability flags |
| Reasoning level across providers | standardized `reasoning` option on `generateText`/`streamText` (e.g. `'low'                                                                                                                                             | 'high'`), mapped to each provider's native setting       | nothing             |
| Provider-native knobs            | `providerOptions: { anthropic: {...}, openai: {...}, google: {...} }` per call — thinking config, OpenAI `serviceTier`, Google `thinkingConfig`, etc.                                                                   | a small `tier → providerOptions` translation (§3)        |
| Structured output from Zod       | the SDK's Zod-schema output option (`Output.object({ schema })` on `generateText`; `generateObject` in older code) — same Zod object as `packages/contracts`                                                            | one repair-retry on `safeParse` failure                  |
| PDF / image input                | file parts in the user message (`{ type: 'file', data, mediaType: 'application/pdf' }`), plus `uploadFile` for upload-once/reference-many                                                                               | `pdfMode: native                                         | rasterize` decision |
| Cross-cutting behaviour          | `languageModelMiddleware` on the registry / `wrapLanguageModel` — this is where the **content-hash cache**, the rate limiter and cost accounting live                                                                   | the middleware implementations (small)                   |
| Observability                    | `registerTelemetry`, `onStart`/`onEnd`, token + latency stats                                                                                                                                                           | writing them into `Run.results[]`                        |
| Retries                          | per-call `maxRetries`                                                                                                                                                                                                   | 429-aware fallback to the next model string (middleware) |

Not covered by the SDK, and therefore **out of scope unless time appears**: provider Batch APIs (50 % price, async). If we want cheap overnight runs, OpenAI `flex` via `providerOptions` is the SDK-native substitute.

Alternative considered: Vercel AI Gateway / OpenRouter (one key, server-side provider routing and fallbacks). Rejected for now: a third party in the data path for pathology text is a conversation we don't want to have with MOÚ, and the registry gives us the same switching locally. Can be added later as just another provider in the registry.

---

## 2. Config shape

A config is a **named, validated object whose fields are AI SDK call options plus a few of ours**. Zod-validated at load; resolved config hashed into every eval `Run` next to `promptHash`.

```ts
// packages/llm/src/config.ts
LlmConfig = {
  model: string,                       // "anthropic:claude-opus-5" | "google:gemini-…" | "openai:gpt-…" — registry string, allowlisted
  reasoning?: "low" | "medium" | "high" | "max",      // AI SDK standardized option, passed through
  tier?: "standard" | "flex" | "fast",                 // ours → translated to providerOptions (§3); illegal combos fail at load
  maxOutputTokens: number,
  temperature?: number,                // refused at load for models whose capability flag says acceptsTemperature=false
  providerOptions?: Record<string, unknown>,           // escape hatch: passed verbatim to the SDK, merged after tier translation
  output: "object" | "text+parse",     // SDK structured output vs. prompt-only JSON + safeParse
  input: { pdfMode: "native" | "rasterize", dpi?: number, maxPages?: number },   // extraction only
  context: { maxInputTokens: number, pagesPerCall?: number },                    // our guard, not an SDK param
  client: { maxRetries: number, timeoutMs: number, concurrency: number, fallbackModels?: string[] },
  cache: boolean,
}

PipelineConfig = { llm: LlmConfig, prompt: PromptVariant }     // PromptVariant: 04-evaluation-design §6.1
AppConfig = { extraction: PipelineConfig, mapping: PipelineConfig, synth: PipelineConfig }
```

Files, with `extends`:

```
configs/
├── base.json                  client defaults, cache on, context guards
├── models.json                allowlist: per registry string → { acceptsTemperature, tiers, reasoning, pdfNative, maxInput, priceIn, priceOut }
├── dev.json                   mapping+synth: openai flex, reasoning low; extraction: standard, concurrency 2
├── eval-fast.json             standard, concurrency 8, reasoning low              — the 2-minute A/B loop
├── eval-quality.json          reasoning high, 2 repeats                           — final provider decision
└── demo.json                  standard (or anthropic fast), reasoning medium, concurrency 2, cache on; flex forbidden
```

Selection: `LLM_CONFIG=eval-fast`, `--config`, or per-cell overrides (`--set mapping.llm.model=google:…`). Keys stay in env / Secrets Manager; the registry is built once from env, configs only name providers.

---

## 3. `tier` → `providerOptions` translation (the only provider knowledge we keep)

| tier       | anthropic                                                                                                                     | openai                                                                                                                | google       |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------ |
| `standard` | —                                                                                                                             | —                                                                                                                     | —            |
| `flex`     | config error                                                                                                                  | `providerOptions.openai.serviceTier = "flex"` (slower, cheaper, may 429 → `fallbackModels` or backoff; dev/eval only) | config error |
| `fast`     | `providerOptions.anthropic` speed/fast-mode option **if the provider package exposes it** for Opus 5 / 4.8; else config error | config error (use `priority` via providerOptions manually)                                                            | config error |

Everything else (thinking type, `thinkingConfig`, `reasoning_effort`) is either the standardized `reasoning` option or a raw `providerOptions` entry in the config file — no code change to try a new knob. Exact option names come from the installed `@ai-sdk/*` package docs on the day we pin versions; **pin them in `pnpm-lock.yaml` on Thursday and don't bump during the event.**

Capability flags in `models.json` drive the Zod refinements: `temperature` on an Anthropic 5-family model, `flex` on Google, `pdfMode: native` on a model without PDF support → all fail at `pnpm turbo typecheck`, not on stage.

---

## 4. Profiles

| Profile        | Mapping                                                  | Extraction              | Synth         | Why                                       |
| -------------- | -------------------------------------------------------- | ----------------------- | ------------- | ----------------------------------------- |
| `dev`          | openai `flex`, reasoning low                             | standard, concurrency 2 | openai `flex` | cheapest while coding; latency irrelevant |
| `eval-fast`    | standard, concurrency 8, reasoning low                   | standard, concurrency 4 | —             | EN vs CZ prompt in ~2 min                 |
| `eval-quality` | standard, reasoning high, 2 repeats                      | standard, high          | —             | the decision run                          |
| `demo`         | standard or anthropic `fast`, reasoning medium, cache on | standard                | —             | **never flex**; a 429 on stage is fatal   |

A refinement rejects `flex` and `concurrency > 4` in `demo.json`.

---

## 5. Middleware stack (registry-level, applies to every call)

```
call → [cost/limits: per-model concurrency + token-bucket] → [cache: sha256(model, resolvedOptions, messages) → S3/local]
     → [fallback: on 429/5xx after retries, re-issue with next client.fallbackModels[i]] → provider
     ← [telemetry: tokens, latency, cost from models.json prices → Run.results[]]
```

Cache key includes the resolved config hash, so changing `reasoning` or `model` never serves a stale answer; changing `client.concurrency` does. Fallback changes the model string _within_ a run — the `Result` records which model actually answered, so a matrix cell that silently fell back is visible in the report, not averaged away.

---

## 6. Guards for "iterate on config alone"

- When configuration files are implemented, add runtime schema-validation checks for them; TypeScript typechecking alone does not validate JSON contents. No `configs/*.json` validation task exists yet.
- `eval matrix` prints estimated cost per cell from `models.json` prices × dataset token stats before running; confirm above a threshold.
- One place to add a provider: register it in the registry + add its models to `models.json`. No pipeline code changes.
- Determinism: don't rely on temperature (several current models reject it). The cache is what makes reruns reproducible; the `eval-quality` profile uses 2 repeats to measure the spread instead.
