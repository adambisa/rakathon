# AWS demo: ECS Fargate

The production runtime is one Docker image containing the Hono API and compiled
React frontend. ECS Fargate runs it; an Application Load Balancer terminates HTTPS
using ACM. ECS injects Parameter Store secrets and manages health-based deployment
rollback. There are no server bootstrap, env-file writer, SSM deployment or custom
rollback scripts. Standard ECS is used rather than Express Mode so Terraform owns
the custom-domain listener and certificate directly.

## Local development

Use Node **22.23.3** and the pinned pnpm version:

```sh
pnpm install --frozen-lockfile
# New checkout only:
cp apps/api/.env.example apps/api/.env
pnpm db:up
pnpm dev
```

Vite and the API watcher remain separate for fast development. Production Docker
packages their built outputs into one image; Node serves `/api/*`, static assets
and SPA routes. API misses and missing hashed assets remain 404s.

```sh
pnpm preview:docker # http://localhost:8080, uses apps/api/.env
# Stop preview:
docker compose down
pnpm test:containers # isolated test with dummy credentials
pnpm check
```

Turbo owns build prerequisites, codegen, caching and package boundaries. Preview
and smoke tests are uncached. `.nvmrc`, package inputs, dependency graph and declared
`VITE_*` inputs protect build caching; production secrets are runtime-only inputs.
Compose is only used locally and for CI smoke tests, never on the production host.

## Infrastructure and permissions

- `bootstrap/`: protected S3 state bucket, GitHub OIDC roles and app ECS execution roles. Apply manually.
- `environments/demo/`: VPC, public/private subnets, ECR, ECS, private RDS, ALB, WAF, ACM, the
  submit-driven document-ingest and mapping Lambdas with private service endpoints, and seven-day CloudWatch logs.
- `docker/Dockerfile`: pinned Node runtime plus prebuilt API/frontend outputs.
- `test-containers.sh`: frontend, routing, auth and cache-policy smoke tests.

The existing state bucket and bootstrap/demo state keys remain unchanged. Provider
caches and plan files are gitignored. Commit both provider lockfiles. Manual
`terraform apply` commands below print their plans and wait for confirmation; CI
applies a saved plan after checks.
For the hackathon, both GitHub pipeline roles have AWS `AdministratorAccess`,
tracked in `bootstrap/hackathon-permissions.tf`. Their OIDC trust is restricted to
this repository's `main` branch. The Terraform role retains the explicit denial
of replacing RDS-managed master credentials with an unmanaged password.
The execution role can read the auth secret, app DB password and REDCap API token SSM parameters, pull the app
image and publish logs. The app task role gets `s3:GetObject`, `s3:GetObjectVersion` and `s3:PutObject`
only for `uploads/*` in the separate application bucket. CI has `s3:*` access to
buckets and objects named `prostapaper-demo-*-000000000000-eu-central-1`, so new
bucket settings do not need individual IAM action additions. The CI and task-role
S3 policies were installed through the AWS CLI; bucket/app deployment is separate.

One task gets **0.5 vCPU / 1 GB RAM**. Deployments temporarily allow a second task;
there is no autoscaling. Tasks have public IPs for outbound access, but security
groups allow inbound application traffic only from the ALB. No NAT gateway is
created. Containers run as UID 1000, read-only, with capabilities dropped.
AWS WAF rate-limits each client IP to 1000 requests per five minutes and blocks
known-bad inputs; adjust `waf.tf` if the demo needs more headroom.

## Initial setup or recreation

```sh
aws login --profile prostapaper-login
export AWS_PROFILE=prostapaper
terraform -chdir=infra/bootstrap init -lockfile=readonly
terraform -chdir=infra/bootstrap apply
terraform -chdir=infra/environments/demo init -lockfile=readonly
```

In AWS Parameter Store (Frankfurt), create Standard SecureString parameters
`/prostapaper/demo/BETTER_AUTH_SECRET`, with a strong random value of at least
32 characters. Preserve existing values. Rotating it invalidates every session.
The retired `/prostapaper/demo/API_TOKEN` parameter can be deleted.
Store the approved project 64 REDCap token in `/prostapaper/demo/REDCAP_API_TOKEN`
as a Standard SecureString. ECS injects it into the server's `REDCAP_API_TOKEN`
environment variable by ARN; Terraform does not read the token value. The demo
stack adds a dedicated execution-role permission before creating the task definition
that references the parameter. Local development uses the same variable in the gitignored
`apps/api/.env`; `REDCAP_API_URL` defaults to `https://redcap.mou.cz/api/`.
The token is optional for local runs without REDCap. Reviewed cases are submitted
through the authenticated app flow. The repository's REDCap MCP remains read-only.
The demo uses the laptop relay described below to pass MOÚ's gateway validation.
Terraform reads one secret: `/prostapaper/demo/DB_PASSWORD` becomes the document-ingest
function's `PGPASSWORD` variable (encrypted at rest with the Lambda service key), so
that value also lives in the demo state file and in CI's temporary plan JSON. The ECS
task still receives it as an SSM reference. Local development uses `.env`.

Before `terraform apply`, the deploy job resolves every SSM secret the planned task
definition references and runs the result through the API's own `loadEnv` and
`loadDatabaseConfig` schemas (`pnpm --filter @prostapaper/api check:deploy-env`), so a
missing or malformed parameter fails the run before ECS starts a task. Parameters under
`/prostapaper/demo/` that the task no longer references are reported, not failed.

### Laptop REDCap relay

The demo routes server-side submissions through
`https://rakathon.example.com/internal/redcap/api/`. Its dedicated ALB
listener rule forwards to EC2 port 18765, which is an SSH reverse forward to this
laptop's Docker relay. The laptop initiates SSH over SSM, so no public EC2 SSH
ingress or inbound laptop firewall rule is needed. The existing app target group
and health checks are separate from this route.

`redcap-relay.tf` attaches an additional security group to the existing
SSM-managed host (`redcap_relay_instance_id`, currently `i-0927102898ac8a8d3`). It
does not own or replace that instance or its IRIS runtime. Only the ALB security
group can reach TCP 18765. `terraform output -json redcap_relay` gives the
non-secret tunnel settings. Deleting this existing instance also removes relay
availability; reconfigure the tunnel and Terraform instance ID if replacing it.

The standalone local service lives outside this repository at
`~/redcap-relay`. It contains its own Dockerfile, Compose
file, operating instructions, synthetic tests, private cookie directory, durable
attempt journal and restricted SSH client key. It needs no application checkout
at runtime. Docker publishes only `127.0.0.1:8765`; SSH forwarding crosses the
authenticated SSM connection. Do not commit the local service's credentials or
cookie files here.

ECS receives `REDCAP_RELAY_URL` and the SecureString
`/prostapaper/demo/REDCAP_RELAY_SECRET`. The execution role can fetch that secret;
Terraform references its ARN and never reads its value. This must match the
standalone relay's bearer credential. The normal project token stays configured
and must match the relay's project token. The deploy-env check makes an
authenticated, read-only project preflight through the actual relay URL and
requires project 64 with automatic numbering enabled. It fails deployment before
ECS switches if the laptop, gateway session or forwarding route is unavailable.
WAF request sampling is disabled to avoid retaining authentication headers;
rate limiting and known-bad-input protection remain active.

Local operations:

```sh
cd ~/redcap-relay
./relayctl up
./relayctl service status
./relayctl check
```

The user LaunchAgent is installed on this laptop. It supervises the tunnel and
prevents idle sleep; Docker supervises the HTTP relay. After a fresh setup, use
`./relayctl service install` to install/start it. Do not also run a foreground
tunnel against the same remote port. `./relayctl service stop` stops forwarding
and restores normal sleep behavior after the demo; `./relayctl service start`
starts it again. `./relayctl watch` monitors live gateway readiness. Keep Docker
Desktop running and refresh the host's AWS login when it expires.

The local `configure-aws.py` provisions only the restricted forwarding Unix
account, pins the host key through authenticated SSM, and provisions the relay
SecureString without printing it or overwriting a different existing value. Its
SSH account allows remote forwarding only on the verified private address and
TCP 18765; shell sessions and other forwarding are disabled. Local SSH credentials
are outside the Docker mount. Run this setup again only when deliberately
reconfiguring the host or credentials.

The routing bootstrap is already provisioned in AWS and is kept outside the
shared main state until this configuration is merged. This prevents older main
deployments from destroying new resources they do not declare.
`redcap-relay-imports.tf` explicitly adopts the seven existing relay resources on
the first deployment. Its IDs describe this demo account's prepared bootstrap;
they are not secrets. Normal full-stack deployment then owns those resources.
Do not apply this unmerged configuration into shared main state early. A fresh
environment requires its own bootstrap and corresponding import IDs. The routing
bootstrap must exist before deployment because the deploy-env check requires a
successful authenticated project check over the actual HTTPS route.

If readiness fails, inspect the local logs and tunnel first. Gateway challenges
need a human to validate in the browser and privately refresh the allowlisted
gateway cookies. Docker restarts the process after a crash; SSH reconnects after
a disconnect. Recovery never retries an HTTP import. Keep the laptop on AC power
with Docker running and sleep prevented for the demo.

The current export format is an identity-only base row plus Complete repeating
lesion rows. Parent clinical fields and `surgery_c61_complete` are not sent. The
relay accepts this shape and journals the existing export-attempt UUID before
dispatch. Preserve the local `state/` directory across restarts. If an import may
have reached REDCap, keep the app's export claim locked and reconcile it using
the existing [submission recovery procedure](../apps/api/README.md#redcap-submission).
Do not clear the journal, generate a replacement attempt or retry automatically.
Read-only project checks establish connectivity, not import permissions or a
successful live clinical submission. Automated validation uses synthetic imports.

Before the first full demo apply, provision the registry and certificate so an
image can be published and DNS validated. This is a one-time bootstrap target:

```sh
terraform -chdir=infra/environments/demo apply \
  -target=aws_ecr_repository.application \
  -target=aws_ecr_lifecycle_policy.application \
  -target=aws_acm_certificate.app
terraform -chdir=infra/environments/demo output certificate_dns_records
```

Add the returned validation CNAME in Vercel DNS and retain it for ACM renewal.
Build/publish the first image using the commands below, then run a normal full
apply. Future deployments never need resource targeting.

## Deployments and rollback

GitHub Actions builds and publishes one immutable ECR image, smoke-tests that exact
digest, and applies a saved Terraform plan using the digest. Tags include commit, run ID
and attempt so reruns cannot collide. Main deployments queue without canceling
active deployments; current-main checks skip stale revisions before apply.
Terraform's state lock also serializes local applies. Do not intentionally deploy
an older local plan after a newer deployment.

ECS starts a healthy replacement before stopping the old task. Its deployment
circuit breaker automatically restores the previous successful deployment on
failure. Terraform waits for stability; CI also checks that ECS actually runs the
requested task definition, so a recovered failed rollout is not reported as success.

For an explicit rollback, Actions → **check** → **Run workflow**, branch **main**:
set `image_digest` to a retained `sha256:...` digest in `prostapaper-demo-app`.
Leave it blank for a fresh build. This uses current infrastructure configuration
with the chosen old app image. Tagged images are retained until teardown so
rollback is not broken by an image-count lifecycle rule.

Manual build and deployment (Docker and AWS CLI required):

```sh
export AWS_PROFILE=prostapaper
pnpm build
repository="$(terraform -chdir=infra/environments/demo output -raw application_repository)"
aws ecr get-login-password --region eu-central-1 | docker login --username AWS --password-stdin "${repository%%/*}"
docker buildx build --platform linux/amd64 -f infra/docker/Dockerfile \
  --provenance=false --tag "$repository:manual-$(date -u +%Y%m%dT%H%M%SZ)" \
  --metadata-file /tmp/prostapaper-image.json --push .
export TF_VAR_image_uri="$repository@$(jq -r '.["containerimage.digest"]' /tmp/prostapaper-image.json)"
APP_IMAGE="$TF_VAR_image_uri" pnpm test:production
terraform -chdir=infra/environments/demo apply
```

For infrastructure-only changes, first use the existing image:
`export TF_VAR_image_uri="$(terraform -chdir=infra/environments/demo output -raw deployed_image)"`
An unchanged plan does not restart tasks. To load rotated SSM secrets without
changing the image, use the ECS console's **Force new deployment**, or:

```sh
aws ecs update-service --region eu-central-1 --cluster prostapaper-demo \
  --service app --force-new-deployment --query 'service.serviceName'
aws ecs wait services-stable --region eu-central-1 --cluster prostapaper-demo --services app
```

Rollback changes app code, not secrets or database schema. Task definition revisions
are retained so AWS can recover deployments; they do not incur compute charges.

## Vercel DNS and HTTPS

```sh
terraform -chdir=infra/environments/demo output certificate_dns_records
terraform -chdir=infra/environments/demo output application_dns_record
```

Use the certificate-validation CNAME exactly as returned. For the application,
replace the old A record with a CNAME pointing to the **ALB DNS name**, not one of
its resolved IPs. Vercel may ask for the relative name under `example.com`:
`rakathon.projects`. Leave the validation CNAME in place permanently.
Terraform waits for ACM validation before attaching the HTTPS listener. HTTP is
redirected to HTTPS. Do not switch application DNS until the new service is healthy.

## Operations and teardown

```sh
aws ecs describe-services --region eu-central-1 --cluster prostapaper-demo --services app \
  --query 'services[0].{running:runningCount,pending:pendingCount,events:events[:5]}'
aws logs tail /ecs/prostapaper-demo --region eu-central-1 --since 10m
```

Before teardown, set the GitHub repository Actions variable
`DEMO_DEPLOY_ENABLED=false` to prevent later main pushes from recreating the demo.
Checks continue to run. Then:

```sh
export AWS_PROFILE=prostapaper
export TF_VAR_image_uri="$(terraform -chdir=infra/environments/demo output -raw deployed_image)"
# First deliberately disable RDS deletion protection in rds.tf and apply; confirm the final snapshot identifier is unused.
# Confirm only after checking that the plan removes the ECS service, private RDS, ALB and other demo resources:
terraform -chdir=infra/environments/demo apply -destroy
```

This removes running tasks, ALB/public IP allocations, networking, logs, certificate
and the demo ECR repository **including its images**; RDS deletion retains a final snapshot. Remove the application CNAME
from Vercel as part of teardown. The protected bootstrap state bucket, IAM roles,
SSM parameters and retained task-definition metadata remain for reuse; no running
compute remains. Bootstrap state is intentionally protected from accidental deletion.
Retained task definitions can be deregistered through ECS when no longer needed.
Do not merely scale tasks to zero: the ALB would continue charging.

Estimated light-use hosting: ~$60–70/month before tax (about $7 of that is WAF),
excluding DB, workers and LLM usage. Seven-day log retention and one steady task limit idle costs.

## Database development and releases

The demo uses private, encrypted Single-AZ RDS PostgreSQL. One database login,
`prostapaper_app`, owns the application schema and runs both the API and migrations.
The RDS-managed administrator remains an infrastructure account, unused by the API.
The application login requires `CONNECT`, `CREATE` and `TEMPORARY` on the
`prostapaper` database and has `ALL PRIVILEGES` on that database. Migration `0003` uses a transaction-scoped temporary table
to check canonical email collisions before updating accounts. Schema ownership
alone does not grant permission to create temporary tables. Container smoke tests
use a non-superuser login with these database privileges.

### Local workflow

```sh
cp apps/api/.env.example apps/api/.env # new checkout only
pnpm db:up
pnpm dev
# After the API has initialized the database:
pnpm db:seed # optional synthetic records
```

One ignored file, `apps/api/.env`, contains API authentication and PostgreSQL
settings. Set `API_ENV_FILE` to an absolute path to use an alternate file. Compose
initializes PostgreSQL with the same login and password as the API. No env files
enter the image. `pnpm db:down` stops PostgreSQL and preserves its volume.

### Schema and startup

`pnpm db:generate` uses Drizzle Kit. Review and commit generated migrations;
never edit applied SQL or its metadata. Before listening for requests, the API
calls Drizzle's `migrate()` and checks database readiness. Initialization failure
closes the pool and exits without serving traffic. Native development defaults
`MIGRATIONS_DIR` to `../../packages/db/migrations`; the image uses `/app/migrations`.

There is no separate migration task, custom migration runner, database bootstrap
or remote seed task. Local seeding remains an explicit Drizzle insert command.
Cases store a required name, owner and workflow milestones; documents store a required
case and uploader, source identity and extraction milestones. Separate statuses are
generated from timestamps. Worker attempts/retries are deferred to step 2.

### Production artifacts and releases

One image packages the API, migration SQL, optional local seed entry point and
frontend. Docker downloads the public regional RDS CA and verifies its pinned
SHA256; `NODE_EXTRA_CA_CERTS` enables verified TLS. No PEM is committed.

Releases build and publish the image, test it, then apply one Terraform plan.
ECS starts the API, which migrates before listening. CI verifies the task definition,
liveness and readiness. `DB_PASSWORD` is the only database password in SSM.
Startup migrations also run for an image selected for rollback; rollbacks never
reverse schema migrations. Images from before the worker-ledger removal expect
removed columns and cannot serve as rollback targets for this schema. Keep migrations compatible with overlapping app versions.

The existing demo ownership was transferred to `prostapaper_app`; the retired
migration login and password were removed. No retained bootstrap command exists. Recreating RDS also requires provisioning its
application login; the provider-managed administrator is separate from runtime.

### Verification

`pnpm test:production` builds an isolated production container and runs native
Node TypeScript integration tests in `apps/api/tests/integration`. Tests cover
case creation/list/read, owner-only access, session authentication, expected not-found errors, persistence across startup
migration reruns, and database outage/recovery. No pagination
fixtures or Python runner remain. The suite is excluded from `pnpm check` and
PR smoke tests; CI runs it before production deployment against the published
image. It never runs destructive outage checks against the live RDS instance.
Test files run serially because they share the database and the outage test
stops it. The database uses an explicit host port so connections still reach it
after recovery.

`pnpm test:containers` retains the lightweight production-image routing/auth/asset
smoke checks used on runtime-changing pull requests. Both suites use temporary
Compose projects and volumes and clean them up afterward.

Terraform uses `terraform fmt`, plus `pnpm check:terraform:style` to require blank
lines between blocks and multiline declarations. The same checks run in CI and
pre-commit. `pnpm format:terraform` applies canonical formatting and checks layout.

Backup restore remains an explicit operator exercise: restore a snapshot to a
separate private RDS instance, inspect synthetic records through a task in its
network, and delete the temporary restored instance afterward. Tests never
restore or replace the active database automatically.

Requested follow-up: split CI checks into matrixed jobs with supporting files in
a dedicated folder. That separate restructuring is still deferred.

## Private application S3 uploads

The application bucket is `prostapaper-demo-documents-000000000000-eu-central-1`,
separate from Terraform state. The demo stack owns it; bootstrap owns task-role
and CI permissions. The CI bucket-management and task upload policies are installed
in IAM and represented in bootstrap Terraform. The bucket and app deployment remain
separate from that IAM update.

The bucket blocks all public access, disables ACLs, encrypts with SSE-S3, requires
TLS and enables versioning. `force_destroy=false` makes teardown fail while any
objects or versions remain: deliberately review and empty the application bucket
before destruction. Current and noncurrent versions are retained indefinitely
for the future processing flow. Only abandoned multipart uploads expire after one
day. Document registration persists upload metadata; scheduled cleanup workers remain future work.

Only the site HTTPS origin and explicit `upload_development_origins` (default
`http://localhost:5173`) get browser POST and GET CORS access. CORS does not grant S3
permissions. The API task role can `GetObject`, `GetObjectVersion` and `PutObject` under `uploads/*`.
The demo stack manages the separate `application-document-preview` task-role policy
(`s3:GetObject` and `s3:GetObjectVersion` on this bucket's `uploads/*` and `derived/*`), and ECS
is dependent on it. Normal deployments install preview permissions without a manual
bootstrap apply. The bootstrap upload policy remains independently managed.
The document-ingest function below is the only event consumer. It reads pinned upload
versions and writes extraction output to `derived/{documentId}/document.json`.

### Reading private documents

`document.presignGet({documentId})` requires the owning case's signed-in owner,
matching `document.list` and `document.get`. The document service reads its own
stored source key and recorded version; callers cannot supply arbitrary S3 keys.
Legacy uploads with unknown bucket/version retain their original key in the
configured bucket. Missing or inaccessible documents return `NOT_FOUND`;
unconfigured/mismatched storage and unfinished uploads return `PRECONDITION_FAILED`.
Signing does not check object existence in S3. Versioned reads require
[`s3:GetObjectVersion`](https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html),
granted by both bootstrap and normal deployment task-role policies.

The response is `{url, expiresAt}` with a five-minute lifetime and
`Cache-Control: no-store`. Version-pinned source GETs request
`private, max-age=120, must-revalidate`; extraction/mapping JSON remains `private, no-store`.
Source images can remain in the browser cache for two minutes, including after logout.
URLs are
bearer credentials: anyone holding one can read the object until expiry (or until
the signing role's temporary credentials expire, if sooner). Store document IDs/object
keys, not signed URLs. Document cards link to `/dokumenty/{documentId}`. The
frontend reuses tickets until 30 seconds before expiry and retains inactive tickets
in memory for ten minutes. Active queries refresh before expiry and stale tickets
refresh on mount, focus or reconnect. Expired tickets are withheld from consumers.
Session changes reset the query cache. Document cards request tickets when mounted
and use native `loading="lazy"` and `decoding="async"`; the browser controls when
offscreen images download.
The detail page eagerly previews the JPEG and links to the original.
The detail view also calls `document.presignGet({documentId, target: "extraction"})`
for the stored extraction JSON after extraction completes. The API signs the stored
result key, uses the same owner and bucket checks, and returns `PRECONDITION_FAILED`
while extraction is unfinished. The browser validates the `ExtractedDocument` contract
and displays each page's text beside the original. Browser JSON fetches require GET
in the bucket CORS rule; the normal deployment policy grants reads under `derived/*`.

### Browser/API protocol

1. Sign in, enter a case name and select PDF, JPEG, PNG or TIFF files. Uploads
   accept at most 20,000,000 bytes and reject empty files and extension/MIME mismatches.
2. `case.create({name})` creates one draft for the batch. For each file,
   `document.register({caseId, documentId, file})` records its metadata and fixed
   `uploads/{documentId}/source` key. Repeated registration with the same ID and
   metadata returns the same document; callers cannot choose a bucket or key.
3. `document.presign({documentId})` checks case ownership and draft state, then
   returns a five-minute POST ticket. The policy binds key, MIME, exact size and
   UTF-8 filename encoded in `x-amz-meta-filename-base64url`.
4. The browser sends the signed fields and file last directly to S3, then calls
   `case.submit`. The API HEADs the registered objects outside its transaction and
   checks their exact sizes. Under the case lock it pins object versions and records
   `uploaded_at` before `submitted_at`, then freezes membership. Draft documents remain
   `awaiting_upload` and cannot be previewed before submission.
5. After commit the API invokes ingest with `{caseId}`. A failed invoke returns an API
   error. The same queued case can be submitted again through the API; the intake form
   has no same-case retry control. S3 events do not start processing.

### Document-ingest and mapping functions

The ingest function also accepts database-free `mode: "extraction-qa"` requests.
See [the QA runbook](../qa/README.md) for dataset preparation, permissions and scoring.
QA files live under `qa/` in the documents bucket.

`apps/document-ingest` is a Node 22 Lambda (`arm64`, 3008 MB, 10 min) in private
subnets. Its security group permits PostgreSQL, the S3 gateway endpoint and HTTPS to
private Mantle and Lambda interface endpoints. It has no internet egress; OCR assets
ship in the deployment zip. The account has ten unreserved concurrent executions.

Ingest takes `{caseId}`, loads the uploaded documents and rejects missing upload
milestones or source versions. It skips completed extractions and processes the rest
in sequence. Each extraction reads the pinned version, writes
`derived/{documentId}/document.json`, then records `extracted_at`. Only after all documents
are extracted does ingest invoke mapping with `{caseId}`.

Mapping validates the case request and records `mapping_started_at` for a submitted,
unmapped case. It maps the extracted documents to `SurgeryRecord`, writes
`mapping/{caseId}/record.json` with `If-None-Match: *`, then records `mapped_at`.
An existing mapping object is preserved and its database completion is reconciled.
Both functions hold a session advisory lock per case and stage; concurrent duplicate
deliveries fail with a retryable lock-contention error. The dedicated lock session closes on completion or failure,
allowing retries without a time lease. Each invocation uses at most two database
connections: one lock session and one for short queries.

A page uses its embedded PDF text only when that text exceeds 200 non-whitespace
characters, which a scanner's header stamp does not reach and a real report page clears
many times over. Everything else renders at 300 dpi for Tesseract in Czech.

MuPDF, the Tesseract cores and the language data all ship inside the deployment zip; the
function has no internet egress to fetch them. The language data are the
`@tesseract.js-data` packages' **integer** LSTM models, because the float models abort the
relaxed-SIMD core Node selects ([tesseract.js#1080](https://github.com/naptha/tesseract.js/issues/1080)).
Three full cores ship rather than the smaller `-lstm` ones: tesseract.js passes a boolean
where its core selection expects an engine-mode number, so it never picks an `-lstm` build.
Uploads are capped at 20,000,000 bytes, so documents are held in memory and `/tmp` is unused.

Failures reject the invocation. Both functions retry asynchronously twice, with a
six-hour maximum event age and no dead-letter queue. Find incomplete cases with:

```sql
select id, submitted_at, mapping_started_at
from app.cases
where submitted_at is not null and mapped_at is null
  and updated_at < now() - interval '15 minutes';
```

Retry the case by invoking ingest; completed extractions are skipped. A queued case
can also be resubmitted through the API.

```sh
aws lambda invoke --region eu-central-1 --function-name prostapaper-demo-document-ingest \
  --invocation-type Event --cli-binary-format raw-in-base64-out \
  --payload '{"caseId":"…"}' /tmp/ingest-response.json
aws logs tail /aws/lambda/prostapaper-demo-document-ingest --region eu-central-1 --since 10m
```

PostgreSQL connections use TLS with the RDS CA bundle supplied by the managed Node
runtime at `/var/runtime/ca-cert.pem`. `NODE_EXTRA_CA_CERTS` extends the root store,
so S3 TLS is unaffected.

The deploy job always runs `pnpm build` so `data.archive_file` can zip `dist/` before
`terraform plan`, including on image rollback (which therefore ships the current function
code). For a manual apply, run `pnpm build` first.

### REDCap record cutover

The REDCap-shaped record deliberately rejects existing ICCR mapping objects. After
this deployment, stop new submissions and let active workers finish before clearing
the demo cases and documents. On a private database connection, run:

```sql
truncate app.documents, app.cases;
```

Empty the application documents bucket, including every noncurrent version and
delete marker; `aws s3 rm` alone leaves versioned contents behind. Recreate demo
cases through the intake form. Do not reset the Terraform state bucket or REDCap.

### Local configuration and verification

The API uses the AWS SDK default credential chain: ECS task credentials in
production, the logged-in `AWS_PROFILE=prostapaper` profile for native local work.
Set `S3_DOCUMENT_BUCKET` in `apps/api/.env` after provisioning a bucket.
The API defaults to `eu-central-1`; set `AWS_REGION` when using another region.
Terraform supplies both values to ECS. No static keys or presigned URLs enter the database or
frontend bundle. Leaving the bucket unset preserves local health/case workflows
and returns a clear upload configuration error. Local Docker does not mount host
AWS credentials; use native API development for AWS upload testing.

Declared MIME and size do not validate document contents. Synthetic/de-identified
files remain the demo scope; future processing must parse untrusted documents.
Presigned tickets are bearer capabilities reusable until expiry.

`pnpm check` covers formatting, lint, type checks and the existing test tasks.
Document interface and connection tests are deferred.
`pnpm test:production` checks the unchanged database migrations/persistence against
temporary PostgreSQL and a production image. Use `terraform validate` and
authenticated `terraform plan` for both stacks; do not apply until deployment is
intended. Actual browser CORS, S3 policy enforcement and task-role access need a
provisioned bucket and a future synthetic smoke upload.
