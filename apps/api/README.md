# @prostapaper/api

tRPC + Hono on Node 22. In production one process serves `/api` and the built SPA on port 3000 inside the ECS task; the ALB terminates HTTPS.

```sh
cp apps/api/.env.example apps/api/.env # from repository root, new checkout only
pnpm db:up                            # starts PostgreSQL
pnpm dev                              # frontend/API watchers; API reads its .env
```

The ECS process serves the SPA and API under one origin:

| Route                   | Auth                                   | Purpose                    |
| ----------------------- | -------------------------------------- | -------------------------- |
| `GET /api/ready`        | none                                   | bounded database readiness |
| `GET /api/health`       | none                                   | liveness                   |
| `GET\|POST /api/trpc/*` | session cookie on protected procedures | SPA ↔ API                  |

Build: `pnpm build` → `dist/server.mjs` (minified with `keepNames`, source map and `sample-cases/` assets alongside; no runtime `node_modules` in the image). Start: `pnpm start` = `node --enable-source-maps dist/server.mjs`, so production stack traces point at source lines.

Email/password registration, sign-in and sign-out use `auth.signUp`, `auth.signIn`
and `auth.signOut` tRPC mutations. Better Auth manages passwords and sessions internally;
its HTTP handler is not exposed.
Sessions expire after seven days and renew after one day of activity. The tRPC
context forwards Better Auth's refreshed cookies to the browser.
New accounts become reviewers and receive a session immediately. Provider aliases
share the unique canonical `auth.user.email`; `auth.user.display_email` retains the
submitted address. `auth.signInAsGuest` creates a reviewer through the Better Auth anonymous plugin with a
placeholder address and no credentials; a database trigger copies it into `display_email`.
Guests can process the bundled examples through `case.createSample({sampleId})`.
The API reads the allowlisted report/map pair from its bundled `sample-cases/`
assets, stores it in S3 and submits it through the normal ingestion flow.
Custom drafts (`case.create`), file registration and upload tickets require a
registered account; the new-case form disables custom single and batch uploads
for guests while keeping the examples modal available.
Both auth pages link to `/host`, whose route loader performs the sign-in and redirects home. Sign-up and
guest sign-in are limited to 5 attempts per minute per client IP. See
[auth policy and normalization](../../docs/05-app-flow-and-ui.md#1-users-and-roles).

Feature routers live in `cases/router.ts`, `documents/router.ts` and `auth/router.ts`.
Shared `CaseService` and `DocumentService` instances use the singleton Drizzle pool.
Protected procedures scope cases and documents to the case owner; documents retain
separate uploader attribution.

`case.create({name})` creates a named draft; `case.list` and `case.get` return its
nested documents. `document.get` reads an individual document; `document.list` returns the latest 50 documents owned through
their cases. `/dokumenty` retains the document card view; `/pripady` groups documents
by case. Case entries open `/pripady/$caseId`; successful upload and submission
navigate there from the new-case form at `/`. The case detail polls persisted
document progress and displays the upload/extraction graph plus document links.
Case and document statuses are generated from separate timestamp fields.
See [the case/document design](../../docs/11-case-document-design.md) for constraints,
the clean migration and deferred attempt model.

`document.register({caseId, documentId, file})` records a document in a draft case.
Repeating the same registration is idempotent. `document.presign({documentId})`
returns a five-minute browser-to-S3 POST ticket for that document's stored key.
Policies enforce MIME, exact size and filename metadata; the upload transport
accepts PDF/JPEG/PNG/TIFF up to 20,000,000 bytes. On submission the API checks each
S3 object with HEAD outside the transaction, verifies its size and pins its version.
Under the case lock it records upload milestones before submission freezes membership.
Draft documents remain awaiting_upload and cannot be previewed until submission.
After commit the API asynchronously invokes document ingest. Ingest extracts the case's
documents in sequence and then invokes mapping. Invocation errors propagate to the caller;
resubmitting the same queued case through the API retries ingestion using its pinned
uploads, without fresh S3 HEAD requests. The intake form does
not provide a same-case retry control. Approval opens a read-only final check. Returning to review clears approval and requires a new approval before sending.
See [the storage protocol](../../infra/README.md#browserapi-protocol).

`document.presignGet({documentId})` returns a five-minute ticket for an owned,
uploaded document using its required storage bucket, stored key and recorded source version.
API ticket responses use `no-store`. Version-pinned source images use
`private, max-age=120, must-revalidate` for short browser caching; unversioned
extraction/mapping JSON keeps `private, no-store`. The browser reads S3 directly; signing makes
no S3 request. The ECS task role needs `s3:GetObject` and `s3:GetObjectVersion`
under `uploads/*` and `derived/*`. See [private document reads](../../infra/README.md#reading-private-documents).

To compare preview performance before and after deployment, use the same account,
document list, viewport and network throttling in browser DevTools. Leave **Disable
cache** unchecked. Clear the browser cache for the first load and record signing
request counts, S3 transferred bytes and time until visible previews load. Navigate
to a document and back within two minutes: the ticket URL should be reused and its
image should come from the browser cache. Cards request tickets when mounted;
native `loading="lazy"` lets the browser defer offscreen image downloads. Scroll
down to verify deferred images load as needed. Repeat after two minutes to check
image revalidation, and after five minutes (including a sleeping tab) to check
ticket renewal. Account changes must clear cached tickets. First-time image bytes
are unchanged; generated previews should be considered only after measuring this
baseline. Do not save signed URLs or patient images in shared performance reports.

Database schema/client and versioned migrations live in `@prostapaper/db`.
Startup applies Drizzle migrations before serving requests. `pnpm test:production`
runs HTTP/database integration tests against isolated production containers.
`AWS_REGION` and `S3_DOCUMENT_BUCKET` configure storage and `DOCUMENT_INGEST_FUNCTION` names the
function submission invokes; all three are required, so a task that is missing one fails to
start rather than degrading silently. The SDK uses the default credential chain (ECS task role
or local AWS profile).

`document.presignGet({documentId, target: "extraction"})` uses the same case-access
and storage checks to sign the stored extraction result key after extraction completes.
The source remains the default target and is pinned to its recorded version. Extraction
JSON follows `ExtractedDocument` (`pages: [{page, text, source}]`, optional `schemaText`);
the browser validates it and displays it beside the original. Browser JSON reads require
GET in the bucket CORS rule for the site and explicit local development origins.

## Case sharing

The owner opens **Sdílet** to select an existing user from a searchable list and
add **Kontrolující** (`reviewer`) or **Čtenář** (`viewer`) access. **Vlastník**
(`owner`) remains in `cases.owner_id`; grants live in `app.case_members` with the
grantor and timestamp. Case roles are separate from account-wide auth roles.

`case.sharing({caseId})` returns the user list and existing access only to the
owner. `case.addAccess({caseId, userId, role})` is owner-only and additive:
duplicate grants preserve the original role. There are no removal, role-change,
invitation, or ownership-transfer endpoints.

All members can read the case, documents, source images, extraction results,
mapping, and export receipt. Reviewers can register/upload draft documents,
submit, start review, approve, and reopen before export. Only the owner can
export to REDCap or grant access. Shared cases appear in the existing lists.
Workflow updates set the actual actor for the audit trigger; uploader and
approver identities remain separate from ownership. Download tickets still
expire after five minutes.

The integration test `tests/integration/sharing.test.ts` verifies inherited file
access, role boundaries, duplicate grants, and reviewer attribution against an
isolated test database with storage and ingestion stubs.

## REDCap submission

`case.approve` opens the final check without source documents. `case.reopen` returns
an approved case to review, but only before export starts. `case.sendToRedcap`
loads and validates the server-side mapping, verifies project 64 and automatic
numbering, then imports the surgery and repeating lesions in one request with
`forceAutoNumber=true`. The case UUID is only a temporary grouping ID in the
payload: REDCap allocates the new record ID. Existing records are never selected
for update. Every surgical form is marked Complete (`2`). There is no extra
confirmation checkbox. Schema/payload validation still applies.

The server uses `REDCAP_API_TOKEN` and `REDCAP_API_URL`; neither is exposed to the
browser. If MOÚ's gateway requires a validated session, set
`REDCAP_GATEWAY_COOKIE_FILE` to the absolute path of the private gateway-cookie
JSON described in [the MCP setup](../../tools/redcap/README.md). The API reads it
on each request, accepts only the gateway cookie allowlist, and rejects REDCap
login cookies. Rotations remain usable in memory when the file is read-only;
external file refreshes are still picked up. For durable rotation, mount a writable
directory rather than a single bind-mounted file. Refresh it using the validated browser session when it expires.
For containers the file must be mounted privately at the configured path; a host
path alone is not available inside ECS or Docker.

The deployed demo uses the standalone laptop relay instead of local gateway
cookies. Configure `REDCAP_RELAY_URL` and `REDCAP_RELAY_SECRET` together; the client
sends the same form to that HTTPS endpoint with a server-only bearer header.
Do not configure `REDCAP_GATEWAY_COOKIE_FILE` in relay mode. The relay holds the
validated gateway session and accepts only the approved import operation. Neither
redirects nor a failed relay request trigger a direct fallback or an import retry.
The relay journals the existing attempt UUID and returns the original receipt for
a confirmed duplicate. Ambiguous attempts remain subject to the app's existing
export lock and reconciliation procedure.

See [laptop relay operations](../../infra/README.md#laptop-redcap-relay) for the
AWS route, local process, startup check and recovery procedure. Application health
remains independent of laptop availability; the deployment environment check
requires a successful read-only project preflight before switching ECS.

An export claim commits under a row lock before remote work, so concurrent clicks,
refreshes and duplicate mutations cannot create another record. A successful reply
stores the REDCap ID and export timestamp; `/exporty` lists successful exports accessible to the user, newest first. Exported cases are read-only in both the API and database.
Startup applies migrations through `0019_review_queue_summary.sql` before serving requests.

Failures before import release the claim and leave the case approved. Any error
after import is attempted, or failure saving its receipt, leaves the case locked
for reconciliation. Imports are never automatically retried. Interrupted requests
also remain locked; after 60 seconds the UI labels the outcome unconfirmed and
continues polling for a reconciled result. Mapping reads have a 15-second abort
covering response headers and body; the export operation shares a 45-second
network/preflight deadline. A cancelled preflight cannot later start an import.

`app.case_audit_events` is append-only: database guards reject updates and deletes.
It records approval/reopen history, export attempt UUIDs, SHA-256 hashes of the
serialized payload, outcomes, and confirmed REDCap IDs, without raw clinical fields,
tokens or cookies. Existing approvals are backfilled when the migration runs.
Remote confirmation is saved separately before the final case receipt update;
if that update fails, the confirmed ID remains available in the audit trail.
If PostgreSQL is entirely unavailable, no database write can be guaranteed; the
original export claim remains locked and REDCap logs must be used for recovery.

Reconciliation is an operator action in this first version. In the recovery
transaction, set `app.actor_id` to the operator's existing application user ID
using `set_config('app.actor_id', operator_id, true)` so transition events identify
the operator (normal API workflow actions explicitly set the acting user). Check REDCap's import
log and the surgical values against the case, attempt UUID, audit trail and export start time. If a record
was created, verify all surgery/lesion rows and their Complete statuses, then save
its ID and timestamp in the application's receipt fields and clear
`export_unconfirmed` in the same transaction. If absence of an import has been
established, clear `export_unconfirmed`, then clear `export_started_at` in a second
update within that transaction, also clearing `export_attempt_id` and
`export_payload_hash`, to return to approved. Never release an ambiguous
claim just because a request timed out. Allow the operation deadline to expire and
verify the remote outcome before releasing a claim. Attempt IDs fence stale
preflight handlers from sending after a claim has been replaced. There is no user-facing retry or reopen
control for an unconfirmed export.

Tests mock REDCap; they never import live data. The export integration test runs
against an isolated PostgreSQL database/container and covers ownership, approval,
reopening, concurrent sends, receipts, preflight failures and unconfirmed imports.
