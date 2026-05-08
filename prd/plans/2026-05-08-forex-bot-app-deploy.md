# Forex Bot — Plan 6c: App Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy `agent-runner` (prod-only) and `paper-runner` (staging-only) on ECS Fargate per `prd/specs/2026-05-08-forex-bot-app-deploy-design.md`. Add per-app Dockerfiles + a generic Terraform `modules/app` + ECS Service Connect for sidecar reachability + `apps-image.yml` CD workflow. Reuses 6a + 6b infra.

**Architecture:** One Fargate service per env (`forex-bot-<env>-<app>`), 0.5 vCPU / 1 GB, public subnet + public IP, ingress none. App tasks consume `mt5-sidecar:50051` via Service Connect (namespace `forex-bot-<env>.local`). Secrets injected from the 6a Secrets Manager blob; DynamoDB R/W via new `modules/data` IAM policies. CD on push to main via OIDC role from 6a.

**Tech Stack:** Node 20 (slim), pnpm 9.12, tsx 4, Terraform ≥ 1.10, hashicorp/aws ~> 5.70, GitHub Actions (`docker/build-push-action@v6`, `aws-actions/configure-aws-credentials@v4`).

**Hard constraints:**
- agent-runner deploys to prod only; paper-runner to staging only. Strict.
- App task IAM roles get `secrets-read` + `journal-rw` + `killswitch-rw` and nothing more.
- Local pytest / vitest / `pnpm -r typecheck` / `pnpm lint` continue to pass.
- No long-lived AWS access keys.
- All resources tagged `Project=forex-bot`, `Environment=<env>`, `ManagedBy=terraform`.
- Service Connect namespace `forex-bot-<env>.local` is account-shared per env; sidecar registers as `mt5-sidecar`, apps consume.

---

## File structure produced by this plan

```
forex-bot/
├── .github/workflows/
│   ├── apps-image.yml                 # NEW
│   └── infra.yml                      # MODIFIED: + app-build matrix smoke
├── apps/
│   ├── agent-runner/Dockerfile        # NEW
│   └── paper-runner/Dockerfile        # NEW
├── package.json                       # MODIFIED: + tsx ^4 dev dep
├── pnpm-lock.yaml                     # MODIFIED: regenerated
├── README.md                          # MODIFIED: flip 6c status to done
└── infra/terraform/
    ├── README.md                      # MODIFIED: append "App deploy" runbook
    ├── modules/
    │   ├── cluster/
    │   │   ├── main.tf                # MODIFIED: + service_discovery http namespace + cluster default
    │   │   └── outputs.tf             # MODIFIED: + service_connect_namespace_arn
    │   ├── data/
    │   │   ├── main.tf                # MODIFIED: + journal-rw + killswitch-rw IAM policies
    │   │   └── outputs.tf             # MODIFIED: + journal_rw_policy_arn + killswitch_rw_policy_arn
    │   ├── sidecar/
    │   │   ├── main.tf                # MODIFIED: register in SC, name "grpc" portMapping
    │   │   ├── variables.tf           # MODIFIED: + service_connect_namespace_arn (optional null default)
    │   │   └── (others unchanged)
    │   └── app/                       # NEW
    │       ├── main.tf
    │       ├── outputs.tf
    │       ├── variables.tf
    │       └── versions.tf
    └── envs/
        ├── prod/
        │   ├── main.tf                # MODIFIED: pass SC arn to sidecar; + module "agent_runner"
        │   └── outputs.tf             # MODIFIED: + agent-runner outputs
        └── staging/
            ├── main.tf                # MODIFIED: pass SC arn to sidecar; + module "paper_runner"
            └── outputs.tf             # MODIFIED: + paper-runner outputs
```

---

## Task 1: Add `tsx` as workspace dev dep

**Files:**
- Modify: `package.json` (root)
- Modify: `pnpm-lock.yaml` (regenerated)

- [ ] **Step 1: Add tsx to root devDependencies**

```bash
pnpm add -w -D tsx@^4
```

This updates `package.json` and `pnpm-lock.yaml`.

- [ ] **Step 2: Verify tsx resolves**

```bash
pnpm exec tsx --version
```

Expected: `4.x.x`.

- [ ] **Step 3: Smoke verify tsx works**

```bash
pnpm exec tsx --no-warnings -e "console.log('tsx ok')"
```

Expected: `tsx ok`.

- [ ] **Step 4: Verify monorepo still typechecks**

```bash
pnpm -r typecheck
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: add tsx as workspace dev dep (used by app Dockerfiles)"
```

---

## Task 2: `apps/agent-runner/Dockerfile`

**Files:**
- Create: `apps/agent-runner/Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# agent-runner — Node 20 + pnpm + tsx; runs apps/agent-runner/src/main.ts
# Build context = repo root. Build with:
#   docker buildx build --platform linux/amd64 -f apps/agent-runner/Dockerfile -t agent-runner:smoke .

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/usr/local/share/pnpm \
    PATH=$PNPM_HOME:$PATH \
    NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json /app/
COPY tsconfig.base.json /app/
COPY packages /app/packages
COPY apps /app/apps
RUN pnpm install --filter @forex-bot/agent-runner... --frozen-lockfile

FROM base AS final
WORKDIR /app
COPY --from=deps /app /app
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1
ENTRYPOINT ["pnpm", "exec", "tsx", "apps/agent-runner/src/main.ts"]
```

NOTE: ENTRYPOINT uses `pnpm exec tsx` (not `pnpm dlx tsx`) so `tsx` resolves from the in-image node_modules (Task 1 added it as a workspace dev dep).

- [ ] **Step 2: Commit**

```bash
git add apps/agent-runner/Dockerfile
git commit -m "feat(agent-runner): add Dockerfile (Node 20 + pnpm + tsx)"
```

---

## Task 3: `apps/paper-runner/Dockerfile`

**Files:**
- Create: `apps/paper-runner/Dockerfile`

- [ ] **Step 1: Write the Dockerfile**

```dockerfile
# paper-runner — Node 20 + pnpm + tsx; runs apps/paper-runner/src/main.ts
# Build context = repo root. Build with:
#   docker buildx build --platform linux/amd64 -f apps/paper-runner/Dockerfile -t paper-runner:smoke .

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/usr/local/share/pnpm \
    PATH=$PNPM_HOME:$PATH \
    NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.12.0 --activate

FROM base AS deps
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json /app/
COPY tsconfig.base.json /app/
COPY packages /app/packages
COPY apps /app/apps
RUN pnpm install --filter @forex-bot/paper-runner... --frozen-lockfile

FROM base AS final
WORKDIR /app
COPY --from=deps /app /app
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "process.exit(0)" || exit 1
ENTRYPOINT ["pnpm", "exec", "tsx", "apps/paper-runner/src/main.ts"]
```

- [ ] **Step 2: Commit**

```bash
git add apps/paper-runner/Dockerfile
git commit -m "feat(paper-runner): add Dockerfile (Node 20 + pnpm + tsx)"
```

---

## Task 4: Local docker buildx smoke (verify only)

**Files:** none modified. Verification step.

- [ ] **Step 1: Build agent-runner image**

```bash
docker buildx build --platform linux/amd64 -f apps/agent-runner/Dockerfile -t forex-bot/agent-runner:smoke .
```

Expected: clean build, ~3–8 min first time. Subsequent <1 min via Docker cache.

- [ ] **Step 2: Build paper-runner image**

```bash
docker buildx build --platform linux/amd64 -f apps/paper-runner/Dockerfile -t forex-bot/paper-runner:smoke .
```

Expected: similar.

- [ ] **Step 3: Inspect sizes**

```bash
docker image ls forex-bot/agent-runner:smoke forex-bot/paper-runner:smoke
```

Expected: ~600–800 MB each.

- [ ] **Step 4: Smoke run agent-runner image with missing env**

```bash
docker run --rm --platform linux/amd64 forex-bot/agent-runner:smoke 2>&1 | head -5 || true
```

Expected: app fails fast with `missing env var: MT5_HOST` (or similar). Confirms tsx + entrypoint wire works; missing-env error path correct.

- [ ] **Step 5: Smoke run paper-runner image with missing env**

```bash
docker run --rm --platform linux/amd64 forex-bot/paper-runner:smoke 2>&1 | head -5 || true
```

Expected: `PAPER_MODE=1 is required` (or similar).

(No commit for this task — verification only.)

---

## Task 5: `modules/data` — add journal-rw + killswitch-rw IAM policies

**Files:**
- Modify: `infra/terraform/modules/data/main.tf`
- Modify: `infra/terraform/modules/data/outputs.tf`

- [ ] **Step 1: Append IAM policy resources to `main.tf`**

Append at end of `infra/terraform/modules/data/main.tf`:
```hcl
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
```

NOTE: `local.name_prefix` is already defined at top of `main.tf` from Plan 6a as `"forex-bot-${var.env}"`. Re-use it.

- [ ] **Step 2: Append outputs**

Append to `infra/terraform/modules/data/outputs.tf`:
```hcl
output "journal_rw_policy_arn" {
  value = aws_iam_policy.journal_rw.arn
}

output "killswitch_rw_policy_arn" {
  value = aws_iam_policy.killswitch_rw.arn
}
```

- [ ] **Step 3: Format + validate**

```bash
cd infra/terraform/modules/data
terraform fmt -recursive
rm -rf .terraform .terraform.lock.hcl
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Commit**

```bash
cd ../../../..
git add infra/terraform/modules/data
git commit -m "feat(infra): add journal-rw + killswitch-rw IAM policies on data module"
```

---

## Task 6: `modules/cluster` — Service Connect namespace + cluster default

**Files:**
- Modify: `infra/terraform/modules/cluster/main.tf`
- Modify: `infra/terraform/modules/cluster/outputs.tf`

- [ ] **Step 1: Add namespace + cluster default to `main.tf`**

In `infra/terraform/modules/cluster/main.tf`:

(a) **Add a new resource** (anywhere; conventionally after `aws_ecs_cluster_capacity_providers`):
```hcl
resource "aws_service_discovery_http_namespace" "main" {
  name        = "forex-bot-${var.env}.local"
  description = "Service Connect namespace for forex-bot-${var.env}"
  tags        = merge(var.common_tags, { Name = "${local.name_prefix}-sc-namespace" })
}
```

(b) **Modify the existing `aws_ecs_cluster.main` block** to add `service_connect_defaults`. Currently:
```hcl
resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-cluster" })
}
```

Replace with:
```hcl
resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  service_connect_defaults {
    namespace = aws_service_discovery_http_namespace.main.arn
  }

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-cluster" })
}
```

- [ ] **Step 2: Append output**

Append to `infra/terraform/modules/cluster/outputs.tf`:
```hcl
output "service_connect_namespace_arn" {
  value = aws_service_discovery_http_namespace.main.arn
}
```

- [ ] **Step 3: Format + validate**

```bash
cd infra/terraform/modules/cluster
terraform fmt -recursive
rm -rf .terraform .terraform.lock.hcl
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Commit**

```bash
cd ../../../..
git add infra/terraform/modules/cluster
git commit -m "feat(infra): add Service Connect namespace + cluster default to cluster module"
```

---

## Task 7: `modules/sidecar` — register in Service Connect

**Files:**
- Modify: `infra/terraform/modules/sidecar/variables.tf`
- Modify: `infra/terraform/modules/sidecar/main.tf`

NOTE: this task adds an OPTIONAL `service_connect_namespace_arn` input (default `null`). Sidecar registers in SC only when the arg is non-null. This keeps env stacks compiling between Tasks 7 and 8.

- [ ] **Step 1: Add input variable**

Append to `infra/terraform/modules/sidecar/variables.tf`:
```hcl
variable "service_connect_namespace_arn" {
  description = "ARN of the Service Connect HTTP namespace from modules/cluster. If null, sidecar does not register."
  type        = string
  default     = null
}
```

- [ ] **Step 2: Modify `main.tf` — name the gRPC port mapping + dynamic SC block**

In `infra/terraform/modules/sidecar/main.tf`, find the `container_definitions` block. The current `portMappings` is:
```hcl
      portMappings = [
        {
          containerPort = 50051
          protocol      = "tcp"
        }
      ]
```

Replace with:
```hcl
      portMappings = [
        {
          containerPort = 50051
          protocol      = "tcp"
          name          = "grpc"
        }
      ]
```

Then find the `aws_ecs_service.sidecar` block. Currently has `network_configuration { ... }`, `lifecycle { ignore_changes = [task_definition] }`, etc. Add a `dynamic "service_connect_configuration"` block immediately after `network_configuration`:

```hcl
  dynamic "service_connect_configuration" {
    for_each = var.service_connect_namespace_arn == null ? [] : [1]
    content {
      enabled   = true
      namespace = var.service_connect_namespace_arn
      service {
        port_name      = "grpc"
        discovery_name = "mt5-sidecar"
        client_alias {
          port     = 50051
          dns_name = "mt5-sidecar"
        }
      }
    }
  }
```

- [ ] **Step 3: Format + validate**

```bash
cd infra/terraform/modules/sidecar
terraform fmt -recursive
rm -rf .terraform .terraform.lock.hcl
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Commit**

```bash
cd ../../../..
git add infra/terraform/modules/sidecar
git commit -m "feat(infra): sidecar registers in Service Connect when namespace arn provided"
```

---

## Task 8: Wire `service_connect_namespace_arn` into env sidecar calls

**Files:**
- Modify: `infra/terraform/envs/prod/main.tf`
- Modify: `infra/terraform/envs/staging/main.tf`

- [ ] **Step 1: Update `envs/prod/main.tf`**

Find the existing `module "sidecar"` block and add the new arg. Currently the block is approximately:
```hcl
module "sidecar" {
  source                  = "../../modules/sidecar"
  env                     = var.env
  cluster_arn             = module.cluster.cluster_arn
  task_execution_role_arn = module.cluster.task_execution_role_arn
  secrets_read_policy_arn = module.secrets.read_policy_arn
  secret_arn              = module.secrets.secret_arn
  vpc_subnet_ids          = module.network.public_subnet_ids
  app_sg_id               = module.network.app_sg_id
  ecr_repo_url            = module.ecr.repo_urls["mt5-sidecar"]
  common_tags             = local.common_tags
}
```

Add one line:
```hcl
  service_connect_namespace_arn = module.cluster.service_connect_namespace_arn
```

(Insert right after `task_execution_role_arn` to keep cluster-related args grouped.)

- [ ] **Step 2: Update `envs/staging/main.tf`**

Same edit — add the same line to the existing `module "sidecar"` block.

- [ ] **Step 3: Format + validate both envs**

```bash
cd infra/terraform/envs/prod
terraform fmt -recursive
rm -rf .terraform .terraform.lock.hcl
terraform init -backend=false
terraform validate
cd ../staging
terraform fmt -recursive
rm -rf .terraform .terraform.lock.hcl
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.` for both.

- [ ] **Step 4: Commit**

```bash
cd ../../../..
git add infra/terraform/envs/prod infra/terraform/envs/staging
git commit -m "feat(infra): pass service_connect_namespace_arn to sidecar in both envs"
```

---

## Task 9: `modules/app` — generic ECS service module

**Files:**
- Create: `infra/terraform/modules/app/{main.tf,outputs.tf,variables.tf,versions.tf}`

- [ ] **Step 1: Write `versions.tf`**

```hcl
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.70" }
  }
}
```

- [ ] **Step 2: Write `variables.tf`**

```hcl
variable "env" {
  description = "Environment name (prod, staging)"
  type        = string
}

variable "app_name" {
  description = "Application name (e.g. agent-runner, paper-runner)"
  type        = string
}

variable "cluster_arn" {
  description = "ECS cluster ARN (from modules/cluster)"
  type        = string
}

variable "task_execution_role_arn" {
  description = "ECS task execution role ARN (from modules/cluster)"
  type        = string
}

variable "service_connect_namespace_arn" {
  description = "Service Connect HTTP namespace ARN (from modules/cluster)"
  type        = string
}

variable "vpc_subnet_ids" {
  description = "Subnet IDs for the service"
  type        = list(string)
}

variable "app_sg_id" {
  description = "Application security group; service joins it"
  type        = string
}

variable "ecr_repo_url" {
  description = "ECR repository URL"
  type        = string
}

variable "image_tag" {
  description = "Container image tag deployed to the cluster"
  type        = string
  default     = "latest"
}

variable "cpu" {
  description = "Fargate CPU units (string, e.g. \"512\")"
  type        = string
  default     = "512"
}

variable "memory" {
  description = "Fargate memory in MB (string, e.g. \"1024\")"
  type        = string
  default     = "1024"
}

variable "secret_arn" {
  description = "ARN of the Secrets Manager blob"
  type        = string
}

variable "secret_keys" {
  description = "Secret keys to inject as env vars. Each item: { env_name, json_key }."
  type = list(object({
    env_name = string
    json_key = string
  }))
  default = []
}

variable "env_vars" {
  description = "Plain-text environment variables (map)"
  type        = map(string)
  default     = {}
}

variable "extra_iam_policy_arns" {
  description = "Additional IAM policy ARNs attached to the task role"
  type        = list(string)
  default     = []
}

variable "secrets_read_policy_arn" {
  description = "Secrets-read policy ARN from modules/secrets (always attached to task role)"
  type        = string
}

variable "desired_count" {
  description = "Number of running tasks"
  type        = number
  default     = 1
}

variable "enable_execute_command" {
  description = "Enable `aws ecs execute-command` for debugging"
  type        = bool
  default     = true
}

variable "common_tags" {
  description = "Tags applied to every resource"
  type        = map(string)
}
```

- [ ] **Step 3: Write `main.tf`**

```hcl
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
```

- [ ] **Step 4: Write `outputs.tf`**

```hcl
output "service_name" {
  value = aws_ecs_service.app.name
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.app.arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.app.name
}
```

- [ ] **Step 5: Format + validate**

```bash
cd infra/terraform/modules/app
terraform fmt -recursive
rm -rf .terraform .terraform.lock.hcl
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 6: Commit**

```bash
cd ../../../..
git add infra/terraform/modules/app
git commit -m "feat(infra): add generic app module (ECS Fargate service for TS app daemons)"
```

---

## Task 10: Wire `module "agent_runner"` into `envs/prod`

**Files:**
- Modify: `infra/terraform/envs/prod/main.tf`
- Modify: `infra/terraform/envs/prod/outputs.tf`

- [ ] **Step 1: Append `module "agent_runner"` to `main.tf`**

Append at end of `infra/terraform/envs/prod/main.tf` (after the existing `module "sidecar"` block):
```hcl

module "agent_runner" {
  source                        = "../../modules/app"
  env                           = var.env
  app_name                      = "agent-runner"
  cluster_arn                   = module.cluster.cluster_arn
  task_execution_role_arn       = module.cluster.task_execution_role_arn
  service_connect_namespace_arn = module.cluster.service_connect_namespace_arn
  vpc_subnet_ids                = module.network.public_subnet_ids
  app_sg_id                     = module.network.app_sg_id
  ecr_repo_url                  = module.ecr.repo_urls["agent-runner"]
  cpu                           = "512"
  memory                        = "1024"
  secret_arn                    = module.secrets.secret_arn
  secrets_read_policy_arn       = module.secrets.read_policy_arn
  secret_keys = [
    { env_name = "ANTHROPIC_API_KEY", json_key = "anthropicApiKey" },
  ]
  env_vars = {
    MT5_HOST         = "mt5-sidecar"
    MT5_PORT         = "50051"
    MT5_DEMO         = "0"
    REDIS_URL        = "redis://${module.data.redis_endpoint}:${module.data.redis_port}"
    REDIS_NAMESPACE  = "forex-bot"
    WATCHED_SYMBOLS  = "EURUSD,USDJPY,XAUUSD"
    POLL_MS          = "60000"
    JOURNAL_TABLE    = module.data.journal_table_name
    KILLSWITCH_TABLE = module.data.killswitch_table_name
    AWS_REGION       = "eu-west-2"
  }
  extra_iam_policy_arns = [
    module.data.journal_rw_policy_arn,
    module.data.killswitch_rw_policy_arn,
  ]
  common_tags = local.common_tags
}
```

- [ ] **Step 2: Append outputs**

Append to `infra/terraform/envs/prod/outputs.tf`:
```hcl

output "agent_runner_service_name" {
  value = module.agent_runner.service_name
}

output "agent_runner_task_role_arn" {
  value = module.agent_runner.task_role_arn
}

output "agent_runner_log_group_name" {
  value = module.agent_runner.log_group_name
}
```

- [ ] **Step 3: Format + validate**

```bash
cd infra/terraform/envs/prod
terraform fmt -recursive
rm -rf .terraform .terraform.lock.hcl
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Commit**

```bash
cd ../../../..
git add infra/terraform/envs/prod
git commit -m "feat(infra): wire agent-runner module into envs/prod"
```

---

## Task 11: Wire `module "paper_runner"` into `envs/staging`

**Files:**
- Modify: `infra/terraform/envs/staging/main.tf`
- Modify: `infra/terraform/envs/staging/outputs.tf`

- [ ] **Step 1: Append `module "paper_runner"` to `main.tf`**

Append at end of `infra/terraform/envs/staging/main.tf`:
```hcl

module "paper_runner" {
  source                        = "../../modules/app"
  env                           = var.env
  app_name                      = "paper-runner"
  cluster_arn                   = module.cluster.cluster_arn
  task_execution_role_arn       = module.cluster.task_execution_role_arn
  service_connect_namespace_arn = module.cluster.service_connect_namespace_arn
  vpc_subnet_ids                = module.network.public_subnet_ids
  app_sg_id                     = module.network.app_sg_id
  ecr_repo_url                  = module.ecr.repo_urls["paper-runner"]
  cpu                           = "512"
  memory                        = "1024"
  secret_arn                    = module.secrets.secret_arn
  secrets_read_policy_arn       = module.secrets.read_policy_arn
  secret_keys = [
    { env_name = "ANTHROPIC_API_KEY", json_key = "anthropicApiKey" },
  ]
  env_vars = {
    MT5_HOST         = "mt5-sidecar"
    MT5_PORT         = "50051"
    MT5_DEMO         = "1"
    PAPER_MODE       = "1"
    PAPER_BUDGET_USD = "50"
    PAPER_OUT_DIR    = "/tmp/paper-out"
    REDIS_URL        = "redis://${module.data.redis_endpoint}:${module.data.redis_port}"
    REDIS_NAMESPACE  = "forex-bot"
    WATCHED_SYMBOLS  = "EURUSD,USDJPY"
    POLL_MS          = "60000"
    JOURNAL_TABLE    = module.data.journal_table_name
    KILLSWITCH_TABLE = module.data.killswitch_table_name
    AWS_REGION       = "eu-west-2"
  }
  extra_iam_policy_arns = [
    module.data.journal_rw_policy_arn,
    module.data.killswitch_rw_policy_arn,
  ]
  common_tags = local.common_tags
}
```

- [ ] **Step 2: Append outputs**

Append to `infra/terraform/envs/staging/outputs.tf`:
```hcl

output "paper_runner_service_name" {
  value = module.paper_runner.service_name
}

output "paper_runner_task_role_arn" {
  value = module.paper_runner.task_role_arn
}

output "paper_runner_log_group_name" {
  value = module.paper_runner.log_group_name
}
```

- [ ] **Step 3: Format + validate**

```bash
cd infra/terraform/envs/staging
terraform fmt -recursive
rm -rf .terraform .terraform.lock.hcl
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Commit**

```bash
cd ../../../..
git add infra/terraform/envs/staging
git commit -m "feat(infra): wire paper-runner module into envs/staging"
```

---

## Task 12: GH Actions `apps-image.yml`

**Files:**
- Create: `.github/workflows/apps-image.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/apps-image.yml`:
```yaml
name: apps-image

on:
  push:
    branches: [main]
    paths:
      - "apps/agent-runner/**"
      - "apps/paper-runner/**"
      - "packages/**"
      - "pnpm-lock.yaml"
      - "package.json"
      - "tsconfig.base.json"
      - ".github/workflows/apps-image.yml"
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

jobs:
  agent-runner:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Configure AWS via OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ vars.AWS_ACCOUNT_ID }}:role/forex-bot-prod-ci
          aws-region: eu-west-2
      - name: Login to ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2
      - uses: docker/setup-buildx-action@v3
      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/agent-runner/Dockerfile
          platforms: linux/amd64
          push: true
          tags: |
            ${{ steps.login-ecr.outputs.registry }}/forex-bot/prod/agent-runner:${{ github.sha }}
            ${{ steps.login-ecr.outputs.registry }}/forex-bot/prod/agent-runner:latest
          cache-from: type=gha,scope=agent-runner
          cache-to: type=gha,mode=max,scope=agent-runner
      - name: Force ECS redeploy
        run: |
          aws ecs update-service \
            --cluster forex-bot-prod-cluster \
            --service forex-bot-prod-agent-runner \
            --force-new-deployment \
            --region eu-west-2
      - name: Wait for stable
        run: |
          aws ecs wait services-stable \
            --cluster forex-bot-prod-cluster \
            --services forex-bot-prod-agent-runner \
            --region eu-west-2

  paper-runner:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Configure AWS via OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ vars.AWS_ACCOUNT_ID }}:role/forex-bot-staging-ci
          aws-region: eu-west-2
      - name: Login to ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2
      - uses: docker/setup-buildx-action@v3
      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/paper-runner/Dockerfile
          platforms: linux/amd64
          push: true
          tags: |
            ${{ steps.login-ecr.outputs.registry }}/forex-bot/staging/paper-runner:${{ github.sha }}
            ${{ steps.login-ecr.outputs.registry }}/forex-bot/staging/paper-runner:latest
          cache-from: type=gha,scope=paper-runner
          cache-to: type=gha,mode=max,scope=paper-runner
      - name: Force ECS redeploy
        run: |
          aws ecs update-service \
            --cluster forex-bot-staging-cluster \
            --service forex-bot-staging-paper-runner \
            --force-new-deployment \
            --region eu-west-2
      - name: Wait for stable
        run: |
          aws ecs wait services-stable \
            --cluster forex-bot-staging-cluster \
            --services forex-bot-staging-paper-runner \
            --region eu-west-2
```

- [ ] **Step 2: YAML lint smoke**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/apps-image.yml')); print('yaml ok')"
```

Expected: `yaml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/apps-image.yml
git commit -m "ci: add apps-image workflow (build + push + ECS redeploy on main)"
```

---

## Task 13: Extend `infra.yml` with `app-build` matrix smoke

**Files:**
- Modify: `.github/workflows/infra.yml`

- [ ] **Step 1: Widen path filters**

In `.github/workflows/infra.yml`, find the existing `on:` block. The current `paths:` arrays under `push:` and `pull_request:` already include `mt5-sidecar/**` from Plan 6b. Add app paths.

Replace:
```yaml
on:
  push:
    branches: [main]
    paths:
      - "infra/terraform/**"
      - "mt5-sidecar/**"
      - "proto/mt5.proto"
      - ".github/workflows/infra.yml"
  pull_request:
    branches: [main]
    paths:
      - "infra/terraform/**"
      - "mt5-sidecar/**"
      - "proto/mt5.proto"
      - ".github/workflows/infra.yml"
```
with:
```yaml
on:
  push:
    branches: [main]
    paths:
      - "infra/terraform/**"
      - "mt5-sidecar/**"
      - "proto/mt5.proto"
      - "apps/agent-runner/**"
      - "apps/paper-runner/**"
      - "packages/**"
      - "pnpm-lock.yaml"
      - "package.json"
      - "tsconfig.base.json"
      - ".github/workflows/infra.yml"
  pull_request:
    branches: [main]
    paths:
      - "infra/terraform/**"
      - "mt5-sidecar/**"
      - "proto/mt5.proto"
      - "apps/agent-runner/**"
      - "apps/paper-runner/**"
      - "packages/**"
      - "pnpm-lock.yaml"
      - "package.json"
      - "tsconfig.base.json"
      - ".github/workflows/infra.yml"
```

- [ ] **Step 2: Append `app-build` matrix job**

Append after the existing `sidecar-build:` job (and the `terraform:` and `tfsec:` jobs):
```yaml

  app-build:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        app: [agent-runner, paper-runner]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build (no push) — smoke
        uses: docker/build-push-action@v6
        with:
          context: .
          file: apps/${{ matrix.app }}/Dockerfile
          platforms: linux/amd64
          push: false
          cache-from: type=gha,scope=${{ matrix.app }}-pr
          cache-to: type=gha,mode=max,scope=${{ matrix.app }}-pr
```

- [ ] **Step 3: YAML lint smoke**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/infra.yml')); print('yaml ok')"
```

Expected: `yaml ok`.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/infra.yml
git commit -m "ci(infra): add app-build matrix smoke (PR-time docker build for both apps)"
```

---

## Task 14: Append app-deploy section to `infra/terraform/README.md`

**Files:**
- Modify: `infra/terraform/README.md`

- [ ] **Step 1: Append section**

Append the following block at the end of `infra/terraform/README.md`:

````markdown

## App deploy (Plan 6c)

Deploys `agent-runner` (prod-only) and `paper-runner` (staging-only) as ECS Fargate services. Apps reach the sidecar via Service Connect at `mt5-sidecar:50051`. See `prd/specs/2026-05-08-forex-bot-app-deploy-design.md` for full design.

### Pre-conditions
1. Plan 6a + 6b applied; sidecar service `RUNNING + HEALTHY` per env.
2. Secrets blob populated with real Anthropic key and MT5 creds.
3. GitHub repo variable `AWS_ACCOUNT_ID` set under repo → Settings → Variables → Actions.

### First TF apply per env

```bash
cd infra/terraform/envs/<env>
terraform init -upgrade
terraform plan -out=tfplan
terraform apply tfplan
```

The relevant app service spawns immediately (`agent_runner` in prod, `paper_runner` in staging). The first task fails health (no image yet). **Expected.**

### First image build

```bash
gh workflow run apps-image.yml --ref main
```

Approx 5–8 min on first build (Node base + pnpm install dominate; subsequent builds <1 min via GHA cache).

### Verify
```bash
ENV=prod        # or staging
APP=agent-runner   # or paper-runner

aws ecs describe-services --cluster forex-bot-$ENV-cluster --services forex-bot-$ENV-$APP \
  --query 'services[0].{running: runningCount, primary: deployments[?status==`PRIMARY`].rolloutState | [0]}'
# Expected: running=1, primary=COMPLETED

aws logs tail /forex-bot/$ENV/$APP --since 5m
# Expected: app startup log line (e.g. "agent-runner started", "paper-runner started")
```

### End-to-end smoke (Service Connect resolution)

```bash
TASK_ARN=$(aws ecs list-tasks --cluster forex-bot-$ENV-cluster --service-name forex-bot-$ENV-$APP --query 'taskArns[0]' --output text)
aws ecs execute-command \
  --cluster forex-bot-$ENV-cluster --task "$TASK_ARN" --container "$APP" \
  --interactive \
  --command "node -e \"const net = require('net'); const s = net.connect(50051, 'mt5-sidecar', () => { console.log('OK'); s.end(); }); s.on('error', e => { console.error('FAIL', e.message); process.exit(1); });\""
# Expected: OK
```

### Troubleshooting

- **Task starts but logs show `Cannot resolve mt5-sidecar`**: Service Connect namespace mis-attached. Verify `aws ecs describe-services` shows non-empty `serviceConnectConfiguration.namespace`.
- **Task starts, sidecar dial succeeds, but app errors `MT5 initialize() failed`**: sidecar's MT5 creds are wrong (fix in Secrets Manager).
- **Image pull denied**: check `forex-bot-$ENV-ci` role's ECR scope includes the app's repo ARN.
- **DynamoDB `AccessDeniedException` from app**: verify `journal_rw_policy_arn` + `killswitch_rw_policy_arn` are attached to the task role:
  ```bash
  aws iam list-attached-role-policies --role-name forex-bot-$ENV-$APP-task
  ```
````

- [ ] **Step 2: Commit**

```bash
git add infra/terraform/README.md
git commit -m "docs(infra): add Plan 6c app-deploy runbook"
```

---

## Task 15: Flip Plan 6c status in root README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update plan-status row**

In `README.md` under `## Plans`, find:
```
| 6c — App deploy | pending | ECS clusters/services for agent-runner, paper-runner, ingest |
```
Replace with:
```
| 6c — App deploy | done | ECS services for agent-runner (prod) + paper-runner (staging); data-ingest deferred |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: flip Plan 6c status to done"
```

---

## Done-Done Checklist

- [ ] `pnpm exec tsx --version` returns 4.x.
- [ ] `docker buildx build` succeeds locally for both Dockerfiles.
- [ ] `docker run --rm forex-bot/agent-runner:smoke` fails fast with missing-env error (sanity confirm tsx + entrypoint).
- [ ] `docker run --rm forex-bot/paper-runner:smoke` fails fast with `PAPER_MODE` error.
- [ ] `terraform validate` passes for `modules/app`, `modules/cluster`, `modules/data`, `modules/sidecar`, both envs.
- [ ] `terraform fmt -check -recursive infra/terraform/` passes.
- [ ] `terraform apply` succeeds in `envs/staging` — paper-runner service exists; first task fails health pre-image.
- [ ] First `apps-image.yml` run pushes images, ECS redeploys, services stable.
- [ ] CloudWatch logs show app startup line per env.
- [ ] `aws ecs execute-command` into agent-runner task → TCP connect to `mt5-sidecar:50051` succeeds.
- [ ] App task IAM role has only `secrets-read` + `journal-rw` + `killswitch-rw` attached.
- [ ] `pnpm test`, `pnpm -r typecheck`, `pnpm lint` continue to pass.
- [ ] No long-lived AWS access keys created.
- [ ] All resources tagged `Project=forex-bot`, `Environment=<env>`, `ManagedBy=terraform`.
- [ ] Cost dashboard delta within ±20% of $30/mo combined.

## Deferred to sub-plans 6d/6e and Plan 7

- CW dashboards, SNS alarms, app metrics emit (Plan 6d).
- `data-ingest` deployment (separate future plan; needs `main.ts` first).
- ops-cli (kill-switch, reconcile, RAG backfill) (Plan 6e).
- DynamoDB kill-switch read-at-boot in agent-runner (Plan 6e).
- Persistent paper-runner output bucket / CloudWatch metric for daily snapshot (Plan 6d).
- Per-job path filters in CI (small inefficiency: paper-runner job runs even when only agent-runner code changes) (Plan 6d).
- Canary deploy / GitHub Environments approval gate on prod (Plan 7).
- Per-task egress allowlist (apps → sidecar) (Plan 7).
- PR-author allowlist on staging OIDC trust (Plan 7).
- Auto-rotation of secrets (Plan 7).
- agent-runner autoscaling, multi-region failover (Plan 7+).
