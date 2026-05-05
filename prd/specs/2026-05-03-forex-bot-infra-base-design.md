# Plan 6a — IaC base (design spec)

> Sub-plan of Plan 6 (Infra & Ops). Scope: AWS foundation. Sibling sub-plans:
> 6b (sidecar deploy), 6c (app deploy + CD pipeline), 6d (observability), 6e (ops-cli).

## 1. Goal & non-goals

**Goal.** Stand up a Terraform IaC tree under `infra/terraform/` that provisions the AWS foundation for `forex-bot`: VPC + subnets + security groups, RDS Postgres (pgvector), ElastiCache Redis, DynamoDB tables, Secrets Manager secret, ECR repos, IAM OIDC provider + GitHub Actions deploy role, and an S3 backend bootstrap. Two parallel stacks: `prod` and `staging`. eu-west-2.

**Non-goals.**
- ECS clusters / task definitions / services — Plan 6b (sidecar) and 6c (apps).
- Sidecar Wine choreography (MT5 binary mount, Python-on-Windows, auto-login) — Plan 6b.
- CloudWatch dashboards, SNS alarms, log aggregation — Plan 6d.
- ops-cli (kill-switch, reconcile, RAG backfill) — Plan 6e.
- Auto-rotation of secrets — Plan 7.
- Blue/green or canary deploys — Plan 7.

## 2. Decisions adopted

| # | Decision | Choice |
|---|----------|--------|
| 1 | IaC tool | Terraform |
| 2 | AWS account | Existing shared account; namespaced via `forex-bot-` prefix + `Project=forex-bot` tag |
| 3 | Environments | Two stacks: `prod` + `staging` |
| 4 | Region | eu-west-2 (London — closest to Equinix LD4 where most retail FX brokers host MT5) |
| 5 | TF state backend | S3 + native lockfile (`use_lockfile = true`, Terraform ≥ 1.10). No DynamoDB lock table |
| 6 | Networking | Two AZs, **public subnets only**, **no NAT**. ECS tasks get public IPs; SGs lock down ingress |
| 7 | Data tier | RDS `db.t4g.micro` 20GB gp3 single-AZ; ElastiCache `cache.t4g.micro` 1 node; DynamoDB on-demand |
| 8 | Secrets | Single Secrets Manager JSON blob per env (`forex-bot/<env>/secrets`) |
| 9 | ECR | One repo per app (6 repos: `mt5-sidecar`, `agent-runner`, `paper-runner`, `data-ingest`, `eval-replay-cli`, `eval-event-study-cli`); scan-on-push; lifecycle keeps last 10 tagged + 7d untagged |
| 10 | CI auth | GitHub Actions OIDC → AWS IAM role (no long-lived access keys) |
| 11 | Staging strategy | Separate stack, same instance sizes; shut down when not in use |

## 3. Repo layout

```
infra/
└── terraform/
    ├── README.md
    ├── bootstrap/                   # one-shot, local state, .gitignored .tfstate
    │   ├── main.tf                  # creates S3 state bucket per env
    │   ├── outputs.tf
    │   └── variables.tf
    ├── modules/
    │   ├── network/                 # VPC, subnets, IGW, RT, SGs, gateway endpoints
    │   ├── data/                    # RDS Postgres + ElastiCache Redis + DynamoDB tables
    │   ├── secrets/                 # Secrets Manager blob + read policy ARN
    │   ├── ecr/                     # one repo per app + lifecycle policy
    │   └── ci-oidc/                 # GH OIDC provider + deploy role + policies
    ├── envs/
    │   ├── prod/
    │   │   ├── main.tf              # composes modules; S3 backend
    │   │   ├── terraform.tfvars
    │   │   └── outputs.tf
    │   └── staging/
    │       ├── main.tf
    │       ├── terraform.tfvars
    │       └── outputs.tf
    └── shared/
        └── tags.tf                  # common_tags map
```

Run order:
1. `cd infra/terraform/bootstrap && terraform init && terraform apply` — once per account.
2. `cd ../envs/prod && terraform init && terraform plan/apply` — thereafter.
3. Same for `envs/staging`.

## 4. Module specs

### `modules/network`
- **Inputs**: `env`, `cidr_block` (default `10.0.0.0/16` prod, `10.1.0.0/16` staging), `azs` (`["eu-west-2a", "eu-west-2b"]`).
- **Resources**:
  - `aws_vpc` with DNS hostnames + DNS support enabled.
  - 2 × `aws_subnet` (public, one per AZ), `map_public_ip_on_launch = true`.
  - `aws_internet_gateway`, `aws_route_table` with default route via IGW, route-table associations.
  - `aws_vpc_endpoint` × 2 (gateway type, free): `com.amazonaws.eu-west-2.s3`, `com.amazonaws.eu-west-2.dynamodb`.
  - `aws_security_group` × 3:
    - `app-sg`: egress all (broker MT5, Anthropic, AWS APIs over 443); ingress only from itself (intra-app gRPC).
    - `data-sg`: ingress 5432 (Postgres) + 6379 (Redis) from `app-sg` only; no egress restrictions needed.
    - (no separate `db-sg`; consolidated into `data-sg`.)
- **Outputs**: `vpc_id`, `public_subnet_ids`, `app_sg_id`, `data_sg_id`.

### `modules/data`
- **Inputs**: `env`, `subnet_ids`, `data_sg_id`, `db_password` (sensitive, sourced from a `random_password` resource declared at the env composition layer; same value piped into the Secrets Manager blob via `aws_secretsmanager_secret_version`).
- **Resources**:
  - `aws_db_subnet_group` over `subnet_ids`.
  - `aws_db_parameter_group` for PostgreSQL 16 with `shared_preload_libraries = 'pgvector'`.
  - `aws_db_instance`: PostgreSQL 16, `db.t4g.micro`, 20GB gp3, single-AZ, backup retention 1 day, deletion protection off in v1, master password from input. **Publicly accessible = false.**
  - `aws_elasticache_subnet_group` over `subnet_ids`.
  - `aws_elasticache_cluster`: Redis 7, `cache.t4g.micro`, 1 node, no auth (locked via SG).
  - `aws_dynamodb_table` for trade journal (`forex-bot-<env>-trade-journal`, hash key `tradeId`, on-demand, PITR on).
  - `aws_dynamodb_table` for kill-switch state (`forex-bot-<env>-kill-switch`, hash key `key`, on-demand, PITR on).
- **Outputs**: `pg_endpoint`, `pg_port`, `redis_endpoint`, `redis_port`, `journal_table_arn`, `killswitch_table_arn`.

### `modules/secrets`
- **Inputs**: `env`.
- **Resources**:
  - `aws_secretsmanager_secret` `forex-bot/<env>/secrets` with placeholder JSON value:
    ```json
    {
      "anthropicApiKey": "REPLACE_ME",
      "mt5Login": "REPLACE_ME",
      "mt5Password": "REPLACE_ME",
      "mt5Server": "REPLACE_ME",
      "dbPassword": "REPLACE_ME"
    }
    ```
  - Real values populated post-apply via AWS Console or CLI; never via Terraform (avoids state leakage).
  - `aws_iam_policy` `forex-bot-<env>-secrets-read` granting `secretsmanager:GetSecretValue` on the secret ARN.
- **Outputs**: `secret_arn`, `read_policy_arn`.

### `modules/ecr`
- **Inputs**: `env`, `apps` (list of strings).
- **Resources**: per app:
  - `aws_ecr_repository` `forex-bot/<env>/<app>` with `image_scanning_configuration { scan_on_push = true }`.
  - `aws_ecr_lifecycle_policy`: keep last 10 tagged images; expire untagged after 7 days.
- **Outputs**: `repo_urls` (map app → `<account>.dkr.ecr.eu-west-2.amazonaws.com/forex-bot/<env>/<app>`), `repo_arns`.

### `modules/ci-oidc`
- **Inputs**: `env`, `github_org`, `github_repo`, `branch_filter` (`refs/heads/main` for prod, `pull_request` for staging), `ecr_repo_arns`, `oidc_provider_arn` (from bootstrap).
- **Resources**:
  - `aws_iam_role` `forex-bot-ci-<env>` with `assume_role_policy` referencing `oidc_provider_arn` and restricting `sub` to `repo:<github_org>/<github_repo>:<branch_filter>`.
  - Inline policy with statements:
    - `ecr:Get*`, `ecr:Put*`, `ecr:Batch*` on `ecr_repo_arns`.
    - `ecs:UpdateService`, `ecs:DescribeServices` on cluster ARN (placeholder; tightened in 6c).
    - `iam:PassRole` for ECS task roles (placeholder).
    - `s3:GetObject` on (future) artifact bucket.
- **Outputs**: `ci_role_arn`.

## 5. Env composition

Each `envs/<env>/main.tf` looks roughly like:

```hcl
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.70" }
  }
  backend "s3" {
    bucket       = "forex-bot-tfstate-prod"   # staging: -staging
    key          = "infra/main.tfstate"
    region       = "eu-west-2"
    encrypt      = true
    use_lockfile = true
  }
}

provider "aws" {
  region = "eu-west-2"
  default_tags { tags = local.common_tags }
}

module "network" { source = "../../modules/network" env = var.env ... }
module "secrets" { source = "../../modules/secrets" env = var.env }
module "data"    { source = "../../modules/data"    env = var.env  subnet_ids = module.network.public_subnet_ids  data_sg_id = module.network.data_sg_id  db_password = random_password.db.result }
module "ecr"     { source = "../../modules/ecr"     env = var.env  apps = local.apps }
module "ci_oidc" { source = "../../modules/ci-oidc" env = var.env  github_org = var.github_org  github_repo = var.github_repo  branch_filter = var.branch_filter  ecr_repo_arns = values(module.ecr.repo_arns) }
```

`shared/tags.tf`:
```hcl
locals {
  common_tags = {
    Project     = "forex-bot"
    Environment = var.env
    ManagedBy   = "terraform"
    Repo        = "github.com/<org>/forex-bot"
  }
}
```

**Naming convention**: every named resource is `forex-bot-<env>-<resource-name>`. Coexists with other resources in the shared account.

## 6. Bootstrap

`bootstrap/main.tf` uses **local state** (`.tfstate` `.gitignored`). Creates account-global resources that must exist before per-env applies:

- Two S3 buckets — `forex-bot-tfstate-prod`, `forex-bot-tfstate-staging`. Versioning, AES256 encryption, public-access-block all-on, lifecycle to expire noncurrent versions after 90 days.
- One `aws_iam_openid_connect_provider` for `https://token.actions.githubusercontent.com`. Account-global (one per AWS account), referenced by both env stacks via input variable `oidc_provider_arn`.

Outputs: `oidc_provider_arn`, `state_bucket_prod`, `state_bucket_staging`. Operator copies `oidc_provider_arn` into `envs/<env>/terraform.tfvars` after bootstrap apply.

Run once per account; loss of bootstrap state is acceptable (re-runnable, idempotent on `aws_s3_bucket` with `import` if needed; OIDC provider re-imports cleanly).

## 7. Testing & validation

- `terraform fmt -check -recursive` in CI (new GH Actions job).
- `terraform validate` per env in CI.
- `tflint` (Plan 6a-bonus, optional): basic lint.
- `tfsec` or `checkov`: security scan for misconfig (public S3, open SGs, etc.). Must pass.
- No `terraform apply` in CI for v1. Apply manually from operator laptop with AWS profile / SSO.
- Smoke checklist (post-apply):
  - `aws rds describe-db-instances --db-instance-identifier forex-bot-prod-rds`
  - `aws elasticache describe-cache-clusters --cache-cluster-id forex-bot-prod-redis`
  - `aws ecr describe-repositories --repository-names forex-bot/prod/agent-runner`
  - `aws secretsmanager describe-secret --secret-id forex-bot/prod/secrets`
  - `aws iam get-role --role-name forex-bot-ci-prod`

## 8. Cost estimate (prod, eu-west-2, before workloads)

| Item | Monthly |
|------|---------|
| RDS db.t4g.micro + 20GB gp3 + 1d backup | ~$15 |
| ElastiCache cache.t4g.micro 1 node | ~$11 |
| DynamoDB on-demand (low volume) | ~$1 |
| VPC + subnets + gateway endpoints + SGs | $0 |
| Secrets Manager (1 secret) | $0.40 |
| ECR (6 repos, < 10GB total) | ~$1 |
| IAM, OIDC | $0 |
| **Prod total** | **~$28** |
| Staging same | ~$28 |
| **Combined** | **~$56/mo before ECS workloads** |

Workloads (paper-runner Fargate task always-on) added in Plan 6c.

## 9. Open items / risks

- **Sidecar deploy choreography (Wine + portable MT5 + Python-on-Windows + auto-login)** is the hardest unsolved problem. Out of scope for 6a but blocks live trading. Plan 6b owns it.
- **NAT-less networking** means task egress over public IPs. SG egress is wide-open by default; tighten in 6c (per-app egress allowlists if broker server IPs are stable).
- **Bootstrap state local** — loss = re-import S3 buckets manually. Acceptable.
- **Secret values populated manually** — operator must `aws secretsmanager put-secret-value` after first apply. Document in `infra/terraform/README.md`.
- **OIDC trust policy `branch_filter`** — staging-on-PR is permissive (any PR can deploy to staging). Acceptable for v1; tighten via PR-author allowlist in Plan 7.
- **No deletion protection on RDS in v1** — `terraform destroy` will wipe the DB. Operator must enable manually pre-prod.

## 10. Acceptance criteria

- [ ] `terraform fmt -check -recursive` passes.
- [ ] `terraform validate` passes for both envs.
- [ ] `tfsec` (or chosen scanner) passes.
- [ ] Bootstrap apply creates both state buckets.
- [ ] `envs/staging` apply succeeds end-to-end.
- [ ] `envs/prod` apply succeeds end-to-end.
- [ ] All resources tagged `Project=forex-bot`, `Environment=<env>`, `ManagedBy=terraform`.
- [ ] GH Actions OIDC role assumable from a test workflow.
- [ ] RDS reachable from a temporary Fargate task in `app-sg`; ElastiCache same.
- [ ] Secrets Manager secret exists with placeholder JSON.
- [ ] All ECR repos created.
- [ ] Cost matches estimate within ±20%.
