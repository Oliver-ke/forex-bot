# forex-bot — Deployment Guide

End-to-end runbook from empty AWS account to live `agent-runner`. Combines Plans 6a (IaC base), 6b (sidecar), 6c (apps).

For per-step Terraform commands, see `infra/terraform/README.md`. This guide is the lane-marking on top.

## Topology

```
                      AWS account (eu-west-2)
   ┌─────────────────────────────────────────────────────────────┐
   │ VPC (10.0.0.0/16 prod | 10.1.0.0/16 staging)                │
   │ 2 public subnets, no NAT, public IPs on tasks               │
   │                                                             │
   │ ECS Fargate cluster — forex-bot-<env>-cluster               │
   │ Service Connect namespace — forex-bot-<env>.local           │
   │   ┌─────────────────────┐  ┌──────────────────────────────┐ │
   │   │ mt5-sidecar         │◄─┤ agent-runner (prod)          │ │
   │   │ Wine + MT5 portable │  │ paper-runner (staging)       │ │
   │   │ gRPC :50051         │  │ → broker MT5 via SC DNS      │ │
   │   └─────────┬───────────┘  └──────────────────────────────┘ │
   │             │                              │                │
   │             ▼                              ▼                │
   │     broker MT5 server          ElastiCache Redis            │
   │     (public internet)          RDS Postgres (pgvector)      │
   │                                DynamoDB (journal+kill-switch)│
   │                                Secrets Manager (one blob)   │
   └─────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    Anthropic API (public)
```

Per env: 1 cluster, 2 services. Prod runs `agent-runner`, staging runs `paper-runner`.

## Cost (steady-state)

| Tier | Per env | Combined (prod+staging) |
|------|---------|-------------------------|
| 6a base (RDS+Redis+DDB+ECR+Secrets) | ~$28 | ~$56 |
| 6b sidecar (Fargate 1vCPU/2GB) | ~$31 | ~$62 |
| 6c app (Fargate 0.5vCPU/1GB) | ~$15 | ~$30 |
| **Total** | **~$74** | **~$148/mo** |

Plus Anthropic LLM spend (variable; budget cap on paper-runner = `PAPER_BUDGET_USD`).

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

3. Populate Secrets Manager **(must do before any image build)**:
   ```bash
   cat > /tmp/staging-secrets.json <<EOF
   {
     "anthropicApiKey": "sk-ant-...",
     "mt5Login":        "12345",
     "mt5Server":       "ICMarketsSC-Demo",
     "mt5Password":     "...",
     "dbPassword":      "$(terraform output -raw db_password 2>/dev/null || echo 'CHECK STATE')"
   }
   EOF
   aws secretsmanager put-secret-value \
     --secret-id forex-bot/staging/secrets \
     --secret-string file:///tmp/staging-secrets.json
   rm /tmp/staging-secrets.json
   ```

   `dbPassword` was randomly generated by Terraform. Leave it as-is — pulling it from state is fine since the state itself is encrypted at rest.

### Prod

Repeat with `envs/prod`, real broker creds, and `MT5_DEMO=0` (already set in `module "agent_runner"` env_vars).

## Phase 2 — first image builds

After staging + prod TF applies, all 3 services exist but tasks fail health (no images yet).

```bash
gh workflow run sidecar-image.yml --ref main
# Wait ~10 min on first build (Wine + MT5 portable layers dominate)
gh run watch
```

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
# Expected: "mt5-sidecar listening on 0.0.0.0:50051" + a successful account_info call

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

- [ ] Secrets blob populated with **live** broker creds (not demo).
- [ ] `MT5_DEMO=0` in `module.agent_runner.env_vars` (already set in `envs/prod/main.tf`).
- [ ] `terraform plan` from `envs/prod` shows zero infra drift.
- [ ] `agent-runner` task has run cleanly against demo broker for ≥ 1 week (paper-runner staging surrogate).
- [ ] Anthropic budget alarm wired (Plan 6d) — currently informational, not capping prod.
- [ ] Kill-switch operator path tested (Phase 4 commands above succeed).
- [ ] Backup window for RDS (1d retention) and DynamoDB PITR confirmed.
- [ ] Anthropic + broker creds documented in 1Password / SSM / equivalent — NOT in Slack or git.
- [ ] Risk officer LLM tested against event-study fixtures (`apps/eval-event-study --all --mode full`).
- [ ] First trade size capped via `defaultRiskConfig` profile (`conservative` recommended for week-1).

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
- **`MT5 initialize() failed`**: sidecar's MT5 creds wrong. Update Secrets Manager + force-new-deployment on the sidecar service.
- **Sidecar healthcheck fails after MT5 server maintenance**: watchdog restart-or-die (Plan 6b §5.3) usually self-heals; if not, force-new-deployment.
- **DynamoDB `AccessDeniedException`**: task role missing journal-rw / killswitch-rw. `aws iam list-attached-role-policies --role-name forex-bot-<env>-<app>-task` should show both.
- **High Anthropic spend on paper-runner**: `BudgetTracker` trips when `PAPER_BUDGET_USD` is reached and stops issuing LLM calls. Investigate via CW logs.
- **`docker buildx ... wineboot: could not load kernel32.dll` on macOS**: known QEMU emulation issue. Build on a Linux x86_64 host or rely on CI.

## What's not in this guide

- **CloudWatch dashboards / alerts** — Plan 6d.
- **Auto kill-switch + canary deploy** — Plan 7.
- **Auto secret rotation** — Plan 7.
- **`data-ingest` deployment** — needs `main.ts` first; future plan.
- **Multi-region failover** — out of scope until Plan 7+.

## References

- `infra/terraform/README.md` — per-step TF command reference.
- `prd/specs/2026-05-03-forex-bot-infra-base-design.md` — 6a design.
- `prd/specs/2026-05-06-forex-bot-sidecar-deploy-design.md` — 6b design.
- `prd/specs/2026-05-08-forex-bot-app-deploy-design.md` — 6c design.
- `prd/2026-04-21-forex-bot-design.md` — overall architecture.
- `README.md` — per-plan status table.
