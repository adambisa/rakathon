# Transcript evaluation

References are JSON documents containing the **whole report transcript**. Scoring
compares text, independently of the method that produced it. Execution adapters
run or collect extraction output; the pure modules in `src/eval/` handle reference
validation, transcript comparison and reporting without AWS, Postgres, MuPDF,
Tesseract or provider SDK dependencies.

## Reference and output formats

A reference in `qa/reference/` looks like this:

```json
{
  "version": 1,
  "quality": "silver",
  "text": "PSA 0,12 ng/ml; Gleason 3+4=7.",
  "provenance": {
    "transcriptFilename": "report-01.txt",
    "transcriptSha256": "original-transcript-sha256",
    "normalization": "nfc-whitespace-v1"
  }
}
```

Use `silver` for provisional labels and `gold` for verified labels. Provenance is
optional; the preparation command records it automatically. Quality is never
inferred from an extraction engine or silently promoted by the evaluator.

References must already be canonical: Unicode NFC, no leading/trailing whitespace,
and a single ordinary space between words. Normalization preserves case, accents,
numbers, punctuation and decimal separators. Every reference is checked before
running extraction or writing reports; if normalization changes its text, the
command stops. Evaluation never rewrites a reference.

Any method can produce a candidate JSON with a `text` string:

```json
{
  "text": "PSA 0,13 ng/ml; Gleason 3+4=7.",
  "diagnostics": { "provider": "your-method", "sources": ["your-method"] }
}
```

Diagnostics are optional and do not affect scores. Existing extraction output
containing `pages` is also accepted: page numbers are validated and sorted, and
text is joined in order with blank lines. No page boundaries are required in the
reference, and no OCR-specific source names or confidence fields are required.
Page numbers, source labels and page counts remain available as diagnostics.
Missing or extra text contributes edits; without page-level reference labels,
there is no claim of measured missing/extra reference pages.

## Prepare the existing PDF/text pairs

The preparation command reads `.txt` files and matching `pdf/<stem>.pdf` files:

```bash
pnpm qa:prepare --source /path/to/outputs/tcga-prostate-cz
```

It copies PDFs into `qa/input/`, creates separately normalized silver JSON
references in `qa/reference/`, and populates `qa/dataset.json`. Original `.txt`
and PDF files remain unchanged. It records each source transcript's hash and
refuses to overwrite a different prepared input, reference or populated dataset.
Repeating preparation with unchanged sources is safe.

Optional `--dataset <path>` controls the destination manifest. Local input and
reference files are resolved relative to its directory. These files and run
artifacts and the generated default manifest are ignored by Git. Run preparation
before using the default dataset, or pass an existing `--dataset` manifest. Empty datasets
fail clearly rather than reporting a successful evaluation.

The manifest pairs inputs and references explicitly:

```json
{
  "version": 1,
  "examples": [
    {
      "id": "report-01",
      "inputKey": "qa/input/report-01.pdf",
      "referenceKey": "qa/reference/report-01.json",
      "contentType": "application/pdf"
    }
  ]
}
```

## Score outputs from any method locally

Save one candidate JSON per example, named `<id>.json`, and run:

```bash
pnpm qa:score \
  --outputs /path/to/method-results \
  --report qa/runs/my-method-run \
  --method my-method
```

This command uses the same scorer and report builder as the cloud runner. It
needs no AWS credentials or database access. `--dataset <path>` selects another
manifest. `--method` is a provenance label, not an instruction to select a model.
Use a fresh report directory; existing reports are not overwritten.

The report directory contains a manifest with reference hashes, JSON/CSV reports,
and a readable transcript comparison for each successful result. Candidate hashes
and optional diagnostics are saved with results. Missing or invalid candidates
are reported as failures, and the command exits unsuccessfully.

## Test the latest pipeline locally

```bash
pnpm qa:test
pnpm qa:test --reader bedrock-mantle --model google.gemma-4-e2b
```

This tests the latest `origin/main`, whatever your checkout is on, on the
dataset stored in S3. It downloads `s3://<documents-bucket>/qa/scans/`
(`dataset.json`, `input/`, `reference/`, laid out like the local `qa/` folder),
fetches `origin/main` into a temporary detached worktree, installs dependencies
there, runs that commit's extraction CLI on every input, and scores the outputs
with that commit's `qa:score`. Your checkout's own code and local `qa/` files
are not used, and the temporary files are removed afterwards. The report lands
in `qa/runs/<method>-<time>/`, with `pipeline.json` recording the tested commit,
reader, model and dataset.

`--reader` selects the extraction strategy, the same names the reader
configuration takes: `tesseract` (the default) or `bedrock-mantle` with
`--model <id>`. Readers that call AWS use the run's `--profile` and `--region`,
so every strategy is scored against the same references through the same
scorer.

It needs AWS CLI v2 and read access to the bucket; it passes `--profile
prostapaper` explicitly, so a different `AWS_PROFILE` in your shell is ignored.
Optional flags: `--bucket <name>` (default: the demo documents bucket),
`--prefix <prefix>` (default `qa/scans/`), `--profile <name>`, `--region
<region>`, `--report <dir>`, `--ref <branch>` (default `main`) and `--method
<label>` (default: the model or reader name with the tested commit).

## Reader comparison on the S3 scan set

Seven hospital scans (`s3://<documents-bucket>/qa/scans/`), one pass each,
scored with the same references and scorer. Tesseract ran through `pnpm qa:test`
at `origin/main` 1717e59; the model ran that same extraction code with this
change's diagnostics fix, which only moves per-page logs to stderr.

| Reader                            | CER    | WER    |
| --------------------------------- | ------ | ------ |
| tesseract                         | 1.59%  | 5.79%  |
| bedrock-mantle google.gemma-4-e2b | 37.95% | 50.26% |

Tesseract's total is dominated by one scan (`scan-0012`, CER 10.62%); the other
six stay under 1%. The model transcripts read as plausible Czech but misspell
clinical terms and stop early: on `scan-0025` the model returned 1115 characters
against a 2504-character reference. This is a single pass per scan at
temperature 0 on a seven-scan silver corpus, not a general ranking of the two
strategies.

## Local OCR baseline

Local comparisons used Czech only, PSM 6, the integer best model, and comparison
normalization v2. Five reports (14 pages) exercised OCR; the other five
(13 pages) used embedded text and matched exactly. OCR-only results were:

| Render DPI | CER    | WER    | Character / word edits |
| ---------- | ------ | ------ | ---------------------- |
| 300        | 0.490% | 0.814% | 140 / 33               |
| 400        | 0.511% | 0.962% | 146 / 39               |
| 600        | 0.515% | 0.987% | 147 / 40               |

Disabling standard word dictionaries or adding medical vocabulary and code
patterns produced byte-identical output to baseline. Custom dictionary assets
are not included. These runs retain the 300 DPI default and measure agreement
with this small silver corpus, not general OCR performance.

## OCR reading order

OCR extraction now requests Tesseract word coordinates and applies the shared
reading-order reconstruction in `packages/extraction/src/reading-order.ts`.
For single-column reports with two-column label/value tables, it uses repeated
coordinate gaps to identify a value column, estimates wrapped-line spacing, and
emits each complete label before its value. It preserves every recognized word;
it does not correct characters or consult reference transcripts. Embedded PDF
text keeps its original order, and general multi-column reading order remains
outside this heuristic's scope.

The local layout experiment rasterized the five text-layer PDFs into separate
300 DPI grayscale copies. All 13 converted pages had no embedded text and were
pixel-identical to the original rendering; original inputs and silver references
were preserved. Together with the five existing image-only PDFs, this exercises
OCR on ten reports / 27 pages. The copies extend OCR coverage, not the number of
independent source reports.

| All-image-only corpus | CER    | WER    | Character / word edits |
| --------------------- | ------ | ------ | ---------------------- |
| Current OCR text      | 0.509% | 1.274% | 301 / 108              |
| Coordinate layout v2  | 0.117% | 0.779% | 69 / 66                |

Four reports improved and six were unchanged, with no regressions on this set.
The geometry heuristic was tuned using these same reports, so this comparison
is not independent validation. The layout method is now the default for OCR;
check it against additional reports and layouts as references become available.

## Run the currently deployed extraction adapter

The existing document-ingest Lambda accepts direct `mode: "extraction-qa"`
requests. The dispatcher chooses QA before importing the application handler or
opening Postgres. This adapter runs the same extraction function and bundled
assets as application uploads. It writes only QA extraction output; scoring runs
on the invoking computer. Only `uploads/` objects trigger automatic ingestion.

Build/deploy document-ingest and apply the demo Terraform stack through the normal
workflow. No additional Lambda, bucket, notification or database migration is
needed. Terraform extends the function's permissions to read pinned `qa/input/`
versions and write `qa/<run-id>/output/` objects. The Lambda cannot read references.

The managed policy identified by `extraction_qa_runner_policy` permits an operator
to read/write `qa/` objects and invoke/inspect the existing function. Attach it to
the QA operator role if that role does not already have those permissions.

The cloud CLI needs AWS CLI v2 with conditional `s3api put-object` support and AWS
credentials. Upload the prepared pairs:

```bash
pnpm qa:extraction --upload-only --bucket <documents-bucket> --profile <operator-profile>
```

Uploads refuse to replace existing objects. Intentional dataset revisions should
use new keys; partially completed uploads can be completed manually with the
missing files. Then run:

```bash
pnpm qa:extraction \
  --bucket <documents-bucket> \
  --function prostapaper-demo-document-ingest \
  --profile <operator-profile> \
  --method current-extraction
```

Optional flags: `--dataset <path>`, `--region <region>` (default `eu-central-1`),
`--qualifier <published-version-or-alias>`, and `--method <label>`. The command
runs the deployed function, not local uncommitted code. Published Lambda versions
are preferable for reproducibility. It runs one document at a time and shares
concurrency with application ingestion.

The runner validates all references, records S3 versions and hashes, then invokes
the function using pinned input versions. Each run saves:

```text
qa/<run-id>/manifest.json
qa/<run-id>/output/report-01.json
qa/<run-id>/diff/report-01.txt
qa/<run-id>/report.json
qa/<run-id>/report.csv
```

The manifest records deployed code hash/revision, runtime, architecture, resource
allocation and method label. Results record extraction settings, actual Lambda
version, output hash/version, and extraction duration excluding S3 I/O. Deployment
changes detected at the end invalidate the run; pin a published version to prevent
changes. Failed documents are recorded and cause an unsuccessful exit.

## Understand the scores

- **CER (character error rate):** character insertions, deletions and substitutions,
  divided by the number of reference characters.
- **WER (word error rate):** word insertions, deletions and substitutions, divided
  by the number of reference words.

Both compare the entire report transcript. CER counts Unicode code points; WER
uses whitespace-delimited tokens, retaining punctuation and case. Lower is better;
zero means identical text. Rates in JSON/CSV are fractions: `0.05` means 5%. They
can exceed 1 and are null when the reference length is zero; edit counts still
expose extra output.

Raw rates include whitespace/Unicode differences. Normalized rates use the shared
comparison normalizer, including whitespace at page boundaries. It also treats
spacing inside numeric `mm`/`cm` measurements as formatting: `3.5x1.5x0.5cm`
compares equal to `3.5 x 1.5 x 0.5 cm`. Numbers, decimal separators, dimension
order, units, and `x` versus `×` remain distinct. Other word spacing remains
significant. This comparison rule operates on copies of both transcripts;
reference validation/preparation still uses `nfc-whitespace-v1`, and stored
reference text is never changed. New reports record the comparison version
`nfc-whitespace-measurement-spacing-v2`; rescore old outputs to compare runs under
the same rules. Original extraction outputs
are preserved, including any trimming performed by the extraction method itself.
These measures describe agreement with the supplied reference, not clinical
correctness or whether a silver reference should be trusted as gold.

Corpus rates divide total edits by total reference length, rather than averaging
document percentages. Failed outputs are counted separately and excluded from
text-rate aggregates. Reports also separate silver/gold references and group
optional diagnostic source labels; mixed-source reports have a `mixed` group.
For the current extraction adapter, these labels distinguish embedded-text and
OCR documents without hardcoding either label in the scorer. Nonzero text errors
do not fail a run; thresholds can be added after establishing a baseline.

## Verify the tooling

```bash
pnpm --filter @prostapaper/document-ingest test
```

The nine core tests cover normalization/reference preservation, measurement spacing, transcript scores,
pagination independence, corpus weighting, database-free QA dispatch, and matching
cloud/local reporting with mocked AWS calls. Synthetic strings check the tooling;
they do not measure actual extraction quality. The layout check covers wrapped
labels, adjacent rows, scale independence, ordinary paragraphs, and word preservation.
