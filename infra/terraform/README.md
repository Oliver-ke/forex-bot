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

## Sidecar deploy (Plan 6b)

Adds the MT5 gRPC sidecar as an ECS Fargate service. Runs Wine + Python-on-Windows
+ portable MT5 inside one container. See
`prd/specs/2026-05-06-forex-bot-sidecar-deploy-design.md` for full design.

### Pre-conditions
1. Plan 6a applied; both envs healthy.
2. Secrets Manager blob populated with real MT5 creds:
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id forex-bot/staging/secrets \
     --secret-string file://staging-secrets.json
   ```
   JSON shape:
   ```json
   {
     "anthropicApiKey": "sk-ant-...",
     "mt5Login":        "12345",
     "mt5Server":       "ICMarketsSC-Demo",
     "mt5Password":     "...",
     "dbPassword":      "<keep value from terraform output>"
   }
   ```
3. GitHub repo variable `AWS_ACCOUNT_ID` set under repo → Settings → Variables → Actions.

### First TF apply
```bash
cd infra/terraform/envs/staging
terraform init -upgrade
terraform plan -out=tfplan
terraform apply tfplan
```
The ECS service spawns immediately; the first task fails health (no image yet). **Expected.**

### First image build
```bash
gh workflow run sidecar-image.yml --ref main
```
Approx 8–12 min on first build. Pushes `:<sha>` and `:latest` tags, then forces an ECS redeploy.

### Verify
```bash
ENV=staging
aws ecs describe-services \
  --cluster forex-bot-$ENV-cluster \
  --services forex-bot-$ENV-mt5-sidecar \
  --query 'services[0].{running: runningCount, desired: desiredCount, primary: deployments[?status==`PRIMARY`].rolloutState | [0]}'
# Expected: running=1, desired=1, primary=COMPLETED

aws logs tail /forex-bot/$ENV/mt5-sidecar --since 5m
# Expected log line: "mt5-sidecar listening on 0.0.0.0:50051"
```

### End-to-end gRPC smoke (operator)
Run a temporary debug task in `app-sg` and `grpcurl` the sidecar's task IP:
```bash
TASK_IP=$(aws ecs describe-tasks \
  --cluster forex-bot-$ENV-cluster \
  --tasks $(aws ecs list-tasks --cluster forex-bot-$ENV-cluster --service-name forex-bot-$ENV-mt5-sidecar --query 'taskArns[0]' --output text) \
  --query 'tasks[0].attachments[0].details[?name==`privateIPv4Address`].value | [0]' \
  --output text)

# from any task in app-sg:
grpcurl -plaintext "$TASK_IP:50051" forex_bot.mt5.MT5/GetAccount
# Expected: a real broker AccountResponse JSON
```

### Troubleshooting

- **Local `docker build` on macOS fails at `wineboot --init` with `could not load kernel32.dll`**: known issue when building `linux/amd64` via QEMU emulation on darwin. Wine prefix init is unreliable under emulation. Fix: build on a native Linux x86_64 host (CI runner, EC2, Linux dev box). The `xauth` apt dep is required for `xvfb-run` and is already in the Dockerfile.
- **Task fails to pull image**: check `forex-bot-$ENV-ci` role has `ecr:GetAuthorizationToken`; verify image tag exists in ECR.
- **Task starts but health probe fails**: tail CloudWatch logs; common causes: bad `MT5_SERVER` value, broker server is in maintenance, MT5 portable binary couldn't reach broker (broker IP firewall on this AWS region).
- **Reconnect loop is hot**: the broker is dropping mid-tick. Check broker's status page; verify your account isn't expired.
- **`aws ecs execute-command` fails**: the Wine+Python-Win container may not have `amazon-ssm-agent`. Fall back to log tailing.

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
