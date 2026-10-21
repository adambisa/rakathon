# Database, Drizzle and RDS decisions

Status: infrastructure deployed; case/document model implemented in code, reconciled 2026-10-09. This document describes
the accepted simplified demo design. The previous proposal for separate migration
roles/tasks and a worker event ledger was superseded.

## Scope

Synthetic or de-identified demo data, private Single-AZ RDS PostgreSQL 18.6 on
`db.t4g.micro`, and durable cases and documents. Real patient data, Multi-AZ,
clinical records and worker retry/event design are separate future work.

## Code ownership

`packages/db` contains reusable schema, validated connection configuration, client
factory, generated migrations and optional local seeding. It depends on contracts
for the shared status vocabulary. It is packaged into the API image, not deployed
as a separate service.

The API owns a singleton pool, `CaseService`, and `DocumentService`. Case list/get,
submission, document registration and upload tickets require the case owner.
Lists return the latest 50 owned cases with their documents. Readiness uses `SELECT 1`.

## Schema and credentials

`app.cases` contains one owner, a required name, ordered lifecycle milestones, an approval
actor, mapping reference and generated workflow status. `app.documents` contains
one case/uploader, file/storage metadata, ordered extraction milestones, result
reference and generated document status. Database guards freeze membership at
submission and content at approval. Unknown sizes are allowed with no size ceiling.
See [11 — Case/document design](11-case-document-design.md) for invariants, legacy
backfill and the deferred attempts model. Applied migrations remain immutable.

One login, `prostapaper_app`, owns the schema, applies migrations and serves API
queries. Its password is the sole database SSM parameter (`DB_PASSWORD`). The
RDS-managed administrator is reserved for infrastructure operations. Creating a
replacement RDS instance requires an operator to provision the application login;
there is no retained bootstrap script/task or automatic admin credential use.

## Network and configuration

RDS is encrypted and private in a subnet group spanning two AZs; the instance is
Single-AZ. Only the app security group can reach 5432. Public-subnet ECS tasks
reach it through VPC-local routing and use outbound internet access for AWS APIs.
There is no NAT gateway or public database endpoint.

Database config is validated with Zod using `PGHOST`, `PGPORT`, `PGDATABASE`,
`PGUSER`, `PGPASSWORD` and `PGSSLMODE`. Local unencrypted connections are limited
to local development hosts. Production requires verified TLS and
`NODE_EXTRA_CA_CERTS`. Docker downloads AWS's regional CA and checks its pinned
SHA256. The public CA is stored in the image; no PEM is committed to the
repository, and no env file enters the image.

Local native development, Compose and seed tooling share one ignored
`apps/api/.env`. Remote non-secret settings come from Terraform; ECS injects the
SSM password. Runtime secrets are not build/cache inputs.

## Migrations and releases

1. Edit the Drizzle schema and run `pnpm db:generate`.
2. Review and commit new SQL, snapshots and journal. Never rewrite applied migrations.
3. CI builds/publishes one image containing API, SPA and migration assets, then
   tests the published image against isolated PostgreSQL.
4. One Terraform plan/apply selects the image digest for ECS. Deploys queue and
   skip obsolete main revisions before apply.
5. API startup calls Drizzle `migrate()` before listening, then checks readiness.

The native migrator wraps all pending migrations in one transaction. If a
migration fails, the pending batch and its history inserts roll back, the API
exits, and ECS retains/restores the previous healthy app. The migration tracking
schema/table may be initialized outside that transaction on a fresh database.

If migrations commit and the app subsequently fails, the schema remains migrated:
ECS rollback restores app code only. Every release must allow the old and new
app to overlap. SQL that cannot run within a transaction requires a separate
explicit plan; arbitrary migration SQL is not guaranteed to be reversible.

There is no advisory-lock wrapper, history-drift checker, separate migrator image,
ECS migration task, shell launcher or remote seed task. The one-replica demo and
serialized deploy workflow are the chosen operating model; parallel manual
migration invocations are not supported by an added custom lock.

## Verification and operations

`pnpm check` includes database config and ESLint rule tests alongside type/lint,
format, dependency and boundary checks. Runtime-changing PRs run lightweight
container smoke tests. Production releases run HTTP/database integration tests
against synthetic containers: session authentication, owner-only case access,
case persistence across restart/migration reruns, and outage/recovery. These tests never target live RDS.

RDS has one-day automated backup retention, deletion protection, a final snapshot
on deletion and seven-day PostgreSQL log retention. Storage, memory and connection
alarms exist with notification actions disabled. Restore rehearsal and a
notification destination remain unfinished. AWS costs include instance/storage,
retained snapshots/logs and the existing ECS/ALB/WAF hosting; no fixed price quote
in this document substitutes for checking the bill.

No PostGIS or other optional extension is installed. Decide image/normalized/3D
coordinate semantics and concrete spatial queries before selecting medical point
types. Clinical record, extraction/review versions, approval and export schemas
remain future product design.

Commands and recovery/teardown guidance: [infra runbook](../infra/README.md).
Delivery summary: [implementation report](10-database-implementation.md).
Next implementation step: private application S3 storage and ECS task-role access,
as described in [the roadmap](07-skeleton-runbook.md).
