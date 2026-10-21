# Monorepo tooling decisions

Status: reconciled with the implemented repository on 2026-10-06.

## Accepted setup

pnpm workspaces and Turborepo coordinate a TypeScript-first repository. Deployable
application source lives in `apps/api` and `apps/web`; reusable code lives in
`packages/config`, `packages/contracts` and `packages/db`. The API/frontend are
packaged together into one ECS image. A package may include a build or local CLI
without becoming a separately deployed service.

Node and pnpm are pinned in `.nvmrc` and `package.json`; dependency versions live
in the workspace catalog and committed lockfile. Use the installed Turbo package's
bundled documentation when changing task configuration; `AGENTS.md` explains how
to resolve it. Examples copied from other Turbo versions are not authoritative.

## Why this setup

The build window favors one language, one package manager and shared runtime
validation. pnpm manages dependencies; Turbo orders tasks and caches outputs.
Bundlers produce API/frontend artifacts; Docker packages them; GitHub Actions,
Terraform and ECS publish and release them. Turbo does not replace AWS operations.

Nx would add a larger plugin/configuration surface for the current package count.
A collection of unrelated shell commands would lose the shared dependency graph
and caching. A second Python toolchain is deferred until a concrete extraction
requirement justifies it; the Python database check runner was removed.

## Shared contracts

Zod is the source of truth for runtime validation and inferred TS types. Codegen
emits JSON Schema for downstream structured-output consumers. Current contracts
include case/document status vocabulary and extracted-document shapes; clinical records,
REDCap dictionary generation and export are future work.

The SPA calls typed tRPC procedures. API services use shared contracts and the
Drizzle schema. Future workers will consume explicit contracts once their
invocation/status semantics are defined. No protobuf/gRPC layer or worker
transition protocol is needed for the current demo.

## Current tasks

- `pnpm build`: cached package builds and codegen prerequisites.
- `pnpm dev`: native frontend/API development; PostgreSQL starts with `pnpm db:up`.
- `pnpm check`: boundaries, codegen, focused tests, type/lint, formatting and knip.
- `pnpm test:containers`: uncached lightweight production-image smoke checks.
- `pnpm test:production`: isolated production HTTP/database integration checks.
- `pnpm preview:docker`: local production preview with required build outputs.
- `pnpm db:generate`, `db:seed`, `db:up`, `db:down`: local database workflows.

The checked-in `turbo.json` and package scripts define the task graph; there is no
`turbo deploy` transport or EC2 release workflow. Production secrets are runtime
inputs, never baked into artifacts or used as build-cache inputs. Architecture
tags and Turbo boundaries enforce package dependencies in `pnpm check`.

Current delivery order: [implementation roadmap](07-skeleton-runbook.md).
Architecture and deployment: [stack decisions](03-stack-decisions.md) and
[infra runbook](../infra/README.md).
