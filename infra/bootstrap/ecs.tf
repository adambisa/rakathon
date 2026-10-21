data "aws_caller_identity" "current" {}

resource "aws_iam_role" "ecs_execution" {
  name = "prostapaper-demo-ecs-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow", Action = "sts:AssumeRole"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Condition = {
        StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id }
        ArnLike      = { "aws:SourceArn" = "arn:aws:ecs:eu-central-1:${data.aws_caller_identity.current.account_id}:*" }
      }
    }]
  })
}

resource "aws_iam_role_policy" "ecs_execution" {
  name = "pull-image-logs-and-secrets"
  role = aws_iam_role.ecs_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
      {
        Effect   = "Allow"
        Action   = ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability"]
        Resource = "arn:aws:ecr:eu-central-1:${data.aws_caller_identity.current.account_id}:repository/prostapaper-demo-app"
      },
      {
        Effect   = "Allow", Action = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:eu-central-1:${data.aws_caller_identity.current.account_id}:log-group:/ecs/prostapaper-demo:*"
      },
      {
        Effect   = "Allow", Action = "ssm:GetParameters"
        Resource = [for name in ["BETTER_AUTH_SECRET", "DB_PASSWORD"] : "arn:aws:ssm:eu-central-1:${data.aws_caller_identity.current.account_id}:parameter/prostapaper/demo/${name}"]
      }
    ]
  })
}

# Application AWS calls use the task role; secret injection uses the execution role.
resource "aws_iam_role" "ecs_task" {
  name               = "prostapaper-demo-ecs-task"
  assume_role_policy = aws_iam_role.ecs_execution.assume_role_policy
}

locals {
  documents_bucket_arn = "arn:aws:s3:::prostapaper-demo-documents-${data.aws_caller_identity.current.account_id}-eu-central-1"
}

resource "aws_iam_role_policy" "ecs_task_storage" {
  name = "application-documents"
  role = aws_iam_role.ecs_task.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]
        Resource = ["${local.documents_bucket_arn}/uploads/*"]
      },
    ]
  })
}
