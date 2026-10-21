# Infrastructure simplification outcome

Status: reconciled 2026-10-06. The infrastructure review led to ECS Fargate;
the former EC2/Compose/Caddy deployment and custom release/rollback scripts were
removed. This file records the outcome, not an operator handoff for the retired host.

## Implemented

- One API/frontend image in ECR; Node serves the SPA and Hono/tRPC API.
- ECS runs one steady replica; ALB/ACM provides HTTPS and WAF filters requests.
- Execution role injects SSM secrets, pulls the image and writes CloudWatch logs.
- GitHub OIDC separates image publishing from demo Terraform operations.
- Bootstrap owns IAM and the protected Terraform state bucket; CI cannot edit
  runtime roles. Demo Terraform owns application resources and image selection.
- Queued deployments, current-main guards, saved plans/state locking and ECS
  health-based rollback replace custom release coordination scripts.
- Private RDS and native startup migrations use one application database login.
- Turbo builds prebuilt outputs and orders checks/local workflows; Compose is
  limited to local preview and isolated CI testing.

## Remaining

The app task role has no AWS permissions yet. The next step is private application
S3 storage and scoped task-role permissions, with bucket settings injected into ECS.
The state bucket is not application storage. CI check matrix/folder restructuring,
alarm notifications and the recovery drill remain separate follow-ups.

See [stack decisions](03-stack-decisions.md), [delivery order](07-skeleton-runbook.md)
and [infra runbook](../infra/README.md) for the current architecture and commands.
