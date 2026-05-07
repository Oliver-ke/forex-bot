locals {
  name_prefix    = "forex-bot-${var.env}"
  log_group_name = "/forex-bot/${var.env}/mt5-sidecar"
}

resource "aws_cloudwatch_log_group" "sidecar" {
  name              = local.log_group_name
  retention_in_days = 14
  tags              = merge(var.common_tags, { Name = "${local.name_prefix}-mt5-sidecar-logs" })
}

data "aws_iam_policy_document" "task_role_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task" {
  name               = "${local.name_prefix}-mt5-sidecar-task"
  assume_role_policy = data.aws_iam_policy_document.task_role_trust.json
  tags               = merge(var.common_tags, { Name = "${local.name_prefix}-mt5-sidecar-task" })
}

resource "aws_iam_role_policy_attachment" "task_secrets_read" {
  role       = aws_iam_role.task.name
  policy_arn = var.secrets_read_policy_arn
}

data "aws_region" "current" {}

resource "aws_ecs_task_definition" "sidecar" {
  family                   = "${local.name_prefix}-mt5-sidecar"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = var.task_execution_role_arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "mt5-sidecar"
      image     = "${var.ecr_repo_url}:${var.image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = 50051
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "MT5_SIDECAR_HOST", value = "0.0.0.0" },
        { name = "MT5_SIDECAR_PORT", value = "50051" },
      ]

      secrets = [
        { name = "MT5_LOGIN", valueFrom = "${var.secret_arn}:mt5Login::" },
        { name = "MT5_PASSWORD", valueFrom = "${var.secret_arn}:mt5Password::" },
        { name = "MT5_SERVER", valueFrom = "${var.secret_arn}:mt5Server::" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = local.log_group_name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = "mt5-sidecar"
        }
      }
    }
  ])

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-mt5-sidecar-td" })
}

resource "aws_ecs_service" "sidecar" {
  name                               = "${local.name_prefix}-mt5-sidecar"
  cluster                            = var.cluster_arn
  task_definition                    = aws_ecs_task_definition.sidecar.arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  enable_execute_command             = true
  wait_for_steady_state              = false
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  network_configuration {
    subnets          = var.vpc_subnet_ids
    security_groups  = [var.app_sg_id]
    assign_public_ip = true
  }

  lifecycle {
    ignore_changes = [task_definition]
  }

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-mt5-sidecar-svc" })
}
