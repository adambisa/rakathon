resource "aws_iam_role" "github_deploy" {
  name               = "prostapaper-demo-github-deploy"
  assume_role_policy = aws_iam_role.github_terraform.assume_role_policy
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "publish-and-deploy"
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = "ecr:GetAuthorizationToken", Resource = "*" },
      # Anonymous public.ecr.aws pulls share the runner's IP quota and fail the base image.
      { Effect = "Allow", Action = ["ecr-public:GetAuthorizationToken", "sts:GetServiceBearerToken"], Resource = "*" },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer", "ecr:BatchCheckLayerAvailability",
          "ecr:InitiateLayerUpload", "ecr:UploadLayerPart", "ecr:CompleteLayerUpload",
          "ecr:PutImage", "ecr:DescribeImages",
        ]
        Resource = "arn:aws:ecr:eu-central-1:${data.aws_caller_identity.current.account_id}:repository/prostapaper-demo-app"
      },
    ]
  })
}
