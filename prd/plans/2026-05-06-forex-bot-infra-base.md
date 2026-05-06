# Forex Bot — Plan 6a: IaC Base Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the AWS Terraform foundation under `infra/terraform/` per spec `prd/specs/2026-05-03-forex-bot-infra-base-design.md`. Provisions VPC + subnets + SGs, RDS Postgres (pgvector), ElastiCache Redis, DynamoDB tables, Secrets Manager blob, ECR repos, GitHub Actions OIDC role, and S3 backend bootstrap. Two stacks: `prod` + `staging`. eu-west-2.

**Architecture:** Terraform 1.10+ (S3 backend with native lockfile, no DynamoDB). AWS provider ~> 5.70. Module-per-concern (`network`, `data`, `secrets`, `ecr`, `ci-oidc`). Per-env composition stacks (`envs/prod`, `envs/staging`). One-shot bootstrap stack creates account-global state buckets + OIDC provider. No NAT, public subnets only with tight security groups.

**Tech Stack:** Terraform ≥ 1.10, hashicorp/aws ~> 5.70, hashicorp/random ~> 3.6, tflint, tfsec.

**Hard constraints:**
- No `terraform apply` in CI for v1.
- No long-lived AWS access keys anywhere.
- Bootstrap state local + `.gitignore`d (never committed).
- Every resource named `forex-bot-<env>-<resource>` and tagged `Project=forex-bot`, `Environment=<env>`, `ManagedBy=terraform`.
- RDS + ElastiCache reachable only from `app-sg` (locked SG ingress).
- Secrets values populated post-apply by operator; `terraform.tfvars` and state must never carry real creds.

---

## File structure produced by this plan

```
forex-bot/
├── .github/workflows/
│   └── infra.yml                              # NEW: terraform fmt + validate + tfsec on PR
├── .gitignore                                 # MODIFIED: ignore terraform local state + lockfiles
└── infra/
    └── terraform/
        ├── README.md                          # operator runbook
        ├── bootstrap/
        │   ├── main.tf
        │   ├── outputs.tf
        │   └── variables.tf
        ├── modules/
        │   ├── network/
        │   │   ├── main.tf
        │   │   ├── outputs.tf
        │   │   └── variables.tf
        │   ├── data/
        │   │   ├── main.tf
        │   │   ├── outputs.tf
        │   │   └── variables.tf
        │   ├── secrets/
        │   │   ├── main.tf
        │   │   ├── outputs.tf
        │   │   └── variables.tf
        │   ├── ecr/
        │   │   ├── main.tf
        │   │   ├── outputs.tf
        │   │   └── variables.tf
        │   └── ci-oidc/
        │       ├── main.tf
        │       ├── outputs.tf
        │       └── variables.tf
        ├── envs/
        │   ├── prod/
        │   │   ├── main.tf
        │   │   ├── outputs.tf
        │   │   ├── terraform.tfvars
        │   │   └── variables.tf
        │   └── staging/
        │       ├── main.tf
        │       ├── outputs.tf
        │       ├── terraform.tfvars
        │       └── variables.tf
        └── shared/
            └── tags.tf
```

---

## Task 1: Repo plumbing — `.gitignore`, root README pointer

**Files:**
- Modify: `.gitignore`
- Modify: `README.md`

- [ ] **Step 1: Append Terraform ignores to `.gitignore`**

Append:
```
# Terraform
infra/terraform/**/.terraform/
infra/terraform/**/.terraform.lock.hcl
infra/terraform/**/terraform.tfstate
infra/terraform/**/terraform.tfstate.backup
infra/terraform/**/*.tfplan
infra/terraform/**/crash.log
```

(Note: do NOT ignore `*.tfvars` — env tfvars are committed; only `.tfstate` is sensitive.)

- [ ] **Step 2: Add infra reference row to README.md repo structure**

In the `## Repository structure` section of `README.md`, add to the `apps`/`packages` block:
```
- `infra/terraform/` — AWS Terraform IaC (Plan 6a). See `infra/terraform/README.md`.
```

- [ ] **Step 3: Commit**

```bash
git add .gitignore README.md
git commit -m "chore(infra): add Terraform gitignore + README pointer"
```

---

## Task 2: `shared/tags.tf` — common tag map

**Files:**
- Create: `infra/terraform/shared/tags.tf`

- [ ] **Step 1: Write `infra/terraform/shared/tags.tf`**

```hcl
# Sourced by every env stack (envs/<env>/main.tf) via a `module "tags"` style
# include OR by passing `var.env` to each module. We use the latter; this file
# documents the convention and is referenced by the README.

# locals.common_tags is replicated inline in each env's main.tf because Terraform
# does not allow a `locals {}` block to be shared across modules without making
# it an input variable. Convention used in every env:
#
#   locals {
#     common_tags = {
#       Project     = "forex-bot"
#       Environment = var.env
#       ManagedBy   = "terraform"
#       Repo        = var.repo_url
#     }
#   }
#
# Provider default_tags is set in each env to apply common_tags repo-wide.
```

- [ ] **Step 2: Commit**

```bash
git add infra/terraform/shared/tags.tf
git commit -m "feat(infra): add shared tags convention doc"
```

---

## Task 3: Bootstrap stack — state buckets + OIDC provider

**Files:**
- Create: `infra/terraform/bootstrap/{main.tf,outputs.tf,variables.tf}`

- [ ] **Step 1: Write `infra/terraform/bootstrap/variables.tf`**

```hcl
variable "region" {
  description = "AWS region for state buckets and OIDC provider"
  type        = string
  default     = "eu-west-2"
}

variable "github_thumbprint" {
  description = "Thumbprint of token.actions.githubusercontent.com TLS cert. Pin a known value; rotate if GitHub rotates."
  type        = string
  default     = "6938fd4d98bab03faadb97b34396831e3780aea1"
}
```

- [ ] **Step 2: Write `infra/terraform/bootstrap/main.tf`**

```hcl
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.70" }
  }
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "forex-bot"
      ManagedBy = "terraform"
      Stack     = "bootstrap"
    }
  }
}

locals {
  envs = ["prod", "staging"]
}

resource "aws_s3_bucket" "tfstate" {
  for_each = toset(local.envs)
  bucket   = "forex-bot-tfstate-${each.value}"
}

resource "aws_s3_bucket_versioning" "tfstate" {
  for_each = aws_s3_bucket.tfstate
  bucket   = each.value.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "tfstate" {
  for_each = aws_s3_bucket.tfstate
  bucket   = each.value.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_public_access_block" "tfstate" {
  for_each = aws_s3_bucket.tfstate
  bucket   = each.value.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "tfstate" {
  for_each = aws_s3_bucket.tfstate
  bucket   = each.value.id
  rule {
    id     = "expire-noncurrent"
    status = "Enabled"
    noncurrent_version_expiration { noncurrent_days = 90 }
  }
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [var.github_thumbprint]
}
```

- [ ] **Step 3: Write `infra/terraform/bootstrap/outputs.tf`**

```hcl
output "state_bucket_prod" {
  value = aws_s3_bucket.tfstate["prod"].bucket
}

output "state_bucket_staging" {
  value = aws_s3_bucket.tfstate["staging"].bucket
}

output "oidc_provider_arn" {
  value = aws_iam_openid_connect_provider.github.arn
}
```

- [ ] **Step 4: Format + validate**

```bash
cd infra/terraform/bootstrap
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 5: Commit**

```bash
cd ../../..
git add infra/terraform/bootstrap
git commit -m "feat(infra): add bootstrap stack (state buckets + GH OIDC provider)"
```

---

## Task 4: `modules/network` — VPC, subnets, IGW, RT, SGs, gateway endpoints

**Files:**
- Create: `infra/terraform/modules/network/{main.tf,outputs.tf,variables.tf}`

- [ ] **Step 1: Write `modules/network/variables.tf`**

```hcl
variable "env" {
  description = "Environment name (prod, staging)"
  type        = string
}

variable "cidr_block" {
  description = "VPC CIDR block"
  type        = string
}

variable "azs" {
  description = "Availability zones (length 2)"
  type        = list(string)
  validation {
    condition     = length(var.azs) == 2
    error_message = "azs must have exactly 2 entries."
  }
}

variable "common_tags" {
  description = "Tags applied to every resource"
  type        = map(string)
}
```

- [ ] **Step 2: Write `modules/network/main.tf`**

```hcl
locals {
  name_prefix = "forex-bot-${var.env}"
}

resource "aws_vpc" "main" {
  cidr_block           = var.cidr_block
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = merge(var.common_tags, { Name = "${local.name_prefix}-vpc" })
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
  tags   = merge(var.common_tags, { Name = "${local.name_prefix}-igw" })
}

resource "aws_subnet" "public" {
  count                   = length(var.azs)
  vpc_id                  = aws_vpc.main.id
  cidr_block              = cidrsubnet(var.cidr_block, 8, count.index)
  availability_zone       = var.azs[count.index]
  map_public_ip_on_launch = true
  tags = merge(var.common_tags, {
    Name = "${local.name_prefix}-public-${var.azs[count.index]}"
    Tier = "public"
  })
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
  tags = merge(var.common_tags, { Name = "${local.name_prefix}-rt-public" })
}

resource "aws_route_table_association" "public" {
  count          = length(aws_subnet.public)
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_vpc_endpoint" "s3" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.s3"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id]
  tags = merge(var.common_tags, { Name = "${local.name_prefix}-vpce-s3" })
}

resource "aws_vpc_endpoint" "dynamodb" {
  vpc_id            = aws_vpc.main.id
  service_name      = "com.amazonaws.${data.aws_region.current.name}.dynamodb"
  vpc_endpoint_type = "Gateway"
  route_table_ids   = [aws_route_table.public.id]
  tags = merge(var.common_tags, { Name = "${local.name_prefix}-vpce-dynamodb" })
}

data "aws_region" "current" {}

resource "aws_security_group" "app" {
  name        = "${local.name_prefix}-app-sg"
  description = "Application tasks (agent-runner, paper-runner, sidecar, ingest)"
  vpc_id      = aws_vpc.main.id
  tags        = merge(var.common_tags, { Name = "${local.name_prefix}-app-sg" })
}

resource "aws_vpc_security_group_egress_rule" "app_egress_all" {
  security_group_id = aws_security_group.app.id
  description       = "Outbound to broker MT5, Anthropic, AWS APIs (tightened in Plan 6c)"
  ip_protocol       = "-1"
  cidr_ipv4         = "0.0.0.0/0"
}

resource "aws_vpc_security_group_ingress_rule" "app_intra" {
  security_group_id            = aws_security_group.app.id
  description                  = "Intra-app gRPC + HTTP"
  ip_protocol                  = "-1"
  referenced_security_group_id = aws_security_group.app.id
}

resource "aws_security_group" "data" {
  name        = "${local.name_prefix}-data-sg"
  description = "RDS Postgres + ElastiCache Redis"
  vpc_id      = aws_vpc.main.id
  tags        = merge(var.common_tags, { Name = "${local.name_prefix}-data-sg" })
}

resource "aws_vpc_security_group_ingress_rule" "data_postgres" {
  security_group_id            = aws_security_group.data.id
  description                  = "Postgres from app"
  ip_protocol                  = "tcp"
  from_port                    = 5432
  to_port                      = 5432
  referenced_security_group_id = aws_security_group.app.id
}

resource "aws_vpc_security_group_ingress_rule" "data_redis" {
  security_group_id            = aws_security_group.data.id
  description                  = "Redis from app"
  ip_protocol                  = "tcp"
  from_port                    = 6379
  to_port                      = 6379
  referenced_security_group_id = aws_security_group.app.id
}
```

- [ ] **Step 3: Write `modules/network/outputs.tf`**

```hcl
output "vpc_id" {
  value = aws_vpc.main.id
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "app_sg_id" {
  value = aws_security_group.app.id
}

output "data_sg_id" {
  value = aws_security_group.data.id
}
```

- [ ] **Step 4: Format + validate**

```bash
cd infra/terraform/modules/network
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 5: Commit**

```bash
cd ../../../..
git add infra/terraform/modules/network
git commit -m "feat(infra): add network module (VPC, subnets, SGs, gateway endpoints)"
```

---

## Task 5: `modules/secrets` — Secrets Manager blob + read policy

**Files:**
- Create: `infra/terraform/modules/secrets/{main.tf,outputs.tf,variables.tf}`

- [ ] **Step 1: Write `modules/secrets/variables.tf`**

```hcl
variable "env" {
  description = "Environment name (prod, staging)"
  type        = string
}

variable "common_tags" {
  description = "Tags applied to every resource"
  type        = map(string)
}

variable "db_password" {
  description = "RDS master password (generated by env-level random_password)"
  type        = string
  sensitive   = true
}
```

- [ ] **Step 2: Write `modules/secrets/main.tf`**

```hcl
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
```

- [ ] **Step 3: Write `modules/secrets/outputs.tf`**

```hcl
output "secret_arn" {
  value = aws_secretsmanager_secret.main.arn
}

output "secret_name" {
  value = aws_secretsmanager_secret.main.name
}

output "read_policy_arn" {
  value = aws_iam_policy.read.arn
}
```

- [ ] **Step 4: Format + validate**

```bash
cd infra/terraform/modules/secrets
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 5: Commit**

```bash
cd ../../../..
git add infra/terraform/modules/secrets
git commit -m "feat(infra): add secrets module (Secrets Manager blob + read policy)"
```

---

## Task 6: `modules/data` — RDS Postgres, ElastiCache Redis, DynamoDB

**Files:**
- Create: `infra/terraform/modules/data/{main.tf,outputs.tf,variables.tf}`

- [ ] **Step 1: Write `modules/data/variables.tf`**

```hcl
variable "env" {
  description = "Environment name"
  type        = string
}

variable "subnet_ids" {
  description = "Subnet IDs for RDS + ElastiCache subnet groups"
  type        = list(string)
}

variable "data_sg_id" {
  description = "Security group ID controlling ingress to RDS + Redis"
  type        = string
}

variable "db_password" {
  description = "RDS master password"
  type        = string
  sensitive   = true
}

variable "common_tags" {
  description = "Tags applied to every resource"
  type        = map(string)
}
```

- [ ] **Step 2: Write `modules/data/main.tf`**

```hcl
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
```

- [ ] **Step 3: Write `modules/data/outputs.tf`**

```hcl
output "pg_endpoint" {
  value = aws_db_instance.pg.address
}

output "pg_port" {
  value = aws_db_instance.pg.port
}

output "redis_endpoint" {
  value = aws_elasticache_cluster.redis.cache_nodes[0].address
}

output "redis_port" {
  value = aws_elasticache_cluster.redis.port
}

output "journal_table_name" {
  value = aws_dynamodb_table.trade_journal.name
}

output "journal_table_arn" {
  value = aws_dynamodb_table.trade_journal.arn
}

output "killswitch_table_name" {
  value = aws_dynamodb_table.kill_switch.name
}

output "killswitch_table_arn" {
  value = aws_dynamodb_table.kill_switch.arn
}
```

- [ ] **Step 4: Format + validate**

```bash
cd infra/terraform/modules/data
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 5: Commit**

```bash
cd ../../../..
git add infra/terraform/modules/data
git commit -m "feat(infra): add data module (RDS Postgres + ElastiCache Redis + DynamoDB)"
```

---

## Task 7: `modules/ecr` — one repo per app

**Files:**
- Create: `infra/terraform/modules/ecr/{main.tf,outputs.tf,variables.tf}`

- [ ] **Step 1: Write `modules/ecr/variables.tf`**

```hcl
variable "env" {
  description = "Environment name"
  type        = string
}

variable "apps" {
  description = "App names for which to create ECR repos"
  type        = list(string)
  default = [
    "mt5-sidecar",
    "agent-runner",
    "paper-runner",
    "data-ingest",
    "eval-replay-cli",
    "eval-event-study-cli",
  ]
}

variable "common_tags" {
  description = "Tags applied to every resource"
  type        = map(string)
}
```

- [ ] **Step 2: Write `modules/ecr/main.tf`**

```hcl
locals {
  name_prefix = "forex-bot-${var.env}"
}

resource "aws_ecr_repository" "app" {
  for_each             = toset(var.apps)
  name                 = "forex-bot/${var.env}/${each.value}"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-ecr-${each.value}" })
}

resource "aws_ecr_lifecycle_policy" "app" {
  for_each   = aws_ecr_repository.app
  repository = each.value.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 tagged images"
        selection = {
          tagStatus     = "tagged"
          tagPatternList = ["*"]
          countType     = "imageCountMoreThan"
          countNumber   = 10
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Expire untagged images after 7 days"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 7
        }
        action = { type = "expire" }
      },
    ]
  })
}
```

- [ ] **Step 3: Write `modules/ecr/outputs.tf`**

```hcl
output "repo_urls" {
  value = { for k, v in aws_ecr_repository.app : k => v.repository_url }
}

output "repo_arns" {
  value = { for k, v in aws_ecr_repository.app : k => v.arn }
}

output "repo_names" {
  value = { for k, v in aws_ecr_repository.app : k => v.name }
}
```

- [ ] **Step 4: Format + validate**

```bash
cd infra/terraform/modules/ecr
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 5: Commit**

```bash
cd ../../../..
git add infra/terraform/modules/ecr
git commit -m "feat(infra): add ecr module (one repo per app + lifecycle)"
```

---

## Task 8: `modules/ci-oidc` — IAM role assumable by GitHub Actions

**Files:**
- Create: `infra/terraform/modules/ci-oidc/{main.tf,outputs.tf,variables.tf}`

- [ ] **Step 1: Write `modules/ci-oidc/variables.tf`**

```hcl
variable "env" {
  description = "Environment name"
  type        = string
}

variable "github_org" {
  description = "GitHub org/owner for the forex-bot repo"
  type        = string
}

variable "github_repo" {
  description = "GitHub repo name (without org)"
  type        = string
  default     = "forex-bot"
}

variable "branch_filter" {
  description = "GitHub Actions sub-claim filter (e.g. 'ref:refs/heads/main' or 'pull_request')"
  type        = string
}

variable "oidc_provider_arn" {
  description = "ARN of token.actions.githubusercontent.com OIDC provider (from bootstrap)"
  type        = string
}

variable "ecr_repo_arns" {
  description = "ECR repository ARNs the CI role may push to"
  type        = list(string)
}

variable "common_tags" {
  description = "Tags applied to every resource"
  type        = map(string)
}
```

- [ ] **Step 2: Write `modules/ci-oidc/main.tf`**

```hcl
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
      values   = ["repo:${var.github_org}/${var.github_repo}:${var.branch_filter}"]
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
```

- [ ] **Step 3: Write `modules/ci-oidc/outputs.tf`**

```hcl
output "ci_role_arn" {
  value = aws_iam_role.ci.arn
}

output "ci_role_name" {
  value = aws_iam_role.ci.name
}
```

- [ ] **Step 4: Format + validate**

```bash
cd infra/terraform/modules/ci-oidc
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 5: Commit**

```bash
cd ../../../..
git add infra/terraform/modules/ci-oidc
git commit -m "feat(infra): add ci-oidc module (IAM role + GH Actions trust + ECR push policy)"
```

---

## Task 9: `envs/staging` composition

**Files:**
- Create: `infra/terraform/envs/staging/{main.tf,outputs.tf,variables.tf,terraform.tfvars}`

- [ ] **Step 1: Write `envs/staging/variables.tf`**

```hcl
variable "env" {
  description = "Environment name"
  type        = string
  default     = "staging"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "eu-west-2"
}

variable "cidr_block" {
  description = "VPC CIDR"
  type        = string
  default     = "10.1.0.0/16"
}

variable "azs" {
  description = "Two AZs in region"
  type        = list(string)
  default     = ["eu-west-2a", "eu-west-2b"]
}

variable "github_org" {
  description = "GitHub org/owner"
  type        = string
}

variable "github_repo" {
  description = "GitHub repo name"
  type        = string
  default     = "forex-bot"
}

variable "oidc_provider_arn" {
  description = "ARN of GH OIDC provider (from bootstrap output)"
  type        = string
}

variable "repo_url" {
  description = "Repo URL for tagging"
  type        = string
}
```

- [ ] **Step 2: Write `envs/staging/main.tf`**

```hcl
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.70" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }

  backend "s3" {
    bucket       = "forex-bot-tfstate-staging"
    key          = "infra/main.tfstate"
    region       = "eu-west-2"
    encrypt      = true
    use_lockfile = true
  }
}

locals {
  common_tags = {
    Project     = "forex-bot"
    Environment = var.env
    ManagedBy   = "terraform"
    Repo        = var.repo_url
  }
}

provider "aws" {
  region = var.region
  default_tags { tags = local.common_tags }
}

resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>?"
}

module "network" {
  source      = "../../modules/network"
  env         = var.env
  cidr_block  = var.cidr_block
  azs         = var.azs
  common_tags = local.common_tags
}

module "secrets" {
  source      = "../../modules/secrets"
  env         = var.env
  db_password = random_password.db.result
  common_tags = local.common_tags
}

module "data" {
  source      = "../../modules/data"
  env         = var.env
  subnet_ids  = module.network.public_subnet_ids
  data_sg_id  = module.network.data_sg_id
  db_password = random_password.db.result
  common_tags = local.common_tags
}

module "ecr" {
  source      = "../../modules/ecr"
  env         = var.env
  common_tags = local.common_tags
}

module "ci_oidc" {
  source            = "../../modules/ci-oidc"
  env               = var.env
  github_org        = var.github_org
  github_repo       = var.github_repo
  branch_filter     = "pull_request"
  oidc_provider_arn = var.oidc_provider_arn
  ecr_repo_arns     = values(module.ecr.repo_arns)
  common_tags       = local.common_tags
}
```

- [ ] **Step 3: Write `envs/staging/outputs.tf`**

```hcl
output "vpc_id" {
  value = module.network.vpc_id
}

output "pg_endpoint" {
  value = module.data.pg_endpoint
}

output "redis_endpoint" {
  value = module.data.redis_endpoint
}

output "secret_arn" {
  value = module.secrets.secret_arn
}

output "secrets_read_policy_arn" {
  value = module.secrets.read_policy_arn
}

output "ecr_repo_urls" {
  value = module.ecr.repo_urls
}

output "ci_role_arn" {
  value = module.ci_oidc.ci_role_arn
}
```

- [ ] **Step 4: Write `envs/staging/terraform.tfvars`**

```hcl
github_org        = "REPLACE_ME_GITHUB_ORG"
oidc_provider_arn = "REPLACE_ME_FROM_BOOTSTRAP_OUTPUT"
repo_url          = "github.com/REPLACE_ME/forex-bot"
```

- [ ] **Step 5: Format + validate**

```bash
cd infra/terraform/envs/staging
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 6: Commit**

```bash
cd ../../../..
git add infra/terraform/envs/staging
git commit -m "feat(infra): add staging env composition stack"
```

---

## Task 10: `envs/prod` composition

**Files:**
- Create: `infra/terraform/envs/prod/{main.tf,outputs.tf,variables.tf,terraform.tfvars}`

- [ ] **Step 1: Write `envs/prod/variables.tf`**

Same as `envs/staging/variables.tf` but `env` default `"prod"` and `cidr_block` default `"10.0.0.0/16"`. Full content:

```hcl
variable "env" {
  description = "Environment name"
  type        = string
  default     = "prod"
}

variable "region" {
  description = "AWS region"
  type        = string
  default     = "eu-west-2"
}

variable "cidr_block" {
  description = "VPC CIDR"
  type        = string
  default     = "10.0.0.0/16"
}

variable "azs" {
  description = "Two AZs in region"
  type        = list(string)
  default     = ["eu-west-2a", "eu-west-2b"]
}

variable "github_org" {
  description = "GitHub org/owner"
  type        = string
}

variable "github_repo" {
  description = "GitHub repo name"
  type        = string
  default     = "forex-bot"
}

variable "oidc_provider_arn" {
  description = "ARN of GH OIDC provider (from bootstrap output)"
  type        = string
}

variable "repo_url" {
  description = "Repo URL for tagging"
  type        = string
}
```

- [ ] **Step 2: Write `envs/prod/main.tf`**

Identical structure to `envs/staging/main.tf` but with `bucket = "forex-bot-tfstate-prod"` and `branch_filter = "ref:refs/heads/main"`. Full content:

```hcl
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.70" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }

  backend "s3" {
    bucket       = "forex-bot-tfstate-prod"
    key          = "infra/main.tfstate"
    region       = "eu-west-2"
    encrypt      = true
    use_lockfile = true
  }
}

locals {
  common_tags = {
    Project     = "forex-bot"
    Environment = var.env
    ManagedBy   = "terraform"
    Repo        = var.repo_url
  }
}

provider "aws" {
  region = var.region
  default_tags { tags = local.common_tags }
}

resource "random_password" "db" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>?"
}

module "network" {
  source      = "../../modules/network"
  env         = var.env
  cidr_block  = var.cidr_block
  azs         = var.azs
  common_tags = local.common_tags
}

module "secrets" {
  source      = "../../modules/secrets"
  env         = var.env
  db_password = random_password.db.result
  common_tags = local.common_tags
}

module "data" {
  source      = "../../modules/data"
  env         = var.env
  subnet_ids  = module.network.public_subnet_ids
  data_sg_id  = module.network.data_sg_id
  db_password = random_password.db.result
  common_tags = local.common_tags
}

module "ecr" {
  source      = "../../modules/ecr"
  env         = var.env
  common_tags = local.common_tags
}

module "ci_oidc" {
  source            = "../../modules/ci-oidc"
  env               = var.env
  github_org        = var.github_org
  github_repo       = var.github_repo
  branch_filter     = "ref:refs/heads/main"
  oidc_provider_arn = var.oidc_provider_arn
  ecr_repo_arns     = values(module.ecr.repo_arns)
  common_tags       = local.common_tags
}
```

- [ ] **Step 3: Write `envs/prod/outputs.tf`**

Identical to `envs/staging/outputs.tf`:

```hcl
output "vpc_id" {
  value = module.network.vpc_id
}

output "pg_endpoint" {
  value = module.data.pg_endpoint
}

output "redis_endpoint" {
  value = module.data.redis_endpoint
}

output "secret_arn" {
  value = module.secrets.secret_arn
}

output "secrets_read_policy_arn" {
  value = module.secrets.read_policy_arn
}

output "ecr_repo_urls" {
  value = module.ecr.repo_urls
}

output "ci_role_arn" {
  value = module.ci_oidc.ci_role_arn
}
```

- [ ] **Step 4: Write `envs/prod/terraform.tfvars`**

```hcl
github_org        = "REPLACE_ME_GITHUB_ORG"
oidc_provider_arn = "REPLACE_ME_FROM_BOOTSTRAP_OUTPUT"
repo_url          = "github.com/REPLACE_ME/forex-bot"
```

- [ ] **Step 5: Format + validate**

```bash
cd infra/terraform/envs/prod
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 6: Commit**

```bash
cd ../../../..
git add infra/terraform/envs/prod
git commit -m "feat(infra): add prod env composition stack"
```

---

## Task 11: CI workflow — `terraform fmt` + `validate` + `tfsec`

**Files:**
- Create: `.github/workflows/infra.yml`

- [ ] **Step 1: Write `.github/workflows/infra.yml`**

```yaml
name: infra

on:
  push:
    branches: [main]
    paths:
      - "infra/terraform/**"
      - ".github/workflows/infra.yml"
  pull_request:
    branches: [main]
    paths:
      - "infra/terraform/**"
      - ".github/workflows/infra.yml"

permissions:
  contents: read

jobs:
  terraform:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        path:
          - infra/terraform/bootstrap
          - infra/terraform/modules/network
          - infra/terraform/modules/data
          - infra/terraform/modules/secrets
          - infra/terraform/modules/ecr
          - infra/terraform/modules/ci-oidc
          - infra/terraform/envs/prod
          - infra/terraform/envs/staging
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: 1.10.5
          terraform_wrapper: false
      - name: Format check
        run: terraform fmt -check -recursive
        working-directory: ${{ matrix.path }}
      - name: Init (no backend)
        run: terraform init -backend=false
        working-directory: ${{ matrix.path }}
      - name: Validate
        run: terraform validate
        working-directory: ${{ matrix.path }}

  tfsec:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: tfsec
        uses: aquasecurity/tfsec-action@v1.0.3
        with:
          working_directory: infra/terraform
          # v1 trade-offs (no KMS CMK, ElastiCache plaintext, MUTABLE ECR tags,
          # wide SG egress, RDS deletion_protection off) are intentional and
          # tracked for Plan 7 hardening. tfsec output is treated as advisory
          # in v1; flip to soft_fail: false in Plan 7.
          soft_fail: true
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/infra.yml
git commit -m "ci(infra): add terraform fmt + validate + tfsec workflow"
```

- [ ] **Step 3: Push + verify CI green** (operator step — `git push` and watch the run on GH Actions; if `tfsec` flags issues, fix them inline and re-commit before continuing)

---

## Task 12: `infra/terraform/README.md` — operator runbook

**Files:**
- Create: `infra/terraform/README.md`

- [ ] **Step 1: Write `infra/terraform/README.md`**

````markdown
# forex-bot Terraform IaC

Plan 6a foundation. Provisions AWS resources for `prod` and `staging` stacks in `eu-west-2`.

## Layout

- `bootstrap/` — one-shot, local state. Creates S3 state buckets + GitHub OIDC provider.
- `modules/` — reusable per-concern modules (`network`, `data`, `secrets`, `ecr`, `ci-oidc`).
- `envs/<env>/` — composes modules; uses S3 backend per env.
- `shared/tags.tf` — common_tags convention doc.

## First-time setup (per AWS account)

```bash
# 0. Confirm AWS CLI is configured for the target account
aws sts get-caller-identity

# 1. Bootstrap state buckets + OIDC provider
cd infra/terraform/bootstrap
terraform init
terraform apply

# 2. Capture outputs (write into envs/<env>/terraform.tfvars):
terraform output oidc_provider_arn
# Copy the value into envs/prod/terraform.tfvars and envs/staging/terraform.tfvars
# under `oidc_provider_arn = "..."`. Also set `github_org` and `repo_url`.

# 3. Apply staging
cd ../envs/staging
terraform init
terraform plan -out=tfplan
terraform apply tfplan

# 4. Apply prod
cd ../prod
terraform init
terraform plan -out=tfplan
terraform apply tfplan

# 5. Populate Secrets Manager (one-time)
aws secretsmanager put-secret-value \
  --secret-id forex-bot/staging/secrets \
  --secret-string file://staging-secrets.json
# JSON file shape:
# {
#   "anthropicApiKey": "sk-ant-...",
#   "mt5Login":       "12345",
#   "mt5Password":    "...",
#   "mt5Server":      "ICMarketsSC-Demo",
#   "dbPassword":     "<keep current value from `terraform output`>"
# }
# DO NOT commit staging-secrets.json. Delete after upload.
```

## Subsequent applies

```bash
cd infra/terraform/envs/<env>
terraform plan -out=tfplan
terraform apply tfplan
```

## Smoke verification (post-apply)

```bash
ENV=staging
aws rds describe-db-instances --db-instance-identifier forex-bot-$ENV-rds --query 'DBInstances[0].DBInstanceStatus'
aws elasticache describe-cache-clusters --cache-cluster-id forex-bot-$ENV-redis --query 'CacheClusters[0].CacheClusterStatus'
aws ecr describe-repositories --repository-names forex-bot/$ENV/agent-runner --query 'repositories[0].repositoryUri'
aws secretsmanager describe-secret --secret-id forex-bot/$ENV/secrets --query 'ARN'
aws iam get-role --role-name forex-bot-$ENV-ci --query 'Role.Arn'
```

All five commands should return non-empty values. RDS status must be `available`.

## Tearing down (staging only — never run on prod without explicit approval)

```bash
cd infra/terraform/envs/staging
terraform destroy
# RDS deletion proceeds because deletion_protection = false in v1.
# Plan 7 will flip this to true on prod.
```

## Cost (prod, before workloads)

~$28/mo. Itemized breakdown in `prd/specs/2026-05-03-forex-bot-infra-base-design.md` §8.

## Caveats

- **No NAT.** ECS tasks (Plan 6c) get public IPs. SG egress is open by default; tightened later.
- **Bootstrap state is local.** Do not lose it; if you do, manually `terraform import` the S3 buckets and OIDC provider.
- **Secret values must be populated post-apply.** RDS will not accept connections from apps until `mt5Login` etc. are real (apps fail-fast on placeholder).
- **`deletion_protection = false`** on RDS. Set to true via Plan 7 hardening.
- **`branch_filter = "pull_request"`** on staging is permissive (any PR can deploy). Tighten via PR-author allowlist in Plan 7.
````

- [ ] **Step 2: Commit**

```bash
git add infra/terraform/README.md
git commit -m "docs(infra): add operator runbook for Plan 6a"
```

---

## Task 13: Update root `README.md` plan table

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update plan-status row in `README.md`**

Replace the Plan 6 row with two rows showing the sub-plan split:

```
| 6a — IaC base | done | VPC, RDS, Redis, DynamoDB, Secrets, ECR, GH OIDC |
| 6b — Sidecar deploy | pending | Wine + portable MT5 + ECS task |
| 6c — App deploy | pending | ECS clusters/services for agent-runner, paper-runner, ingest |
| 6d — Observability | pending | CW metrics, SNS alerts, dashboards |
| 6e — ops-cli | pending | kill-switch, reconcile, RAG backfill |
```

(Remove the prior single Plan 6 row.)

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: split Plan 6 into 6a-6e in README plan table"
```

---

## Done-Done Checklist

- [ ] `terraform fmt -check -recursive` passes from `infra/terraform/`.
- [ ] `terraform init -backend=false && terraform validate` passes for: `bootstrap`, every module, both envs.
- [ ] `tfsec` CI job passes.
- [ ] `.gitignore` ignores `.terraform/`, `*.tfstate`, `*.tfplan`.
- [ ] Bootstrap stack applied successfully (manual operator step).
- [ ] `staging` stack applied successfully (manual operator step).
- [ ] `prod` stack applied successfully (manual operator step).
- [ ] Secrets Manager values populated for both envs (manual operator step).
- [ ] Smoke verification commands from `infra/terraform/README.md` all return non-empty.
- [ ] No long-lived AWS access keys created or stored anywhere.
- [ ] Resources tagged with `Project=forex-bot`, `Environment=<env>`, `ManagedBy=terraform`.
- [ ] Cost dashboard shows ~$56/mo combined steady-state (prod + staging).

## Deferred to sub-plans 6b–6e

- ECS clusters, task definitions, services for sidecar + apps (6b/6c).
- Sidecar Wine + portable MT5 + auto-login choreography (6b).
- App-level CD pipeline (build images → push ECR → `aws ecs update-service`) (6c).
- CloudWatch metrics emit from `MetricsWriter`, SNS alarms, log groups, dashboards (6d).
- ops-cli (kill-switch, reconcile, RAG backfill, deploy bumps) (6e).
- RDS deletion protection on prod (Plan 7).
- Automated secret rotation (Plan 7).
- Tighter SG egress rules (allowlist broker IPs) (Plan 7).
- Stricter OIDC trust (PR-author allowlist) (Plan 7).
- tfsec strict mode (flip `soft_fail: true` → `false` after addressing: KMS CMK on Secrets/ECR/DynamoDB, ElastiCache encryption-in-transit + at-rest, ECR `IMMUTABLE` tags, RDS performance insights + deletion protection, narrow SG egress) (Plan 7).
