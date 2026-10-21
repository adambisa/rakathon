# Evaluation design — evaluatable by default

> Future design: the LLM, mapping and generalized evaluation packages/configurations
> described here are not implemented. A focused [extraction QA runner](../qa/README.md)
> now evaluates the deployed document-ingest Lambda against silver/gold report transcripts,
> without Postgres. Ten PDF/silver-transcript pairs are registered locally. Current checks do not call LLM
> providers or score clinical records. Use the [roadmap](07-skeleton-runbook.md)
> for delivery order.

Goal: both pipelines (`extraction`: raw → text, `mapping`: text → JSON) can be scored on a dataset at any time, locally with one command and in the cloud as a batch, using the **same pipeline code and the same scorers**. And: get trustworthy text → JSON gold labels without being doctors.

---

## 1. Patterns

### 1.1 Pipelines as pure functions with injected ports (hexagonal)

Each pipeline is a function of `(input, deps)` → `output`. `deps` carries the AI SDK language model (resolved from the registry by config string), a clock and a blob store. Nothing inside reads env vars, S3 or the network directly.

```ts
// packages/extraction
export async function extract(
  input: RawDoc,
  deps: { model: LanguageModel; blobs: BlobPort },
): Promise<ExtractedDocument>;
// packages/mapping
export async function map(
  doc: ExtractedDocument,
  deps: { model: LanguageModel },
): Promise<RadicalProstatectomyExtraction>;
```

Why it matters for eval: the worker Lambda, the local CLI and the eval runner all call the _same_ function with different `deps`. No "test mode" branches inside the pipeline. Swapping provider = a different registry string in the config.

### 1.2 Dataset → Example → Run → Scorer (the eval-framework shape)

This is the shape every LLM eval tool converges on (promptfoo, Braintrust, Inspect, OpenAI Evals). We implement a thin version in `packages/eval` rather than adopt a framework, so it runs identically in Lambda.

```
Dataset        { id, split: "synth" | "real" | "adversarial", examples: Example[] }
Example        { id, input: <pipeline input ref>, expected: <pipeline output>, meta: { source, difficulty, tags } }
Run            { runId, datasetId, pipeline, pipelineVersion(git sha), promptHash, provider, model, startedAt,
                 results: Result[] , summary: Summary }
Result         { exampleId, output, scores: Record<metric, number>, latencyMs, costUsd, rawResponseRef, error? }
Scorer         (output, expected, example) => Record<metric, number>     // pure, no I/O
Reporter       (run) => markdown table / JSON / console
Runner         (dataset, pipeline, scorers) => Run                       // LocalRunner | LambdaRunner
```

Everything is JSON on disk or in S3 under `evals/{datasetId}/{runId}/`. Two runs are diffable with a one-liner (`eval diff runA runB`), which is the actual hackathon loop: change prompt → run → diff.

### 1.3 One `Runner` interface, two implementations

|          | `LocalRunner`                                                | `LambdaRunner`                                                                                                                                                                  |
| -------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Executes | in-process, `p-limit` concurrency (e.g. 4)                   | invokes the deployed worker with `{ mode: "eval", exampleRef }` per example, concurrency via Lambda itself; results written to S3 by the worker; runner collects and summarizes |
| Deps     | registry models with real APIs; `BlobPort` = local dir or S3 | the worker's own deps (real env, real bundle)                                                                                                                                   |
| Use      | prompt iteration, CI-ish sanity                              | "does the deployed thing still score the same", large batches, provider comparison overnight                                                                                    |

The worker's handler is a tiny switch: S3 event → `process(case)`; direct invoke with `mode: "eval"` → run one example and write a `Result`. Same `extract`/`map` underneath. (Step Functions Map state is the "proper" fan-out; a loop of async invokes from the runner is enough for ≤ 200 examples.)

### 1.4 LLM call cache keyed by content hash

A registry middleware wraps every model with a cache: `sha256(model string, resolved options, messages)` → response, stored in `cache/` locally and `llm-cache/` in S3. Re-running an eval on unchanged examples costs nothing, is deterministic, and the raw responses are preserved for debugging. Also lets us re-score old outputs with new scorers without re-calling the model.

### 1.5 Capture → label → promote (production is the dataset)

Every processed case produces a candidate example for free: its `uploads/{documentId}/source` objects are raw inputs, `derived/{documentId}/document.json` is each extraction output, and the **human-corrected record from the review UI is a mapping gold label**. An "Approve & add to eval set" action in the UI promotes the pair to the `real` split. The correction UI _is_ the labeling tool — this is how we get clinician-quality labels: let the MOÚ mentor correct 10 records on Friday evening instead of asking them to label from scratch.

### 1.6 Invariants as label-free oracles

Many errors are detectable without any gold label, via domain consistency rules derived from the ICCR dataset:

- `gleason.primary + gleason.secondary == gleason.score`
- ISUP grade group ⇔ Gleason score (1: ≤6, 2: 3+4, 3: 4+3, 4: 8, 5: 9–10)
- `pT == "pT3b"` ⇒ `seminalVesicleInvasion == "involved"`; `pT3a` ⇒ `epe == "present"`
- `margin.locations`/`extent`/`gleasonAtMargin` only present if `margin.status == "involved"`
- `lymphNodes.positive <= lymphNodes.examined`; `pN1` ⇔ positive > 0
- every `evidence` snippet must actually occur in the source text (catches hallucinated support)

These run as a scorer on _every_ output, gold or not, and as a UI warning. They're also the cheapest regression test. The proposed clinical schema would mirror validated rules as CHECK constraints and generated columns (`03-stack-decisions.md` §2c). The current database contains cases and documents; no approved `records` table or clinical invariants are installed.

---

## 2. Gold labels for text → JSON without doctors

The trick: **don't label text; generate text from labels.** Reverse the pipeline.

### 2.1 Backward synthesis (exact gold by construction)

```
1. sample a SurgeryRecord            ← from the Zod schema + realistic joint distributions
   (e.g. ISUP 2 most common; pT3b ⇒ SVI; margin positive ~20%; multifocal sectors)
2. render it to a Czech pathology report text     ← LLM, style-conditioned, with a fixed terminology table
3. render the text + a drawn schema to a PDF/PNG  ← programmatic: template layout, prostate sector diagram with
                                                    marked sectors from record.sectors, then "scan" augmentation
                                                    (rotation, blur, JPEG, handwriting-style font for annotations)
4. store { raw: pdf, document: text(+schema text), record } as one example in split "synth"
```

Step 1 is sampled by us, so **the JSON gold is exact** and we never have to judge medical correctness — only that the generator's distributions and invariants (§1.6) hold, which the ICCR dataset tells us. Step 3 gives the **raw → text gold for free** as well, so the "raw ⇒ text golden pairs" you assumed exist are actually produced the same way; we won't have real ones unless MOÚ provides samples.

Steps 2–3 need a **Czech terminology table** (EN element → CZ phrasing variants, abbreviations) — e.g. extraprostatic extension → "extraprostatické šíření / EPE / prorůstání přes pouzdro", seminal vesicles → "semenné váčky / SV", margins → "chirurgické resekční okraje / okraje", Gleason → "GS 3+4=7, ISUP GG 2 / grade group 2". Building that table is a Friday-morning job with a mentor and is the single highest-leverage hour for mapping quality, because it drives both the generator and the mapping prompt.

Noise is part of the generator: optional fields missing, two phrasings for the same fact, typos, OCR-like confusions (`0`/`O`, `l`/`1`), units in different places, order shuffled. Tag examples with the noise applied so the report can break accuracy down by difficulty.

Honest limitation: synthetic text has the generator's style, not MOÚ's. That's why the `real` split exists and is reported separately, even if it has 5 examples.

### 2.2 Real samples: consensus + human on disagreements

If MOÚ hands over de-identified real reports (and allows cloud models):

1. run mapping with 2–3 different strong models,
2. fields where all agree → provisional gold (tagged `consensus`),
3. fields where they disagree → shown to the mentor in the review UI, resolved in minutes,
4. the invariants from §1.6 veto any "consensus" that is internally inconsistent.

Disagreements are precisely the hard cases, so human time goes where it's worth the most.

### 2.3 Adversarial split

A handful of hand-built examples for known failure modes: report with **two tumour nodules** of different grades, a **biopsy** report accidentally submitted, a report stating "žádný nádor" (no tumour), a report where the schema contradicts the text. These don't need medical judgement, just the schema semantics, and they're the ones to show the jury when talking about safety.

---

## 3. Scorers

| Pipeline   | Metric                                                                            | Notes                                       |
| ---------- | --------------------------------------------------------------------------------- | ------------------------------------------- |
| extraction | CER / WER per page, normalized (whitespace, diacritics kept — Czech)              | threshold, not exact                        |
| extraction | schema-text recall: did each marked sector in gold appear in the schema rendering | set-based                                   |
| mapping    | per-field exact match for enums / integers; ±tolerance for mm / g                 | the headline table                          |
| mapping    | set F1 for `sectors[]`, `margin.locations[]`, `epe.locations[]`                   |                                             |
| mapping    | "clinically critical" subset accuracy: ISUP, pT, margin status, SVI, EPE          | what the jury cares about; show this number |
| mapping    | invariant violations per record (§1.6)                                            | label-free                                  |
| mapping    | calibration: confidence vs correctness buckets                                    | makes the confidence badge in the UI honest |
| both       | latency, cost per document, provider/model                                        | for the provider decision                   |

---

## 4. Repo placement

```
packages/eval/
├── src/
│   ├── types.ts            Dataset/Example/Run/Result/Scorer/Runner
│   ├── runners/local.ts    LocalRunner
│   ├── runners/lambda.ts   LambdaRunner (invoke worker in eval mode, collect from S3)
│   ├── scorers/extraction.ts · scorers/mapping.ts · scorers/invariants.ts
│   ├── synth/              record sampler, Czech renderer, PDF/PNG renderer + scan augmentation, terminology table
│   ├── report.ts           markdown/console table, run diff
│   └── cli.ts              eval run --pipeline mapping --dataset synth-v1 --provider gemini
│                           eval diff <runA> <runB> · eval synth --n 50 --seed 7 · eval promote <caseId>
├── datasets/
│   ├── synth-v1/           generated, committed (small) or regenerated from seed
│   ├── real/               only de-identified + permitted; otherwise S3-only, never committed
│   └── adversarial/
└── runs/                   gitignored locally; S3 evals/ in the cloud
```

Future eval commands should distinguish the fast cached subset from explicit paid runs. The example `pnpm eval run …` commands below are proposals, not existing scripts. Current `pnpm check` runs focused database-config/ESLint tests, and production integration tests run separately. A future worker and eval runner should share processing functions.

---

## 5. What this buys at pitch time

A table on a slide: synthetic N, real N, per-field accuracy, critical-field accuracy, invariant violations, cost per report, by provider. Very few hackathon teams will have that, and it directly answers "práce s daty", "kvalita prototypu" and "technická proveditelnost" from the judging criteria.

---

## 6. Rapid prompt experiments during the hackathon ("does an English prompt beat a Czech one?")

Target: answer a question like that in **under 5 minutes wall-clock, on 50 examples, with a readable verdict**. Achievable for mapping; slower for extraction. What has to be true:

### 6.1 Prompts are versioned variants, not strings in code

```
packages/mapping/src/variants/
├── cz-v1.ts        { language: "cs", schemaDescriptions: "cs", fewShot: 0, chunking: "single", temperature: 0 }
├── en-v1.ts        { language: "en", schemaDescriptions: "en", fewShot: 0, chunking: "single", temperature: 0 }
└── en-fewshot3.ts  { ...en-v1, fewShot: 3 }
```

A variant is a config object that the prompt builder consumes; `map(doc, deps, variant)`. The CLI takes `--variant`, the `Run` records `promptHash = sha256(builtPrompt + schema)`. Note the schema's `.describe()` texts are part of the prompt too, so the variant must control their language as well — otherwise an "English prompt" still carries Czech field descriptions (or vice versa).

Dimensions worth exposing from day one: `language`, `schemaDescriptions`, `fewShot` (count, drawn from the **dev** split only), `chunking` (one call for the whole record vs one call per ICCR group), `model`, `temperature`.

### 6.2 `eval matrix` — one command, one table

```
pnpm eval matrix --pipeline mapping --dataset synth-v1/test --variants cz-v1,en-v1 --providers gemini,anthropic
```

Runs every (variant × provider) cell against the same examples and prints:

1. per-cell: critical-field accuracy, all-field accuracy, invariant violations, cost/doc, p50 latency;
2. **paired flips** between two chosen cells: fields that went wrong→right and right→wrong, by field name. With 50 examples a 3 % aggregate difference is noise; "EN fixed 11 `margin_location` errors and broke 2 `pt_stated`" is a decision.

Because scorers are pure and outputs are stored, `eval rescore` recomputes tables with a new scorer without any LLM call.

### 6.3 Speed budget and the real ceiling

Mapping eval = N calls per cell, no extraction involved (it reads gold `document.json`). Numbers:

|                                        | per call   | concurrency | 50 examples           |
| -------------------------------------- | ---------- | ----------- | --------------------- |
| mapping, single-call variant           | 5–15 s     | 8           | **~1–2 min per cell** |
| mapping, per-group chunking (×7 calls) | 3–6 s each | 8           | ~4–6 min per cell     |
| extraction (vision, 2–4 pages)         | 20–60 s    | 4           | ~5–10 min per cell    |

The ceiling is **provider rate limits, not our infra**. Lambda fan-out doesn't help an API-bound workload; the `LambdaRunner` is for running against the deployed bundle and for overnight batches, not for speed. Required before Friday:

- Gemini key on a **paid tier** (AI Studio free tier RPM is far too low); check Anthropic tier RPM/TPM and request a raise if needed.
- registry middleware provides bounded concurrency per model, retry with backoff on 429/5xx (plus `fallbackModels`), and the content-hash cache — unchanged cells re-run for free, so iterating on one variant never re-pays for the baseline.

### 6.4 Data ready before the first prompt change

- **50 synthetic examples generated before Friday** (regenerate after the terminology table is built, Friday morning, ~10 min). Mapping eval must never wait on extraction.
- Fixed split: `synth-v1/dev` (few-shot source, prompt tinkering) and `synth-v1/test` (decisions). Never pick few-shots from test.
- No reliance on temperature (several current models reject it); the cache makes reruns reproducible, and the final provider/variant decision runs 2 repeats to report the spread.

### 6.5 What this does not give us

- Statistical confidence on small differences — 50 synthetic examples distinguish "clearly better" from "same", not 2 % from 4 %. Fine for a hackathon; say so on the slide.
- Any claim about real MOÚ reports beyond the `real` split size. Report synth and real separately, always.
