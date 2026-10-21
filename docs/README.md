# Project docs

Status: reconciled 2026-10-09. ECS hosting, private RDS/Drizzle, cases/documents and
Better Auth email+password sessions are implemented. Private application S3 storage,
scoped ECS task-role access and browser presigned uploads are wired in code but not
deployed. Processing and clinical review/export remain future work.

| Doc                                                                      | Purpose                                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| [01 — Rakathon research](01-rakathon-research.md)                        | Event context, clinical references and organizer questions                                  |
| [02 — Monorepo tooling](02-monorepo-tooling-eval.md)                     | Implemented pnpm/Turbo setup and shared contracts                                           |
| [03 — Stack decisions](03-stack-decisions.md)                            | Current architecture, clearly labeled product proposals and remaining work                  |
| [04 — Evaluation design](04-evaluation-design.md)                        | Future evaluation architecture and synthetic scoring proposals                              |
| [05 — App flow and UI](05-app-flow-and-ui.md)                            | Current auth/shell status and proposed clinical product flow                                |
| [06 — LLM config](06-llm-config.md)                                      | Future provider/configuration design; not implemented                                       |
| [07 — Implementation roadmap](07-skeleton-runbook.md)                    | Completed foundations, next S3 step and delivery order                                      |
| [08 — Infrastructure simplification](08-infra-simplification-handoff.md) | Accepted simplification outcome; retired host instructions removed                          |
| [09 — Database decisions](09-database-drizzle-rds-plan.md)               | Accepted single-login/startup-migration design and failure behavior                         |
| [10 — Database delivery](10-database-implementation.md)                  | Delivered scope, verification and remaining operational work                                |
| [11 — Case/document design](11-case-document-design.md)                  | Implemented ownership, document kinds (picked at upload) and routing, lifecycle constraints |
| [12 — Clinical record schema](12-clinical-record-schema.md)              | REDCap-shaped surgery record, generated dictionary snapshot and validated upload rows       |
| [13 — Hackathon intake and REDCap](13-hackathon-intake.md)               | Paired inputs, REDCap audit and preparation for reviewed HTTP uploads                       |
| [14 — Review expansion](14-review-expansion-plan.md)                     | Corrections, evidence, confidence, saved revisions, approval gates and implementation log   |
| [Infra runbook](../infra/README.md)                                      | Local workflows, deployment, rollback, recovery and teardown                                |

`reference/` contains the official rules PDF and PI-RADS v2.1. Product proposals are not evidence that their tables, routes or
packages already exist. Use the roadmap for implementation order and the runbook
for operating commands.
