locals {
  name_prefix = "forex-bot-${var.env}"
}

resource "aws_db_subnet_group" "pg" {
  name       = "${local.name_prefix}-pg-subnet"
  subnet_ids = var.subnet_ids
  tags       = merge(var.common_tags, { Name = "${local.name_prefix}-pg-subnet" })
}

resource "aws_db_parameter_group" "pg" {
  name   = "${local.name_prefix}-pg16"
  family = "postgres16"

  # pgvector is NOT a shared_preload_libraries member on RDS — it is enabled
  # at runtime via `CREATE EXTENSION vector;` against the target database.
  # Operator step (one-time per env, post-apply):
  #   psql "<rds-endpoint>" -U forexbot -d forexbot -c 'CREATE EXTENSION IF NOT EXISTS vector;'
  # Parameter group is kept as a placeholder for future tuning.

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-pg16" })
}

resource "aws_db_instance" "pg" {
  identifier              = "${local.name_prefix}-rds"
  engine                  = "postgres"
  engine_version          = "16"
  instance_class          = "db.t4g.micro"
  allocated_storage       = 20
  storage_type            = "gp3"
  storage_encrypted       = true
  db_name                 = "forexbot"
  username                = "forexbot"
  password                = var.db_password
  port                    = 5432
  vpc_security_group_ids  = [var.data_sg_id]
  db_subnet_group_name    = aws_db_subnet_group.pg.name
  parameter_group_name    = aws_db_parameter_group.pg.name
  multi_az                = false
  publicly_accessible     = false
  backup_retention_period = 1
  skip_final_snapshot     = true
  deletion_protection     = false

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-rds" })
}

resource "aws_elasticache_subnet_group" "redis" {
  name       = "${local.name_prefix}-redis-subnet"
  subnet_ids = var.subnet_ids
}

# node_type is cache.t3.micro (x86), NOT cache.t4g.micro (Graviton): in
# 2026-06 eu-west-2 had no t4g.micro capacity in EITHER AZ (2a and 2b both
# returned "insufficient capacity", surfaced as the generic
# `incompatible-network` failure state). t3.micro has far broader capacity at
# ~the same price. No availability_zone pin — let ElastiCache place the node
# in whichever AZ in the subnet group has capacity.
resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "${local.name_prefix}-redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.redis.name
  security_group_ids   = [var.data_sg_id]

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-redis" })
}

resource "aws_dynamodb_table" "trade_journal" {
  name         = "${local.name_prefix}-trade-journal"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "tradeId"

  attribute {
    name = "tradeId"
    type = "S"
  }

  point_in_time_recovery { enabled = true }
  server_side_encryption { enabled = true }

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-trade-journal" })
}

resource "aws_dynamodb_table" "kill_switch" {
  name         = "${local.name_prefix}-kill-switch"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "key"

  attribute {
    name = "key"
    type = "S"
  }

  point_in_time_recovery { enabled = true }
  server_side_encryption { enabled = true }

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-kill-switch" })
}

data "aws_iam_policy_document" "journal_rw" {
  statement {
    sid    = "TradeJournalRW"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
    ]
    resources = [
      aws_dynamodb_table.trade_journal.arn,
      "${aws_dynamodb_table.trade_journal.arn}/index/*",
    ]
  }
}

resource "aws_iam_policy" "journal_rw" {
  name        = "${local.name_prefix}-trade-journal-rw"
  description = "Read/write on trade-journal DynamoDB table"
  policy      = data.aws_iam_policy_document.journal_rw.json
}

# Full decision stream (every tick: approved + vetoed). Kept separate from the
# trade-journal so "trades" stays pure. Same key (tradeId) so DynamoJournalStore
# works against it unchanged.
resource "aws_dynamodb_table" "decisions" {
  name         = "${local.name_prefix}-decisions"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "tradeId"

  attribute {
    name = "tradeId"
    type = "S"
  }

  point_in_time_recovery { enabled = true }
  server_side_encryption { enabled = true }

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-decisions" })
}

data "aws_iam_policy_document" "decisions_rw" {
  statement {
    sid    = "DecisionsRW"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
    ]
    resources = [
      aws_dynamodb_table.decisions.arn,
      "${aws_dynamodb_table.decisions.arn}/index/*",
    ]
  }
}

resource "aws_iam_policy" "decisions_rw" {
  name        = "${local.name_prefix}-decisions-rw"
  description = "Read/write on decisions DynamoDB table"
  policy      = data.aws_iam_policy_document.decisions_rw.json
}

resource "aws_dynamodb_table" "metrics" {
  name         = "${local.name_prefix}-metrics"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "dayMs"

  attribute {
    name = "dayMs"
    type = "N"
  }

  point_in_time_recovery { enabled = true }
  server_side_encryption { enabled = true }

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-metrics" })
}

data "aws_iam_policy_document" "metrics_rw" {
  statement {
    sid    = "MetricsRW"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
    ]
    resources = [
      aws_dynamodb_table.metrics.arn,
      "${aws_dynamodb_table.metrics.arn}/index/*",
    ]
  }
}

resource "aws_iam_policy" "metrics_rw" {
  name        = "${local.name_prefix}-metrics-rw"
  description = "Read/write on daily metrics snapshot DynamoDB table"
  policy      = data.aws_iam_policy_document.metrics_rw.json
}

data "aws_iam_policy_document" "killswitch_rw" {
  statement {
    sid    = "KillSwitchRW"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ]
    resources = [
      aws_dynamodb_table.kill_switch.arn,
      "${aws_dynamodb_table.kill_switch.arn}/index/*",
    ]
  }
}

resource "aws_iam_policy" "killswitch_rw" {
  name        = "${local.name_prefix}-killswitch-rw"
  description = "Read/write on kill-switch DynamoDB table"
  policy      = data.aws_iam_policy_document.killswitch_rw.json
}
