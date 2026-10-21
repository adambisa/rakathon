# Implementation status and next steps

Status: 2026-10-07. The repository skeleton, production hosting and database
foundation are implemented. Private S3 and presigned browser uploads are implemented
in code. CI bucket-management and ECS upload IAM policies are installed; bucket
provisioning and a demo release remain pending. Use this delivery order rather
than the superseded scaffolding/EC2 instructions.

## Completed

- pnpm/Turbo workspace, strict TypeScript, shared ESLint/Prettier, package boundaries
  and Zod contracts with codegen.
- Hono/tRPC API and Vite/React frontend; UI library and deferred route skeletons.
- Feature routers with shared `CaseService` and `DocumentService`, singleton database pool and protected
  session middleware.
- ECS Fargate, immutable ECR image, ALB/ACM HTTPS, WAF, SSM secrets and GitHub OIDC.
- Private Single-AZ RDS, one schema-owning application login, Drizzle migrations
  at startup and local Docker PostgreSQL using the API env file.
- CI checks, PR container smoke tests and production HTTP/database integration
  tests; queued deploys, stale-revision guards and ECS health-based rollback.

The pipeline visualization remains in a separate open PR. It simulates processing;
a processing worker is not implemented.

## Delivery order

| Step | Deliverable                                                                      | Completion check                                                                                                 |
| ---- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 1    | Private application S3 bucket, scoped ECS task-role access, bucket configuration | Implemented; Terraform validated/planned, no apply; runtime access still needs deployment                        |
| 2    | Protected case/document registration and presigned POST uploads                  | Implemented; authenticated POST ticket and direct upload; named cases and document metadata persist              |
| 3    | S3-triggered Lambda and upload status reporting                                  | Implemented; upload milestones and source versions recorded idempotently; processing attempts remain future work |
| 4    | LLM config, extraction and mapping                                               | Each pipeline has a CLI/fixture and validated output                                                             |
| 5    | Evaluation                                                                       | Synthetic gold set and per-field scoring guide provider/prompt choices                                           |
| 6    | Review, approval and export                                                      | Confirmed clinical contracts persist and export human-approved records                                           |

Worker events, revision/attempt counters and the internal callback protocol were
removed. Reintroduce only what the actual worker requires. Clinical tables are
proposals, not installed schema. Better Auth replaced the shared token on 2026-10-07;
roles exist on the user row but no role-gated procedure uses them yet.

Separate maintenance: matrixed CI jobs/files in a folder, snapshot recovery drill
and alarm notification destination. Product and organizer questions remain in
[stack decisions](03-stack-decisions.md) and [research](01-rakathon-research.md).

## Local workflow

Use Node from `.nvmrc` and the pinned pnpm version:

```sh
pnpm install --frozen-lockfile
cp apps/api/.env.example apps/api/.env
pnpm db:up
pnpm dev
```

Copy the env file only for a new checkout. The API applies pending migrations
before serving. `pnpm db:generate` creates migrations after schema edits;
`pnpm db:seed` explicitly inserts optional synthetic records after initialization
and attributes them to the seeded reviewer, so run the user seed first.
`pnpm db:down` preserves local data. `pnpm check` runs repository checks;
`pnpm test:containers` and `pnpm test:production` use isolated containers.

Deployment, recreation and teardown: [infra runbook](../infra/README.md).
Architecture and roadmap: [stack decisions](03-stack-decisions.md).
Database implementation: [report](10-database-implementation.md).
