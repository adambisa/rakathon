# Database implementation

Private Single-AZ RDS PostgreSQL persists application data for the demo. `packages/db` owns
shared schema/configuration and immutable migrations; the API owns one singleton
Drizzle pool. One runtime login owns the schema and runs both app queries and
Drizzle migrations before the HTTP server starts.

Local development needs only `apps/api/.env`, copied from `.env.example`. Compose
initializes PostgreSQL with that same login. Native development uses the same file;
AWS uses Terraform settings and SSM `DB_PASSWORD`. The RDS-managed administrator
is an infrastructure account, unused by the API.

The current code uses cases and documents with generated statuses, ordered milestones,
owner-scoped access, source/result references, and database lifecycle guards. Migration
0005 requires an empty jobs table, creates the new model without backfill, and installs
lifecycle guards. Historical migrations remain unchanged. Legacy demo jobs and S3
object versions were cleared explicitly; the new schema is deployed through the PR. See [11 — Case/document design](11-case-document-design.md).

No bootstrap SQL/script, dedicated migration runner, operator execution role,
remote seed/bootstrap/migration task or launcher remains. One Docker stage packages
API, frontend, migrations and the optional local Drizzle seed command. CI tests the
published image and performs one Terraform plan/apply followed by health checks.
The public RDS certificate is downloaded and verified during Docker packaging.

Production integration tests exercise the HTTP interface: case persistence
across restart/startup migrations, and database outage/recovery. They run against
isolated synthetic containers, never the live RDS instance. Database config tests
remain. Terraform formatting/layout checks run locally, in CI and pre-commit.

The live ownership transfer and cleanup release completed. The retired database
login, migration password, worker secret, two execution roles and obsolete task
definitions were removed. The database and skeleton PRs are merged. Their combined
main revision `f6d7aee` deployed successfully on 2026-10-06 as ECS task revision 12;
health/readiness, public tRPC, unauthenticated job rejection and frontend assets
were verified. The pipeline visualization remains a separate open PR.

Routine deployments replace task revisions and image digests; inspect ECS and ECR
for the current release rather than treating this delivery checkpoint as a pinned
rollback target.
The historical production integration tests, targeted build/type/lint/config checks,
package boundaries, retained local database upgrade/seed and Terraform validation
pass. RDS configuration and app network access were unchanged. Pre-cleanup images
expect the removed worker columns and are unsuitable rollback targets after this
schema change; future rollbacks must use compatible images.

The CI matrix/folder restructuring remains a separate deferred follow-up.

Private application S3 storage, browser uploads and the document-ingest Lambda are wired in
code, including per-document text extraction. Better Auth owns the `auth` schema; case-level
mapping, clinical schema/review/export, a snapshot recovery rehearsal and alarm notifications
remain future work. See the [roadmap](07-skeleton-runbook.md).
