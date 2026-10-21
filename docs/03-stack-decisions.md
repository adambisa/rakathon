# Stack decisions

Status: reconciled with merged main and the deployed demo on 2026-10-06.
The demo uses synthetic or de-identified data. Cost and complexity take priority;
real patient data and higher availability require a separate design.

## 1. Implemented architecture

| Layer                | Current implementation                                                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo             | pnpm workspaces and pinned Turborepo; shared config and contracts                                                                                           |
| Frontend             | Vite, React, TanStack Router/Query, Tailwind and daisyUI; deferred route skeletons are merged                                                               |
| API                  | Hono + tRPC on Node; one process serves API and compiled SPA under the same origin                                                                          |
| Runtime              | One ECS Fargate replica, 0.5 vCPU / 1 GB; ALB + ACM HTTPS and WAF; temporary second task during rollout                                                     |
| Database             | Private Single-AZ RDS PostgreSQL 18.6, `db.t4g.micro`; Drizzle with `node-postgres`                                                                         |
| Database credentials | One schema-owning runtime login, `prostapaper_app`; SSM `DB_PASSWORD`; RDS-managed administrator reserved for infrastructure operations                     |
| Migrations           | Committed Drizzle migrations run at API startup before HTTP serving; no separate task or custom runner                                                      |
| Auth                 | Shared bearer token resolves to a fixed admin identity; protected tRPC middleware; no user database or role-management flow                                 |
| Infrastructure       | Manual `infra/bootstrap` for state/IAM; `infra/environments/demo` for application resources; S3 backend with locking                                        |
| Releases             | GitHub Actions checks, Turbo build, immutable ECR image, image smoke/integration tests, Terraform plan/apply, ECS rollback and endpoint checks              |
| Tests                | Database config and ESLint rule tests in `pnpm check`; lightweight PR container smoke tests; small production HTTP/database integration suite before deploy |
| Storage              | Separate private, encrypted, versioned application bucket and presigned uploads are wired in code; deployment pending                                       |

There is no EC2 host, nginx, systemd deployment, SSH/rsync release, worker,
internal worker callback, event ledger or separate migrator login in the current setup.
The pipeline visualization is a separate open PR, not deployed processing.

### API structure

Feature routers are `cases/router.ts`, `documents/router.ts` and `auth/router.ts`.
The root router exposes `createCaller`. `CaseService` owns case reads/submission;
`DocumentService` owns registration and upload tickets. Both scope access to the
signed-in case owner. One service instance and database pool are shared across requests.

Current procedures are `case.create`, `case.list`, `case.get`, `case.submit`,
`document.list`, `document.register`, `document.presign`, `session.get`, and `me`. Lists return the
latest 50 owned cases with nested documents. A batch upload creates one case;
registration is idempotent by document ID and retries reuse that document.
`app.cases` and `app.documents` store milestones and generate separate statuses.
The S3 Lambda records upload time and a pinned source version. Processing, review,
and export workers remain future work. The complete model, database guards, and
legacy migration policy are in [11 — Case/document design](11-case-document-design.md).
The processing/clinical tables described later in this document are proposals;
Their names follow the case/document split, but the clinical tables remain unimplemented.

### Database networking and configuration

RDS is private and permits port 5432 only from the app security group. ECS tasks
have public-subnet outbound connectivity and reach RDS through VPC-local routing;
there is no NAT gateway. Production connections verify TLS using the AWS regional
CA downloaded and checksum-verified when packaging the image. No PEM is committed.

The API owns a singleton bounded pool. Database settings use validated `PG*`
variables. Local Compose and native API development share one ignored
`apps/api/.env`; ECS receives settings from Terraform and secrets from SSM.
The bootstrap task-role policy grants upload-prefix PutObject
access (deployment pending). The execution role pulls images,
loads the app token/database password and sends logs.

## 2. Future product contracts and processing

The following sections describe product direction, not existing tables, routes,
packages or worker infrastructure. Clinical fields and approval rules must be
validated against actual input contracts before implementation. Shared contracts
currently include cases, documents and extracted-document shapes; REDCap generation and
clinical record persistence are not complete.

## 2. `packages/contracts`

Future clinical contracts will be the single source of truth for the pathology record, written as **Zod 4** schemas with `.meta()` carrying REDCap field metadata. Planned outputs once the clinical contract is defined:

| Output                     | Mechanism                                                                                              | Used by                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| TS types                   | `z.infer`                                                                                              | FE forms, tRPC router I/O, Drizzle `jsonb` typing                                              |
| JSON Schema                | `z.toJSONSchema()` (built into Zod 4)                                                                  | LLM structured-output schema; model reply is `safeParse`d with the same Zod schema             |
| REDCap data dictionary CSV | walk schema + `.meta()`                                                                                | import once into REDCap; remap to MOÚ's dictionary via a JSON mapping file if they give us one |
| REDCap row flattener       | runtime fn: enums → codes, checkbox arrays → `field___code`, nested arrays → repeating-instrument rows | `packages/redcap` CSV writer / `import_records` client                                         |
| Pydantic models (optional) | `datamodel-codegen` from the JSON Schema                                                               | Python worker                                                                                  |

Design rule: the model returns every field as `{ value, confidence, evidence, page }`; the review UI unwraps it after human approval and only the approved record is exported. Field list and schema shape: hackathon work, guided by the ICCR dataset.

---

## 2b. Proposed processing: two pipelines, one worker

The proposed processing worker is a thin composer; Lambda remains a candidate, not a provisioned service. The intended work will live in two packages with **no dependency on each other** — only on `packages/contracts` (types) and `packages/llm` (provider client).

```
                 packages/extraction                    packages/mapping
  S3 object ──▶  pdf / image  ──▶  ExtractedDocument ──▶  text ──▶ RadicalProstatectomyExtraction (JSON)
                 (OCR / vision)         │                           (LLM structured output + Zod validate)
                                        ▼
                               persisted: derived/{documentId}/document.json
```

|                                       | `packages/extraction`                                                                                                                                                                                                                                                      | `packages/mapping`                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Input                                 | `{ bucket, key }` or `Buffer` + mime                                                                                                                                                                                                                                       | `ExtractedDocument`                                                                                                         |
| Output                                | `ExtractedDocument` (defined in contracts): per-page text blocks with page number, plus a **text rendering of the hand-drawn schema** (e.g. "sector PZpl mid L: tumour, Gleason 4; margin positive apex") — so the diagram also becomes text and stays inside the contract | `RadicalProstatectomyExtraction` (value / confidence / evidence / page per field), validated with the contract's Zod schema |
| Depends on                            | `llm`, pdf/image tooling                                                                                                                                                                                                                                                   | `llm`, `contracts`, `sectors`                                                                                               |
| Local checks (CLI, no test framework) | fixture PDFs/images → expected `ExtractedDocument` (text similarity threshold, not exact match)                                                                                                                                                                            | fixture `ExtractedDocument` JSON → expected record (exact field-level match)                                                |
| Eval set in `packages/eval`           | `samples/*.pdf` + `gold/document/*.json`                                                                                                                                                                                                                                   | `gold/document/*.json` (as input) + `gold/record/*.json`                                                                    |
| CLI for the hackathon loop            | `pnpm --filter extraction run cli ./sample.pdf` → prints document.json                                                                                                                                                                                                     | `pnpm --filter mapping run cli ./document.json` → prints record.json + diff vs gold                                         |

Proposed consequences for the future case flow (not implemented):

- Document extraction advances `uploaded → extracting → extracted`; case mapping advances `extracting → mapping → ready_for_review`. Extraction output is persisted at `derived/{documentId}/document.json`; mapping output belongs to the case. Failure and retries belong to the deferred attempt model.
- **Mapping can be re-run without re-extracting**: `case.remap` tRPC mutation invokes the worker in mapping-only mode. This is the main prompt-iteration loop during the event — extraction is slow and expensive, mapping is cheap.
- The review UI can show the extracted text next to the page image, so when a field is wrong we can tell at a glance whether extraction or mapping failed.
- The one place the split gets strained is the schema diagram: a vision model could go image → JSON directly. We still route it through a text rendering so both pipelines keep a single, inspectable interface. If that costs accuracy on the diagram, the escape hatch is an optional `attachments` field on `ExtractedDocument` carrying the cropped diagram image for mapping to look at as well.

---

## 2c. Proposed clinical schema: raw extraction and approved records

Two tables with different responsibilities. The split matters because an LLM's output is often _inconsistent_ and we must be able to store it to review it; the database must only refuse what a **human** tries to approve.

| Table                    | Content                                                                                                                                                                                                                                                                                                                                                      | Constraints                                                                                                                         | Why                                                                                                                                             |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `extractions`            | `document_id`, `document jsonb` (ExtractedDocument), `extraction jsonb` (value/confidence/evidence envelope), `prompt_hash`, `provider`, `model`                                                                                                                                                                                                             | none beyond PK/FK                                                                                                                   | must accept anything the model says; it's evidence                                                                                              |
| `field_reviews`          | one row per `(case_id, field_path)`: `extracted_value`, `confidence`, `evidence`, `page`, `corrected_value`, `status pending/accepted/corrected`, `reviewed_by`, `reviewed_at`                                                                                                                                                                               | PK `(case_id, field_path)`                                                                                                          | per-field review queues across cases; correction-rate stats per field for `packages/eval`; schema-agnostic (path is text)                       |
| **`records`** (approved) | **stable ICCR core fields as real columns** (`gleason_primary`, `gleason_secondary`, `gleason_tertiary`, `epe`, `epe_extent`, `svi`, `bladder_neck`, `margin_status`, `margin_extent_mm`, `lvi`, `ln_examined`, `ln_positive`, `pt_stated`, `pn_stated`, `specimen_weight_g`, `psa_ng_ml`) + `extra jsonb` for the long tail (sectors, locations, free text) | **CHECK, UNIQUE, GENERATED** — see below                                                                                            | the human-approved truth; what goes to REDCap; what the jury sees queried                                                                       |
| `record_sectors`         | `(record_id, sector_id)`, `tumour`, `gleason_pattern`, `epe`, `positive_margin`                                                                                                                                                                                                                                                                              | PK `(record_id, sector_id)`, FK `sector_id → sectors` (seeded from the PI-RADS v2.1 vocabulary), CHECK `gleason_pattern IN (3,4,5)` | per-sector join with MRI later is the whole point of the challenge; a FK to the sector vocabulary kills typos like `PZpl_mid_l` vs `PZpl_mid_L` |

In this proposed schema, only the long-tail fields would live in `extra jsonb`, and the core columns are ICCR-required elements that won't change on Friday — that keeps the "schema churn during the hackathon" risk where it belongs.

### What Postgres enforces on `records`

**Generated columns (deterministic inferred values):**

```sql
gleason_score   int  generated always as (gleason_primary + gleason_secondary) stored,
isup            int  generated always as (
                  case when gleason_primary + gleason_secondary <= 6 then 1
                       when gleason_primary = 3 and gleason_secondary = 4 then 2
                       when gleason_primary = 4 and gleason_secondary = 3 then 3
                       when gleason_primary + gleason_secondary = 8 then 4
                       else 5 end) stored,
pn_derived      text generated always as (
                  case when ln_examined is null then 'pNX'
                       when ln_positive > 0 then 'pN1' else 'pN0' end) stored,
pt_floor        text generated always as (            -- minimum stage implied by findings
                  case when svi = 'involved' then 'pT3b'
                       when epe = 'present' or bladder_neck = 'involved' then 'pT3a'
                       else 'pT2' end) stored
```

ISUP and Gleason score are therefore **never extracted or typed by a human** — they're derived. `pt_floor` vs `pt_stated` and `pn_derived` vs `pn_stated` are the error detectors: a stated pT2 with EPE present is either an extraction error or a pathologist's inconsistency, and either way it must be looked at before approval.

**CHECK constraints (the invariants from `04-evaluation-design.md` §1.6, as a backstop):**

```sql
check (gleason_primary in (3,4,5) and gleason_secondary in (3,4,5) and (gleason_tertiary is null or gleason_tertiary in (4,5))),
check (epe_extent is null or epe = 'present'),
check (margin_extent_mm is null or margin_status = 'involved'),
check (ln_positive is null or ln_examined is null or ln_positive <= ln_examined),
check (pt_stated <> 'pT2' or (svi <> 'involved' and epe <> 'present')),
check (pt_stated <> 'pT3b' or svi = 'involved'),
check (pn_stated is null or pn_stated = pn_derived)
```

Named constraints (`records_pt_vs_epe`) so the API can map a violation to a human-readable message in the review UI.

**UNIQUE:** `(case_id)`; `(patient_pseudo_id, accession_number)` to stop the same specimen entering REDCap twice; `redcap_record_id` once exported.

**Enums:** text + CHECK during the hackathon (pgEnum can't drop values without pain); flip to `pgEnum` when frozen.

### Where the rules live

The intended design would enforce the same invariants twice: once in TS (`packages/contracts/invariants.ts`) for instant feedback in the review UI and for the eval scorer running in Lambda without a database, and once in SQL as the backstop nothing can bypass. Eight rules; the duplication is cheap and the DB catches drift in the TS copy. Drizzle supports all of it: `.generatedAlwaysAs(sql\`…\`)`, `check()`in the table's extra config,`unique()`, and `pgTable` relations for the sector FK.

### Flow

```
worker → extractions (jsonb, anything goes) → field_reviews rows (one per field)
reviewer accepts/corrects fields → "Approve" → INSERT INTO records (+ record_sectors)
   ├─ succeeds: record promoted to eval set, available for REDCap export
   └─ constraint violation: UI shows the named rule, approval blocked, fields stay pending
```

---

## 3. Build, provision and deploy

Turbo owns builds, codegen, checks and local task dependencies. It does not run a
custom AWS deployment transport. The Dockerfile packages prebuilt API/frontend
outputs, committed migration assets and the optional local seed command.

GitHub Actions publishes an immutable image tagged by commit/run/attempt and
tests that exact image. Demo deploy jobs share a queue, skip obsolete main
revisions before apply and use Terraform state locking. Terraform updates ECS to
the image digest; ECS waits for a healthy replacement before draining the old task.
CI verifies the requested task definition and `/api/health` plus `/api/ready`.

Drizzle applies all pending migrations in one transaction. A migration failure
rolls back the pending batch and prevents the new API from serving. ECS retains
the previous healthy deployment. If migrations commit and later application
startup/health fails, ECS rolls back the application only; schema changes remain.
Migrations must support the old and new app during rollout and rollback. Applied
SQL and metadata are immutable; changes use a new generated migration.

The database has one-day automated backup retention, deletion protection and a
final snapshot on deletion. Restore rehearsal and alarm notification wiring
remain unfinished. Capacity alarms exist with actions disabled.

Operating commands: [infra runbook](../infra/README.md).
Database decisions: [database design](09-database-drizzle-rds-plan.md).

## 4. Current repository layout

```text
apps/api/                 Hono/tRPC runtime and production integration tests
apps/web/                 Vite SPA and UI component library
packages/config/          shared TS/ESLint/Prettier configuration
packages/contracts/       shared Zod contracts and JSON Schema codegen
packages/db/              Drizzle schema/config/client, migrations and local seed
infra/bootstrap/          state bucket and manually managed IAM/OIDC roles
infra/environments/demo/  VPC, ECS, ECR, ALB/HTTPS/WAF and private RDS
infra/docker/             production Dockerfile and local/test Compose
```

Worker, LLM, extraction, mapping, eval, sectors and REDCap packages are future
work. Their package boundaries will follow concrete use cases; no stubs are needed
just to match the proposed product diagram.

## 5. Delivery order

1. **Next: private application S3 bucket and ECS access.** Provision in the demo
   stack, keep it distinct from Terraform state, and add scoped object permissions
   to the application task role in manually managed bootstrap. Pass the bucket
   name/region into the API through Terraform. Verify authorized access from ECS.
   The bucket alone does not implement upload endpoints or trigger processing.
2. Authenticated stateless presigned POST flow (implemented, deployment pending).
   S3 policy enforces size/type limits; explicit browser CORS is configured.
3. Processing worker and its invocation, retries and status reporting. Lambda/S3
   events remain candidates; the removed transition protocol and ledger are not
   prerequisites to revive before requirements are known.
4. LLM configuration, extraction and mapping with synthetic fixtures; evaluation
   and prompt/provider comparison. [LLM proposal](06-llm-config.md) and
   [evaluation proposal](04-evaluation-design.md) describe future intent.
5. Review UI, persistence, atomic approval and REDCap export once clinical contracts
   and reviewer/version semantics are known.

Better Auth provides Drizzle-backed users and cookie sessions. Sign-up is disabled
on the running API; accounts come from `pnpm --filter @prostapaper/api seed:users`.

`@prostapaper/db` depends on `kysely` even though it never imports it. Better Auth
pulls kysely in, and `drizzle-orm` declares kysely as an optional peer, so without
it pnpm resolves two `drizzle-orm` instances and the packages stop type-checking
against each other. Do not remove it.

## 6. Remaining follow-ups and open decisions

- Split CI checks into matrixed jobs and supporting files in a dedicated folder.
- Restore a synthetic snapshot into a separate private RDS instance and record
  recovery results; choose an alarm notification destination.
- Confirm upload constraints, artifact retention and deletion behavior while
  implementing storage; worker packaging/invocation when implementing processing.
- Validate medical point coordinates and required queries before choosing spatial
  types/extensions. No PostGIS extension is installed or currently needed.
- Obtain clinical input samples, REDCap dictionary and organizer answers; confirm
  cloud-LLM permission for any supplied data.
- Team IAM access, provider keys/spend limits, synthetic demo fixtures, license and
  third-party attribution, and an offline processing/demo fallback remain work.

The full clinical schema and real-data controls are outside the deployed demo
foundation. Do not interpret the proposed clinical tables above as delivered.
