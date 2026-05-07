locals {
  name_prefix = "forex-bot-${var.env}"
  secret_name = "forex-bot/${var.env}/secrets"
}

resource "aws_secretsmanager_secret" "main" {
  name                    = local.secret_name
  description             = "Forex bot secrets blob (Anthropic key, MT5 creds, DB password)"
  recovery_window_in_days = 7
  tags                    = merge(var.common_tags, { Name = "${local.name_prefix}-secrets" })
}

resource "aws_secretsmanager_secret_version" "main" {
  secret_id = aws_secretsmanager_secret.main.id
  secret_string = jsonencode({
    anthropicApiKey = "REPLACE_ME"
    mt5Login        = "REPLACE_ME"
    mt5Password     = "REPLACE_ME"
    mt5Server       = "REPLACE_ME"
    dbPassword      = var.db_password
  })

  # Allow operator to overwrite anthropic/mt5 fields outside Terraform without
  # triggering a state-vs-actual diff on each plan.
  lifecycle {
    ignore_changes = [secret_string]
  }
}

data "aws_iam_policy_document" "read" {
  statement {
    sid       = "ReadSecret"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [aws_secretsmanager_secret.main.arn]
  }
}

resource "aws_iam_policy" "read" {
  name        = "${local.name_prefix}-secrets-read"
  description = "Read-only access to ${local.secret_name}"
  policy      = data.aws_iam_policy_document.read.json
}
