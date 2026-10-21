> **This is a stripped public copy.** It is a snapshot of the Rakathon 2026 team repository (`rakathon26/rakathon`, `main` at `72946bb`), republished here by [@adambisa](https://github.com/adambisa), who worked on it with [@filipcodes](https://github.com/filipcodes) and [@Roggy987](https://github.com/Roggy987). It is not the original repository.
>
> Removed for **copyright**: the PI-RADS v2.1 PDF (ACR), and the organizer's rules PDF with its text extract (`docs/reference/`). `packages/extraction/scripts/sector-figure.ts` reads the PI-RADS PDF and will not run without it.
>
> Removed or replaced for **PII**: the full git history (it carries personal commit emails), a team member's personal domain and home-directory paths (now `example.com` and `~/`), and the AWS account ID in the infra and workflow files (now `000000000000`). The Terraform and deploy workflow are for reading, not for running as-is.
>
> The CI/deploy workflow was moved from `.github/workflows/check.yml` to `ci/check.yml` so it does not run here; it is for reading, and its deploy jobs target the original team's AWS account.
>
> The data in this repo is synthetic. No real patient data is included.

# ProstaPaper — Rakathon 2026 (Brno / MOÚ)

Prostate pathology report + hand-drawn schema → structured, human-reviewed record → REDCap registry, for MRI/histology comparison.

Current architecture and proposals: [`docs/README.md`](docs/README.md). API/frontend, private RDS/Drizzle and shared-token auth are deployed. Private application S3 storage and presigned browser uploads are wired in code, awaiting deployment; delivery order in [`docs/07-skeleton-runbook.md`](docs/07-skeleton-runbook.md).

AWS ECS Fargate setup, Vercel DNS records, deployment and teardown:
[`infra/README.md`](infra/README.md).

## Commands

| Command                | Purpose                                                        |
| ---------------------- | -------------------------------------------------------------- |
| `pnpm dev`             | Native frontend hot reload and API watcher (after DB setup)    |
| `pnpm check`           | App/repository checks and architecture boundaries; same as CI  |
| `pnpm build`           | Turbo builds, restoring cached outputs when possible           |
| `pnpm test:containers` | Build prerequisites, then isolated Docker smoke tests          |
| `pnpm preview:docker`  | Build prerequisites, then production preview on localhost:8080 |

The task graph lives in `turbo.json`; per-package `turbo.json` files assign
architecture tags. Turbo boundaries are experimental in the pinned version.
Docker checks always run, even when app builds hit cache. Main deployments publish
one app image; Terraform and ECS handle rollout and secret injection. Use the
workflow image_digest input for an explicit rollback.

Use the exact Node version in `.nvmrc` (also enforced by pnpm). Build caching inputs and deployment verification are described in [the infra runbook](infra/README.md).

Local database setup and remote migration releases: [database runbook](infra/README.md#database-development-and-releases).
