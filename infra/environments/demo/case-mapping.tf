locals {
  case_mapping_timeout_seconds = 600
  openai_api_key_parameter     = "/prostapaper/demo/OPENAI_API_KEY"
}

data "archive_file" "case_mapping" {
  type        = "zip"
  source_dir  = "${path.module}/../../../apps/case-mapping/dist"
  output_path = "${path.module}/.terraform/case-mapping.zip"
}

resource "aws_iam_role" "case_mapping" {
  name = "${local.name_prefix}-case-mapping"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow", Action = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "case_mapping_vpc" {
  role       = aws_iam_role.case_mapping.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

resource "aws_iam_role_policy" "case_mapping_storage" {
  name = "case-storage"
  role = aws_iam_role.case_mapping.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow", Action = "s3:GetObject"
        Resource = "${aws_s3_bucket.documents.arn}/derived/*"
      },
      {
        Effect   = "Allow", Action = "s3:PutObject"
        Resource = "${aws_s3_bucket.documents.arn}/mapping/*"
      },
    ]
  })
}

# The function reads the key itself, so its value stays out of the task configuration and this state.
resource "aws_iam_role_policy" "case_mapping_secrets" {
  name = "case-mapping-secrets"
  role = aws_iam_role.case_mapping.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow", Action = "ssm:GetParameter"
      Resource = "arn:aws:ssm:eu-central-1:${data.aws_caller_identity.current.account_id}:parameter${local.openai_api_key_parameter}"
    }]
  })
}

resource "aws_cloudwatch_log_group" "case_mapping" {
  name              = "/aws/lambda/${local.name_prefix}-case-mapping"
  retention_in_days = 7
}

resource "aws_security_group" "case_mapping" {
  name_prefix = "${local.name_prefix}-case-mapping-"
  vpc_id      = aws_vpc.main.id
  description = "Case-mapping function: PostgreSQL, S3 gateway and HTTPS egress to the model API."
}

resource "aws_vpc_security_group_egress_rule" "case_mapping_database" {
  security_group_id            = aws_security_group.case_mapping.id
  referenced_security_group_id = aws_security_group.database.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "case_mapping_storage" {
  security_group_id = aws_security_group.case_mapping.id
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "case_mapping_internet" {
  security_group_id = aws_security_group.case_mapping.id
  cidr_ipv4         = "0.0.0.0/0"
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_lambda_function" "case_mapping" {
  function_name    = "${local.name_prefix}-case-mapping"
  role             = aws_iam_role.case_mapping.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "handler.handler"
  filename         = data.archive_file.case_mapping.output_path
  source_code_hash = data.archive_file.case_mapping.output_base64sha256
  memory_size      = 512
  timeout          = local.case_mapping_timeout_seconds

  # The account quota is 10; AWS requires all 10 slots to remain unreserved.
  reserved_concurrent_executions = -1

  vpc_config {
    subnet_ids         = [for subnet in aws_subnet.private : subnet.id]
    security_group_ids = [aws_security_group.case_mapping.id]
  }

  environment {
    variables = merge(
      { for entry in local.database_environment : entry.name => entry.value },
      {
        PGUSER                   = "prostapaper_app"
        PGPASSWORD               = data.aws_ssm_parameter.database_password.value
        OPENAI_API_KEY_PARAMETER = local.openai_api_key_parameter
        MAPPING_CITATIONS        = "true"
        NODE_EXTRA_CA_CERTS      = "/var/runtime/ca-cert.pem"
        NODE_OPTIONS             = "--enable-source-maps"
      },
    )
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.case_mapping.name
  }

  depends_on = [
    aws_iam_role_policy_attachment.case_mapping_vpc,
    aws_iam_role_policy.case_mapping_storage,
    aws_iam_role_policy.case_mapping_secrets,
  ]
}

resource "aws_lambda_function_event_invoke_config" "case_mapping" {
  function_name                = aws_lambda_function.case_mapping.function_name
  maximum_event_age_in_seconds = 21600
  maximum_retry_attempts       = 2
}

resource "aws_iam_role_policy" "application_document_ingest_invoke" {
  name = "application-document-ingest-invoke"
  role = data.aws_iam_role.ecs_task.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.document_ingest.arn
    }]
  })
}
