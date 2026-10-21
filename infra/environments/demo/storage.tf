locals {
  # Must match the bootstrap task-role policy; application data never uses the state bucket.
  upload_bucket_name = "prostapaper-demo-documents-${data.aws_caller_identity.current.account_id}-eu-central-1"
}

resource "aws_s3_bucket" "documents" {
  bucket        = local.upload_bucket_name
  force_destroy = false
}

# Preview permissions belong to the normal deployment stack, not a manual bootstrap apply.
# Use a separate policy name so bootstrap's upload policy remains independently managed.
resource "aws_iam_role_policy" "document_preview" {
  name = "application-document-preview"
  role = data.aws_iam_role.ecs_task.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:GetObjectVersion"]
        Resource = [
          "${aws_s3_bucket.documents.arn}/uploads/*",
          "${aws_s3_bucket.documents.arn}/derived/*",
          "${aws_s3_bucket.documents.arn}/mapping/*",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject", "s3:GetObjectVersion", "s3:PutObject"]
        Resource = "${aws_s3_bucket.documents.arn}/reviews/*"
      },
      {
        Effect    = "Allow"
        Action    = "s3:ListBucket"
        Resource  = aws_s3_bucket.documents.arn
        Condition = { StringLike = { "s3:prefix" = "uploads/*" } }
      },
    ]
  })
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket                  = aws_s3_bucket.documents.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id

  versioning_configuration {
    status = "Enabled"
  }
}

# Retain source versions pinned at submission.
resource "aws_s3_bucket_lifecycle_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  rule {
    id     = "abort-incomplete-multipart"
    status = "Enabled"

    filter {}

    abort_incomplete_multipart_upload {
      days_after_initiation = 1
    }
  }
}

resource "aws_s3_bucket_cors_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id

  cors_rule {
    allowed_origins = concat(["https://${var.site_hostname}"], var.upload_development_origins)
    allowed_methods = ["POST", "GET"]
    allowed_headers = ["content-type"]
    max_age_seconds = 300
  }
}

resource "aws_s3_bucket_policy" "documents" {
  bucket = aws_s3_bucket.documents.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "DenyInsecureTransport"
      Effect    = "Deny"
      Principal = "*"
      Action    = "s3:*"
      Resource  = [aws_s3_bucket.documents.arn, "${aws_s3_bucket.documents.arn}/*"]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
  depends_on = [aws_s3_bucket_public_access_block.documents]
}

variable "upload_development_origins" {
  description = "Explicit local browser origins permitted to upload synthetic files."
  type        = list(string)
  default     = ["http://localhost:5173"]

  validation {
    condition     = alltrue([for origin in var.upload_development_origins : can(regex("^http://(localhost|127\\.0\\.0\\.1):[0-9]+$", origin))])
    error_message = "Use explicit localhost/127.0.0.1 HTTP origins with a port."
  }
}

output "upload_bucket_name" {
  value = aws_s3_bucket.documents.id
}
