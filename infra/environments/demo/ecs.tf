data "aws_caller_identity" "current" {}

data "aws_iam_role" "ecs_execution" {
  name = "${local.name_prefix}-ecs-execution"
}

data "aws_iam_role" "ecs_task" {
  name = "${local.name_prefix}-ecs-task"
}

# Keep this permission in the demo apply so it exists before the new task starts.
resource "aws_iam_role_policy" "redcap_secret" {
  name = "redcap-api-token"
  role = data.aws_iam_role.ecs_execution.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow", Action = "ssm:GetParameters"
      Resource = [for name in ["REDCAP_API_TOKEN", "REDCAP_RELAY_SECRET"] : "arn:aws:ssm:eu-central-1:${data.aws_caller_identity.current.account_id}:parameter/prostapaper/demo/${name}"]
    }]
  })
}

variable "image_uri" {
  description = "Tested application ECR digest. Required for service creation or updates."
  type        = string
  default     = null
  validation {
    condition     = var.image_uri == null || can(regex("^[0-9]{12}\\.dkr\\.ecr\\.eu-central-1\\.amazonaws\\.com/prostapaper-demo-app@sha256:[a-f0-9]{64}$", var.image_uri))
    error_message = "Use the app repository and an immutable sha256 digest."
  }
}

resource "aws_ecs_cluster" "app" {
  name = local.name_prefix
}

resource "aws_cloudwatch_log_group" "app" {
  name              = "/ecs/${local.name_prefix}"
  retention_in_days = 7
}

resource "aws_ecs_task_definition" "app" {
  depends_on               = [aws_iam_role_policy.redcap_secret]
  family                   = local.name_prefix
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = "512"
  memory                   = "1024"
  execution_role_arn       = data.aws_iam_role.ecs_execution.arn
  task_role_arn            = data.aws_iam_role.ecs_task.arn
  # Retain old revisions so operators can inspect and redeploy known image digests.
  skip_destroy = true

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }
  container_definitions = jsonencode([{
    name            = "app", image = var.image_uri, essential = true
    user            = "1000", readonlyRootFilesystem = true
    linuxParameters = { initProcessEnabled = true, capabilities = { add = [], drop = ["ALL"] } }
    portMappings    = [{ containerPort = 3000, protocol = "tcp" }]
    environment     = concat(local.database_environment, [{ name = "AWS_REGION", value = "eu-central-1" }, { name = "S3_DOCUMENT_BUCKET", value = aws_s3_bucket.documents.id }, { name = "DOCUMENT_INGEST_FUNCTION", value = aws_lambda_function.document_ingest.function_name }, { name = "MIGRATIONS_DIR", value = "/app/migrations" }, { name = "NODE_ENV", value = "production" }, { name = "PORT", value = "3000" }, { name = "PGUSER", value = "prostapaper_app" }, { name = "BETTER_AUTH_URL", value = "https://${var.site_hostname}" }, { name = "REDCAP_RELAY_URL", value = "https://${var.site_hostname}/internal/redcap/api/" }])
    secrets = [for environment, parameter in { BETTER_AUTH_SECRET = "BETTER_AUTH_SECRET", PGPASSWORD = "DB_PASSWORD", REDCAP_API_TOKEN = "REDCAP_API_TOKEN", REDCAP_RELAY_SECRET = "REDCAP_RELAY_SECRET" } : {
      name = environment, valueFrom = "arn:aws:ssm:eu-central-1:${data.aws_caller_identity.current.account_id}:parameter/prostapaper/demo/${parameter}"
    }]
    healthCheck = {
      command  = ["CMD-SHELL", "node -e \"fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\""]
      interval = 5, timeout = 2, retries = 3, startPeriod = 5
    }
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.app.name
        awslogs-region        = "eu-central-1"
        awslogs-stream-prefix = "app"
      }
    }
  }])

  lifecycle {
    precondition {
      condition     = var.image_uri != null
      error_message = "Set TF_VAR_image_uri to the tested app digest (see infra/README.md)."
    }
  }
}

resource "aws_ecs_service" "app" {
  name            = "app"
  cluster         = aws_ecs_cluster.app.id
  task_definition = aws_ecs_task_definition.app.arn
  launch_type     = "FARGATE"
  desired_count   = 1
  # Temporary second task during rollout; no autoscaling or persistent second replica.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60
  wait_for_steady_state              = true

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }
  network_configuration {
    subnets          = [aws_subnet.public.id, aws_subnet.public_b.id]
    security_groups  = [aws_security_group.app.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.app.arn
    container_name   = "app"
    container_port   = 3000
  }
  depends_on = [aws_lb_listener.https, aws_vpc_security_group_ingress_rule.app, aws_iam_role_policy.document_preview, aws_s3_bucket_versioning.documents, aws_s3_bucket_cors_configuration.documents, aws_s3_bucket_policy.documents, aws_s3_bucket_server_side_encryption_configuration.documents, aws_s3_bucket_ownership_controls.documents]
  timeouts {
    create = "20m"
    update = "20m"
    delete = "10m"
  }
}

output "ecs_cluster" {
  value = aws_ecs_cluster.app.name
}

output "ecs_service" {
  value = aws_ecs_service.app.name
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.app.arn
}

output "deployed_image" {
  value = var.image_uri
}
