# Plan 6f — Broker-provider plugin + MetaApi migration (design spec)

> Sub-plan of Plan 6 (Infra & Ops). Scope: refactor `mt5-sidecar` to a
> provider-pluggable architecture and migrate prod + staging from the broken
> Wine path to MetaApi.cloud. Depends on Plans 6a (IaC base), 6b (sidecar
> scaffold), 6c (app deploy). Sibling sub-plans: 6d (observability), 6e (ops-cli).

## 1. Goal & non-goals

**Goal.** Make `mt5-sidecar` provider-agnostic. The gRPC contract
(`proto/mt5.proto`) stays unchanged; the sidecar's internal broker connection
becomes a swappable plugin. Ship two providers in v1: `MetaApiProvider` (primary,
talks to metaapi.cloud REST + WebSocket) and `FakeProvider` (tests). Drop the
broken Wine + MT5-portable image entirely. Provider selected at runtime via the
`BROKER_PROVIDER` env var. Apps require zero code changes.

**Non-goals.**
- `Mt5LinuxProvider` (gmag11 image + mt5linux RPyC). Deferred. Plugin abstraction
  makes it a ~1-day add later if MetaApi proves unsuitable.
- TS/Node sidecar rewrite. Defer indefinitely.
- Multi-broker or multi-account per sidecar instance (one task = one provider =
  one account).
- Migration of historical journal data (clean DB cutover acceptable; demo
  accounts).
- `agent-runner` / `paper-runner` code changes (gRPC contract unchanged).
- Live trading on the new provider in prod without ≥ 1 week of paper-runner
  staging validation.
- Async gRPC server rewrite (sync ↔ asyncio bridge in `MetaApiProvider` is
  v1-acceptable).

## 2. Decisions adopted

| # | Decision | Choice |
|---|----------|--------|
| 1 | Loose-coupling shape | Single sidecar binary, provider-plugin pattern. `BROKER_PROVIDER` env var selects at boot. |
| 2 | Providers in v1 | `MetaApiProvider` (primary) + `FakeProvider` (tests). Wine `MT5Provider` kept opt-in but not deployed. `Mt5LinuxProvider` deferred. |
| 3 | Language | Python. Reuses Plan 6b's gRPC server, tests, Dockerfile shape. |
| 4 | MetaApi SDK | `metaapi_cloud_sdk` (PyPI). Sync handlers bridge to its async API via one event loop + `run_until_complete`. |
| 5 | Config knob | `BROKER_PROVIDER` env var. `METAAPI_TOKEN` + `METAAPI_ACCOUNT_ID` secrets (Secrets Manager), `METAAPI_REGION` env var. |

## 3. Architecture

```
                          existing apps (agent-runner, paper-runner)
                                          │
                                          │ gRPC :50051 (forex_bot.mt5.MT5)
                                          │ contract unchanged
                                          ▼
   ┌────────────────────────────────────────────────────────────────┐
   │ mt5-sidecar (Linux Python, ~180 MB image, no Wine)             │
   │                                                                │
   │  ┌────────────────────┐         ┌──────────────────────────┐   │
   │  │ MT5Service         │ ──────► │ provider: BrokerProvider │   │
   │  │ (gRPC servicer)    │         │   (Protocol)             │   │
   │  └────────────────────┘         └─────────┬────────────────┘   │
   │                                            │                   │
   │           ┌────────────────────────────────┼─────────────────┐ │
   │           ▼                                ▼                 ▼ │
   │  MetaApiProvider (default)        FakeProvider           future │
   │  (metaapi_cloud_sdk)               (tests only)         providers│
   │           │                                                     │
   │           │ REST + WebSocket                                    │
   │           ▼                                                     │
   │     metaapi.cloud (London region)                               │
   │           │                                                     │
   │           ▼                                                     │
   │     broker MT5 server (broker-side)                             │
   └────────────────────────────────────────────────────────────────┘

Boot-time selection:
  BROKER_PROVIDER=metaapi   → MetaApiProvider  (prod + staging default)
  BROKER_PROVIDER=fake      → FakeProvider     (tests + dev)
  BROKER_PROVIDER=mt5       → legacy MT5Provider (opt-in, requires MetaTrader5 pkg + Wine; not in prod image)
```

Per-env shape:
- prod: sidecar task (`BROKER_PROVIDER=metaapi`) + agent-runner task.
- staging: sidecar task (`BROKER_PROVIDER=metaapi`) + paper-runner task.
- Local tests: in-process `FakeProvider`, no network.

## 4. File layout

```
mt5-sidecar/
├── Dockerfile                        # REPLACED: Linux Python only, no Wine
├── pyproject.toml                    # MODIFIED: + metaapi_cloud_sdk; MetaTrader5 moved to [mt5] extra
├── src/mt5_sidecar/
│   ├── __main__.py                   # MODIFIED: uses providers.get_provider()
│   ├── server.py                     # MODIFIED: MT5Service accepts BrokerProvider
│   ├── adapter.py                    # DEPRECATED SHIM: re-exports from providers/ for 1 release
│   └── providers/                    # NEW package
│       ├── __init__.py               # get_provider() factory + re-exports
│       ├── base.py                   # BrokerProvider Protocol + dataclasses
│       ├── metaapi.py                # MetaApiProvider
│       ├── fake.py                   # FakeProvider
│       └── mt5_native.py             # legacy MT5Provider (moved from adapter.py)
└── tests/
    ├── test_health.py                # MODIFIED: targets mt5_native.MT5Provider
    ├── test_login.py                 # MODIFIED: tests factory dispatch (was MT5-specific)
    ├── test_reconnect.py             # MODIFIED: targets mt5_native.MT5Provider
    ├── test_server.py                # MODIFIED: uses FakeProvider directly
    ├── test_providers.py             # NEW: factory + Fake end-to-end
    └── test_metaapi_integration.py   # NEW: skipped by default; real-network smoke
```

Terraform:
```
infra/terraform/
├── modules/
│   ├── secrets/main.tf               # MODIFIED: +metaApiToken, +metaApiAccountId placeholders
│   └── sidecar/
│       ├── variables.tf              # MODIFIED: +var.broker_provider
│       └── main.tf                   # MODIFIED: env BROKER_PROVIDER + METAAPI_REGION; secrets METAAPI_TOKEN, METAAPI_ACCOUNT_ID
└── envs/
    ├── prod/main.tf                  # MODIFIED: broker_provider = "metaapi"
    └── staging/main.tf               # MODIFIED: broker_provider = "metaapi"
```

CI:
```
.github/workflows/ci.yml              # MODIFIED: +grep guard for real MetaApi in tests
```

## 5. `BrokerProvider` protocol + factory

### `providers/base.py`

```python
from __future__ import annotations
from typing import Any, Protocol
from dataclasses import dataclass


@dataclass(frozen=True)
class Tick:
    ts: int; symbol: str; bid: float; ask: float

@dataclass(frozen=True)
class Candle:
    ts: int; open: float; high: float; low: float; close: float; volume: float

@dataclass(frozen=True)
class Account:
    ts: int; currency: str; balance: float; equity: float
    free_margin: float; used_margin: float; margin_level_pct: float

@dataclass(frozen=True)
class Position:
    id: str; symbol: str; side: str   # "buy" | "sell"
    lot_size: float; entry: float; sl: float; tp: float; opened_at: int


class BrokerProvider(Protocol):
    """Implemented by MetaApiProvider, FakeProvider, MT5Provider."""

    def initialize(self, **kwargs: Any) -> None: ...
    def shutdown(self) -> None: ...
    def is_alive(self) -> bool: ...
    def reconnect_or_die(self, *, max_attempts: int = 1) -> None: ...

    def get_quote(self, symbol: str) -> Tick: ...
    def get_candles(self, symbol: str, proto_timeframe: int, limit: int) -> list[Candle]: ...
    def get_account(self) -> Account: ...
    def get_open_positions(self) -> list[Position]: ...

    def place_market_order(
        self, symbol: str, side: str, lot_size: float,
        sl: float | None, tp: float | None, client_id: str | None,
    ) -> dict: ...
```

### `providers/__init__.py`

```python
import os
from .base import BrokerProvider, Tick, Candle, Account, Position

def get_provider() -> BrokerProvider:
    name = os.environ.get("BROKER_PROVIDER", "metaapi").lower()
    if name == "metaapi":
        from .metaapi import MetaApiProvider
        return MetaApiProvider()
    if name == "fake":
        from .fake import FakeProvider
        return FakeProvider()
    if name == "mt5":
        from .mt5_native import MT5Provider
        return MT5Provider()
    raise ValueError(
        f"Unknown BROKER_PROVIDER={name!r}. Valid: metaapi, fake, mt5"
    )


__all__ = ["BrokerProvider", "Tick", "Candle", "Account", "Position", "get_provider"]
```

### `__main__.py` change

```python
# OLD:
adapter = MT5Adapter(mt5)
adapter.initialize(login=int(login), server=server, password=password)
# NEW:
from .providers import get_provider
provider = get_provider()
provider.initialize()    # reads its own creds from env vars
```

### Migration of legacy `MT5Adapter`

- Move class to `providers/mt5_native.py`, rename to `MT5Provider`.
- `Tick/Candle/Account/Position` dataclasses + `MT5SDK` Protocol → `base.py`.
- `mt5-sidecar/src/mt5_sidecar/adapter.py` becomes a re-export shim for one
  release, marked with `# DEPRECATED — import from .providers instead`.

## 6. `MetaApiProvider`

### Dependencies

- `metaapi_cloud_sdk` exact-pinned in `pyproject.toml` (e.g. `==27.0.0` —
  verify latest at impl time). Async API.
- `MetaTrader5` moved to `[mt5]` optional extra. Not installed in prod image.

### Creds

Secrets Manager blob (per env) gains:
```json
{
  "metaApiToken":     "<MetaApi.cloud API token>",
  "metaApiAccountId": "<UUID of registered MT5 account>",
  // existing keys kept (anthropicApiKey, mt5Login/Password/Server, dbPassword)
}
```

ECS injects as env vars:
- `BROKER_PROVIDER=metaapi`
- `METAAPI_TOKEN`     (from `metaApiToken`)
- `METAAPI_ACCOUNT_ID` (from `metaApiAccountId`)
- `METAAPI_REGION=london` (non-sensitive; plain env var)

### `providers/metaapi.py` shape

```python
from __future__ import annotations
import asyncio, os, threading, time
from typing import Any

from metaapi_cloud_sdk import MetaApi

from .base import Account, BrokerProvider, Candle, Position, Tick


class MetaApiProvider:
    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._api: MetaApi | None = None
        self._account: Any = None
        self._connection: Any = None
        self._init_kwargs: dict[str, Any] = {}
        self._call_lock = threading.Lock()   # serialize gRPC threads → single loop

    def initialize(self, **kwargs: Any) -> None:
        token   = kwargs.get("token")      or os.environ.get("METAAPI_TOKEN")
        acct_id = kwargs.get("account_id") or os.environ.get("METAAPI_ACCOUNT_ID")
        region  = kwargs.get("region")     or os.environ.get("METAAPI_REGION", "london")
        if not (token and acct_id):
            raise RuntimeError("METAAPI_TOKEN + METAAPI_ACCOUNT_ID required")
        self._init_kwargs = {"token": token, "account_id": acct_id, "region": region}

        self._loop = asyncio.new_event_loop()
        self._api = MetaApi(token=token, opts={"region": region})
        self._account = self._run(self._api.metatrader_account_api.get_account(acct_id))
        self._run(self._account.deploy())
        self._run(self._account.wait_connected())
        self._connection = self._account.get_streaming_connection()
        self._run(self._connection.connect())
        self._run(self._connection.wait_synchronized())

    def shutdown(self) -> None:
        try:
            if self._connection is not None:
                self._run(self._connection.close())
        except Exception:
            pass
        try:
            if self._loop is not None:
                self._loop.close()
        except Exception:
            pass

    def is_alive(self) -> bool:
        try:
            return self._connection is not None and bool(self._connection.synchronized)
        except Exception:
            return False

    def reconnect_or_die(self, *, max_attempts: int = 1) -> None:
        last_err: Exception | None = None
        for _ in range(max_attempts):
            try:
                self.shutdown()
            except Exception:
                pass
            try:
                self.initialize(**self._init_kwargs)
                return
            except Exception as e:
                last_err = e
                time.sleep(2)
        raise RuntimeError(f"MetaApi reconnect failed; exiting for ECS restart: {last_err}")

    def get_quote(self, symbol: str) -> Tick:
        price = self._run(self._connection.get_symbol_price(symbol))
        return Tick(
            ts=int(price["time"].timestamp() * 1000),
            symbol=symbol,
            bid=float(price["bid"]),
            ask=float(price["ask"]),
        )

    def get_candles(self, symbol: str, proto_timeframe: int, limit: int) -> list[Candle]:
        tf = _PROTO_TO_METAAPI_TIMEFRAME[proto_timeframe]
        bars = self._run(self._account.get_historical_candles(symbol, tf, limit=limit))
        return [
            Candle(
                ts=int(b["time"].timestamp() * 1000),
                open=float(b["open"]), high=float(b["high"]),
                low=float(b["low"]),   close=float(b["close"]),
                volume=float(b.get("tickVolume", 0)),
            )
            for b in bars
        ]

    def get_account(self) -> Account:
        info = self._run(self._connection.get_account_information())
        return Account(
            ts=int(time.time() * 1000),
            currency=str(info["currency"]),
            balance=float(info["balance"]),
            equity=float(info["equity"]),
            free_margin=float(info["freeMargin"]),
            used_margin=float(info["margin"]),
            margin_level_pct=float(info.get("marginLevel", 0) or 0),
        )

    def get_open_positions(self) -> list[Position]:
        rows = self._run(self._connection.get_positions()) or []
        return [
            Position(
                id=str(r["id"]),
                symbol=str(r["symbol"]),
                side="buy" if r["type"] == "POSITION_TYPE_BUY" else "sell",
                lot_size=float(r["volume"]),
                entry=float(r["openPrice"]),
                sl=float(r.get("stopLoss") or 0),
                tp=float(r.get("takeProfit") or 0),
                opened_at=int(r["time"].timestamp() * 1000),
            )
            for r in rows
        ]

    def place_market_order(
        self, symbol: str, side: str, lot_size: float,
        sl: float | None, tp: float | None, client_id: str | None,
    ) -> dict:
        method = (self._connection.create_market_buy_order if side == "buy"
                  else self._connection.create_market_sell_order)
        result = self._run(method(
            symbol, lot_size,
            stop_loss=sl, take_profit=tp,
            options={"clientId": client_id} if client_id else None,
        ))
        return {"ticket": str(result["orderId"]), "fill_price": float(result.get("price", 0))}

    def _run(self, coro: Any) -> Any:
        assert self._loop is not None
        with self._call_lock:
            return self._loop.run_until_complete(coro)


_PROTO_TO_METAAPI_TIMEFRAME: dict[int, str] = {
    # proto Timeframe int → MetaApi string. Values per proto/mt5.proto enum.
    1: "1m", 5: "5m", 15: "15m", 30: "30m", 60: "1h", 240: "4h", 1440: "1d", 10080: "1w",
}
```

Notes:
- `_call_lock` serializes gRPC worker threads through the single event loop.
  Acceptable at our tick rate (≤ 1/sec aggregate); revisit if measured latency
  hurts.
- Field shapes (`"openPrice"`, `"volume"`, `"time"`, …) assume current SDK docs.
  Verify against installed version at impl time; adjust as needed.
- `_PROTO_TO_METAAPI_TIMEFRAME` mirrors `mt5_native.PROTO_TO_MT5_TIMEFRAME` —
  keep in sync if proto enum grows.

## 7. `FakeProvider` + tests

`providers/fake.py` is a deterministic in-memory broker with seeding helpers
(`set_quote`, `set_candles`, `force_disconnect`, `reject_next_order`). Used by:

- Refactored `test_server.py` (gRPC handler tests).
- New `test_providers.py` (factory + FakeProvider end-to-end).
- Future `agent-runner` integration tests that need a faux sidecar.

### Test migration

| Test file | Change |
|-----------|--------|
| `test_reconnect.py` | Targets `mt5_native.MT5Provider` (renamed legacy class). Logic identical. |
| `test_health.py` | Targets `mt5_native.MT5Provider`. Health-servicer assertion unchanged. |
| `test_login.py` | Rewritten — now verifies factory dispatch (BROKER_PROVIDER=metaapi/fake/mt5/unknown). Old MT5_LOGIN/MT5_SERVER/MT5_PASSWORD checks move into `test_mt5_native_provider.py` if needed. |
| `test_server.py` | Replace `MT5Adapter` ctor with `FakeProvider()`. |
| `test_providers.py` (new) | Factory contract + Fake e2e + reconnect path. |
| `test_metaapi_integration.py` (new) | Skipped by default; runs only if `RUN_METAAPI_INTEGRATION=1` + creds present. |

Expected post-refactor counts: ~20-25 tests (was 17). All run natively, no
network in default CI.

### CI grep guard

`.github/workflows/ci.yml`, append after the existing AnthropicLlm guard:
```yaml
- name: Verify no real MetaApi calls in tests
  run: |
    if grep -RInE 'MetaApi\(token=' --include='*.py' --include='*.ts' mt5-sidecar/tests apps packages; then
      echo "ERROR: MetaApi cannot be instantiated in tests with a real token — use FakeProvider." >&2
      exit 1
    fi
```

## 8. Dockerfile + Terraform changes

### `mt5-sidecar/Dockerfile` (full replace)

```dockerfile
FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/v0.4.25/grpc_health_probe-linux-amd64 \
      -o /usr/local/bin/grpc_health_probe && chmod +x /usr/local/bin/grpc_health_probe

COPY mt5-sidecar/pyproject.toml mt5-sidecar/uv.lock /app/
COPY mt5-sidecar/src /app/src
COPY proto /proto

RUN pip install --no-cache-dir \
      grpcio==1.66.0 \
      grpcio-health-checking==1.66.0 \
      grpcio-tools==1.66.0 \
      protobuf==5.28.0 \
      metaapi-cloud-sdk>=27.0.0

RUN python -m grpc_tools.protoc \
      -I/proto --python_out=/app/src/mt5_sidecar/generated \
      --grpc_python_out=/app/src/mt5_sidecar/generated /proto/mt5.proto

EXPOSE 50051
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD grpc_health_probe -addr=:50051 || exit 1
ENTRYPOINT ["python", "-m", "mt5_sidecar"]
```

Estimated final image: 180-220 MB. First build < 2 min.

### Terraform amendments

**`modules/secrets/main.tf`** — extend placeholder JSON:

```hcl
secret_string = jsonencode({
  anthropicApiKey  = "REPLACE_ME"
  mt5Login         = "REPLACE_ME"
  mt5Password      = "REPLACE_ME"
  mt5Server        = "REPLACE_ME"
  metaApiToken     = "REPLACE_ME"        # NEW
  metaApiAccountId = "REPLACE_ME"        # NEW
  dbPassword       = var.db_password
})
```

**`modules/sidecar/variables.tf`** — add:

```hcl
variable "broker_provider" {
  description = "Provider plugin selected at boot: metaapi | mt5 | fake"
  type        = string
  default     = "metaapi"
  validation {
    condition     = contains(["metaapi", "mt5", "fake"], var.broker_provider)
    error_message = "broker_provider must be one of: metaapi, mt5, fake."
  }
}
```

**`modules/sidecar/main.tf`** — `container_definitions` env/secrets blocks:

```hcl
environment = [
  { name = "MT5_SIDECAR_HOST", value = "0.0.0.0" },
  { name = "MT5_SIDECAR_PORT", value = "50051" },
  { name = "BROKER_PROVIDER",  value = var.broker_provider },   # NEW
  { name = "METAAPI_REGION",   value = "london" },              # NEW
]

secrets = [
  { name = "MT5_LOGIN",          valueFrom = "${var.secret_arn}:mt5Login::" },
  { name = "MT5_PASSWORD",       valueFrom = "${var.secret_arn}:mt5Password::" },
  { name = "MT5_SERVER",         valueFrom = "${var.secret_arn}:mt5Server::" },
  { name = "METAAPI_TOKEN",      valueFrom = "${var.secret_arn}:metaApiToken::" },     # NEW
  { name = "METAAPI_ACCOUNT_ID", valueFrom = "${var.secret_arn}:metaApiAccountId::" }, # NEW
]
```

**Env composition (`envs/<env>/main.tf`)** — pass explicitly (default already
`"metaapi"`, but make intent visible):

```hcl
module "sidecar" {
  # ... existing args ...
  broker_provider = "metaapi"
}
```

Operator can flip to `"fake"` for safe-mode rollback or `"mt5"` for legacy
opt-in via `terraform.tfvars` override + apply, no image rebuild.

### CI

`sidecar-image.yml` and `infra.yml` `sidecar-build` job unchanged structurally.
With Wine gone, builds finish in ~2 min instead of failing at 5+ min.

## 9. Migration sequence

1. **Pre-flight**: register the staging demo MT5 account at metaapi.cloud
   dashboard. Capture `account_id` (UUID) + API token. Verify MetaApi free tier
   can connect to your broker demo.
2. **Code refactor lands on main** (impl-plan tasks). New Dockerfile + provider
   plugin code. CI builds new image. `sidecar-image.yml` pushes to ECR.
   Staging sidecar redeploys.
3. **Configure staging secrets**:
   ```bash
   aws secretsmanager put-secret-value \
     --secret-id forex-bot/staging/secrets \
     --secret-string file:///tmp/staging-secrets.json   # contains metaApiToken + metaApiAccountId
   aws ecs update-service \
     --cluster forex-bot-staging-cluster \
     --service forex-bot-staging-mt5-sidecar \
     --force-new-deployment
   ```
4. **Verify staging**:
   ```bash
   aws logs tail /forex-bot/staging/mt5-sidecar --since 5m
   # Expect: "Provider: metaapi" + "MetaApiProvider initialized — synchronized with account <id>"
   ```
   `paper-runner` connects via gRPC, places paper trades against MetaApi demo.
5. **Soak test in staging ≥ 1 week**: measure tick latency (p50/p95/p99),
   order round-trip, reconnect frequency, MetaApi cost. Compare to budget.
6. **Prod cutover**: register live MT5 with MetaApi → populate prod secrets →
   force-new-deployment. agent-runner connects via gRPC (no app code change).
   First few trades manually inspected.

### Rollback

- `broker_provider = "fake"` puts sidecar in safe mode: gRPC stays healthy, no
  real orders flow. agent-runner pauses cleanly until provider is fixed.
- `broker_provider = "mt5"` only viable if Wine path is restored (not in v1).
- Plan 7 ops-cli will add: `forex-bot provider switch <env> <name>` (one-line
  rollback).

## 10. Runbook (append to `infra/terraform/README.md` + `DEPLOY.md`)

### Switch provider on a deployed env

```bash
ENV=staging
PROVIDER=metaapi   # or: fake, mt5

# 1. Set the var in tfvars (add the line if not present)
echo "broker_provider = \"$PROVIDER\"" >> infra/terraform/envs/$ENV/terraform.tfvars
# (or edit the existing line)

# 2. Apply — updates task def revision, ECS rolling redeploy follows
cd infra/terraform/envs/$ENV
terraform apply

# 3. Verify
aws logs tail /forex-bot/$ENV/mt5-sidecar --since 5m
```

### Verify provider on a running task

```bash
aws ecs describe-tasks --cluster forex-bot-$ENV-cluster \
  --tasks $(aws ecs list-tasks --cluster forex-bot-$ENV-cluster --service-name forex-bot-$ENV-mt5-sidecar --query 'taskArns[0]' --output text) \
  --query 'tasks[0].overrides.containerOverrides[0].environment[?name==`BROKER_PROVIDER`].value | [0]'
```

## 11. Cost (delta vs Plan 6c baseline)

| Item | Per env monthly |
|------|-----------------|
| Sidecar Fargate (1 vCPU / 2 GB → 0.5 vCPU / 1 GB after Wine drop) | **-$15** |
| ECR storage (180 MB image vs 2.5 GB Wine target) | -$0.20 |
| MetaApi PAYG (~50k req/day per account + 24×7 tick stream) | +$20-40 (variable) |
| **Per env delta** | **+$5 to +$25** |

Combined (prod + staging): **+$10 to +$50/mo**. Likely close to a wash; bias
toward more cost but vastly better reliability and zero Wine ops time.

Sidecar Fargate downsize is deferred — verify the new image runs comfortably at
0.5/1 before changing TF defaults. Track in Plan 7 cost tuning.

## 12. Risks & open items

- **MetaApi region latency**: confirm London region p95 < 100 ms from
  eu-west-2. Verify with `paper-runner` during soak. If excessive, switch region
  or revisit provider choice.
- **PAYG cost surprise**: tick stream is the heavy cost. Wire CloudWatch
  billing alarm on MetaApi spend in Plan 6d. Extend `BudgetTracker` (currently
  Anthropic-only) to count MetaApi after this lands.
- **MetaApi SDK breaking changes**: pin `metaapi_cloud_sdk` to exact version in
  `pyproject.toml` (`==X.Y.Z`). Lock known-good revision; bump explicitly with
  smoke retest.
- **Async-to-sync bridge correctness**: `threading.Lock` serializes gRPC worker
  threads through the single event loop. Acceptable v1 latency; revisit if
  measured contention hurts. Future fix: async gRPC server.
- **MetaApi 2FA / broker session expiry**: MetaApi handles re-login
  automatically once the initial connect succeeds. First connect requires manual
  dashboard click for some brokers. Document as Phase-5 prerequisite in
  `DEPLOY.md`.
- **Plugin abstraction debt**: `BrokerProvider` Protocol may need refinement as
  we discover MetaApi-specific quirks (e.g., timezone semantics on `Candle.ts`).
  Acceptable — patch the protocol + all impls together.
- **Tests can't fully exercise MetaApi**: real network integration is the only
  verification of SDK contract. Mitigation: skipped-by-default integration test
  + ≥ 1 week soak in staging.
- **`adapter.py` shim deletion**: 1-release window before removal. Track in
  Plan 7 cleanup.

## 13. Acceptance criteria

- [ ] `mt5-sidecar/Dockerfile` builds locally and in CI in < 5 min.
- [ ] Image size ≤ 250 MB.
- [ ] `BROKER_PROVIDER=fake` boots sidecar with no creds (tests + dev).
- [ ] `BROKER_PROVIDER=metaapi` + valid creds → `MetaApiProvider.is_alive()`
      returns True within 30 s of boot.
- [ ] All existing pytest tests pass after migration (legacy MT5 path tests
      retargeted at `mt5_native.MT5Provider`).
- [ ] New `test_providers.py` covers factory dispatch + FakeProvider e2e.
- [ ] `test_metaapi_integration.py` is skipped by default in CI and passes when
      run with real creds.
- [ ] gRPC contract (`proto/mt5.proto`) unchanged.
- [ ] `agent-runner` + `paper-runner` boot with no code changes and connect
      via Service Connect to `mt5-sidecar:50051`.
- [ ] `aws ecs describe-tasks` shows `BROKER_PROVIDER=metaapi` env var injected
      on staging and prod tasks.
- [ ] Cost dashboard delta within ±$50/mo of estimate after 1-month soak.
- [ ] CI grep guard rejects `MetaApi(token=...)` in test files.
- [ ] No long-lived AWS access keys.
- [ ] All resources tagged `Project=forex-bot`, `Environment=<env>`,
      `ManagedBy=terraform`.
