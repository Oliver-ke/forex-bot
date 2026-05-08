locals {
  name_prefix    = "forex-bot-${var.env}"
  service_name   = "${local.name_prefix}-${var.app_name}"
  log_group_name = "/forex-bot/${var.env}/${var.app_name}"
}

resource "aws_cloudwatch_log_group" "app" {
  name              = local.log_group_name
  retention_in_days = 14
  tags              = merge(var.common_tags, { Name = "${local.service_name}-logs" })
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
  name               = "${local.service_name}-task"
  assume_role_policy = data.aws_iam_policy_document.task_role_trust.json
  tags               = merge(var.common_tags, { Name = "${local.service_name}-task" })
}

resource "aws_iam_role_policy_attachment" "task_secrets_read" {
  role       = aws_iam_role.task.name
  policy_arn = var.secrets_read_policy_arn
}

resource "aws_iam_role_policy_attachment" "task_extra" {
  for_each   = toset(var.extra_iam_policy_arns)
  role       = aws_iam_role.task.name
  policy_arn = each.value
}

data "aws_region" "current" {}

resource "aws_ecs_task_definition" "app" {
  family                   = local.service_name
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.cpu
  memory                   = var.memory
  execution_role_arn       = var.task_execution_role_arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = var.app_name
      image     = "${var.ecr_repo_url}:${var.image_tag}"
      essential = true

      environment = [for k, v in var.env_vars : { name = k, value = v }]

      secrets = [
        for s in var.secret_keys : {
          name      = s.env_name
          valueFrom = "${var.secret_arn}:${s.json_key}::"
        }
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = local.log_group_name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = var.app_name
        }
      }
    }
  ])

  tags = merge(var.common_tags, { Name = "${local.service_name}-td" })
}

resource "aws_ecs_service" "app" {
  name                               = local.service_name
  cluster                            = var.cluster_arn
  task_definition                    = aws_ecs_task_definition.app.arn
  desired_count                      = var.desired_count
  launch_type                        = "FARGATE"
  enable_execute_command             = var.enable_execute_command
  wait_for_steady_state              = false
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  network_configuration {
    subnets          = var.vpc_subnet_ids
    security_groups  = [var.app_sg_id]
    assign_public_ip = true
  }

  service_connect_configuration {
    enabled   = true
    namespace = var.service_connect_namespace_arn
  }

  lifecycle {
    ignore_changes = [task_definition]
  }

  tags = merge(var.common_tags, { Name = "${local.service_name}-svc" })
}
