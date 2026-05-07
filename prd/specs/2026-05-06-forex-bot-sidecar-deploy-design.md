# Plan 6b — Sidecar deploy (design spec)

> Sub-plan of Plan 6 (Infra & Ops). Scope: get `mt5-sidecar` running on ECS Fargate.
> Depends on Plan 6a (IaC base — VPC, ECR, Secrets Manager, OIDC role).
> Sibling sub-plans: 6c (app deploy), 6d (observability), 6e (ops-cli).

## 1. Goal & non-goals

**Goal.** Replace the stub `mt5-sidecar/Dockerfile` with a working Wine + Python-on-Windows + portable MT5 + sidecar image. Deploy it as a Fargate service via Terraform. Wire env-var auto-login from the 6a Secrets Manager blob. Add gRPC health checks + reconnect logic in the sidecar Python. Ship a GitHub Actions workflow that builds, pushes to ECR, and forces an ECS redeploy on push to `main`.

**Non-goals.**
- ECS app tasks (agent-runner, paper-runner, data-ingest) — Plan 6c.
- CloudWatch dashboards / SNS alarms — Plan 6d.
- Canary deploys, manual approval gates, blue/green — Plan 7.
- EFS-backed Wine prefix persistence — explicit YAGNI per Decision 4 (cold-start is acceptable).
- Multi-broker / failover / disaster recovery — Plan 7.
- VPN / PrivateLink to broker — out of scope; rely on broker's public MT5 server.
- Linux-native MT5 alternatives (e.g., MetaApi REST gateway) — out of scope; if pursued, lives in a parallel adapter.

## 2. Decisions adopted

| # | Decision | Choice |
|---|----------|--------|
| 1 | Wine architecture | (a) Wine + Python-on-Windows runs sidecar directly. No `mt5linux` bridge, no community image, no Windows Fargate. |
| 2 | MT5 binary distribution | (c) Portable MT5 — `wine mt5setup.exe /portable /auto` at image build time. No installer dialogs, no S3 mount, no EFS. |
| 3 | Auto-login | (a) Env vars (`MT5_LOGIN`/`MT5_SERVER`/`MT5_PASSWORD`) injected by ECS from Secrets Manager. Sidecar passes through to `mt5.initialize(...)`. |
| 4 | Sizing + state | (b) 1 vCPU / 2 GB Fargate, (i) ephemeral state (no EFS). |
| 5 | Health + restart | (a) gRPC `health.v1` service backed by `mt5.account_info()`. Reconnect once, then exit → ECS replaces task. |
| 6 | ECS cluster scope | (a) One shared cluster per env (`forex-bot-<env>-cluster`); 6c reuses it. |
| 7 | CD pipeline | (b) GitHub Actions on push to `main`, matrix `[staging, prod]`, OIDC role from 6a. |
| 8 | Dockerfile shape | (a) Replace existing stub Dockerfile (no consumer today). |

## 3. Architecture

```
                 GitHub push to main
                         │
                         ▼
       .github/workflows/sidecar-image.yml
                         │
        OIDC → forex-bot-<env>-ci role (from 6a)
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
  docker build       ECR push         ECS update-service
  (Wine + MT5)       :sha + :latest   --force-new-deployment

                         │
                         ▼
   ┌──────────────────────────────────────────────┐
   │ ECS Fargate task — forex-bot-<env>-cluster   │
   │ ┌──────────────────────────────────────────┐ │
   │ │ Container (Linux base + Wine 9 stable)   │ │
   │ │   xvfb-run wine python -m mt5_sidecar    │ │
   │ │     ↓ ctypes via Wine                    │ │
   │ │   MT5 portable terminal (Wine prefix)    │ │
   │ │     ↓ TCP                                │ │
   │ │   broker MT5 server (public internet)    │ │
   │ │                                          │ │
   │ │   gRPC :50051 (sidecar)  ← from app-sg   │ │
   │ │   HEALTHCHECK: grpc_health_probe         │ │
   │ └──────────────────────────────────────────┘ │
   │ Env: MT5_LOGIN, MT5_SERVER, MT5_PASSWORD     │
   │   (injected from Secrets Manager 6a blob)    │
   │ Logs → CloudWatch /forex-bot/<env>/mt5-sidecar│
   └──────────────────────────────────────────────┘
                         │ gRPC :50051
                         ▼
              agent-runner / paper-runner
              (Plan 6c, intra-VPC, app-sg)
```

`desiredCount = 1` per env. No NAT — task gets public IP, egress over public internet to broker. Ingress 50051 only from `app-sg`.

## 4. Container image

Replace `mt5-sidecar/Dockerfile` with multi-stage build:

```dockerfile
# Stage 1: wine-base — Debian + Wine 9 stable + xvfb
FROM debian:bookworm-slim AS wine-base
ENV DEBIAN_FRONTEND=noninteractive \
    WINEPREFIX=/wine \
    WINEARCH=win64 \
    WINEDEBUG=-all \
    DISPLAY=:99
RUN dpkg --add-architecture i386 && \
    apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg xvfb libfreetype6 libgnutls30 && \
    curl -fsSL https://dl.winehq.org/wine-builds/winehq.key | gpg --dearmor -o /etc/apt/keyrings/winehq.gpg && \
    echo "deb [signed-by=/etc/apt/keyrings/winehq.gpg] https://dl.winehq.org/wine-builds/debian/ bookworm main" > /etc/apt/sources.list.d/winehq.list && \
    apt-get update && apt-get install -y --no-install-recommends winehq-stable && \
    rm -rf /var/lib/apt/lists/*
RUN xvfb-run wine wineboot --init && xvfb-run wineserver -w

# Stage 2: python-win — Python 3.11 inside Wine prefix + MetaTrader5 + grpcio
FROM wine-base AS python-win
ARG PYTHON_VERSION=3.11.9
RUN curl -fsSL "https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-amd64.exe" -o /tmp/py.exe && \
    xvfb-run wine /tmp/py.exe /quiet InstallAllUsers=1 PrependPath=1 Include_test=0 && \
    rm /tmp/py.exe && xvfb-run wineserver -w
RUN xvfb-run wine python -m pip install --no-cache-dir \
      MetaTrader5==5.0.45 grpcio==1.66.0 grpcio-health-checking==1.66.0 grpcio-tools==1.66.0 protobuf==5.28.0

# Stage 3: mt5 — portable MT5 terminal in the Wine prefix
FROM python-win AS mt5
RUN curl -fsSL https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe -o /tmp/mt5.exe && \
    xvfb-run wine /tmp/mt5.exe /portable /auto && \
    rm /tmp/mt5.exe && xvfb-run wineserver -w

# Stage 4: final — sidecar code + proto + health probe
FROM mt5 AS final
WORKDIR /app
COPY pyproject.toml uv.lock /app/
COPY src /app/src
COPY proto /proto
ARG GRPC_HEALTH_PROBE_VERSION=v0.4.25
RUN curl -fsSL "https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${GRPC_HEALTH_PROBE_VERSION}/grpc_health_probe-linux-amd64" \
      -o /usr/local/bin/grpc_health_probe && chmod +x /usr/local/bin/grpc_health_probe
RUN xvfb-run wine python -m grpc_tools.protoc \
      -I/proto --python_out=/app/src/mt5_sidecar/generated \
      --grpc_python_out=/app/src/mt5_sidecar/generated /proto/mt5.proto
EXPOSE 50051
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD grpc_health_probe -addr=:50051 || exit 1
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

`mt5-sidecar/entrypoint.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
Xvfb :99 -screen 0 1024x768x16 &
exec wine python -m mt5_sidecar
```

Estimated final image size **2.0–2.5 GB**. First-pass build ~8 min; rebuilds on sidecar-source-only changes <1 min thanks to layer caching.

## 5. Sidecar Python changes

All edits inside `mt5-sidecar/src/mt5_sidecar/`. Tests still run natively (mocked `MetaTrader5`).

### 5.1 Auto-login (`__main__.py`)

Read MT5 creds from env. If all three present, pass to `initialize()`; otherwise fall back to last-known login (dev only).

```python
login = os.environ.get("MT5_LOGIN")
server = os.environ.get("MT5_SERVER")
password = os.environ.get("MT5_PASSWORD")
if login and server and password:
    adapter.initialize(login=int(login), server=server, password=password)
else:
    adapter.initialize()
```

`int(login)` raises `ValueError` on non-numeric values — fail-fast at startup.

### 5.2 gRPC health service (`server.py`)

Register `grpc_health.v1.Health` against the same gRPC server. Background thread polls `adapter.is_alive()` every 5s and updates the servicer's `SERVING` / `NOT_SERVING` state for both the empty service name (root) and `mt5.MT5Bridge`.

### 5.3 Reconnect logic (`adapter.py`)

Add to `MT5Adapter`:
- `is_alive() -> bool` — wraps `self._sdk.account_info() is not None` with broad `Exception` catch.
- `reconnect_or_die(*, max_attempts: int = 1) -> None` — `shutdown()` then `initialize(**self._init_kwargs)` retry; raises `RuntimeError` after `max_attempts` consecutive failures.

A daemon thread in `__main__.py` runs every 30s: if not alive, call `reconnect_or_die(max_attempts=1)`. Two consecutive failures within 60s → `SystemExit` → ECS replaces task.

### 5.4 Tests

New pytest files (mock `MetaTrader5` per existing pattern):
- `tests/test_login.py` — env vars set: `mt5.initialize` called with kwargs. Env vars unset: no-arg call. `MT5_LOGIN=abc` raises `ValueError`.
- `tests/test_health.py` — `is_alive()` returns False when mock `account_info` is None; servicer flips to `NOT_SERVING`.
- `tests/test_reconnect.py` — `reconnect_or_die` retries once and raises on permanent failure.

Coverage target: existing pytest threshold (no change).

## 6. Terraform: cluster + sidecar modules

Two new modules under `infra/terraform/modules/`. Both wire into `envs/<env>/main.tf` after the existing 6a modules.

### 6.1 `modules/cluster/`

Shared per env. 6c will reuse `cluster_arn` + `task_execution_role_arn`.

Resources:
- `aws_ecs_cluster` `forex-bot-<env>-cluster`. Container Insights `enabled`.
- `aws_ecs_cluster_capacity_providers` — `["FARGATE", "FARGATE_SPOT"]`. Default strategy: `FARGATE` weight 1 (sidecar uses this; spot reserved for ephemeral apps in 6c).
- `aws_iam_role` `forex-bot-<env>-ecs-task-execution` — assumed by `ecs-tasks.amazonaws.com`. Attaches AWS-managed `AmazonECSTaskExecutionRolePolicy` plus the `secrets_read_policy_arn` from 6a (so ECS can resolve `valueFrom` references during task launch).

Inputs: `env`, `secrets_read_policy_arn`, `common_tags`.
Outputs: `cluster_arn`, `cluster_name`, `task_execution_role_arn`.

### 6.2 `modules/sidecar/`

Resources:
- `aws_cloudwatch_log_group` `/forex-bot/<env>/mt5-sidecar`, retention 14 days.
- `aws_iam_role` `forex-bot-<env>-mt5-sidecar-task` — task-runtime role. Attaches only `secrets_read_policy_arn`. (Sidecar needs no other AWS APIs — narrow blast radius.)
- `aws_ecs_task_definition`:
  - Family `forex-bot-<env>-mt5-sidecar`.
  - `network_mode = "awsvpc"`, `requires_compatibilities = ["FARGATE"]`.
  - `cpu = "1024"`, `memory = "2048"`.
  - `runtime_platform { operating_system_family = "LINUX", cpu_architecture = "X86_64" }`.
  - `execution_role_arn` from cluster module.
  - `task_role_arn` = sidecar task role.
  - Single container `mt5-sidecar`:
    - `image = "${ecr_repo_url}:${var.image_tag}"` (default `image_tag = "latest"`).
    - `portMappings = [{ containerPort = 50051, protocol = "tcp" }]`.
    - `secrets`:
      - `MT5_LOGIN`     → `<secret_arn>:mt5Login::`
      - `MT5_PASSWORD`  → `<secret_arn>:mt5Password::`
      - `MT5_SERVER`    → `<secret_arn>:mt5Server::`
    - `environment`:
      - `MT5_SIDECAR_HOST = "0.0.0.0"`
      - `MT5_SIDECAR_PORT = "50051"`
    - `logConfiguration` → CloudWatch group above, `awslogs-stream-prefix = mt5-sidecar`.
- `aws_ecs_service`:
  - Name `forex-bot-<env>-mt5-sidecar`.
  - Cluster `cluster_arn`.
  - `task_definition = "${family}:${revision}"`.
  - `desired_count = 1`. `launch_type = "FARGATE"`.
  - `network_configuration { subnets = vpc_subnet_ids, security_groups = [app_sg_id], assign_public_ip = true }`.
  - `deployment_minimum_healthy_percent = 0`, `deployment_maximum_percent = 100` (replace-not-rolling for single task).
  - `enable_execute_command = true` (operator debug).
  - `wait_for_steady_state = false`.
  - `lifecycle { ignore_changes = [task_definition] }` so GH Actions `--force-new-deployment` doesn't drift TF state.

Inputs: `env`, `cluster_arn`, `task_execution_role_arn`, `secrets_read_policy_arn`, `secret_arn`, `vpc_subnet_ids`, `app_sg_id`, `ecr_repo_url`, `image_tag` (default `"latest"`), `common_tags`.
Outputs: `service_name`, `task_role_arn`, `task_definition_arn`, `log_group_name`.

### 6.3 Env composition update

`envs/<env>/main.tf` gains two `module` blocks (after 6a modules):

```hcl
module "cluster" {
  source                  = "../../modules/cluster"
  env                     = var.env
  secrets_read_policy_arn = module.secrets.read_policy_arn
  common_tags             = local.common_tags
}

module "sidecar" {
  source                   = "../../modules/sidecar"
  env                      = var.env
  cluster_arn              = module.cluster.cluster_arn
  task_execution_role_arn  = module.cluster.task_execution_role_arn
  secrets_read_policy_arn  = module.secrets.read_policy_arn
  secret_arn               = module.secrets.secret_arn
  vpc_subnet_ids           = module.network.public_subnet_ids
  app_sg_id                = module.network.app_sg_id
  ecr_repo_url             = module.ecr.repo_urls["mt5-sidecar"]
  common_tags              = local.common_tags
}
```

### 6.4 OIDC trust amendment

The `ci-oidc` module from 6a takes a single `branch_filter` string. Staging is currently `"pull_request"`. The new `sidecar-image` workflow runs on `push: main`, so staging deploy will fail OIDC trust check.

**Amendment** (small):
- Rename `var.branch_filter` (string) in `modules/ci-oidc` to `var.branch_filters` (`list(string)`, length ≥ 1).
- The trust-policy `sub` condition becomes a **single `StringLike`** with multiple values:
  `values = [for f in var.branch_filters : "repo:${var.github_org}/${var.github_repo}:${f}"]`
- Update `envs/staging/main.tf` to pass `["pull_request", "ref:refs/heads/main"]`.
- `envs/prod/main.tf` stays `["ref:refs/heads/main"]` (single-element list).

~10 LoC TF change.

## 7. CI: build + push + redeploy

New `.github/workflows/sidecar-image.yml`:

```yaml
name: sidecar-image

on:
  push:
    branches: [main]
    paths:
      - "mt5-sidecar/**"
      - "proto/mt5.proto"
      - ".github/workflows/sidecar-image.yml"
  workflow_dispatch:

permissions:
  id-token: write
  contents: read

jobs:
  build-push-deploy:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        env: [staging, prod]
    steps:
      - uses: actions/checkout@v4
      - name: Configure AWS via OIDC
        uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::${{ vars.AWS_ACCOUNT_ID }}:role/forex-bot-${{ matrix.env }}-ci
          aws-region: eu-west-2
      - name: Login to ECR
        id: login-ecr
        uses: aws-actions/amazon-ecr-login@v2
      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: mt5-sidecar
          file: mt5-sidecar/Dockerfile
          push: true
          tags: |
            ${{ steps.login-ecr.outputs.registry }}/forex-bot/${{ matrix.env }}/mt5-sidecar:${{ github.sha }}
            ${{ steps.login-ecr.outputs.registry }}/forex-bot/${{ matrix.env }}/mt5-sidecar:latest
          cache-from: type=gha,scope=mt5-sidecar-${{ matrix.env }}
          cache-to:   type=gha,mode=max,scope=mt5-sidecar-${{ matrix.env }}
      - name: Force ECS redeploy
        run: |
          aws ecs update-service \
            --cluster forex-bot-${{ matrix.env }}-cluster \
            --service forex-bot-${{ matrix.env }}-mt5-sidecar \
            --force-new-deployment \
            --region eu-west-2
      - name: Wait for stable
        run: |
          aws ecs wait services-stable \
            --cluster forex-bot-${{ matrix.env }}-cluster \
            --services forex-bot-${{ matrix.env }}-mt5-sidecar \
            --region eu-west-2
```

**Required GH config** (operator):
- Repo variable `AWS_ACCOUNT_ID`.
- Both staging + prod runs trigger on every main push. Manual prod approval = Plan 7 (GitHub Environments).

## 8. Testing & smoke verification

**Layer 1 — Python unit (existing pytest CI)**: covered by the test files in §5.4.

**Layer 2 — Image build smoke (PR-time)**: extend `.github/workflows/infra.yml` (or new `sidecar-build.yml`) to run `docker build mt5-sidecar/` on PR with `paths: mt5-sidecar/**`. No push; just verifies the Dockerfile builds.

**Layer 3 — Live ECS exec (operator, post-deploy)**:

```bash
ENV=staging
TASK_ARN=$(aws ecs list-tasks --cluster forex-bot-$ENV-cluster --service-name forex-bot-$ENV-mt5-sidecar --query 'taskArns[0]' --output text)
aws ecs execute-command --cluster forex-bot-$ENV-cluster --task "$TASK_ARN" --container mt5-sidecar \
  --interactive --command "/usr/local/bin/grpc_health_probe -addr=:50051"
# Expected: status: SERVING
aws logs tail /forex-bot/$ENV/mt5-sidecar --since 5m
# Expected: "mt5-sidecar listening on 0.0.0.0:50051"
```

**Layer 4 — End-to-end (operator)**:

```bash
# Run a temporary debug task in app-sg with grpcurl, hit the sidecar's private DNS:
aws ecs run-task --cluster forex-bot-$ENV-cluster --launch-type FARGATE \
  --network-configuration 'awsvpcConfiguration={...,securityGroups=[<app_sg_id>]}' \
  --task-definition <debug-td> ...
# Inside the debug task:
grpcurl -plaintext <sidecar-task-private-ip>:50051 mt5.MT5Bridge/GetAccount
# Expected: real broker AccountResponse JSON
```

## 9. Runbook (appended to `infra/terraform/README.md`)

Add a "Sidecar deploy (Plan 6b)" section:

1. Pre-conditions: 6a applied, secrets blob populated with valid MT5 creds (`mt5Login`, `mt5Server`, `mt5Password`).
2. First TF apply: `terraform apply` in `envs/<env>/`. Picks up new `cluster` + `sidecar` modules. The ECS service spawns a task that fails health (no image yet). **Expected.**
3. First image build: `gh workflow run sidecar-image.yml` after setting GH repo var `AWS_ACCOUNT_ID`. ~10 min for first build.
4. Verify deploy:
   - `aws ecs describe-services --cluster forex-bot-<env>-cluster --services forex-bot-<env>-mt5-sidecar` shows `runningCount: 1`.
   - `aws logs tail /forex-bot/<env>/mt5-sidecar --since 5m` shows `mt5-sidecar listening on 0.0.0.0:50051`.
5. End-to-end: per Layer 4 above.

## 10. Cost (delta on top of 6a)

| Item | Per-env monthly |
|------|-----------------|
| Fargate 1 vCPU / 2 GB, 24×7 | ~$30 |
| ECR storage (image ~2.5 GB) | ~$0.25 |
| CloudWatch Logs (~100 MB/day INFO) | ~$0.50 |
| **Sidecar delta per env** | **~$31** |

Combined prod + staging delta: **~$62/mo**. Total infra (6a + 6b) ~$118/mo before app tasks (6c).

## 11. Risks & open items

- **Wine + portable MT5 build flakiness.** MetaQuotes installer has been known to surface dialogs on certain MT5 versions. If `/portable /auto` proves unreliable, fall back to:
  - (i) Decision 2(a) build-time silent installer with `xvfb-run`, or
  - (ii) S3-hosted Wine prefix tarball (operator pre-builds locally, image `aws s3 cp` + tar-extracts).
- **MT5 weekend rollover.** Brokers run maintenance Sunday 00:00–05:00 UTC; sessions drop. Reconnect loop handles transient drops; persistent drops trigger ECS task restart. Acceptable.
- **Cold-start latency.** First gRPC call after task replace lands during MT5 cold-start (~30–60s). Plan 6c agent-runner needs retry on `UNAVAILABLE`.
- **Staging OIDC trust widening.** Adding `ref:refs/heads/main` to staging trust expands the deploy surface. Acceptable for v1; tighten via PR-author allowlist in Plan 7.
- **Wine prefix is huge in image.** ~1.5 GB of Wine prefix + Python + MT5 — careful layering keeps cache hits high. If image bloat hurts cold-pull times, switch to a smaller Wine variant or strip locales.
- **MT5 Python pkg version pin (`5.0.45`).** New broker-side server versions occasionally require pkg upgrades. Document in runbook.
- **No metrics emit yet.** Sidecar logs to CloudWatch but doesn't emit custom metrics (latency, reconnects, broker errors). Plan 6d wires this.
- **`aws ecs execute-command`** requires the `amazon-ssm-agent` running inside the task. Wine + Python-Win sidecar may not have it. If exec doesn't work, fall back to logs-only debugging. Tracked.

## 12. Acceptance criteria

- [ ] `mt5-sidecar/Dockerfile` builds locally on Linux x86_64 (or mac via `docker buildx --platform linux/amd64`) without manual interaction.
- [ ] `make test` passes (unit tests for login + health + reconnect).
- [ ] `terraform validate` passes for `modules/cluster`, `modules/sidecar`, both envs.
- [ ] `terraform apply` succeeds in staging — ECS service exists, task initially fails health (no image).
- [ ] First `sidecar-image.yml` run pushes image, redeploys, task becomes `RUNNING` + `HEALTHY`.
- [ ] CloudWatch logs show `mt5-sidecar listening on 0.0.0.0:50051` and a successful `mt5.account_info()` call against demo broker creds.
- [ ] `grpc_health_probe -addr=<task-ip>:50051` returns `SERVING` from a debug task in `app-sg`.
- [ ] `grpcurl ... mt5.MT5Bridge/GetAccount` returns a real broker account response.
- [ ] Repo CI (`infra.yml`) still passes for both envs.
- [ ] No long-lived AWS access keys created.
- [ ] All resources tagged `Project=forex-bot`, `Environment=<env>`, `ManagedBy=terraform`.
- [ ] Sidecar task IAM role has only `secrets_read_policy_arn` attached (no broader perms).
- [ ] Cost dashboard delta matches estimate within ±20%.
