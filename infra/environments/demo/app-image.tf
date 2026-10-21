resource "aws_ecr_repository" "application" {
  name                 = "${local.name_prefix}-app"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true
}

resource "aws_ecr_lifecycle_policy" "application" {
  repository = aws_ecr_repository.application.name
  # Keep tagged releases until teardown so ECS rollback never loses its image.
  policy = jsonencode({ rules = [{
    rulePriority = 1
    description  = "Expire untagged images after seven days"
    selection    = { tagStatus = "untagged", countType = "sinceImagePushed", countUnit = "days", countNumber = 7 }
    action       = { type = "expire" }
  }] })
}

output "application_repository" {
  value = aws_ecr_repository.application.repository_url
}
