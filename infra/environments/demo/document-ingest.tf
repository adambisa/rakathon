data "aws_ssm_parameter" "database_password" {
  name            = "/prostapaper/demo/DB_PASSWORD"
  with_decryption = true
}

data "archive_file" "document_ingest" {
  type        = "zip"
  source_dir  = "${path.module}/../../../apps/document-ingest/dist"
  output_path = "${path.module}/.terraform/document-ingest.zip"
}

resource "aws_iam_role" "document_ingest" {
  name = "${local.name_prefix}-document-ingest"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow", Action = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
      Condition = { StringEquals = { "aws:SourceAccount" = data.aws_caller_identity.current.account_id } }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "document_ingest_vpc" {
  role       = aws_iam_role.document_ingest.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole"
}

# Application extraction and explicit QA invocations share the same deployment.
resource "aws_iam_role_policy" "document_ingest_storage" {
  name = "document-storage"
  role = aws_iam_role.document_ingest.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow", Action = "s3:GetObjectVersion"
        Resource = "${aws_s3_bucket.documents.arn}/uploads/*"
      },
      {
        Effect   = "Allow", Action = "s3:PutObject"
        Resource = "${aws_s3_bucket.documents.arn}/derived/*"
      },
      {
        Effect   = "Allow", Action = "s3:GetObjectVersion"
        Resource = "${aws_s3_bucket.documents.arn}/qa/input/*"
      },
      {
        Effect   = "Allow", Action = "s3:PutObject"
        Resource = "${aws_s3_bucket.documents.arn}/qa/*/output/*"
      },
    ]
  })
}

# Mantle authorizes under its own namespace; bedrock:InvokeModel does not cover this endpoint.
# The reader sends a bearer token, which Mantle checks as CallWithBearerToken.
resource "aws_iam_role_policy" "document_ingest_inference" {
  name = "document-inference"
  role = aws_iam_role.document_ingest.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["bedrock-mantle:CreateInference", "bedrock-mantle:CallWithBearerToken"]
      Resource = "*"
    }]
  })
}

# Attach this policy to an operator role to prepare datasets and run QA from the CLI.
resource "aws_iam_policy" "extraction_qa_runner" {
  name = "${local.name_prefix}-extraction-qa-runner"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]
        Resource = "${aws_s3_bucket.documents.arn}/qa/*"
      },
      {
        Effect   = "Allow"
        Action   = ["lambda:InvokeFunction", "lambda:GetFunctionConfiguration"]
        Resource = [aws_lambda_function.document_ingest.arn, "${aws_lambda_function.document_ingest.arn}:*"]
      },
    ]
  })
}

output "extraction_qa_runner_policy" {
  value = aws_iam_policy.extraction_qa_runner.arn
}

resource "aws_cloudwatch_log_group" "document_ingest" {
  name              = "/aws/lambda/${local.name_prefix}-document-ingest"
  retention_in_days = 7
}

resource "aws_security_group" "document_ingest" {
  name_prefix = "${local.name_prefix}-document-ingest-"
  vpc_id      = aws_vpc.main.id
  description = "Document-ingest function: PostgreSQL, S3 gateway, Mantle and Lambda endpoint egress."

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_vpc_security_group_egress_rule" "document_ingest_database" {
  security_group_id            = aws_security_group.document_ingest.id
  referenced_security_group_id = aws_security_group.database.id
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
}

resource "aws_vpc_security_group_egress_rule" "document_ingest_storage" {
  security_group_id = aws_security_group.document_ingest.id
  prefix_list_id    = aws_vpc_endpoint.s3.prefix_list_id
  ip_protocol       = "tcp"
  from_port         = 443
  to_port           = 443
}

resource "aws_vpc_security_group_egress_rule" "document_ingest_inference" {
  security_group_id            = aws_security_group.document_ingest.id
  referenced_security_group_id = aws_security_group.bedrock_mantle.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_lambda_function" "document_ingest" {
  function_name    = "${local.name_prefix}-document-ingest"
  role             = aws_iam_role.document_ingest.arn
  runtime          = "nodejs22.x"
  architectures    = ["arm64"]
  handler          = "handler.handler"
  filename         = data.archive_file.document_ingest.output_path
  source_code_hash = data.archive_file.document_ingest.output_base64sha256

  # Sized for single-threaded WebAssembly OCR; revisit once representative documents are measured.
  memory_size = 3008
  timeout     = 600

  vpc_config {
    subnet_ids         = [for subnet in aws_subnet.private : subnet.id]
    security_group_ids = [aws_security_group.document_ingest.id]
  }

  environment {
    variables = merge(
      { for entry in local.database_environment : entry.name => entry.value },
      {
        PGUSER                = "prostapaper_app"
        PGPASSWORD            = data.aws_ssm_parameter.database_password.value
        NODE_EXTRA_CA_CERTS   = "/var/runtime/ca-cert.pem"
        NODE_OPTIONS          = "--enable-source-maps"
        EXTRACTION_READER     = var.extraction_reader
        EXTRACTION_MODEL      = var.extraction_model
        CASE_MAPPING_FUNCTION = aws_lambda_function.case_mapping.function_name
      },
    )
  }

  logging_config {
    log_format = "JSON"
    log_group  = aws_cloudwatch_log_group.document_ingest.name
  }

  depends_on = [
    aws_iam_role_policy_attachment.document_ingest_vpc,
    aws_iam_role_policy.document_ingest_storage,
    aws_iam_role_policy.document_ingest_inference,
    aws_iam_role_policy.document_ingest_mapping_invoke,
    aws_vpc_endpoint.lambda,
  ]
}

# Two asynchronous retries are the whole failure policy. The age is the maximum, so a queue
# drained slowly behind the concurrency cap finishes late instead of being dropped.
resource "aws_lambda_function_event_invoke_config" "document_ingest" {
  function_name                = aws_lambda_function.document_ingest.function_name
  maximum_event_age_in_seconds = 21600
  maximum_retry_attempts       = 2
}

resource "aws_iam_role_policy" "document_ingest_mapping_invoke" {
  name = "document-ingest-mapping-invoke"
  role = aws_iam_role.document_ingest.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "lambda:InvokeFunction"
      Resource = aws_lambda_function.case_mapping.arn
    }]
  })
}

resource "aws_security_group" "lambda" {
  name_prefix = "${local.name_prefix}-lambda-"
  vpc_id      = aws_vpc.main.id
  description = "Lambda interface endpoint: HTTPS from document ingest."
}

resource "aws_vpc_security_group_ingress_rule" "lambda" {
  security_group_id            = aws_security_group.lambda.id
  referenced_security_group_id = aws_security_group.document_ingest.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

# Private DNS points the app task at this endpoint too, so its invokes need admission.
resource "aws_vpc_security_group_ingress_rule" "lambda_app" {
  security_group_id            = aws_security_group.lambda.id
  referenced_security_group_id = aws_security_group.app.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_vpc_security_group_egress_rule" "document_ingest_lambda" {
  security_group_id            = aws_security_group.document_ingest.id
  referenced_security_group_id = aws_security_group.lambda.id
  ip_protocol                  = "tcp"
  from_port                    = 443
  to_port                      = 443
}

resource "aws_vpc_endpoint" "lambda" {
  vpc_id              = aws_vpc.main.id
  service_name        = "com.amazonaws.eu-central-1.lambda"
  vpc_endpoint_type   = "Interface"
  subnet_ids          = [for subnet in aws_subnet.private : subnet.id]
  security_group_ids  = [aws_security_group.lambda.id]
  private_dns_enabled = true

  tags = { Name = "${local.name_prefix}-lambda" }
}

output "document_ingest_function" {
  value = aws_lambda_function.document_ingest.function_name
}
