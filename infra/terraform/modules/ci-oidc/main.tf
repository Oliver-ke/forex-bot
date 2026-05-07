locals {
  name_prefix = "forex-bot-${var.env}"
}

data "aws_iam_policy_document" "trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [var.oidc_provider_arn]
    }

    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [for f in var.branch_filters : "repo:${var.github_org}/${var.github_repo}:${f}"]
    }
  }
}

resource "aws_iam_role" "ci" {
  name               = "${local.name_prefix}-ci"
  description        = "Assumed by GitHub Actions for CD into ${var.env}"
  assume_role_policy = data.aws_iam_policy_document.trust.json
  tags               = merge(var.common_tags, { Name = "${local.name_prefix}-ci" })
}

data "aws_iam_policy_document" "deploy" {
  statement {
    sid    = "EcrAuth"
    effect = "Allow"
    actions = [
      "ecr:GetAuthorizationToken",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "EcrPushPull"
    effect = "Allow"
    actions = [
      "ecr:BatchCheckLayerAvailability",
      "ecr:BatchGetImage",
      "ecr:CompleteLayerUpload",
      "ecr:DescribeImages",
      "ecr:DescribeRepositories",
      "ecr:GetDownloadUrlForLayer",
      "ecr:InitiateLayerUpload",
      "ecr:ListImages",
      "ecr:PutImage",
      "ecr:UploadLayerPart",
    ]
    resources = var.ecr_repo_arns
  }

  # ECS update perms; cluster ARNs are unknown at 6a time. Tightened in 6c.
  statement {
    sid    = "EcsDeployPlaceholder"
    effect = "Allow"
    actions = [
      "ecs:UpdateService",
      "ecs:DescribeServices",
      "ecs:RegisterTaskDefinition",
      "ecs:DescribeTaskDefinition",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "PassRolePlaceholder"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = ["*"]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role_policy" "deploy" {
  name   = "${local.name_prefix}-ci-deploy"
  role   = aws_iam_role.ci.id
  policy = data.aws_iam_policy_document.deploy.json
}
