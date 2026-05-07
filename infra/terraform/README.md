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
