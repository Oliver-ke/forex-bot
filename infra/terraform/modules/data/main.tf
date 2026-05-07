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

  parameter {
    name         = "shared_preload_libraries"
    value        = "pgvector"
    apply_method = "pending-reboot"
  }

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

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "${local.name_prefix}-redis"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = "cache.t4g.micro"
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
