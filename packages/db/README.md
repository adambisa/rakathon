# @prostapaper/db

Shared Drizzle schema, PostgreSQL connection validation, versioned migrations and
an optional local seed entry point. The API owns one singleton client and applies
Drizzle migrations before serving requests. The same login owns the schema and
handles application queries.

- `pnpm db:generate`: generate and review schema migrations.
- `pnpm db:up` / `pnpm db:down`: start/stop local PostgreSQL.
- `pnpm db:seed`: explicitly insert synthetic demo records after API startup.

Applied migrations remain immutable. No bootstrap, custom migration runner or
remote database task is retained. See the [runbook](../../infra/README.md#database-development-and-releases).
