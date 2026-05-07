# Forex Bot — Plan 6b: Sidecar Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `mt5-sidecar` deployable to ECS Fargate per `prd/specs/2026-05-06-forex-bot-sidecar-deploy-design.md`. Replace the stub Dockerfile with a Wine + Python-on-Windows + portable MT5 image. Add Terraform `modules/cluster` (shared per env) + `modules/sidecar`. Add env-var auto-login, gRPC health checks, and a watchdog-driven reconnect-or-die loop in the sidecar Python. Ship a GitHub Actions workflow that builds, pushes, and redeploys on push to `main`.

**Architecture:** One ECS Fargate service per env (`forex-bot-<env>-mt5-sidecar`), 1 vCPU / 2 GB, public-subnet with public IP, ingress 50051 only from `app-sg`. Container runs Linux + Wine 9 + Python-on-Windows + MT5 portable + sidecar gRPC inside Wine via `xvfb-run wine python -m mt5_sidecar`. Auto-login from Secrets Manager. Reconnect-or-die watchdog. CD on push to main via OIDC role from Plan 6a.

**Tech Stack:** Debian bookworm-slim, Wine 9 stable (`winehq-stable`), Python 3.11.9 (Windows), MetaTrader5 5.0.45, grpcio 1.66, grpcio-health-checking 1.66, grpc_health_probe 0.4.25, Terraform ≥ 1.10, hashicorp/aws ~> 5.70, GitHub Actions (`docker/build-push-action@v6`, `aws-actions/configure-aws-credentials@v4`, `aws-actions/amazon-ecr-login@v2`).

**Hard constraints:**
- Sidecar Python runs **inside Wine** in prod, but unit tests still run **natively** on Linux Python (mocking `MetaTrader5`). No test ever requires Wine.
- No long-lived AWS access keys.
- Sidecar IAM task role has only `secrets_read_policy_arn` attached.
- All resources tagged `Project=forex-bot`, `Environment=<env>`, `ManagedBy=terraform`.
- Pinned versions: Wine `winehq-stable`, Python 3.11.9, MetaTrader5 5.0.45. Bumps go through this plan-amend cycle, not ad-hoc.

---

## File structure produced by this plan

```
forex-bot/
├── .github/workflows/
│   ├── sidecar-image.yml                       # NEW: build + push + redeploy
│   └── infra.yml                               # MODIFIED: add docker-build smoke job
├── README.md                                   # MODIFIED: flip 6b status to done
├── infra/terraform/
│   ├── README.md                               # MODIFIED: append sidecar deploy runbook
│   ├── modules/
│   │   ├── cluster/                            # NEW: shared ECS cluster + execution role
│   │   │   ├── main.tf
│   │   │   ├── outputs.tf
│   │   │   ├── variables.tf
│   │   │   └── versions.tf
│   │   ├── sidecar/                            # NEW: log group + task role + task def + service
│   │   │   ├── main.tf
│   │   │   ├── outputs.tf
│   │   │   ├── variables.tf
│   │   │   └── versions.tf
│   │   └── ci-oidc/                            # MODIFIED: branch_filter → branch_filters list
│   │       ├── main.tf
│   │       └── variables.tf
│   └── envs/
│       ├── prod/main.tf                        # MODIFIED: add cluster + sidecar; update ci_oidc args
│       └── staging/main.tf                     # MODIFIED: same; widen branch_filters to include main
└── mt5-sidecar/
    ├── Dockerfile                              # REPLACED: Wine + Python-on-Windows + MT5 portable
    ├── entrypoint.sh                           # NEW: xvfb + wine python -m mt5_sidecar
    ├── pyproject.toml                          # MODIFIED: add grpcio-health-checking dep
    ├── src/mt5_sidecar/
    │   ├── __main__.py                         # MODIFIED: env-var auto-login + watchdog thread
    │   ├── adapter.py                          # MODIFIED: is_alive + reconnect_or_die
    │   └── server.py                           # MODIFIED: register Health servicer
    └── tests/
        ├── test_login.py                       # NEW: env-var → mt5.initialize kwargs
        ├── test_health.py                      # NEW: is_alive + servicer flips
        └── test_reconnect.py                   # NEW: reconnect retry/raise
```

---

## Task 1: Add `grpcio-health-checking` dep + regenerate uv lock

**Files:**
- Modify: `mt5-sidecar/pyproject.toml`

- [ ] **Step 1: Read current `pyproject.toml`**

Inspect the `[project] dependencies` (or `[tool.uv] dependencies`) array to find the existing entries (notably `grpcio` and `grpcio-tools`).

- [ ] **Step 2: Add `grpcio-health-checking` pin**

Add `"grpcio-health-checking==1.66.0"` to the runtime deps list (same array that already pins `grpcio==1.66.0`). Do not bump `grpcio` or `grpcio-tools`.

Example diff (exact line will depend on current array layout):
```toml
dependencies = [
  "grpcio==1.66.0",
  "grpcio-tools==1.66.0",
  "grpcio-health-checking==1.66.0",  # NEW
  "MetaTrader5==5.0.45",
  "protobuf==5.28.0",
]
```

- [ ] **Step 3: Regenerate lock**

```bash
cd mt5-sidecar
uv lock
```

Expected: `uv.lock` updated; `grpcio-health-checking` resolved to 1.66.0.

- [ ] **Step 4: Smoke install + import**

```bash
cd mt5-sidecar
uv sync
uv run python -c "from grpc_health.v1 import health, health_pb2, health_pb2_grpc; print('ok')"
```

Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
cd ..
git add mt5-sidecar/pyproject.toml mt5-sidecar/uv.lock
git commit -m "chore(mt5-sidecar): add grpcio-health-checking 1.66.0 dep"
```

---

## Task 2: Sidecar — auto-login from env vars

**Files:**
- Modify: `mt5-sidecar/src/mt5_sidecar/__main__.py`
- Create: `mt5-sidecar/tests/test_login.py`

- [ ] **Step 1: Write the failing test**

Create `mt5-sidecar/tests/test_login.py`:
```python
"""Tests for env-var driven MT5 login in __main__.main()."""

from __future__ import annotations
from unittest.mock import MagicMock, patch
import pytest


def _run_main_with_env(monkeypatch, env: dict[str, str], mt5_mock: MagicMock) -> None:
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    # Stop the gRPC server from blocking on wait_for_termination
    server = MagicMock()
    server.wait_for_termination.side_effect = SystemExit(0)
    with (
        patch("mt5_sidecar.__main__.MT5Adapter") as adapter_cls,
        patch("mt5_sidecar.__main__.build_server", return_value=server),
        patch.dict("sys.modules", {"MetaTrader5": mt5_mock}),
    ):
        adapter = MagicMock()
        adapter_cls.return_value = adapter
        from mt5_sidecar import __main__ as entry
        with pytest.raises(SystemExit):
            entry.main()
        return adapter


def test_login_uses_env_vars_when_all_three_present(monkeypatch):
    env = {"MT5_LOGIN": "12345", "MT5_SERVER": "ICMarketsSC-Demo", "MT5_PASSWORD": "secret"}
    adapter = _run_main_with_env(monkeypatch, env, MagicMock())
    adapter.initialize.assert_called_once_with(
        login=12345, server="ICMarketsSC-Demo", password="secret"
    )


def test_login_falls_back_to_no_args_when_env_missing(monkeypatch):
    monkeypatch.delenv("MT5_LOGIN", raising=False)
    monkeypatch.delenv("MT5_SERVER", raising=False)
    monkeypatch.delenv("MT5_PASSWORD", raising=False)
    adapter = _run_main_with_env(monkeypatch, {}, MagicMock())
    adapter.initialize.assert_called_once_with()


def test_login_raises_on_non_numeric_login(monkeypatch):
    env = {"MT5_LOGIN": "abc", "MT5_SERVER": "X", "MT5_PASSWORD": "y"}
    with pytest.raises(ValueError):
        _run_main_with_env(monkeypatch, env, MagicMock())
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd mt5-sidecar
uv run pytest tests/test_login.py -v
```

Expected: 3 FAILED. Either `entry.main()` doesn't read env vars, or the assertion mismatch shows the current `adapter.initialize()` always passes no args.

- [ ] **Step 3: Update `__main__.py` to read env vars**

Open `mt5-sidecar/src/mt5_sidecar/__main__.py`. Replace the existing `main()` body so that the `adapter.initialize(...)` call uses env-var creds when all three are present.

Resulting file content (full file, post-edit):
```python
"""Entrypoint: bootstraps the real MetaTrader5 SDK and starts the gRPC server."""

from __future__ import annotations

import os
import signal
from typing import NoReturn

from .adapter import MT5Adapter
from .server import build_server


def main() -> NoReturn:
    try:
        import MetaTrader5 as mt5  # type: ignore[import-not-found]
    except ImportError as e:
        raise SystemExit(
            "MetaTrader5 package not installed (install with `[mt5]` extra)"
        ) from e

    adapter = MT5Adapter(mt5)

    login = os.environ.get("MT5_LOGIN")
    server_name = os.environ.get("MT5_SERVER")
    password = os.environ.get("MT5_PASSWORD")
    if login and server_name and password:
        adapter.initialize(login=int(login), server=server_name, password=password)
    else:
        adapter.initialize()

    host = os.environ.get("MT5_SIDECAR_HOST", "0.0.0.0")
    port = int(os.environ.get("MT5_SIDECAR_PORT", "50051"))
    server = build_server(adapter, host=host, port=port)
    server.start()

    def _shutdown(signum, frame):  # noqa: ANN001
        server.stop(grace=3)
        adapter.shutdown()
        raise SystemExit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)
    print(f"mt5-sidecar listening on {host}:{port}", flush=True)
    server.wait_for_termination()
    raise SystemExit(0)


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd mt5-sidecar
uv run pytest tests/test_login.py -v
```

Expected: 3 PASSED.

- [ ] **Step 5: Run full suite to catch regressions**

```bash
uv run pytest -v
```

Expected: all tests pass (existing + 3 new).

- [ ] **Step 6: Commit**

```bash
cd ..
git add mt5-sidecar/src/mt5_sidecar/__main__.py mt5-sidecar/tests/test_login.py
git commit -m "feat(mt5-sidecar): env-var driven MT5 auto-login"
```

---

## Task 3: Sidecar — `is_alive` + `reconnect_or_die` on `MT5Adapter`

**Files:**
- Modify: `mt5-sidecar/src/mt5_sidecar/adapter.py`
- Create: `mt5-sidecar/tests/test_reconnect.py`

- [ ] **Step 1: Write the failing test**

Create `mt5-sidecar/tests/test_reconnect.py`:
```python
"""Tests for MT5Adapter.is_alive and reconnect_or_die."""

from __future__ import annotations
from unittest.mock import MagicMock
import pytest

from mt5_sidecar.adapter import MT5Adapter


def test_is_alive_true_when_account_info_returns_value():
    sdk = MagicMock()
    sdk.account_info.return_value = MagicMock(login=12345)
    adapter = MT5Adapter(sdk)
    assert adapter.is_alive() is True


def test_is_alive_false_when_account_info_returns_none():
    sdk = MagicMock()
    sdk.account_info.return_value = None
    adapter = MT5Adapter(sdk)
    assert adapter.is_alive() is False


def test_is_alive_false_when_account_info_raises():
    sdk = MagicMock()
    sdk.account_info.side_effect = RuntimeError("disconnected")
    adapter = MT5Adapter(sdk)
    assert adapter.is_alive() is False


def test_reconnect_or_die_succeeds_on_first_attempt():
    sdk = MagicMock()
    sdk.initialize.return_value = True
    adapter = MT5Adapter(sdk)
    adapter.initialize(login=12345, server="X", password="y")
    sdk.initialize.reset_mock()
    sdk.shutdown.reset_mock()
    sdk.initialize.return_value = True
    adapter.reconnect_or_die()
    sdk.shutdown.assert_called_once()
    sdk.initialize.assert_called_once_with(login=12345, server="X", password="y")


def test_reconnect_or_die_raises_after_exhausting_attempts():
    sdk = MagicMock()
    sdk.initialize.return_value = True
    adapter = MT5Adapter(sdk)
    adapter.initialize()  # store empty kwargs
    sdk.initialize.reset_mock()
    sdk.initialize.return_value = False  # always fail
    with pytest.raises(RuntimeError, match="reconnect failed"):
        adapter.reconnect_or_die(max_attempts=2)
    assert sdk.initialize.call_count == 2
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd mt5-sidecar
uv run pytest tests/test_reconnect.py -v
```

Expected: 5 FAILED. `MT5Adapter` has no `is_alive` or `reconnect_or_die` yet, and `initialize()` does not record kwargs.

- [ ] **Step 3: Update `adapter.py` to add the methods**

Open `mt5-sidecar/src/mt5_sidecar/adapter.py`. Read the current contents and apply this edit:

Add an instance attribute that records the last `initialize()` kwargs, then add `is_alive()` and `reconnect_or_die()`.

Full resulting `adapter.py` (replace the file contents from `class MT5Adapter` onward with the version below; preserve any existing imports above the class):

```python
from __future__ import annotations

import time
from typing import Any, Protocol


class MT5SDK(Protocol):
    def initialize(self, *args: Any, **kwargs: Any) -> bool: ...
    def shutdown(self) -> None: ...
    def account_info(self) -> Any: ...


class MT5Adapter:
    def __init__(self, sdk: MT5SDK) -> None:
        self._sdk = sdk
        self._init_kwargs: dict[str, Any] = {}

    def initialize(self, **kwargs: Any) -> None:
        self._init_kwargs = dict(kwargs)
        if not self._sdk.initialize(**kwargs):
            raise RuntimeError("MT5 initialize() failed")

    def shutdown(self) -> None:
        try:
            self._sdk.shutdown()
        except Exception:
            pass

    def is_alive(self) -> bool:
        try:
            return self._sdk.account_info() is not None
        except Exception:
            return False

    def reconnect_or_die(self, *, max_attempts: int = 1) -> None:
        """Retry MT5 initialize after a drop. On exhaustion, raise so the
        process exits and ECS replaces the task."""
        for _ in range(max_attempts):
            try:
                self._sdk.shutdown()
            except Exception:
                pass
            if self._sdk.initialize(**self._init_kwargs):
                return
            time.sleep(2)
        raise RuntimeError("MT5 reconnect failed; exiting for ECS restart")
```

NOTE: if the existing `adapter.py` has additional methods not shown above (e.g., wrappers around `mt5.copy_rates_*`, `mt5.symbol_info_tick`, etc.), preserve those untouched. The edit is purely additive aside from changing `__init__` to record `_init_kwargs` and `initialize()` to store them.

- [ ] **Step 4: Run reconnect tests**

```bash
cd mt5-sidecar
uv run pytest tests/test_reconnect.py -v
```

Expected: 5 PASSED.

- [ ] **Step 5: Run full suite to catch regressions**

```bash
uv run pytest -v
```

Expected: all tests pass (login + reconnect + existing).

- [ ] **Step 6: Commit**

```bash
cd ..
git add mt5-sidecar/src/mt5_sidecar/adapter.py mt5-sidecar/tests/test_reconnect.py
git commit -m "feat(mt5-sidecar): add is_alive + reconnect_or_die on MT5Adapter"
```

---

## Task 4: Sidecar — gRPC health service registration

**Files:**
- Modify: `mt5-sidecar/src/mt5_sidecar/server.py`
- Modify: `mt5-sidecar/src/mt5_sidecar/__main__.py` (start the watchdog thread; refresh health status)
- Create: `mt5-sidecar/tests/test_health.py`

- [ ] **Step 1: Write the failing test**

Create `mt5-sidecar/tests/test_health.py`:
```python
"""Tests for gRPC health service wiring + watchdog refresh."""

from __future__ import annotations
import time
from unittest.mock import MagicMock
from grpc_health.v1 import health_pb2

from mt5_sidecar.server import build_server, _build_health_servicer
from mt5_sidecar.adapter import MT5Adapter


def test_build_server_registers_health_servicer():
    sdk = MagicMock()
    adapter = MT5Adapter(sdk)
    server = build_server(adapter, host="127.0.0.1", port=0)
    # Health is registered by name on the same server. Sanity: server is a grpc.Server.
    import grpc
    assert isinstance(server, grpc.Server)


def test_health_servicer_reflects_adapter_state():
    sdk = MagicMock()
    sdk.account_info.return_value = MagicMock()  # alive
    adapter = MT5Adapter(sdk)
    servicer = _build_health_servicer(adapter, refresh_interval_s=0.01)
    time.sleep(0.05)
    assert servicer.check("").status == health_pb2.HealthCheckResponse.SERVING
    assert servicer.check("mt5.MT5Bridge").status == health_pb2.HealthCheckResponse.SERVING

    # Now flip to not alive
    sdk.account_info.return_value = None
    time.sleep(0.05)
    assert servicer.check("").status == health_pb2.HealthCheckResponse.NOT_SERVING
    assert servicer.check("mt5.MT5Bridge").status == health_pb2.HealthCheckResponse.NOT_SERVING
```

NOTE: the test imports a `_build_health_servicer` helper that does not exist yet — that's the point of TDD.

- [ ] **Step 2: Run test to verify it fails**

```bash
cd mt5-sidecar
uv run pytest tests/test_health.py -v
```

Expected: 2 FAILED. `_build_health_servicer` not importable; the existing server may not register a Health service at all.

- [ ] **Step 3: Update `server.py` to register the Health servicer**

Open `mt5-sidecar/src/mt5_sidecar/server.py`. Read the current `build_server` function. The current shape is approximately:
```python
def build_server(adapter: MT5Adapter, *, host: str, port: int) -> grpc.Server:
    server = grpc.server(...)
    add_MT5BridgeServicer_to_server(MT5BridgeServicer(adapter), server)
    server.add_insecure_port(f"{host}:{port}")
    return server
```

Apply this edit: introduce a private helper `_build_health_servicer` that wires a background daemon thread to refresh status from `adapter.is_alive()`, then call it from `build_server` and register it on the server.

Append/integrate (preserve existing imports above):
```python
import threading
from grpc_health.v1 import health, health_pb2, health_pb2_grpc


def _build_health_servicer(
    adapter: MT5Adapter, *, refresh_interval_s: float = 5.0
) -> health.HealthServicer:
    servicer = health.HealthServicer()
    servicer.set("", health_pb2.HealthCheckResponse.SERVING)
    servicer.set("mt5.MT5Bridge", health_pb2.HealthCheckResponse.SERVING)

    def _refresh() -> None:
        while True:
            ok = adapter.is_alive()
            status = (
                health_pb2.HealthCheckResponse.SERVING
                if ok
                else health_pb2.HealthCheckResponse.NOT_SERVING
            )
            servicer.set("", status)
            servicer.set("mt5.MT5Bridge", status)
            time.sleep(refresh_interval_s)

    threading.Thread(target=_refresh, name="mt5-health-refresh", daemon=True).start()
    return servicer
```

In `build_server`, after the existing `add_MT5BridgeServicer_to_server(...)` call, add:
```python
    health_servicer = _build_health_servicer(adapter)
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)
```

NOTE: the `time` module needs to be importable. Add `import time` at the top of `server.py` if it is not already imported.

- [ ] **Step 4: Run health tests**

```bash
cd mt5-sidecar
uv run pytest tests/test_health.py -v
```

Expected: 2 PASSED.

- [ ] **Step 5: Wire the watchdog thread in `__main__.py`**

The health servicer reflects state. The watchdog enforces the reconnect-or-die policy. They are separate concerns — the health refresh thread does not call `reconnect_or_die`.

Open `mt5-sidecar/src/mt5_sidecar/__main__.py`. After `server.start()` and before `signal.signal(signal.SIGINT, ...)`, add a watchdog daemon thread:

```python
import threading
import time
def _watchdog() -> None:
    consecutive_failures = 0
    while True:
        time.sleep(30.0)
        if adapter.is_alive():
            consecutive_failures = 0
            continue
        consecutive_failures += 1
        print(
            f"mt5-sidecar: liveness probe failed (consecutive={consecutive_failures})",
            flush=True,
        )
        if consecutive_failures == 1:
            try:
                adapter.reconnect_or_die(max_attempts=1)
                consecutive_failures = 0
                continue
            except Exception as exc:
                print(f"mt5-sidecar: reconnect attempt failed: {exc}", flush=True)
        if consecutive_failures >= 2:
            print("mt5-sidecar: liveness probe failed twice; exiting for ECS restart", flush=True)
            os._exit(1)

threading.Thread(target=_watchdog, name="mt5-watchdog", daemon=True).start()
```

`os._exit(1)` is intentional — it bypasses cleanup so the gRPC server doesn't drain mid-shutdown, ensuring ECS sees a fast exit and replaces the task.

Add `import threading`, `import time` at the top of `__main__.py` if not already imported.

- [ ] **Step 6: Run full suite**

```bash
cd mt5-sidecar
uv run pytest -v
```

Expected: all tests pass (login + reconnect + health + existing).

- [ ] **Step 7: Commit**

```bash
cd ..
git add mt5-sidecar/src/mt5_sidecar/server.py mt5-sidecar/src/mt5_sidecar/__main__.py mt5-sidecar/tests/test_health.py
git commit -m "feat(mt5-sidecar): gRPC health service + watchdog reconnect-or-die"
```

---

## Task 5: Replace Dockerfile + add `entrypoint.sh`

**Files:**
- Replace: `mt5-sidecar/Dockerfile`
- Create: `mt5-sidecar/entrypoint.sh`

- [ ] **Step 1: Write the new `Dockerfile`**

Replace `mt5-sidecar/Dockerfile` with:
```dockerfile
# MT5 sidecar — Linux + Wine 9 stable + Python-on-Windows + portable MT5 terminal.
# Sidecar gRPC server runs INSIDE Wine via `xvfb-run wine python -m mt5_sidecar`.
# See prd/specs/2026-05-06-forex-bot-sidecar-deploy-design.md §4.

FROM debian:bookworm-slim AS wine-base

ENV DEBIAN_FRONTEND=noninteractive \
    WINEPREFIX=/wine \
    WINEARCH=win64 \
    WINEDEBUG=-all \
    DISPLAY=:99

RUN dpkg --add-architecture i386 && \
    apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl gnupg xvfb \
      libfreetype6 libgnutls30 \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://dl.winehq.org/wine-builds/winehq.key \
       | gpg --dearmor -o /etc/apt/keyrings/winehq.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/winehq.gpg] https://dl.winehq.org/wine-builds/debian/ bookworm main" \
       > /etc/apt/sources.list.d/winehq.list \
    && apt-get update && apt-get install -y --no-install-recommends winehq-stable \
    && rm -rf /var/lib/apt/lists/*

RUN xvfb-run wine wineboot --init && xvfb-run wineserver -w


FROM wine-base AS python-win

ARG PYTHON_VERSION=3.11.9
RUN curl -fsSL "https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-amd64.exe" -o /tmp/py.exe && \
    xvfb-run wine /tmp/py.exe /quiet InstallAllUsers=1 PrependPath=1 Include_test=0 && \
    rm /tmp/py.exe && xvfb-run wineserver -w

RUN xvfb-run wine python -m pip install --no-cache-dir \
      MetaTrader5==5.0.45 \
      grpcio==1.66.0 \
      grpcio-health-checking==1.66.0 \
      grpcio-tools==1.66.0 \
      protobuf==5.28.0


FROM python-win AS mt5

RUN curl -fsSL https://download.mql5.com/cdn/web/metaquotes.software.corp/mt5/mt5setup.exe -o /tmp/mt5.exe && \
    xvfb-run wine /tmp/mt5.exe /portable /auto && \
    rm /tmp/mt5.exe && xvfb-run wineserver -w


FROM mt5 AS final

WORKDIR /app
COPY pyproject.toml uv.lock /app/
COPY src /app/src
COPY proto /proto

ARG GRPC_HEALTH_PROBE_VERSION=v0.4.25
RUN curl -fsSL "https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/${GRPC_HEALTH_PROBE_VERSION}/grpc_health_probe-linux-amd64" \
      -o /usr/local/bin/grpc_health_probe && chmod +x /usr/local/bin/grpc_health_probe

# Generate proto stubs into the Wine-side site-packages so the sidecar can import them.
RUN xvfb-run wine python -m grpc_tools.protoc \
      -I/proto \
      --python_out=/app/src/mt5_sidecar/generated \
      --grpc_python_out=/app/src/mt5_sidecar/generated \
      /proto/mt5.proto

EXPOSE 50051

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD grpc_health_probe -addr=:50051 || exit 1

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]
```

NOTE 1: the build context for the eventual `docker build` is `mt5-sidecar/`, but the Dockerfile copies `proto/` which lives at the repo root. Two options:
- (a) Build context is the repo root, with `-f mt5-sidecar/Dockerfile` — `COPY proto /proto` works directly.
- (b) Add a build step that copies `proto/` into `mt5-sidecar/proto/` first.

Plan adopts (a). Task 11 (CI) sets `context: .` and `file: mt5-sidecar/Dockerfile` accordingly.

NOTE 2: the proto-generation step writes `mt5_pb2.py` and `mt5_pb2_grpc.py` into `/app/src/mt5_sidecar/generated/`. The directory must exist as a proper package. The repo already has `mt5-sidecar/src/mt5_sidecar/generated/__init__.py` from Plan 2 — the `COPY src /app/src` step picks it up.

- [ ] **Step 2: Write `entrypoint.sh`**

Create `mt5-sidecar/entrypoint.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail

# Boot Xvfb so Wine + MT5 can paint to a virtual display
Xvfb :99 -screen 0 1024x768x16 &
XVFB_PID=$!
trap 'kill -TERM $XVFB_PID 2>/dev/null || true' EXIT

# Run sidecar inside the Wine prefix (Python-on-Windows imports MetaTrader5).
exec wine python -m mt5_sidecar
```

- [ ] **Step 3: Make sure `entrypoint.sh` is executable in git**

```bash
chmod +x mt5-sidecar/entrypoint.sh
git update-index --chmod=+x mt5-sidecar/entrypoint.sh
```

- [ ] **Step 4: Commit Dockerfile + entrypoint**

```bash
git add mt5-sidecar/Dockerfile mt5-sidecar/entrypoint.sh
git commit -m "feat(mt5-sidecar): replace Dockerfile with Wine + Python-on-Windows + portable MT5"
```

(Build smoke comes in Task 6 — separated so the commit cleanly captures the file change.)

---

## Task 6: Local Docker build smoke (mac via buildx)

**Files:** none modified. This is an operator/agent verification step.

- [ ] **Step 1: Run a local build for the linux/amd64 platform**

From the repo root:
```bash
docker buildx build --platform linux/amd64 -f mt5-sidecar/Dockerfile -t forex-bot/mt5-sidecar:smoke .
```

Expected: the build completes with no errors. Wait time: 8–12 min on first run, <1 min on subsequent runs (Docker layer cache).

If the build fails on the `wine /tmp/mt5.exe /portable /auto` layer, it usually means the MetaQuotes installer surfaced an interactive dialog. Retry once. If it persistently fails, the spec's §11 fallback applies — switch to a build-arg-driven URL and re-run; otherwise BLOCK and report.

If the build fails on the `grpc_tools.protoc` layer, ensure the repo root contains `proto/mt5.proto` (already exists — created in Plan 2) and that the build context is the repo root (`.`), not `mt5-sidecar/`.

- [ ] **Step 2: Inspect image size**

```bash
docker image inspect forex-bot/mt5-sidecar:smoke --format '{{.Size}}' | awk '{ printf "%.2f GB\n", $1/1024/1024/1024 }'
```

Expected: 2.0–2.5 GB. Numbers significantly above 3 GB warrant inspection of which layer ballooned.

- [ ] **Step 3: Document the smoke result**

No file change. Report back with:
- Final image size.
- Any layer that took >5 min on first build.
- Any non-fatal warning printed by Wine.

(No commit for this task — verification only.)

---

## Task 7: `modules/cluster` — shared ECS cluster + execution role

**Files:**
- Create: `infra/terraform/modules/cluster/{main.tf,outputs.tf,variables.tf,versions.tf}`

- [ ] **Step 1: Write `modules/cluster/versions.tf`**

```hcl
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.70" }
  }
}
```

- [ ] **Step 2: Write `modules/cluster/variables.tf`**

```hcl
variable "env" {
  description = "Environment name (prod, staging)"
  type        = string
}

variable "secrets_read_policy_arn" {
  description = "ARN of the IAM policy granting read access to the env's Secrets Manager blob (from modules/secrets)"
  type        = string
}

variable "common_tags" {
  description = "Tags applied to every resource"
  type        = map(string)
}
```

- [ ] **Step 3: Write `modules/cluster/main.tf`**

```hcl
locals {
  name_prefix = "forex-bot-${var.env}"
}

resource "aws_ecs_cluster" "main" {
  name = "${local.name_prefix}-cluster"

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-cluster" })
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = 0
  }
}

data "aws_iam_policy_document" "task_execution_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "task_execution" {
  name               = "${local.name_prefix}-ecs-task-execution"
  assume_role_policy = data.aws_iam_policy_document.task_execution_trust.json
  tags               = merge(var.common_tags, { Name = "${local.name_prefix}-ecs-task-execution" })
}

resource "aws_iam_role_policy_attachment" "task_execution_managed" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy_attachment" "task_execution_secrets_read" {
  role       = aws_iam_role.task_execution.name
  policy_arn = var.secrets_read_policy_arn
}
```

- [ ] **Step 4: Write `modules/cluster/outputs.tf`**

```hcl
output "cluster_arn" {
  value = aws_ecs_cluster.main.arn
}

output "cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "task_execution_role_arn" {
  value = aws_iam_role.task_execution.arn
}
```

- [ ] **Step 5: Format + validate**

```bash
cd infra/terraform/modules/cluster
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 6: Commit**

```bash
cd ../../../..
git add infra/terraform/modules/cluster
git commit -m "feat(infra): add cluster module (shared ECS cluster + task execution role)"
```

---

## Task 8: `modules/sidecar` — log group, task role, task def, service

**Files:**
- Create: `infra/terraform/modules/sidecar/{main.tf,outputs.tf,variables.tf,versions.tf}`

- [ ] **Step 1: Write `modules/sidecar/versions.tf`**

```hcl
terraform {
  required_version = ">= 1.10"
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 5.70" }
  }
}
```

- [ ] **Step 2: Write `modules/sidecar/variables.tf`**

```hcl
variable "env" {
  description = "Environment name"
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

variable "secrets_read_policy_arn" {
  description = "IAM policy ARN granting read on the env Secrets Manager blob (from modules/secrets)"
  type        = string
}

variable "secret_arn" {
  description = "ARN of the Secrets Manager blob (used for valueFrom references)"
  type        = string
}

variable "vpc_subnet_ids" {
  description = "Subnet IDs in which the sidecar service runs"
  type        = list(string)
}

variable "app_sg_id" {
  description = "Application security group; sidecar joins it (intra-app ingress + wide egress)"
  type        = string
}

variable "ecr_repo_url" {
  description = "ECR repository URL (e.g. 1234.dkr.ecr.eu-west-2.amazonaws.com/forex-bot/staging/mt5-sidecar)"
  type        = string
}

variable "image_tag" {
  description = "Image tag deployed to the cluster"
  type        = string
  default     = "latest"
}

variable "common_tags" {
  description = "Tags applied to every resource"
  type        = map(string)
}
```

- [ ] **Step 3: Write `modules/sidecar/main.tf`**

```hcl
locals {
  name_prefix    = "forex-bot-${var.env}"
  log_group_name = "/forex-bot/${var.env}/mt5-sidecar"
}

resource "aws_cloudwatch_log_group" "sidecar" {
  name              = local.log_group_name
  retention_in_days = 14
  tags              = merge(var.common_tags, { Name = "${local.name_prefix}-mt5-sidecar-logs" })
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
  name               = "${local.name_prefix}-mt5-sidecar-task"
  assume_role_policy = data.aws_iam_policy_document.task_role_trust.json
  tags               = merge(var.common_tags, { Name = "${local.name_prefix}-mt5-sidecar-task" })
}

resource "aws_iam_role_policy_attachment" "task_secrets_read" {
  role       = aws_iam_role.task.name
  policy_arn = var.secrets_read_policy_arn
}

resource "aws_ecs_task_definition" "sidecar" {
  family                   = "${local.name_prefix}-mt5-sidecar"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "1024"
  memory                   = "2048"
  execution_role_arn       = var.task_execution_role_arn
  task_role_arn            = aws_iam_role.task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "mt5-sidecar"
      image     = "${var.ecr_repo_url}:${var.image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = 50051
          protocol      = "tcp"
        }
      ]

      environment = [
        { name = "MT5_SIDECAR_HOST", value = "0.0.0.0" },
        { name = "MT5_SIDECAR_PORT", value = "50051" },
      ]

      secrets = [
        { name = "MT5_LOGIN", valueFrom = "${var.secret_arn}:mt5Login::" },
        { name = "MT5_PASSWORD", valueFrom = "${var.secret_arn}:mt5Password::" },
        { name = "MT5_SERVER", valueFrom = "${var.secret_arn}:mt5Server::" },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = local.log_group_name
          awslogs-region        = data.aws_region.current.name
          awslogs-stream-prefix = "mt5-sidecar"
        }
      }
    }
  ])

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-mt5-sidecar-td" })
}

data "aws_region" "current" {}

resource "aws_ecs_service" "sidecar" {
  name                               = "${local.name_prefix}-mt5-sidecar"
  cluster                            = var.cluster_arn
  task_definition                    = aws_ecs_task_definition.sidecar.arn
  desired_count                      = 1
  launch_type                        = "FARGATE"
  enable_execute_command             = true
  wait_for_steady_state              = false
  deployment_minimum_healthy_percent = 0
  deployment_maximum_percent         = 100

  network_configuration {
    subnets          = var.vpc_subnet_ids
    security_groups  = [var.app_sg_id]
    assign_public_ip = true
  }

  lifecycle {
    ignore_changes = [task_definition]
  }

  tags = merge(var.common_tags, { Name = "${local.name_prefix}-mt5-sidecar-svc" })
}
```

- [ ] **Step 4: Write `modules/sidecar/outputs.tf`**

```hcl
output "service_name" {
  value = aws_ecs_service.sidecar.name
}

output "task_role_arn" {
  value = aws_iam_role.task.arn
}

output "task_definition_arn" {
  value = aws_ecs_task_definition.sidecar.arn
}

output "log_group_name" {
  value = aws_cloudwatch_log_group.sidecar.name
}
```

- [ ] **Step 5: Format + validate**

```bash
cd infra/terraform/modules/sidecar
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 6: Commit**

```bash
cd ../../../..
git add infra/terraform/modules/sidecar
git commit -m "feat(infra): add sidecar module (log group, task role, task def, service)"
```

---

## Task 9: `modules/ci-oidc` — `branch_filter` → `branch_filters` list

**Files:**
- Modify: `infra/terraform/modules/ci-oidc/variables.tf`
- Modify: `infra/terraform/modules/ci-oidc/main.tf`

- [ ] **Step 1: Replace `variable "branch_filter"` with `variable "branch_filters"`**

In `infra/terraform/modules/ci-oidc/variables.tf`, replace the existing block:
```hcl
variable "branch_filter" {
  description = "GitHub Actions sub-claim filter (e.g. 'ref:refs/heads/main' or 'pull_request')"
  type        = string
}
```
with:
```hcl
variable "branch_filters" {
  description = "List of GitHub Actions sub-claim suffixes (e.g. ['ref:refs/heads/main', 'pull_request']). At least one entry required."
  type        = list(string)

  validation {
    condition     = length(var.branch_filters) > 0
    error_message = "branch_filters must contain at least one entry."
  }
}
```

- [ ] **Step 2: Update the trust policy in `main.tf`**

In `infra/terraform/modules/ci-oidc/main.tf`, find the trust-policy `condition` for the `sub` variable. Replace:
```hcl
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["repo:${var.github_org}/${var.github_repo}:${var.branch_filter}"]
    }
```
with:
```hcl
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:sub"
      values   = [for f in var.branch_filters : "repo:${var.github_org}/${var.github_repo}:${f}"]
    }
```

- [ ] **Step 3: Format + validate**

```bash
cd infra/terraform/modules/ci-oidc
terraform fmt -recursive
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 4: Commit**

```bash
cd ../../../..
git add infra/terraform/modules/ci-oidc
git commit -m "refactor(infra): ci-oidc accepts branch_filters list (multiple sub claims)"
```

---

## Task 10: Wire cluster + sidecar into both env stacks; widen staging trust

**Files:**
- Modify: `infra/terraform/envs/staging/main.tf`
- Modify: `infra/terraform/envs/prod/main.tf`

- [ ] **Step 1: Update `envs/staging/main.tf`**

In `infra/terraform/envs/staging/main.tf`:

1. Find the existing `module "ci_oidc"` block. Change `branch_filter = "pull_request"` to:
   ```hcl
   branch_filters = ["pull_request", "ref:refs/heads/main"]
   ```
   Remove the old `branch_filter = "..."` line.

2. Append two new module blocks **after** the `module "ci_oidc"` block:

```hcl
module "cluster" {
  source                  = "../../modules/cluster"
  env                     = var.env
  secrets_read_policy_arn = module.secrets.read_policy_arn
  common_tags             = local.common_tags
}

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

- [ ] **Step 2: Update `envs/staging/outputs.tf`**

Append:
```hcl
output "ecs_cluster_name" {
  value = module.cluster.cluster_name
}

output "sidecar_service_name" {
  value = module.sidecar.service_name
}

output "sidecar_log_group_name" {
  value = module.sidecar.log_group_name
}
```

- [ ] **Step 3: Update `envs/prod/main.tf`**

In `infra/terraform/envs/prod/main.tf`:

1. Find the existing `module "ci_oidc"` block. Change `branch_filter = "ref:refs/heads/main"` to:
   ```hcl
   branch_filters = ["ref:refs/heads/main"]
   ```
   Remove the old `branch_filter` line.

2. Append the same two module blocks (verbatim — copy from Step 1 staging Step 2 above):

```hcl
module "cluster" {
  source                  = "../../modules/cluster"
  env                     = var.env
  secrets_read_policy_arn = module.secrets.read_policy_arn
  common_tags             = local.common_tags
}

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

- [ ] **Step 4: Update `envs/prod/outputs.tf`**

Append:
```hcl
output "ecs_cluster_name" {
  value = module.cluster.cluster_name
}

output "sidecar_service_name" {
  value = module.sidecar.service_name
}

output "sidecar_log_group_name" {
  value = module.sidecar.log_group_name
}
```

- [ ] **Step 5: Format + validate both envs**

```bash
cd infra/terraform/envs/staging && terraform fmt -recursive && terraform init -backend=false && terraform validate
cd ../prod && terraform fmt -recursive && terraform init -backend=false && terraform validate
```

Expected: `Success! The configuration is valid.` for both.

- [ ] **Step 6: Commit**

```bash
cd ../../..
git add infra/terraform/envs/staging infra/terraform/envs/prod
git commit -m "feat(infra): wire cluster + sidecar into envs; widen staging OIDC trust to main"
```

---

## Task 11: GH Actions `sidecar-image.yml` — build + push + redeploy

**Files:**
- Create: `.github/workflows/sidecar-image.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/sidecar-image.yml`:
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

      - name: Set up Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build and push
        uses: docker/build-push-action@v6
        with:
          context: .
          file: mt5-sidecar/Dockerfile
          platforms: linux/amd64
          push: true
          tags: |
            ${{ steps.login-ecr.outputs.registry }}/forex-bot/${{ matrix.env }}/mt5-sidecar:${{ github.sha }}
            ${{ steps.login-ecr.outputs.registry }}/forex-bot/${{ matrix.env }}/mt5-sidecar:latest
          cache-from: type=gha,scope=mt5-sidecar-${{ matrix.env }}
          cache-to: type=gha,mode=max,scope=mt5-sidecar-${{ matrix.env }}

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

- [ ] **Step 2: YAML lint smoke**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/sidecar-image.yml')); print('yaml ok')"
```

Expected: `yaml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/sidecar-image.yml
git commit -m "ci: add sidecar-image workflow (build + push + ECS redeploy on main)"
```

---

## Task 12: Extend `infra.yml` with PR-time docker build smoke

**Files:**
- Modify: `.github/workflows/infra.yml`

- [ ] **Step 1: Append the `sidecar-build` job**

In `.github/workflows/infra.yml`, add a new top-level job under the existing `jobs:` map (alongside `terraform` and `tfsec`):

```yaml
  sidecar-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: Build (no push) — smoke
        uses: docker/build-push-action@v6
        with:
          context: .
          file: mt5-sidecar/Dockerfile
          platforms: linux/amd64
          push: false
          cache-from: type=gha,scope=mt5-sidecar-pr
          cache-to: type=gha,mode=max,scope=mt5-sidecar-pr
```

Also extend the `paths:` filter on `push` and `pull_request` triggers at the top of the file to include sidecar paths so this job runs whenever sidecar code or proto changes (the existing terraform job already filters on `infra/terraform/**`, so we additively widen).

Find the existing trigger:
```yaml
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
```
and replace with:
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

- [ ] **Step 2: YAML lint smoke**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/infra.yml')); print('yaml ok')"
```

Expected: `yaml ok`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/infra.yml
git commit -m "ci(infra): add sidecar-build job (PR-time docker build smoke)"
```

---

## Task 13: README runbook update

**Files:**
- Modify: `infra/terraform/README.md`

- [ ] **Step 1: Append a "Sidecar deploy (Plan 6b)" section**

At the end of `infra/terraform/README.md`, append:

````markdown

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
grpcurl -plaintext "$TASK_IP:50051" mt5.MT5Bridge/GetAccount
# Expected: a real broker AccountResponse JSON
```

### Troubleshooting
- **Task fails to pull image**: check `forex-bot-$ENV-ci` role has `ecr:GetAuthorizationToken`; verify image tag exists in ECR.
- **Task starts but health probe fails**: tail CloudWatch logs; common causes: bad `MT5_SERVER` value, broker server is in maintenance, MT5 portable binary couldn't reach broker (broker IP firewall on this AWS region).
- **Reconnect loop is hot**: the broker is dropping mid-tick. Check broker's status page; verify your account isn't expired.
- **`aws ecs execute-command` fails**: the Wine+Python-Win container may not have `amazon-ssm-agent`. Fall back to log tailing.
````

- [ ] **Step 2: Commit**

```bash
git add infra/terraform/README.md
git commit -m "docs(infra): add Plan 6b sidecar deploy runbook"
```

---

## Task 14: Flip Plan 6b status in root README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update plan-status row**

In `README.md` under `## Plans`, find:
```
| 6b — Sidecar deploy | pending | Wine + portable MT5 + ECS task |
```
Replace with:
```
| 6b — Sidecar deploy | done | Wine + portable MT5 + ECS task |
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: flip Plan 6b status to done"
```

---

## Done-Done Checklist

- [ ] `make test` passes in `mt5-sidecar/` (login + reconnect + health + existing).
- [ ] `docker buildx build --platform linux/amd64 -f mt5-sidecar/Dockerfile -t forex-bot/mt5-sidecar:smoke .` succeeds locally.
- [ ] `terraform validate` passes for `modules/cluster`, `modules/sidecar`, `modules/ci-oidc`, both envs.
- [ ] `terraform fmt -check -recursive infra/terraform/` passes.
- [ ] `terraform apply` succeeds in `envs/staging` — ECS service exists, first task fails health (no image yet).
- [ ] First `gh workflow run sidecar-image.yml` succeeds, pushes image, ECS redeploys; service stable; task `RUNNING` + `HEALTHY`.
- [ ] CloudWatch logs show `mt5-sidecar listening on 0.0.0.0:50051` and a successful `mt5.account_info()` call.
- [ ] `grpc_health_probe -addr=<task-ip>:50051` returns `SERVING` from a debug task in `app-sg`.
- [ ] `grpcurl -plaintext <task-ip>:50051 mt5.MT5Bridge/GetAccount` returns a real broker account response.
- [ ] `pnpm test`, `pnpm -r typecheck`, `pnpm lint` still pass repo-wide (sidecar changes are Python-only — no TS impact expected, just sanity).
- [ ] Sidecar task IAM role has only `secrets_read_policy_arn` attached.
- [ ] All resources tagged `Project=forex-bot`, `Environment=<env>`, `ManagedBy=terraform`.
- [ ] No long-lived AWS access keys created.
- [ ] Cost dashboard delta within ±20% of $62/mo (combined prod + staging).

---

## Deferred to sub-plans 6c–6e and Plan 7

- ECS clusters/services for `agent-runner`, `paper-runner`, `data-ingest` (Plan 6c).
- Service discovery (Cloud Map / private DNS) so apps reach the sidecar by name (Plan 6c).
- CloudWatch dashboards, SNS alarms on sidecar restarts/log patterns (Plan 6d).
- ops-cli (Plan 6e).
- EFS-backed Wine prefix (deferred indefinitely; YAGNI).
- Linux-native MT5 alternative (e.g., MetaApi REST adapter) — separate effort if Wine path fails.
- Broker-IP egress allowlist on `app-sg` (Plan 7).
- PR-author allowlist on staging OIDC trust (Plan 7).
- GitHub Environments / manual approval gate on prod deploy (Plan 7).
- Auto-rotation of MT5 creds in Secrets Manager (Plan 7).
- RDS deletion protection toggle on prod (Plan 7).
- Observability: per-call latency, broker error counters, reconnect counts → CloudWatch metrics (Plan 6d).
