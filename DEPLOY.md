# forex-bot — Deployment Guide

End-to-end runbook from empty AWS account to live `agent-runner`. Combines Plans 6a (IaC base), 6b (sidecar scaffold), 6c (apps), 6f (broker-provider plugin + MetaApi).

For per-step Terraform commands, see `infra/terraform/README.md`. This guide is the lane-marking on top.

## Topology

```
                      AWS account (eu-west-2)
   ┌──────────────────────────────────────────────────────────────────┐
   │ VPC (10.0.0.0/16 prod | 10.1.0.0/16 staging)                     │
   │ 2 public subnets, no NAT, public IPs on tasks                    │
   │                                                                  │
   │ ECS Fargate cluster — forex-bot-<env>-cluster                    │
   │ Service Connect namespace — forex-bot-<env>.local                │
   │   ┌─────────────────────────┐  ┌──────────────────────────────┐  │
   │   │ mt5-sidecar (Python)    │◄─┤ agent-runner (prod)          │  │
   │   │ BROKER_PROVIDER=metaapi │  │ paper-runner (staging)       │  │
   │   │ gRPC :50051             │  │ → sidecar via SC DNS         │  │
   │   └─────────┬───────────────┘  └──────────────────────────────┘  │
   │             │ REST + WebSocket               │                   │
   │             ▼                                ▼                   │
   │   metaapi.cloud (London region)    ElastiCache Redis             │
   │             │                       RDS Postgres (pgvector)      │
   │             │                       DynamoDB (journal+kill-switch)│
   │             ▼                       Secrets Manager (one blob)   │
   │     broker MT5 server                                            │
   │     (broker-side)                                                │
   └──────────────────────────────────────────────────────────────────┘
                                 │
                                 ▼
                       Anthropic API (public)
```

Per env: 1 cluster, 2 services. Prod runs `agent-runner`, staging runs `paper-runner`.

**Sidecar provider** is pluggable via `BROKER_PROVIDER` env var: `metaapi` (default, prod), `fake` (safe-mode / rollback), `mt5` (legacy Wine path — not in v1 prod image). Provider selected at boot; gRPC contract unchanged.

## Cost (steady-state)

| Tier | Per env | Combined (prod+staging) |
|------|---------|-------------------------|
| 6a base (RDS+Redis+DDB+ECR+Secrets) | ~$28 | ~$56 |
| 6b/6f sidecar (Fargate 1vCPU/2GB — downsize candidate post-6f) | ~$31 | ~$62 |
| 6c app (Fargate 0.5vCPU/1GB) | ~$15 | ~$30 |
| 6f MetaApi PAYG | ~$20-40 | ~$40-80 |
| **Total** | **~$94-114** | **~$188-228/mo** |

Plus Anthropic LLM spend (variable; budget cap on paper-runner = `PAPER_BUDGET_USD`). MetaApi sidecar Fargate can be downsized to 0.5vCPU/1GB once stability proven (Plan 7 cost tuning).

## Prerequisites

**Local tools**:
- `terraform` ≥ 1.10 (`brew install terraform`)
- `aws` CLI v2 (`brew install awscli`), authed via SSO or access keys with admin on the target account
- `gh` CLI (`brew install gh`), authed against the GitHub repo
- `docker` (Desktop, OrbStack, or Linux daemon)
- `pnpm` 9.12 (`corepack enable && corepack prepare pnpm@9.12.0 --activate`)
- Node 20.11+
- Python 3.12 + `uv` (only if running `mt5-sidecar` tests locally)

**AWS account**:
- Existing account ID — copy to `infra/terraform/envs/<env>/terraform.tfvars` and GitHub repo variable.
- IAM user/role with admin perms (for first apply only). After bootstrap, OIDC role does the rest.

**GitHub repo settings** (operator one-time):
- Settings → Variables → Actions → Repository → New variable: `AWS_ACCOUNT_ID = <12-digit account ID>`.
- Settings → Secrets → Actions: nothing required (OIDC).

**Broker account**:
- Pick broker (IC Markets / Pepperstone / FP Markets / Tickmill — see `prd/specs/...`). Open **demo** for staging + **live** for prod (same broker = simpler).
- Capture per env: MT5 login (numeric), MT5 server name (e.g. `ICMarketsSC-Demo`), MT5 password.
- Confirm broker permits API/Expert Advisor trading on the live account.

**MetaApi.cloud account** (default provider since Plan 6f):
- Sign up at https://metaapi.cloud (free tier suffices for staging).
- Per env: register your MT5 account in the MetaApi dashboard. Capture:
  - `METAAPI_TOKEN` (single token per account; bottom of dashboard).
  - `METAAPI_ACCOUNT_ID` (UUID assigned to the registered MT5 account).
- Region: `london` is the default; verify your broker server's MT5 region is close.
- PAYG billing — primary cost driver is tick-stream subscriptions. Monitor via MetaApi dashboard.

**Anthropic**:
- API key from https://console.anthropic.com.
- Same key may be used in both envs in v1; rotate in Plan 7 hardening.

## Phase 0 — bootstrap (once per AWS account)

Creates S3 state buckets + GitHub OIDC provider. Local-state stack.

```bash
cd infra/terraform/bootstrap
terraform init
terraform apply
```

Capture outputs:
```bash
terraform output oidc_provider_arn          # → use in tfvars below
terraform output state_bucket_prod
terraform output state_bucket_staging
```

Set GitHub repo variable now: `AWS_ACCOUNT_ID = <account>`.

## Phase 1 — apply 6a + 6b + 6c per env

Two passes: staging first, prod second.

### Staging

1. Edit `infra/terraform/envs/staging/terraform.tfvars`:
   ```hcl
   github_org        = "<your-gh-org>"
   oidc_provider_arn = "<from bootstrap output>"
   repo_url          = "github.com/<your-gh-org>/forex-bot"
   ```

2. Apply:
   ```bash
   cd infra/terraform/envs/staging
   terraform init
   terraform plan -out=tfplan
   terraform apply tfplan
   ```

   Time: ~6 min. Resources: VPC + RDS (~3 min) + Redis (~2 min) + DDB + ECR + IAM + ECS cluster + sidecar service + paper-runner service.

3. Populate Secrets Manager **(must do before sidecar can serve real broker)**:
   ```bash
   DB_PASS=$(terraform output -raw db_password)
   cat > /tmp/staging-secrets.json <<EOF
   {
     "anthropicApiKey":  "sk-ant-...",
     "mt5Login":         "12345",
     "mt5Server":        "ICMarketsSC-Demo",
     "mt5Password":      "...",
     "metaApiToken":     "<from metaapi.cloud dashboard>",
     "metaApiAccountId": "<UUID of registered MT5 account>",
     "dbPassword":       "$DB_PASS"
   }
   EOF
   aws secretsmanager put-secret-value \
     --secret-id forex-bot/staging/secrets \
     --secret-string file:///tmp/staging-secrets.json
   rm /tmp/staging-secrets.json
   ```

   Notes:
   - `dbPassword` was randomly generated by Terraform. Pulling from state is fine (state is encrypted at rest).
   - `mt5*` fields are legacy — ignored when `BROKER_PROVIDER=metaapi` (the default since Plan 6f). Keep them populated for safety so flipping to `BROKER_PROVIDER=mt5` doesn't fail-fast.
   - `metaApi*` fields are **required for the default `metaapi` provider**. If absent, sidecar fails at boot with `METAAPI_TOKEN + METAAPI_ACCOUNT_ID required`.

4. **Enable `pgvector` extension on RDS** (one-time per env, post-apply):

   pgvector is in the RDS default extension allowlist for Postgres 16+ but is not a shared_preload_library — it must be enabled via SQL on the target database.

   RDS is in private subnets with no public access. Pick one of:

   **Option A (simplest, ephemeral): temporarily allow your IP through `data-sg`.**
   ```bash
   ENV=staging
   MY_IP=$(curl -s https://checkip.amazonaws.com)
   DATA_SG=$(aws ec2 describe-security-groups --filters "Name=tag:Name,Values=forex-bot-$ENV-data-sg" --query 'SecurityGroups[0].GroupId' --output text)
   aws ec2 authorize-security-group-ingress --group-id "$DATA_SG" --protocol tcp --port 5432 --cidr "$MY_IP/32"

   # AND temporarily make RDS publicly accessible (one-line TF override OR via console toggle).
   # Easier: skip Option A and use Option B.
   ```
   Caveat: `publicly_accessible = false` is set on RDS in module/data — toggling requires a TF change + apply. Operationally clunky.

   **Option B (recommended): one-shot ECS task with `postgres-client`.**
   ```bash
   ENV=staging
   PG_HOST=$(cd infra/terraform/envs/$ENV && terraform output -raw pg_endpoint)
   PG_PASS=$(aws secretsmanager get-secret-value --secret-id forex-bot/$ENV/secrets --query SecretString --output text | jq -r .dbPassword)
   CLUSTER=forex-bot-$ENV-cluster
   SUBNET=$(cd infra/terraform/envs/$ENV && terraform output -json | jq -r '.public_subnet_ids.value[0]' 2>/dev/null || aws ec2 describe-subnets --filters "Name=tag:Project,Values=forex-bot" "Name=tag:Environment,Values=$ENV" "Name=tag:Tier,Values=public" --query 'Subnets[0].SubnetId' --output text)
   APP_SG=$(aws ec2 describe-security-groups --filters "Name=tag:Name,Values=forex-bot-$ENV-app-sg" --query 'SecurityGroups[0].GroupId' --output text)

   aws ecs run-task --cluster "$CLUSTER" --launch-type FARGATE \
     --network-configuration "awsvpcConfiguration={subnets=[$SUBNET],securityGroups=[$APP_SG],assignPublicIp=ENABLED}" \
     --overrides "{\"containerOverrides\":[{\"name\":\"psql\",\"command\":[\"psql\",\"host=$PG_HOST port=5432 user=forexbot dbname=forexbot sslmode=require\",\"-c\",\"CREATE EXTENSION IF NOT EXISTS vector;\"],\"environment\":[{\"name\":\"PGPASSWORD\",\"value\":\"$PG_PASS\"}]}]}" \
     --task-definition <one-shot-psql-td>
   ```
   Requires a one-off task definition with the `postgres:16` image. Skipped wiring this in 6c — Plan 6e (`ops-cli`) will register a `forex-bot db init` subcommand that does this cleanly.

   **Option C (interim, fastest right now): `aws ecs execute-command` into a running app task and shell into it.** App images don't carry `psql` (slim base). You'd need to install on the fly, which only works while the task lives.

   **Pragmatic v1 path**: defer the `CREATE EXTENSION vector` until Plan 4's RAG store first writes are needed. Apps boot fine without it (Redis hot cache + DynamoDB journal don't depend on pgvector). Reflection agent's RAG writes will fail loudly until enabled. Track as a known gap.

   To verify it's enabled later (from any reachable client):
   ```sql
   SELECT extname, extversion FROM pg_extension WHERE extname = 'vector';
   -- Expected: vector | 0.7.x
   ```

### Prod

Repeat with `envs/prod`, real broker creds, and `MT5_DEMO=0` (already set in `module "agent_runner"` env_vars).

## Phase 2 — first image builds

After staging + prod TF applies, all 3 services exist but tasks fail health (no images yet).

```bash
gh workflow run sidecar-image.yml --ref main
# ~2-3 min on first build (Linux Python only post-Plan 6f — no Wine).
# Cached rebuilds <30s.
gh run watch
```

Sidecar image is ~211 MB. Drops from the broken 4 GB Wine attempt to a slim `python:3.11-slim` base carrying `metaapi-cloud-sdk` + `grpcio` + the generated proto stubs.

Once sidecar is `RUNNING + HEALTHY` per env:

```bash
gh workflow run apps-image.yml --ref main
# ~5 min on first build
gh run watch
```

Per app:
- staging → `paper-runner`
- prod → `agent-runner`

## Phase 3 — verification

For each env (`ENV=staging` then `ENV=prod`):

```bash
# Sidecar healthy
aws ecs describe-services --cluster forex-bot-$ENV-cluster --services forex-bot-$ENV-mt5-sidecar \
  --query 'services[0].{run:runningCount,roll:deployments[?status==`PRIMARY`].rolloutState | [0]}'
# Expected: run=1, roll=COMPLETED

aws logs tail /forex-bot/$ENV/mt5-sidecar --since 10m
# Expected:
#   "mt5-sidecar: provider=metaapi"
#   "mt5-sidecar listening on 0.0.0.0:50051"
# Followed (after MetaApi sync ~30-60s) by:
#   "MetaApi connection synchronized" — provider healthy, account reachable.

# App healthy
APP=$([[ $ENV = prod ]] && echo agent-runner || echo paper-runner)
aws ecs describe-services --cluster forex-bot-$ENV-cluster --services forex-bot-$ENV-$APP \
  --query 'services[0].{run:runningCount,roll:deployments[?status==`PRIMARY`].rolloutState | [0]}'
# Expected: run=1, roll=COMPLETED

aws logs tail /forex-bot/$ENV/$APP --since 10m
# Expected: app started log line
```

End-to-end gRPC reachability:
```bash
TASK_ARN=$(aws ecs list-tasks --cluster forex-bot-$ENV-cluster --service-name forex-bot-$ENV-$APP --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster forex-bot-$ENV-cluster --task "$TASK_ARN" --container "$APP" \
  --interactive --command "node -e \"const s=require('net').connect(50051,'mt5-sidecar',()=>{console.log('OK');s.end()});s.on('error',e=>{console.error(e.message);process.exit(1)})\""
# Expected: OK
```

## Phase 4 — operating

### Image bumps
Every push to `main` that touches `apps/<app>/**`, `mt5-sidecar/**`, `packages/**`, or shared TS configs triggers `apps-image.yml` / `sidecar-image.yml` automatically. CD does ECR push + `aws ecs update-service --force-new-deployment`.

Manual rebuild any time:
```bash
gh workflow run apps-image.yml --ref main
gh workflow run sidecar-image.yml --ref main
```

### Secret rotation (manual in v1; Plan 7 automates)
```bash
aws secretsmanager update-secret \
  --secret-id forex-bot/<env>/secrets \
  --secret-string file:///tmp/new-secrets.json
# Force task replacement so new task reads fresh secret:
aws ecs update-service --cluster forex-bot-<env>-cluster --service forex-bot-<env>-<service> --force-new-deployment
```

### Tail logs
```bash
aws logs tail /forex-bot/<env>/<service> --follow --since 30m
```

### Stop service (cost saver)
```bash
aws ecs update-service --cluster forex-bot-<env>-cluster --service forex-bot-<env>-<service> --desired-count 0
# Resume: --desired-count 1
```

### TF state changes
```bash
cd infra/terraform/envs/<env>
terraform plan -out=tfplan
terraform apply tfplan
```

`lifecycle { ignore_changes = [task_definition] }` on services means CD-driven image bumps never drift TF state. Plan output stays small after the first apply.

### Kill-switch (manual until Plan 6e ops-cli)
```bash
# Trip
aws dynamodb put-item --table-name forex-bot-<env>-kill-switch \
  --item '{"key":{"S":"global"},"tripped":{"BOOL":true},"reason":{"S":"manual kill"},"trippedAt":{"N":"'$(date +%s%3N)'"}}'

# Untrip
aws dynamodb delete-item --table-name forex-bot-<env>-kill-switch \
  --key '{"key":{"S":"global"}}'
```

(agent-runner does not yet read this on boot — Plan 6e wires the read path. v1 kill-switch is operator-only via task `desired-count = 0`.)

### Stop everything in an env
```bash
ENV=staging
for svc in forex-bot-$ENV-mt5-sidecar forex-bot-$ENV-paper-runner; do
  aws ecs update-service --cluster forex-bot-$ENV-cluster --service $svc --desired-count 0
done
```

## Phase 5 — going live

**Pre-live checklist** (manual until Plan 7):

- [ ] Secrets blob populated with **live** broker creds (not demo) in `mt5*` fields.
- [ ] Secrets blob populated with **prod** `metaApiToken` + `metaApiAccountId` (live MT5 registered with MetaApi).
- [ ] `MT5_DEMO=0` in `module.agent_runner.env_vars` (already set in `envs/prod/main.tf`).
- [ ] `terraform plan` from `envs/prod` shows zero infra drift.
- [ ] `agent-runner` task has run cleanly against demo broker via MetaApi for ≥ 1 week (paper-runner staging surrogate).
- [ ] MetaApi `synchronized=true` sustained for the soak period; reconnect frequency < 1/day.
- [ ] MetaApi region p95 latency from eu-west-2 measured < 100 ms during soak.
- [ ] Anthropic budget alarm wired (Plan 6d) — currently informational, not capping prod.
- [ ] MetaApi PAYG cost tracked (extend `BudgetTracker` per Plan 6d deferred).
- [ ] Kill-switch operator path tested (Phase 4 commands above succeed).
- [ ] Backup window for RDS (1d retention) and DynamoDB PITR confirmed.
- [ ] Anthropic + broker + MetaApi creds documented in 1Password / SSM / equivalent — NOT in Slack or git.
- [ ] Risk officer LLM tested against event-study fixtures (`apps/eval-event-study --all --mode full`).
- [ ] First trade size capped via `defaultRiskConfig` profile (`conservative` recommended for week-1).
- [ ] `BROKER_PROVIDER=fake` rollback path tested (flip tfvars, apply, sidecar accepts gRPC but rejects orders).

To enable live trading: ensure prod's secrets blob has live MT5 creds and `agent-runner` task is `RUNNING + HEALTHY`. The agent will trade per `WATCHED_SYMBOLS` schedule defined in `module "agent_runner"` env_vars. To pause, set `desired_count = 0` on the agent-runner service (does not affect sidecar).

**Hard stop conditions** (operator triggers manually until Plan 7 automates):
- Daily P&L < `-3.0%` of starting balance.
- Total drawdown > `-10.0%`.
- Three consecutive losing trades.
- Feed-stale > 60s on any tick.
- Anthropic budget overrun.

`KillSwitch` class in `packages/risk/src/kill-switch.ts` enumerates the rules; operator must monitor and trigger via Phase 4 kill-switch commands.

## Troubleshooting

- **TF apply: `state lock conflict`**: another apply is running, or a previous one died. `terraform force-unlock <lock-id>` after confirming nothing else is mid-flight.
- **Image push: `ECR no permission`**: GitHub OIDC role's ECR scope missing the new app. Re-apply env stack.
- **Task: `unable to pull image`**: image not pushed yet. Run `gh workflow run apps-image.yml`.
- **Task: `STOPPED — Essential container exited`**: read `aws logs tail /forex-bot/<env>/<svc>`. Most common: missing env var (fail-fast), broker rejected MT5 login, or Anthropic 401.
- **`Cannot resolve mt5-sidecar`**: Service Connect namespace mis-attached. `aws ecs describe-services ... --query services[0].serviceConnectConfiguration` should show non-empty namespace.
- **`METAAPI_TOKEN + METAAPI_ACCOUNT_ID required`**: secrets blob missing `metaApiToken` / `metaApiAccountId` keys (or task started before the update). Update secret + force-new-deployment on the sidecar.
- **Sidecar logs `synchronized=False` >60s**: MetaApi can't reach broker. Check MetaApi dashboard (account deployed? broker server up? account expired?). Test with the MetaApi web SDK from your laptop to isolate.
- **MetaApi PAYG cost spike**: tick-stream subscribes dominate. Inspect MetaApi dashboard cost breakdown. Trim symbols in `WATCHED_SYMBOLS` or exclude symbols server-side via the MetaApi dashboard.
- **Sidecar healthcheck fails after broker maintenance**: watchdog reconnect-or-die (Plan 6b §5.3) usually self-heals within 60s; if not, force-new-deployment on the sidecar.
- **Need to fall back to a non-MetaApi path**: flip `broker_provider = "fake"` in `terraform.tfvars` + apply. Sidecar accepts gRPC but rejects orders cleanly. agent-runner pauses without crashing. See `infra/terraform/README.md` "Broker-provider switching".
- **DynamoDB `AccessDeniedException`**: task role missing journal-rw / killswitch-rw. `aws iam list-attached-role-policies --role-name forex-bot-<env>-<app>-task` should show both.
- **High Anthropic spend on paper-runner**: `BudgetTracker` trips when `PAPER_BUDGET_USD` is reached and stops issuing LLM calls. Investigate via CW logs.
- **`docker buildx ... wineboot: could not load kernel32.dll` on macOS**: known QEMU emulation issue. Build on a Linux x86_64 host or rely on CI.

## What's not in this guide

- **CloudWatch dashboards / alerts + MetaApi cost tracking in `BudgetTracker`** — Plan 6d.
- **`forex-bot db init` for pgvector + `forex-bot kill-switch` + reconcile** — Plan 6e ops-cli.
- **Auto kill-switch + canary deploy** — Plan 7.
- **Auto secret rotation (incl. MetaApi token rotation)** — Plan 7.
- **`data-ingest` deployment** — needs `main.ts` first; future plan.
- **Multi-region failover (incl. MetaApi region failover)** — Plan 7+.
- **`Mt5LinuxProvider`** (gmag11 image + RPyC) — deferred unless MetaApi proves unsuitable.

## References

- `infra/terraform/README.md` — per-step TF command reference + provider switching.
- `prd/specs/2026-05-03-forex-bot-infra-base-design.md` — 6a design.
- `prd/specs/2026-05-06-forex-bot-sidecar-deploy-design.md` — 6b design (legacy Wine path).
- `prd/specs/2026-05-08-forex-bot-app-deploy-design.md` — 6c design.
- `prd/specs/2026-05-12-forex-bot-broker-provider-design.md` — 6f design (provider plugin + MetaApi).
- `prd/2026-04-21-forex-bot-design.md` — overall architecture.
- `README.md` — per-plan status table.

## Phase 6 — broker-provider switching (Plan 6f)

The sidecar provider is set via `BROKER_PROVIDER` env var, plumbed through
the Terraform `module.sidecar.broker_provider` variable. Valid values:

| Provider | Purpose | Default location |
|----------|---------|------------------|
| `metaapi` | Production. Talks to metaapi.cloud REST/WebSocket. | Both envs (default). |
| `fake` | Safe-mode / rollback. gRPC stays up; orders are rejected cleanly. | None. |
| `mt5` | Legacy native MT5 SDK path. Requires Wine + MetaTrader5 pkg. Not deployable in the v1 prod image. | None. |

Initial creds population is part of Phase 1. This phase documents **runtime
switches** + **rotation** + **troubleshooting**.

### Update MetaApi creds (rotation or initial fill)

```bash
ENV=staging   # then repeat for prod
DB_PASS=$(cd infra/terraform/envs/$ENV && terraform output -raw db_password)
cat > /tmp/$ENV-secrets.json <<JSON
{
  "anthropicApiKey":  "sk-ant-...",
  "mt5Login":         "12345",
  "mt5Server":        "ICMarketsSC-Demo",
  "mt5Password":      "...",
  "metaApiToken":     "<from metaapi.cloud dashboard>",
  "metaApiAccountId": "<UUID of registered MT5 account>",
  "dbPassword":       "$DB_PASS"
}
JSON
aws secretsmanager put-secret-value \
  --secret-id forex-bot/$ENV/secrets \
  --secret-string file:///tmp/$ENV-secrets.json
rm /tmp/$ENV-secrets.json

# Force the sidecar task to pick up the new secrets
aws ecs update-service \
  --cluster forex-bot-$ENV-cluster \
  --service forex-bot-$ENV-mt5-sidecar \
  --force-new-deployment
```

### Switching provider at runtime (no image rebuild)

```bash
ENV=staging
PROVIDER=fake     # or: metaapi, mt5

# 1. Flip the tfvar
grep -q '^broker_provider' infra/terraform/envs/$ENV/terraform.tfvars \
  && sed -i '' "s/^broker_provider.*/broker_provider = \"$PROVIDER\"/" infra/terraform/envs/$ENV/terraform.tfvars \
  || echo "broker_provider = \"$PROVIDER\"" >> infra/terraform/envs/$ENV/terraform.tfvars

# 2. Apply — updates the task def revision; ECS rolling redeploys.
cd infra/terraform/envs/$ENV
terraform plan -out=tfplan
terraform apply tfplan

# 3. Verify
aws logs tail /forex-bot/$ENV/mt5-sidecar --since 5m
# Expect: "mt5-sidecar: provider=<PROVIDER>"
```

Full reference + edge cases: `infra/terraform/README.md` → "Broker-provider switching".

### Local sidecar testing (no AWS)

```bash
# Fake provider — no creds, no network
docker run --rm -e BROKER_PROVIDER=fake \
  -p 50099:50051 \
  $(aws ecr describe-repositories --repository-names forex-bot/staging/mt5-sidecar --query 'repositories[0].repositoryUri' --output text):latest

# Test gRPC reachability from another shell
grpcurl -plaintext localhost:50099 grpc.health.v1.Health/Check
# Expected: {"status": "SERVING"}
```

Or against a local build:
```bash
docker buildx build --platform linux/amd64 -f mt5-sidecar/Dockerfile -t forex-bot/mt5-sidecar:smoke .
docker run --rm -e BROKER_PROVIDER=fake -p 50099:50051 forex-bot/mt5-sidecar:smoke
```
