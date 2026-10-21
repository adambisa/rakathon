resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}

resource "aws_iam_role" "github_terraform" {
  name = "prostapaper-demo-github-terraform"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRoleWithWebIdentity"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      # GitHub issues immutable subjects (owner@id/repo@id); keep the legacy form too.
      Condition = {
        StringEquals = {
          "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          "token.actions.githubusercontent.com:sub" = [
            "repo:rakathon26/rakathon:ref:refs/heads/main",
            "repo:rakathon26@336255949/rakathon@1401604733:ref:refs/heads/main",
          ]
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_terraform" {
  name = "demo-terraform"
  role = aws_iam_role.github_terraform.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        # CI must not replace RDS-managed credentials with a caller-known master password.
        Effect    = "Deny", Action = ["rds:CreateDBInstance", "rds:ModifyDBInstance"], Resource = "*"
        Condition = { Bool = { "rds:ManageMasterUserPassword" = "false" } }
      },
      { Effect = "Allow", Action = ["cloudwatch:DescribeAlarms", "cloudwatch:ListTagsForResource"], Resource = "*" },
      { Effect = "Allow", Action = ["cloudwatch:PutMetricAlarm", "cloudwatch:DeleteAlarms", "cloudwatch:TagResource", "cloudwatch:UntagResource"], Resource = "arn:aws:cloudwatch:eu-central-1:${data.aws_caller_identity.current.account_id}:alarm:prostapaper-demo-db-*" },
      { Effect = "Allow", Action = ["rds:Describe*", "rds:ListTagsForResource"], Resource = "*", Condition = { StringEquals = { "aws:RequestedRegion" = "eu-central-1" } } },
      { Effect = "Allow", Action = ["rds:CreateDBInstance", "rds:ModifyDBInstance", "rds:DeleteDBInstance", "rds:CreateDBSubnetGroup", "rds:ModifyDBSubnetGroup", "rds:DeleteDBSubnetGroup", "rds:CreateDBParameterGroup", "rds:ModifyDBParameterGroup", "rds:DeleteDBParameterGroup", "rds:AddTagsToResource", "rds:RemoveTagsFromResource", "rds:CreateDBSnapshot"], Resource = [for kind in ["db", "subgrp", "pg", "snapshot"] : "arn:aws:rds:eu-central-1:${data.aws_caller_identity.current.account_id}:${kind}:prostapaper-demo*"] },
      { Effect = "Allow", Action = ["secretsmanager:CreateSecret", "secretsmanager:TagResource", "secretsmanager:DescribeSecret"], Resource = "arn:aws:secretsmanager:eu-central-1:${data.aws_caller_identity.current.account_id}:secret:rds!db-*" },
      { Effect = "Allow", Action = "kms:DescribeKey", Resource = "arn:aws:kms:eu-central-1:${data.aws_caller_identity.current.account_id}:key/*" },
      # Pre-deploy check reads the task's SSM secrets and validates them with the API env schema.
      { Effect = "Allow", Action = ["ssm:GetParameters", "ssm:GetParametersByPath"], Resource = ["arn:aws:ssm:eu-central-1:${data.aws_caller_identity.current.account_id}:parameter/prostapaper/demo", "arn:aws:ssm:eu-central-1:${data.aws_caller_identity.current.account_id}:parameter/prostapaper/demo/*"] },
      {
        Effect    = "Allow", Action = "kms:Decrypt", Resource = "arn:aws:kms:eu-central-1:${data.aws_caller_identity.current.account_id}:key/*"
        Condition = { StringEquals = { "kms:ViaService" = "ssm.eu-central-1.amazonaws.com" } }
      },
      {
        Effect    = "Allow", Action = "ec2:*", Resource = "*"
        Condition = { StringEquals = { "aws:RequestedRegion" = "eu-central-1" } }
      },
      {
        Effect   = "Allow", Action = "ecr:*"
        Resource = "arn:aws:ecr:eu-central-1:${data.aws_caller_identity.current.account_id}:repository/prostapaper-demo-app"
      },
      {
        Effect    = "Allow", Action = ["ecs:Describe*", "ecs:List*", "ecs:RegisterTaskDefinition"]
        Resource  = "*"
        Condition = { StringEquals = { "aws:RequestedRegion" = "eu-central-1" } }
      },
      {
        Effect = "Allow", Action = "ecs:*"
        Resource = [
          "arn:aws:ecs:eu-central-1:${data.aws_caller_identity.current.account_id}:cluster/prostapaper-demo",
          "arn:aws:ecs:eu-central-1:${data.aws_caller_identity.current.account_id}:service/prostapaper-demo/*",
          "arn:aws:ecs:eu-central-1:${data.aws_caller_identity.current.account_id}:task-definition/prostapaper-demo:*",
          "arn:aws:ecs:eu-central-1:${data.aws_caller_identity.current.account_id}:task/prostapaper-demo/*",
        ]
      },
      {
        Effect = "Allow", Action = "elasticloadbalancing:Describe*", Resource = "*"
      },
      {
        Effect   = "Allow", Action = "elasticloadbalancing:*"
        Resource = [for kind in ["loadbalancer/app", "listener/app", "listener-rule/app", "targetgroup"] : "arn:aws:elasticloadbalancing:eu-central-1:${data.aws_caller_identity.current.account_id}:${kind}/prostapaper-demo/*"]
      },
      {
        Effect    = "Allow", Action = "acm:*", Resource = "*"
        Condition = { StringEquals = { "aws:RequestedRegion" = "eu-central-1" } }
      },
      {
        Effect    = "Allow", Action = "wafv2:*", Resource = "*"
        Condition = { StringEquals = { "aws:RequestedRegion" = "eu-central-1" } }
      },
      { Effect = "Allow", Action = "logs:DescribeLogGroups", Resource = "*" },
      {
        Effect   = "Allow", Action = ["logs:CreateLogGroup", "logs:DeleteLogGroup", "logs:PutRetentionPolicy", "logs:DeleteRetentionPolicy", "logs:ListTagsForResource", "logs:TagResource", "logs:UntagResource"]
        Resource = ["arn:aws:logs:eu-central-1:${data.aws_caller_identity.current.account_id}:log-group:/ecs/prostapaper-demo", "arn:aws:logs:eu-central-1:${data.aws_caller_identity.current.account_id}:log-group:/ecs/prostapaper-demo:*", "arn:aws:logs:eu-central-1:${data.aws_caller_identity.current.account_id}:log-group:/aws/rds/instance/prostapaper-demo/postgresql", "arn:aws:logs:eu-central-1:${data.aws_caller_identity.current.account_id}:log-group:/aws/rds/instance/prostapaper-demo/postgresql:*"]
      },
      {
        Effect   = "Allow", Action = "iam:GetRole"
        Resource = [aws_iam_role.ecs_execution.arn, aws_iam_role.ecs_task.arn]
      },
      {
        Effect   = "Allow"
        Action   = ["iam:GetRolePolicy", "iam:PutRolePolicy", "iam:DeleteRolePolicy"]
        Resource = aws_iam_role.ecs_task.arn
      },
      {
        Effect    = "Allow", Action = "iam:PassRole"
        Resource  = [aws_iam_role.ecs_execution.arn, aws_iam_role.ecs_task.arn]
        Condition = { StringEquals = { "iam:PassedToService" = "ecs-tasks.amazonaws.com" } }
      },
      {
        Effect    = "Allow", Action = "iam:CreateServiceLinkedRole", Resource = "*"
        Condition = { StringEquals = { "iam:AWSServiceName" = ["ecs.amazonaws.com", "rds.amazonaws.com"] } }
      },
      {
        Sid    = "DemoBucketManagement"
        Effect = "Allow"
        Action = "s3:*"
        Resource = [
          "arn:aws:s3:::prostapaper-demo-*-${data.aws_caller_identity.current.account_id}-eu-central-1",
          "arn:aws:s3:::prostapaper-demo-*-${data.aws_caller_identity.current.account_id}-eu-central-1/*",
        ]
      },
      { Effect = "Allow", Action = "s3:ListBucket", Resource = aws_s3_bucket.state.arn },
      {
        Effect   = "Allow", Action = ["s3:GetObject", "s3:PutObject"]
        Resource = "${aws_s3_bucket.state.arn}/demo/terraform.tfstate"
      },
      {
        Effect   = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "${aws_s3_bucket.state.arn}/demo/terraform.tfstate.tflock"
      },
    ]
  })
}

output "github_terraform_role_arn" {
  value = aws_iam_role.github_terraform.arn
}
