# Plan 6c — App deploy (design spec)

> Sub-plan of Plan 6 (Infra & Ops). Scope: deploy `agent-runner` (prod-only) and
> `paper-runner` (staging-only) to ECS Fargate. Depends on Plan 6a (IaC base)
> and Plan 6b (sidecar deploy). Sibling sub-plans: 6d (observability), 6e (ops-cli).

## 1. Goal & non-goals

**Goal.** Ship `agent-runner` and `paper-runner` as ECS Fargate services. Add per-app Dockerfiles + a generic Terraform `modules/app` + Service Connect for sidecar reachability. Wire `apps-image.yml` GitHub Actions workflow that builds, pushes, and forces ECS redeploys on push to `main`. Reuse 6a infra unchanged; cluster module gains Service Connect default config; data module gains DynamoDB R/W IAM policies for the trade-journal + kill-switch tables.

**Non-goals.**
- `data-ingest` deploy — deferred (no `main.ts` entrypoint exists). Future plan.
- CloudWatch dashboards / SNS alarms — Plan 6d.
- ops-cli (kill-switch, reconcile, RAG backfill) — Plan 6e.
- Canary / blue-green / manual approval — Plan 7.
- Per-app autoscaling — `desired_count = 1` per service.
- Persistent paper-runner output bucket — accept ephemeral; daily snapshot lands in CW Logs for now.
- App code changes beyond what is needed to import existing `main.ts` modules — no new features.
- DynamoDB kill-switch read-at-boot — stub; landing in Plan 6e.

## 2. Decisions adopted

| # | Decision | Choice |
|---|----------|--------|
| 1 | App ↔ env mapping | `agent-runner` → prod only; `paper-runner` → staging only. |
| 2 | Service discovery | ECS Service Connect (namespace `forex-bot-<env>.local`). |
| 3 | CI shape | One workflow file (`apps-image.yml`), one job per app. |
| 4 | Dockerfile shape | Per-app Dockerfile (`apps/<app>/Dockerfile`), build context = repo root. |
| 5 | Sizing | 0.5 vCPU / 1 GB per app, Fargate, 24×7. ~$15/mo each. |
| 6 | Per-app IAM task roles | One per app, attached to `journal-rw` + `killswitch-rw` (both apps need DDB), plus the existing `secrets-read` from 6a. |
| 7 | data-ingest scope | Dropped from this plan — no entrypoint exists yet. |

## 3. Architecture

```
                 GitHub push to main
                         │
                         ▼
       .github/workflows/apps-image.yml
                         │
        OIDC → forex-bot-<env>-ci role (6a)
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  docker build       ECR push         ECS update-service
  per-app            :sha + :latest   --force-new-deployment

                         │
                         ▼
   ┌──────────────────────────────────────────────────────────────┐
   │ ECS Fargate cluster — forex-bot-<env>-cluster (6b)           │
   │ Service Connect namespace: forex-bot-<env>.local             │
   │                                                              │
   │ ┌────────────────────────┐    ┌────────────────────────────┐ │
   │ │ mt5-sidecar (6b)       │    │ agent-runner (prod) OR     │ │
   │ │ SC name: mt5-sidecar   │◄───┤ paper-runner (staging)     │ │
   │ │ port: 50051            │    │                            │ │
   │ │ pulls MT5 creds from   │    │ ENV: MT5_HOST=mt5-sidecar  │ │
   │ │ secrets blob (6b wiring)│    │      MT5_PORT=50051        │ │
   │ └────────────────────────┘    │      REDIS_URL=<EC>        │ │
   │                                │      ANTHROPIC_API_KEY     │ │
   │                                │       (valueFrom secret)   │ │
   │                                └────────────────────────────┘ │
   │                                          │                    │
   │                                          ▼                    │
   │                              ElastiCache Redis (6a)          │
   │                              RDS Postgres (6a)                │
   │                              DynamoDB tables (6a)             │
   └──────────────────────────────────────────────────────────────┘
                                              │
                                              ▼
                                  Anthropic API (public internet)
```

Topology per env:
- prod: 2 services (`mt5-sidecar` + `agent-runner`).
- staging: 2 services (`mt5-sidecar` + `paper-runner`).

## 4. File layout

```
forex-bot/
├── .github/workflows/
│   ├── apps-image.yml               # NEW: per-app build + push + redeploy
│   └── infra.yml                    # MODIFIED: add app-build matrix smoke job
├── apps/
│   ├── agent-runner/Dockerfile      # NEW
│   └── paper-runner/Dockerfile      # NEW
└── infra/terraform/
    ├── modules/
    │   ├── cluster/                 # MODIFIED: + service_connect namespace + cluster default
    │   ├── data/                    # MODIFIED: + journal-rw + killswitch-rw IAM policies
    │   ├── sidecar/                 # MODIFIED: register in SC namespace
    │   └── app/                     # NEW: generic ECS service module for TS app daemons
    │       ├── main.tf
    │       ├── outputs.tf
    │       ├── variables.tf
    │       └── versions.tf
    └── envs/
        ├── prod/main.tf             # MODIFIED: + module "agent_runner"
        ├── prod/outputs.tf          # MODIFIED: + agent-runner outputs
        ├── staging/main.tf          # MODIFIED: + module "paper_runner"
        └── staging/outputs.tf       # MODIFIED: + paper-runner outputs
```

## 5. Per-app Dockerfile

`apps/agent-runner/Dockerfile` (paper-runner identical with paths swapped):

```dockerfile
# agent-runner — Node 20 + pnpm + tsx; runs apps/agent-runner/src/main.ts
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
ENTRYPOINT ["pnpm", "dlx", "tsx", "apps/agent-runner/src/main.ts"]
```

Image size estimate: 600–800 MB. Cache-friendly: layer changes only when `pnpm-lock.yaml` or `packages/**` changes. App-only edits hit the `final` stage.

`tsx` must resolve at runtime. If it's not already a workspace dev dep, add `pnpm add -D -w tsx@^4` and commit before the first build (verify in Task 6 smoke).

## 6. Terraform module — `modules/app`

Generic. Same module deploys agent-runner OR paper-runner OR future TS app daemons. Differences flow through input variables.

### Inputs
- `env`, `app_name` (e.g. `agent-runner`).
- `cluster_arn`, `task_execution_role_arn` (from 6b cluster).
- `service_connect_namespace_arn` (from cluster module — added in 6c).
- `vpc_subnet_ids`, `app_sg_id` (from 6a network).
- `ecr_repo_url`, `image_tag` (default `"latest"`).
- `cpu` (string, default `"512"`), `memory` (string, default `"1024"`).
- `secret_arn` (Secrets Manager blob from 6a).
- `secret_keys` (`list(object({ env_name = string, json_key = string }))` — declares which secret-blob fields to inject as env vars).
- `env_vars` (`map(string)` — plain-text env vars).
- `extra_iam_policy_arns` (`list(string)` — attached to task role; e.g. journal-rw + killswitch-rw).
- `desired_count` (default `1`).
- `enable_execute_command` (default `true`).
- `common_tags`.

### Resources
- `aws_cloudwatch_log_group` `/forex-bot/<env>/<app_name>`, retention 14 days.
- `aws_iam_role` `forex-bot-<env>-<app_name>-task` (ECS trust).
- `aws_iam_role_policy_attachment` × N — secrets-read (always; 6a) + each `extra_iam_policy_arn`.
- `aws_ecs_task_definition`:
  - Family `forex-bot-<env>-<app_name>`.
  - `network_mode = "awsvpc"`, `requires_compatibilities = ["FARGATE"]`.
  - `cpu`, `memory` from inputs.
  - `runtime_platform { operating_system_family = "LINUX", cpu_architecture = "X86_64" }`.
  - Single container `<app_name>`:
    - `image = "${ecr_repo_url}:${image_tag}"`.
    - No `portMappings` (apps are clients).
    - `environment = [for k, v in var.env_vars : { name = k, value = v }]`.
    - `secrets = [for s in var.secret_keys : { name = s.env_name, valueFrom = "${var.secret_arn}:${s.json_key}::" }]`.
    - `logConfiguration` → log group above; `awslogs-stream-prefix = <app_name>`.
- `aws_ecs_service`:
  - Name `forex-bot-<env>-<app_name>`.
  - `cluster = cluster_arn`. `task_definition = task_def.arn`.
  - Launch type FARGATE. `desired_count`. `enable_execute_command`.
  - `network_configuration { subnets, security_groups = [app_sg_id], assign_public_ip = true }`.
  - `service_connect_configuration { enabled = true, namespace = service_connect_namespace_arn }` — pure consumer, no `service` sub-block.
  - `deployment_minimum_healthy_percent = 0`, `deployment_maximum_percent = 100`.
  - `lifecycle { ignore_changes = [task_definition] }` — CD does `--force-new-deployment`.

### Outputs
- `service_name`, `task_role_arn`, `task_definition_arn`, `log_group_name`.

## 7. Cluster + sidecar + data module amendments

### `modules/cluster` (additive)
- `aws_service_discovery_http_namespace` named `forex-bot-<env>.local`.
- `aws_ecs_cluster.main` gains:
  ```hcl
  service_connect_defaults { namespace = aws_service_discovery_http_namespace.main.arn }
  ```
- New output: `service_connect_namespace_arn`.

### `modules/sidecar` (additive)
- New input: `service_connect_namespace_arn`.
- Task definition's `portMappings` entry gains `name = "grpc"`.
- ECS service gains:
  ```hcl
  service_connect_configuration {
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
  ```

### `modules/data` (additive)
- `aws_iam_policy` `forex-bot-<env>-trade-journal-rw` — `dynamodb:GetItem/PutItem/UpdateItem/DeleteItem/Query/Scan` on `aws_dynamodb_table.trade_journal.arn`.
- `aws_iam_policy` `forex-bot-<env>-killswitch-rw` — same actions on `aws_dynamodb_table.kill_switch.arn`.
- New outputs: `journal_rw_policy_arn`, `killswitch_rw_policy_arn`.

## 8. Env composition wiring

### `envs/prod/main.tf` (append)

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

### `envs/staging/main.tf` (append)

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

**Hard scope guard**: prod has no `paper_runner` block; staging has no `agent_runner` block. `terraform apply` in the wrong env can never accidentally spawn the wrong service.

`outputs.tf` per env appends `app_service_name`, `app_task_role_arn`, `app_log_group_name` (referencing `module.agent_runner.*` in prod, `module.paper_runner.*` in staging).

## 9. CI: `apps-image.yml`

Triggers on push to `main` with paths covering `apps/{agent,paper}-runner/**`, `packages/**`, `pnpm-lock.yaml`, `package.json`, `tsconfig.base.json`, the workflow file itself, plus `workflow_dispatch` for manual rebuilds.

Two top-level jobs (one per app), no matrix:

- **`agent-runner`** job — assumes `forex-bot-prod-ci` role, builds `apps/agent-runner/Dockerfile`, pushes to ECR `forex-bot/prod/agent-runner:<sha>` + `:latest`, runs `aws ecs update-service --force-new-deployment`, waits stable.
- **`paper-runner`** job — same shape against staging.

`permissions: { id-token: write, contents: read }`.

Build step uses `docker/build-push-action@v6` with `cache-from: type=gha,scope=<app>` + `cache-to: type=gha,mode=max,scope=<app>`.

`infra.yml` gains a matrix `app-build` job that runs `docker/build-push-action@v6` with `push: false` per app on PRs. Path filter widens to include `apps/{agent,paper}-runner/**`.

## 10. Operator runbook (append to `infra/terraform/README.md`)

Pre-conditions:
1. Plan 6a + 6b applied; sidecar service `RUNNING + HEALTHY`.
2. Secrets blob populated (Anthropic + MT5 creds).
3. GH repo variable `AWS_ACCOUNT_ID` set.

First TF apply per env:
```bash
cd infra/terraform/envs/<env>
terraform init -upgrade
terraform plan -out=tfplan
terraform apply tfplan
```
Service spawns; first task fails health (no image yet). Expected.

First image build:
```bash
gh workflow run apps-image.yml --ref main
```
Approx 5–8 min on first build (Node base + pnpm install dominate; subsequent builds <1 min via GHA cache).

Verify per env:
```bash
ENV=prod   # or staging
APP=agent-runner   # or paper-runner
aws ecs describe-services --cluster forex-bot-$ENV-cluster --services forex-bot-$ENV-$APP \
  --query 'services[0].{running: runningCount, primary: deployments[?status==`PRIMARY`].rolloutState | [0]}'
aws logs tail /forex-bot/$ENV/$APP --since 5m
```
Expected: `running=1`, `primary=COMPLETED`. Logs show `agent-runner started` (or `paper-runner started`).

End-to-end smoke (Service Connect resolution):
```bash
TASK_ARN=$(aws ecs list-tasks --cluster forex-bot-$ENV-cluster --service-name forex-bot-$ENV-$APP --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster forex-bot-$ENV-cluster --task "$TASK_ARN" --container "$APP" \
  --interactive --command "node -e \"const net = require('net'); const s = net.connect(50051, 'mt5-sidecar', () => { console.log('OK'); s.end(); }); s.on('error', e => { console.error('FAIL', e.message); process.exit(1); });\""
```
Expected: `OK`.

Troubleshooting:
- Task starts but logs show `Cannot resolve mt5-sidecar`: Service Connect namespace mis-attached. Check `aws ecs describe-services` shows non-empty `serviceConnectConfiguration.namespace`.
- Task starts, sidecar dial succeeds, but agent-runner errors `MT5 initialize() failed`: sidecar's MT5 creds are wrong (fix in Secrets Manager).
- Image pull denied: check `forex-bot-<env>-ci` role's ECR scope includes the app's repo ARN.
- DynamoDB `AccessDeniedException` from app: verify `journal_rw_policy_arn` + `killswitch_rw_policy_arn` are attached to the task role (`aws iam list-attached-role-policies --role-name forex-bot-<env>-<app>-task`).

## 11. Cost (delta on top of 6a + 6b)

| Item | Per-env monthly |
|------|-----------------|
| Fargate 0.5 vCPU / 1 GB, 24×7 | ~$15 |
| CloudWatch Logs (~50 MB/day) | ~$0.30 |
| Service Connect Envoy proxy | bundled in task memory |
| **Per env (one app)** | **~$15** |

Combined prod (agent-runner) + staging (paper-runner) delta = **~$30/mo**.
Total infra ≈ **~$148/mo** (6a + 6b + 6c) before data-ingest.

## 12. Risks & open items

- Apps deploying before secrets are populated → fail-fast at boot. Document.
- TF apply order matters: cluster (creates SC namespace) → sidecar (registers in SC) → app (consumes SC). Module ordering in `envs/<env>/main.tf` enforces it via implicit deps; explicit `depends_on` not needed.
- `pnpm dlx tsx` at runtime fetches tsx if missing in node_modules. Mitigate by adding `tsx` as a `-w -D` dev dep before first build.
- agent-runner with placeholder MT5 creds will error loudly when the sidecar refuses connections. Acceptable v1 failure mode.
- ECS task replacement loses ~30–60s of poll cycles. Acceptable — ticks are minute-aligned.
- Apps share `app-sg`. Sidecar gRPC reachable from any task in the SG. Plan 7 may tighten with task-level egress allowlists.
- agent-runner doesn't read kill-switch DDB at boot yet — Plan 6e wires this. If kill-switch tripped historically, fresh task won't honor it.
- paper-runner output dir `/tmp/paper-out` is ephemeral; daily snapshot lost on task replacement until 6d/Plan 6e wires durable storage.
- Staging env has access to a wide `branch_filters` (PR + main pushes). Anyone with PR rights can deploy to staging. Plan 7 tightens with PR-author allowlist.

## 13. Acceptance criteria

- [ ] `docker buildx build` succeeds locally for both Dockerfiles.
- [ ] `terraform validate` passes for `modules/app`, both envs.
- [ ] `terraform fmt -check -recursive infra/terraform` passes.
- [ ] `terraform apply` succeeds in `envs/staging` — paper-runner service exists; first task fails health pre-image.
- [ ] First `apps-image.yml` run pushes images, ECS redeploys, services stable.
- [ ] CloudWatch logs show app startup line.
- [ ] `aws ecs execute-command` into agent-runner task → TCP connect to `mt5-sidecar:50051` succeeds.
- [ ] All resources tagged `Project=forex-bot`, `Environment=<env>`, `ManagedBy=terraform`.
- [ ] Sidecar registers in Service Connect; app tasks resolve `mt5-sidecar` DNS.
- [ ] App task role has `secrets-read` + `journal-rw` + `killswitch-rw` attached; nothing more.
- [ ] No long-lived AWS access keys created or stored.
- [ ] Cost dashboard delta within ±20% of $30/mo combined.
