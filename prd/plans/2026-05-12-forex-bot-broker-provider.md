# Forex Bot — Plan 6f: Broker-provider plugin + MetaApi migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `mt5-sidecar` to a provider-plugin pattern per `prd/specs/2026-05-12-forex-bot-broker-provider-design.md`. Drop the broken Wine layer. Ship `MetaApiProvider` (primary) + `FakeProvider` (tests), with `MT5Provider` kept as an opt-in legacy path. Provider selected at boot via `BROKER_PROVIDER` env var. gRPC contract (`proto/mt5.proto`) unchanged — apps require zero code changes.

**Architecture:** New `mt5_sidecar.providers` subpackage. `BrokerProvider` Protocol in `base.py`; concrete impls in `metaapi.py`, `fake.py`, `mt5_native.py`. Factory `get_provider()` dispatches on `BROKER_PROVIDER` env var. `MetaApiProvider` wraps `metaapi_cloud_sdk` (async) and bridges to the sync gRPC server via one event loop + `threading.Lock`. Dockerfile becomes Linux-Python-only (~180 MB). `MetaTrader5` Python pkg moves to optional `[mt5]` extra.

**Tech Stack:** Python 3.11, `metaapi_cloud_sdk` (PyPI, pinned), `grpcio` 1.66, `grpcio-health-checking` 1.66, `grpcio-tools` 1.66, `protobuf` 5.28, `pytest`, Terraform ≥ 1.10, hashicorp/aws ~> 5.70, GitHub Actions.

**Hard constraints:**
- gRPC contract (`proto/mt5.proto`) is frozen for this plan.
- No long-lived AWS access keys.
- CI test environment never calls real MetaApi (grep guard).
- `agent-runner` / `paper-runner` source code is not touched.
- `MetaTrader5` Python pkg is **not** installed in the prod sidecar image.
- All Terraform `terraform fmt -check -recursive` + `terraform validate` pass.
- All pytest tests pass locally without network access (real-network test skipped by default).
- Existing pytest pass count of 17 is preserved or grows (target ~22-25 post-refactor).

---

## File structure produced by this plan

```
forex-bot/
├── .github/workflows/ci.yml                      # MODIFIED: + MetaApi grep guard
├── DEPLOY.md                                     # MODIFIED: + provider switch runbook
├── README.md                                     # MODIFIED: + Plan 6f row in plans table
├── infra/terraform/
│   ├── README.md                                 # MODIFIED: + provider switch section
│   ├── envs/
│   │   ├── prod/main.tf                          # MODIFIED: broker_provider arg
│   │   └── staging/main.tf                       # MODIFIED: broker_provider arg
│   └── modules/
│       ├── secrets/main.tf                       # MODIFIED: +metaApiToken, +metaApiAccountId
│       └── sidecar/
│           ├── main.tf                           # MODIFIED: + env/secrets MetaApi
│           └── variables.tf                      # MODIFIED: +var.broker_provider
└── mt5-sidecar/
    ├── Dockerfile                                # REPLACED: Linux Python only
    ├── pyproject.toml                            # MODIFIED: +metaapi-cloud-sdk, MetaTrader5 → [mt5] extra
    ├── uv.lock                                   # MODIFIED: regenerated
    ├── src/mt5_sidecar/
    │   ├── __main__.py                           # MODIFIED: uses providers.get_provider()
    │   ├── server.py                             # MODIFIED: typed against BrokerProvider
    │   ├── adapter.py                            # MODIFIED: re-export shim
    │   └── providers/                            # NEW
    │       ├── __init__.py                       # factory get_provider()
    │       ├── base.py                           # BrokerProvider Protocol + dataclasses
    │       ├── metaapi.py                        # MetaApiProvider
    │       ├── fake.py                           # FakeProvider
    │       └── mt5_native.py                     # legacy MT5Provider (moved from adapter.py)
    └── tests/
        ├── test_health.py                        # MODIFIED: imports update
        ├── test_login.py                         # REWRITTEN: factory dispatch tests
        ├── test_reconnect.py                     # MODIFIED: imports update
        ├── test_server.py                        # MODIFIED: uses FakeProvider
        ├── test_providers.py                     # NEW: factory + Fake e2e
        └── test_metaapi_integration.py           # NEW: skipped by default
```

---

## Task 1: Update `pyproject.toml` — add MetaApi SDK, move MT5 pkg to extra

**Files:**
- Modify: `mt5-sidecar/pyproject.toml`
- Modify: `mt5-sidecar/uv.lock`

- [ ] **Step 1: Read current `pyproject.toml` to understand current shape**

Current relevant content (already from Plan 6b):
```toml
dependencies = [
  "grpcio>=1.66.0",
  "grpcio-health-checking>=1.66.0",
  "protobuf>=5.27.0",
]

[project.optional-dependencies]
mt5 = ["MetaTrader5>=5.0.45"]
dev = [
  "grpcio-tools>=1.66.0",
  "pytest>=8.3",
  "pytest-asyncio>=0.24",
]
```

- [ ] **Step 2: Add `metaapi-cloud-sdk` to runtime deps**

Edit `mt5-sidecar/pyproject.toml`. The `dependencies` array becomes:
```toml
dependencies = [
  "grpcio>=1.66.0",
  "grpcio-health-checking>=1.66.0",
  "metaapi-cloud-sdk>=27.0.0",
  "protobuf>=5.27.0",
]
```

Leave `MetaTrader5>=5.0.45` in the `[project.optional-dependencies].mt5` block — that's its correct home now.

- [ ] **Step 3: Regenerate the lockfile**

```bash
cd mt5-sidecar
uv lock
```

Expected: `uv.lock` regenerates with `metaapi-cloud-sdk` resolved (likely 27.x or higher). Note: `uv lock` may bump transitive deps; that is acceptable.

- [ ] **Step 4: Install + smoke-import**

```bash
cd mt5-sidecar
uv sync
uv run python -c "from metaapi_cloud_sdk import MetaApi; print('metaapi-cloud-sdk ok')"
```

Expected: `metaapi-cloud-sdk ok`.

- [ ] **Step 5: Verify existing tests still pass before the refactor begins**

```bash
cd mt5-sidecar
uv run pytest -v
```

Expected: all 17 pre-refactor tests pass. No new tests yet.

- [ ] **Step 6: Commit**

```bash
cd ..
git add mt5-sidecar/pyproject.toml mt5-sidecar/uv.lock
git commit -m "chore(mt5-sidecar): add metaapi-cloud-sdk runtime dep"
```

---

## Task 2: Create `providers/base.py` — Protocol + dataclasses

**Files:**
- Create: `mt5-sidecar/src/mt5_sidecar/providers/__init__.py` (empty for now — final factory lands in Task 7)
- Create: `mt5-sidecar/src/mt5_sidecar/providers/base.py`

NOTE: Leaves `adapter.py` untouched at this stage. Until the shim lands in Task 4, the existing `adapter.py` keeps its own dataclass definitions and is the source-of-truth. Task 4 collapses them into `providers/base.py`. This avoids broken intermediate states during the migration.

- [ ] **Step 1: Create `providers/__init__.py` (empty placeholder)**

```python
"""Broker provider plugins. Factory + Protocol lands in __init__.py once
all sibling provider modules are added (see Tasks 3-7)."""
```

- [ ] **Step 2: Create `providers/base.py`**

```python
"""Broker provider Protocol + shared dataclasses.

All concrete providers (MetaApiProvider, FakeProvider, MT5Provider) implement
the BrokerProvider Protocol. The dataclasses are the wire shape used by
server.py to translate broker calls into proto messages.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True)
class Tick:
    ts: int
    symbol: str
    bid: float
    ask: float


@dataclass(frozen=True)
class Candle:
    ts: int
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass(frozen=True)
class Account:
    ts: int
    currency: str
    balance: float
    equity: float
    free_margin: float
    used_margin: float
    margin_level_pct: float


@dataclass(frozen=True)
class Position:
    id: str
    symbol: str
    side: str  # "buy" | "sell"
    lot_size: float
    entry: float
    sl: float
    tp: float
    opened_at: int


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
        self,
        symbol: str,
        side: str,
        lot_size: float,
        sl: float | None,
        tp: float | None,
        client_id: str | None,
    ) -> dict: ...
```

- [ ] **Step 3: Verify the new module imports cleanly**

```bash
cd mt5-sidecar
uv run python -c "from mt5_sidecar.providers.base import BrokerProvider, Tick, Candle, Account, Position; print('base ok')"
```

Expected: `base ok`.

- [ ] **Step 4: Confirm existing tests still pass**

```bash
uv run pytest -v
```

Expected: all 17 tests pass. The new `providers/` package is dormant — nothing imports it yet.

- [ ] **Step 5: Commit**

```bash
cd ..
git add mt5-sidecar/src/mt5_sidecar/providers/__init__.py mt5-sidecar/src/mt5_sidecar/providers/base.py
git commit -m "feat(mt5-sidecar): add providers/base.py with BrokerProvider Protocol"
```

---

## Task 3: Create `providers/mt5_native.py` — move legacy `MT5Adapter` as `MT5Provider`

**Files:**
- Create: `mt5-sidecar/src/mt5_sidecar/providers/mt5_native.py`

- [ ] **Step 1: Write `providers/mt5_native.py`**

This file contains the same logic that lived in `adapter.py` for `MT5Adapter`, but:
1. Renamed class to `MT5Provider`.
2. Reuses dataclasses from `providers.base` (not redeclaring them).
3. Imports `MetaTrader5` lazily inside `__init__` so the module loads even when the SDK is absent (factory tolerates missing `[mt5]` extra).

```python
"""Legacy MT5 native provider. Wraps the Windows-only `MetaTrader5` Python
package. Only usable when the `[mt5]` extra is installed AND when running
inside a Wine prefix that has the package available.

NOT installed in the default prod image. Opt-in via BROKER_PROVIDER=mt5.
"""

from __future__ import annotations

import time
from typing import Any, Iterable, Protocol

from ..mappings import (
    MT5_ORDER_TYPE_BUY,
    MT5_ORDER_TYPE_SELL,
    MT5_TRADE_ACTION_DEAL,
    MT5_TRADE_RETCODE_DONE,
    PROTO_TO_MT5_TIMEFRAME,
)
from .base import Account, BrokerProvider, Candle, Position, Tick


class MT5SDK(Protocol):
    """Subset of the `MetaTrader5` module API the adapter consumes."""

    def initialize(self, *args: Any, **kwargs: Any) -> bool: ...
    def shutdown(self) -> None: ...
    def symbol_info_tick(self, symbol: str) -> Any: ...
    def copy_rates_from_pos(
        self, symbol: str, timeframe: int, start: int, count: int
    ) -> Any: ...
    def account_info(self) -> Any: ...
    def positions_get(self) -> Iterable[Any]: ...
    def order_send(self, request: dict) -> Any: ...


class MT5Provider:
    """BrokerProvider implementation backed by the MetaTrader5 SDK."""

    def __init__(self, sdk: MT5SDK | None = None) -> None:
        if sdk is None:
            # Lazy import; raises ImportError with a useful message if the
            # MetaTrader5 package is not installed.
            try:
                import MetaTrader5 as mt5_module  # type: ignore[import-not-found]
            except ImportError as e:
                raise ImportError(
                    "MT5Provider requires the MetaTrader5 package "
                    "(install via the [mt5] extra). Use BROKER_PROVIDER=metaapi "
                    "or BROKER_PROVIDER=fake for environments without it."
                ) from e
            sdk = mt5_module  # type: ignore[assignment]
        self._sdk: MT5SDK = sdk
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

    def get_quote(self, symbol: str) -> Tick:
        info = self._sdk.symbol_info_tick(symbol)
        if info is None:
            raise ValueError(f"symbol_info_tick({symbol}) returned None")
        return Tick(
            ts=int(info.time_msc),
            symbol=symbol,
            bid=float(info.bid),
            ask=float(info.ask),
        )

    def get_candles(self, symbol: str, proto_timeframe: int, limit: int) -> list[Candle]:
        mt5_tf = PROTO_TO_MT5_TIMEFRAME.get(proto_timeframe)
        if mt5_tf is None:
            raise ValueError(f"unknown timeframe: {proto_timeframe}")
        rows = self._sdk.copy_rates_from_pos(symbol, mt5_tf, 0, limit)
        if rows is None:
            raise RuntimeError(f"copy_rates_from_pos({symbol}) returned None")
        return [
            Candle(
                ts=int(r["time"]) * 1000,
                open=float(r["open"]),
                high=float(r["high"]),
                low=float(r["low"]),
                close=float(r["close"]),
                volume=float(r["tick_volume"]),
            )
            for r in rows
        ]

    def get_account(self) -> Account:
        info = self._sdk.account_info()
        if info is None:
            raise RuntimeError("account_info() returned None")
        return Account(
            ts=int(time.time() * 1000),
            currency=str(info.currency),
            balance=float(info.balance),
            equity=float(info.equity),
            free_margin=float(info.margin_free),
            used_margin=float(info.margin),
            margin_level_pct=float(info.margin_level or 0),
        )

    def get_open_positions(self) -> list[Position]:
        rows = self._sdk.positions_get() or []
        out: list[Position] = []
        for r in rows:
            side = "buy" if int(r.type) == MT5_ORDER_TYPE_BUY else "sell"
            out.append(
                Position(
                    id=str(r.ticket),
                    symbol=str(r.symbol),
                    side=side,
                    lot_size=float(r.volume),
                    entry=float(r.price_open),
                    sl=float(r.sl),
                    tp=float(r.tp),
                    opened_at=int(r.time) * 1000,
                )
            )
        return out

    def place_market_order(
        self,
        symbol: str,
        side: str,
        lot_size: float,
        sl: float | None,
        tp: float | None,
        client_id: str | None,
    ) -> dict:
        order_type = MT5_ORDER_TYPE_BUY if side == "buy" else MT5_ORDER_TYPE_SELL
        tick = self._sdk.symbol_info_tick(symbol)
        if tick is None:
            raise ValueError(f"no quote for {symbol}")
        price = float(tick.ask if side == "buy" else tick.bid)
        request = {
            "action": MT5_TRADE_ACTION_DEAL,
            "symbol": symbol,
            "volume": lot_size,
            "type": order_type,
            "price": price,
            "deviation": 10,
            "magic": 1,
            "comment": client_id or "",
            "type_filling": 1,  # IOC
            "type_time": 0,  # GTC
        }
        if sl is not None:
            request["sl"] = sl
        if tp is not None:
            request["tp"] = tp
        result = self._sdk.order_send(request)
        if result is None or int(result.retcode) != MT5_TRADE_RETCODE_DONE:
            code = int(result.retcode) if result is not None else -1
            raise RuntimeError(f"order_send rejected: retcode={code}")
        return {"ticket": str(result.order), "fill_price": float(result.price)}
```

- [ ] **Step 2: Verify import**

```bash
cd mt5-sidecar
uv run python -c "from mt5_sidecar.providers.mt5_native import MT5Provider; print('mt5_native ok')"
```

Expected: `mt5_native ok` (the lazy `MetaTrader5` import only runs at `MT5Provider()` construction time).

- [ ] **Step 3: Confirm full suite still green**

```bash
uv run pytest -v
```

Expected: 17 tests still pass (legacy `adapter.py` remains the active path).

- [ ] **Step 4: Commit**

```bash
cd ..
git add mt5-sidecar/src/mt5_sidecar/providers/mt5_native.py
git commit -m "feat(mt5-sidecar): add providers/mt5_native.py (legacy MT5Provider, opt-in)"
```

---

## Task 4: Replace `adapter.py` with a re-export shim

**Files:**
- Modify: `mt5-sidecar/src/mt5_sidecar/adapter.py`

This file is now a thin shim that re-exports the moved symbols so existing
test imports (`from mt5_sidecar.adapter import MT5Adapter, Tick, Candle, ...`)
keep working until the test migration tasks (10-13) rewrite them.

- [ ] **Step 1: Replace `mt5-sidecar/src/mt5_sidecar/adapter.py` with shim**

Full new file content:
```python
"""DEPRECATED: import from `mt5_sidecar.providers` instead.

This module re-exports the legacy `MT5Adapter` (now `MT5Provider`) plus the
shared dataclasses (Tick, Candle, Account, Position) for one release window.
Slated for deletion in a Plan 7 cleanup task.

New code should:
    from mt5_sidecar.providers import get_provider, BrokerProvider
    from mt5_sidecar.providers.base import Tick, Candle, Account, Position
    from mt5_sidecar.providers.mt5_native import MT5Provider
"""

from __future__ import annotations

from .providers.base import Account, BrokerProvider, Candle, Position, Tick
from .providers.mt5_native import MT5Provider, MT5SDK

# Back-compat alias: tests + downstream still reference MT5Adapter.
MT5Adapter = MT5Provider

__all__ = [
    "Account",
    "BrokerProvider",
    "Candle",
    "MT5Adapter",
    "MT5Provider",
    "MT5SDK",
    "Position",
    "Tick",
]
```

- [ ] **Step 2: Verify imports**

```bash
cd mt5-sidecar
uv run python -c "from mt5_sidecar.adapter import MT5Adapter, Tick; print('shim ok')"
```

Expected: `shim ok`.

- [ ] **Step 3: Full test suite**

```bash
uv run pytest -v
```

Expected: all 17 tests still pass. The shim aliases `MT5Adapter = MT5Provider`,
so existing tests are unchanged.

- [ ] **Step 4: Commit**

```bash
cd ..
git add mt5-sidecar/src/mt5_sidecar/adapter.py
git commit -m "refactor(mt5-sidecar): adapter.py becomes re-export shim for providers"
```

---

## Task 5: Create `providers/fake.py` — in-memory test provider

**Files:**
- Create: `mt5-sidecar/src/mt5_sidecar/providers/fake.py`

- [ ] **Step 1: Write `providers/fake.py`**

```python
"""FakeProvider — deterministic in-memory broker. Tests + dev only.
   Selected via BROKER_PROVIDER=fake. No network."""

from __future__ import annotations

import time
from typing import Any

from .base import Account, BrokerProvider, Candle, Position, Tick


class FakeProvider:
    """Implements BrokerProvider. Seedable from tests via set_* methods."""

    def __init__(self) -> None:
        self._alive = False
        self._init_kwargs: dict[str, Any] = {}
        self._quotes: dict[str, tuple[float, float]] = {}        # symbol → (bid, ask)
        self._candles: dict[tuple[str, int], list[Candle]] = {}
        self._positions: dict[str, Position] = {}
        self._next_ticket = 1
        self._balance = 10_000.0
        self._reject_orders = False

    # Test seeding API (not part of BrokerProvider) ----------------------------
    def set_quote(self, symbol: str, bid: float, ask: float) -> None:
        self._quotes[symbol] = (bid, ask)

    def set_candles(
        self, symbol: str, proto_timeframe: int, candles: list[Candle]
    ) -> None:
        self._candles[(symbol, proto_timeframe)] = list(candles)

    def force_disconnect(self) -> None:
        self._alive = False

    def reject_next_order(self) -> None:
        self._reject_orders = True

    # BrokerProvider protocol --------------------------------------------------
    def initialize(self, **kwargs: Any) -> None:
        self._init_kwargs = dict(kwargs)
        self._alive = True

    def shutdown(self) -> None:
        self._alive = False

    def is_alive(self) -> bool:
        return self._alive

    def reconnect_or_die(self, *, max_attempts: int = 1) -> None:
        for _ in range(max_attempts):
            if self._alive:
                return
            self._alive = True
            return
        raise RuntimeError("fake reconnect exhausted")

    def get_quote(self, symbol: str) -> Tick:
        q = self._quotes.get(symbol)
        if q is None:
            raise ValueError(f"no quote for {symbol}")
        return Tick(ts=int(time.time() * 1000), symbol=symbol, bid=q[0], ask=q[1])

    def get_candles(
        self, symbol: str, proto_timeframe: int, limit: int
    ) -> list[Candle]:
        rows = self._candles.get((symbol, proto_timeframe), [])
        return rows[-limit:]

    def get_account(self) -> Account:
        return Account(
            ts=int(time.time() * 1000),
            currency="USD",
            balance=self._balance,
            equity=self._balance,
            free_margin=self._balance,
            used_margin=0.0,
            margin_level_pct=0.0,
        )

    def get_open_positions(self) -> list[Position]:
        return list(self._positions.values())

    def place_market_order(
        self,
        symbol: str,
        side: str,
        lot_size: float,
        sl: float | None,
        tp: float | None,
        client_id: str | None,
    ) -> dict:
        if self._reject_orders:
            self._reject_orders = False
            raise RuntimeError("FakeProvider: order rejected (test setup)")
        q = self._quotes.get(symbol)
        if q is None:
            raise ValueError(f"no quote for {symbol}")
        price = q[1] if side == "buy" else q[0]
        ticket = str(self._next_ticket)
        self._next_ticket += 1
        self._positions[ticket] = Position(
            id=ticket,
            symbol=symbol,
            side=side,
            lot_size=lot_size,
            entry=price,
            sl=sl or 0.0,
            tp=tp or 0.0,
            opened_at=int(time.time() * 1000),
        )
        return {"ticket": ticket, "fill_price": price}
```

- [ ] **Step 2: Smoke import**

```bash
cd mt5-sidecar
uv run python -c "from mt5_sidecar.providers.fake import FakeProvider; p = FakeProvider(); p.initialize(); print('alive:', p.is_alive())"
```

Expected: `alive: True`.

- [ ] **Step 3: Full test suite still green**

```bash
uv run pytest -v
```

Expected: 17 tests pass. `FakeProvider` isn't wired into any existing test yet.

- [ ] **Step 4: Commit**

```bash
cd ..
git add mt5-sidecar/src/mt5_sidecar/providers/fake.py
git commit -m "feat(mt5-sidecar): add providers/fake.py (FakeProvider for tests + dev)"
```

---

## Task 6: Create `providers/metaapi.py` — MetaApi cloud provider

**Files:**
- Create: `mt5-sidecar/src/mt5_sidecar/providers/metaapi.py`

- [ ] **Step 1: Write `providers/metaapi.py`**

```python
"""MetaApi.cloud provider. Wraps metaapi_cloud_sdk; bridges async → sync for
gRPC handlers via one event loop + a threading.Lock."""

from __future__ import annotations

import asyncio
import os
import threading
import time
from typing import Any

from metaapi_cloud_sdk import MetaApi  # type: ignore[import-not-found]

from .base import Account, BrokerProvider, Candle, Position, Tick


# proto Timeframe int → MetaApi string. Values mirror proto/mt5.proto enum.
_PROTO_TO_METAAPI_TIMEFRAME: dict[int, str] = {
    1: "1m",
    5: "5m",
    15: "15m",
    30: "30m",
    60: "1h",
    240: "4h",
    1440: "1d",
    10080: "1w",
}


class MetaApiProvider:
    """BrokerProvider backed by metaapi.cloud REST + WebSocket."""

    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._api: MetaApi | None = None
        self._account: Any = None
        self._connection: Any = None
        self._init_kwargs: dict[str, Any] = {}
        self._call_lock = threading.Lock()

    # --- Sync surface (matches BrokerProvider protocol) -----------------------
    def initialize(self, **kwargs: Any) -> None:
        token = kwargs.get("token") or os.environ.get("METAAPI_TOKEN")
        acct_id = kwargs.get("account_id") or os.environ.get("METAAPI_ACCOUNT_ID")
        region = kwargs.get("region") or os.environ.get("METAAPI_REGION", "london")
        if not (token and acct_id):
            raise RuntimeError("METAAPI_TOKEN + METAAPI_ACCOUNT_ID required")
        self._init_kwargs = {"token": token, "account_id": acct_id, "region": region}

        self._loop = asyncio.new_event_loop()
        self._api = MetaApi(token=token, opts={"region": region})
        self._account = self._run(
            self._api.metatrader_account_api.get_account(acct_id)
        )
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
            if self._connection is None:
                return False
            return bool(self._connection.synchronized)
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
        raise RuntimeError(
            f"MetaApi reconnect failed; exiting for ECS restart: {last_err}"
        )

    def get_quote(self, symbol: str) -> Tick:
        price = self._run(self._connection.get_symbol_price(symbol))
        return Tick(
            ts=int(price["time"].timestamp() * 1000),
            symbol=symbol,
            bid=float(price["bid"]),
            ask=float(price["ask"]),
        )

    def get_candles(
        self, symbol: str, proto_timeframe: int, limit: int
    ) -> list[Candle]:
        tf = _PROTO_TO_METAAPI_TIMEFRAME.get(proto_timeframe)
        if tf is None:
            raise ValueError(f"unknown timeframe: {proto_timeframe}")
        bars = self._run(
            self._account.get_historical_candles(symbol, tf, limit=limit)
        )
        return [
            Candle(
                ts=int(b["time"].timestamp() * 1000),
                open=float(b["open"]),
                high=float(b["high"]),
                low=float(b["low"]),
                close=float(b["close"]),
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
        self,
        symbol: str,
        side: str,
        lot_size: float,
        sl: float | None,
        tp: float | None,
        client_id: str | None,
    ) -> dict:
        method = (
            self._connection.create_market_buy_order
            if side == "buy"
            else self._connection.create_market_sell_order
        )
        result = self._run(
            method(
                symbol,
                lot_size,
                stop_loss=sl,
                take_profit=tp,
                options={"clientId": client_id} if client_id else None,
            )
        )
        return {
            "ticket": str(result["orderId"]),
            "fill_price": float(result.get("price", 0)),
        }

    # --- Async-to-sync bridge -------------------------------------------------
    def _run(self, coro: Any) -> Any:
        assert self._loop is not None
        with self._call_lock:
            return self._loop.run_until_complete(coro)
```

- [ ] **Step 2: Smoke import (no network)**

```bash
cd mt5-sidecar
uv run python -c "from mt5_sidecar.providers.metaapi import MetaApiProvider; p = MetaApiProvider(); print('module ok; is_alive:', p.is_alive())"
```

Expected: `module ok; is_alive: False` (no `initialize()` called).

- [ ] **Step 3: Confirm full suite still green**

```bash
uv run pytest -v
```

Expected: 17 tests still pass.

- [ ] **Step 4: Commit**

```bash
cd ..
git add mt5-sidecar/src/mt5_sidecar/providers/metaapi.py
git commit -m "feat(mt5-sidecar): add providers/metaapi.py (MetaApi cloud provider)"
```

---

## Task 7: Wire factory in `providers/__init__.py`

**Files:**
- Modify: `mt5-sidecar/src/mt5_sidecar/providers/__init__.py`

- [ ] **Step 1: Replace `providers/__init__.py` with the factory**

Full file content:
```python
"""Broker provider plugins. Selection driven by BROKER_PROVIDER env var.

Usage:
    from mt5_sidecar.providers import get_provider, BrokerProvider
    provider = get_provider()   # honours BROKER_PROVIDER; defaults to metaapi
    provider.initialize()
"""

from __future__ import annotations

import os

from .base import Account, BrokerProvider, Candle, Position, Tick


def get_provider() -> BrokerProvider:
    """Construct a provider based on the BROKER_PROVIDER env var.

    Valid values: 'metaapi' (default), 'fake', 'mt5'.
    Raises ValueError on any other value.
    """
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


__all__ = [
    "Account",
    "BrokerProvider",
    "Candle",
    "Position",
    "Tick",
    "get_provider",
]
```

- [ ] **Step 2: Smoke test the factory**

```bash
cd mt5-sidecar
BROKER_PROVIDER=fake uv run python -c "from mt5_sidecar.providers import get_provider; p = get_provider(); print(type(p).__name__)"
```

Expected: `FakeProvider`.

```bash
BROKER_PROVIDER=metaapi uv run python -c "from mt5_sidecar.providers import get_provider; p = get_provider(); print(type(p).__name__)"
```

Expected: `MetaApiProvider`.

```bash
BROKER_PROVIDER=bogus uv run python -c "from mt5_sidecar.providers import get_provider; get_provider()" 2>&1 | tail -1
```

Expected: line ends with `Unknown BROKER_PROVIDER='bogus'. Valid: metaapi, fake, mt5`.

- [ ] **Step 3: Full test suite still green**

```bash
uv run pytest -v
```

Expected: 17 tests still pass.

- [ ] **Step 4: Commit**

```bash
cd ..
git add mt5-sidecar/src/mt5_sidecar/providers/__init__.py
git commit -m "feat(mt5-sidecar): add providers factory (get_provider() honours BROKER_PROVIDER)"
```

---

## Task 8: Refactor `server.py` to accept `BrokerProvider`

**Files:**
- Modify: `mt5-sidecar/src/mt5_sidecar/server.py`

The only changes are import statements and one type annotation. `MT5Service`
already takes `adapter: MT5Adapter` and calls protocol-shaped methods —
swap the annotation to `BrokerProvider`. Behaviour is unchanged.

- [ ] **Step 1: Apply two surgical edits**

In `mt5-sidecar/src/mt5_sidecar/server.py`:

(a) Find:
```python
from .adapter import MT5Adapter
```
Replace with:
```python
from .providers import BrokerProvider
```

(b) Find:
```python
class MT5Service(mt5_pb2_grpc.MT5Servicer):
    def __init__(self, adapter: MT5Adapter, *, stream_interval_sec: float = 0.5):
```
Replace with:
```python
class MT5Service(mt5_pb2_grpc.MT5Servicer):
    def __init__(self, adapter: BrokerProvider, *, stream_interval_sec: float = 0.5):
```

(c) Find:
```python
def _build_health_servicer(
    adapter: MT5Adapter, *, refresh_interval_s: float = 5.0
) -> health.HealthServicer:
```
Replace with:
```python
def _build_health_servicer(
    adapter: BrokerProvider, *, refresh_interval_s: float = 5.0
) -> health.HealthServicer:
```

(d) Find:
```python
def build_server(
    adapter: MT5Adapter, host: str = "0.0.0.0", port: int = 50051
) -> grpc.Server:
```
Replace with:
```python
def build_server(
    adapter: BrokerProvider, host: str = "0.0.0.0", port: int = 50051
) -> grpc.Server:
```

- [ ] **Step 2: Smoke import**

```bash
cd mt5-sidecar
uv run python -c "from mt5_sidecar.server import build_server, _build_health_servicer; print('server ok')"
```

Expected: `server ok`.

- [ ] **Step 3: Full test suite**

```bash
uv run pytest -v
```

Expected: 17 tests still pass. Existing tests pass `MT5Adapter` instances
(which is `MT5Provider` via shim) into `build_server`; structural subtyping
makes them satisfy `BrokerProvider`.

- [ ] **Step 4: Commit**

```bash
cd ..
git add mt5-sidecar/src/mt5_sidecar/server.py
git commit -m "refactor(mt5-sidecar): server.py types against BrokerProvider Protocol"
```

---

## Task 9: Refactor `__main__.py` to use the factory

**Files:**
- Modify: `mt5-sidecar/src/mt5_sidecar/__main__.py`

The new boot flow:
1. Look up `BROKER_PROVIDER` (default `metaapi`).
2. Call `get_provider()`. The provider reads its own creds from env vars.
3. The legacy MT5 path still honours `MT5_LOGIN` / `MT5_SERVER` / `MT5_PASSWORD`
   IF `BROKER_PROVIDER=mt5`. Other providers ignore them.

- [ ] **Step 1: Replace the body of `main()` and the `_watchdog` definition appropriately**

Full new `__main__.py` content:
```python
"""Entrypoint: starts the gRPC server with a BrokerProvider chosen at boot."""

from __future__ import annotations

import os
import signal
import threading
import time
from typing import Any, NoReturn

from .providers import BrokerProvider, get_provider
from .server import build_server


def _legacy_mt5_kwargs() -> dict[str, Any]:
    """Build kwargs for the legacy MT5Provider from MT5_* env vars, if all
    three are present. Returns {} otherwise (provider then uses last-known
    login). MetaApi/Fake providers ignore this entirely."""
    login = os.environ.get("MT5_LOGIN")
    server_name = os.environ.get("MT5_SERVER")
    password = os.environ.get("MT5_PASSWORD")
    if login and server_name and password:
        return {"login": int(login), "server": server_name, "password": password}
    return {}


def main() -> NoReturn:
    provider_name = os.environ.get("BROKER_PROVIDER", "metaapi").lower()
    print(f"mt5-sidecar: provider={provider_name}", flush=True)

    provider: BrokerProvider = get_provider()
    init_kwargs = _legacy_mt5_kwargs() if provider_name == "mt5" else {}
    provider.initialize(**init_kwargs)

    host = os.environ.get("MT5_SIDECAR_HOST", "0.0.0.0")
    port = int(os.environ.get("MT5_SIDECAR_PORT", "50051"))
    server = build_server(provider, host=host, port=port)
    server.start()

    def _watchdog() -> None:
        consecutive_failures = 0
        while True:
            time.sleep(30.0)
            if provider.is_alive():
                consecutive_failures = 0
                continue
            consecutive_failures += 1
            print(
                f"mt5-sidecar: liveness probe failed (consecutive={consecutive_failures})",
                flush=True,
            )
            if consecutive_failures == 1:
                try:
                    provider.reconnect_or_die(max_attempts=1)
                    consecutive_failures = 0
                    continue
                except Exception as exc:
                    print(
                        f"mt5-sidecar: reconnect attempt failed: {exc}",
                        flush=True,
                    )
            if consecutive_failures >= 2:
                print(
                    "mt5-sidecar: liveness probe failed twice; exiting for ECS restart",
                    flush=True,
                )
                os._exit(1)

    threading.Thread(
        target=_watchdog, name="mt5-watchdog", daemon=True
    ).start()

    def _shutdown(signum, frame):  # noqa: ANN001
        server.stop(grace=3)
        provider.shutdown()
        raise SystemExit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)
    print(f"mt5-sidecar listening on {host}:{port}", flush=True)
    server.wait_for_termination()
    raise SystemExit(0)


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Smoke run with the fake provider (no network)**

```bash
cd mt5-sidecar
BROKER_PROVIDER=fake MT5_SIDECAR_HOST=127.0.0.1 MT5_SIDECAR_PORT=50099 \
  timeout 2 uv run python -m mt5_sidecar 2>&1 | head -3
```

Expected output begins with:
```
mt5-sidecar: provider=fake
mt5-sidecar listening on 127.0.0.1:50099
```

(The `timeout 2` aborts after 2s — that's intentional; we only verify boot prints.)

- [ ] **Step 3: Run the legacy test suite**

```bash
cd mt5-sidecar
uv run pytest -v
```

Expected: many login-related tests now fail (they patched `mt5_sidecar.__main__.MT5Adapter` which no longer exists). These get re-written in Tasks 11-13. For this commit, **3 known failures in `test_login.py` are expected**. Other tests (15+) should still pass.

- [ ] **Step 4: Commit**

```bash
cd ..
git add mt5-sidecar/src/mt5_sidecar/__main__.py
git commit -m "feat(mt5-sidecar): __main__.py uses get_provider() factory"
```

---

## Task 10: Migrate `test_reconnect.py` imports

**Files:**
- Modify: `mt5-sidecar/tests/test_reconnect.py`

- [ ] **Step 1: Replace the import line**

In `mt5-sidecar/tests/test_reconnect.py`, find:
```python
from mt5_sidecar.adapter import MT5Adapter
```
Replace with:
```python
from mt5_sidecar.providers.mt5_native import MT5Provider as MT5Adapter
```

(Alias kept so the rest of the test body — which uses the name `MT5Adapter` —
needs no further changes.)

- [ ] **Step 2: Run the test file**

```bash
cd mt5-sidecar
uv run pytest tests/test_reconnect.py -v
```

Expected: 5/5 PASSED.

- [ ] **Step 3: Commit**

```bash
cd ..
git add mt5-sidecar/tests/test_reconnect.py
git commit -m "test(mt5-sidecar): point test_reconnect at providers.mt5_native"
```

---

## Task 11: Migrate `test_health.py` imports

**Files:**
- Modify: `mt5-sidecar/tests/test_health.py`

- [ ] **Step 1: Replace the import line**

In `mt5-sidecar/tests/test_health.py`, find:
```python
from mt5_sidecar.adapter import MT5Adapter
```
Replace with:
```python
from mt5_sidecar.providers.mt5_native import MT5Provider as MT5Adapter
```

- [ ] **Step 2: Run the test file**

```bash
cd mt5-sidecar
uv run pytest tests/test_health.py -v
```

Expected: 2/2 PASSED.

- [ ] **Step 3: Commit**

```bash
cd ..
git add mt5-sidecar/tests/test_health.py
git commit -m "test(mt5-sidecar): point test_health at providers.mt5_native"
```

---

## Task 12: Migrate `test_server.py` to use `FakeProvider`

**Files:**
- Modify: `mt5-sidecar/tests/test_server.py`

- [ ] **Step 1: Read current test imports + setup**

The existing file constructs `MT5Adapter(sdk_mock)` for each test. Replace
with `FakeProvider()`. The gRPC handlers don't care which provider — they call
the protocol methods.

- [ ] **Step 2: Replace the import + provider-construction lines**

In `mt5-sidecar/tests/test_server.py`:

(a) Find:
```python
from mt5_sidecar.adapter import MT5Adapter
```
Replace with:
```python
from mt5_sidecar.providers.fake import FakeProvider
```

(b) For each test that currently constructs an adapter — e.g.:
```python
sdk = MagicMock()
sdk.symbol_info_tick.return_value = MagicMock(time_msc=..., bid=..., ask=...)
adapter = MT5Adapter(sdk)
```
Replace with:
```python
adapter = FakeProvider()
adapter.initialize()
adapter.set_quote("EURUSD", bid=..., ask=...)
```

For the `test_get_quote_round_trip` test, the precise replacement is:
```python
def test_get_quote_round_trip(...):
    adapter = FakeProvider()
    adapter.initialize()
    adapter.set_quote("EURUSD", bid=1.1000, ask=1.1002)
    server = build_server(adapter, host="127.0.0.1", port=0)
    # ... rest of test unchanged
```

For `test_place_order_market_round_trip`:
```python
def test_place_order_market_round_trip(...):
    adapter = FakeProvider()
    adapter.initialize()
    adapter.set_quote("EURUSD", bid=1.1000, ask=1.1002)
    # ... rest unchanged
```

NOTE: read the current test_server.py file before editing; it has 2 tests
that need this pattern. Keep the rest of the test body unchanged.

- [ ] **Step 3: Run the test file**

```bash
cd mt5-sidecar
uv run pytest tests/test_server.py -v
```

Expected: 2/2 PASSED.

- [ ] **Step 4: Commit**

```bash
cd ..
git add mt5-sidecar/tests/test_server.py
git commit -m "test(mt5-sidecar): test_server uses FakeProvider"
```

---

## Task 13: Rewrite `test_login.py` to test factory dispatch

**Files:**
- Modify: `mt5-sidecar/tests/test_login.py` (full replace)

The old test patched `mt5_sidecar.__main__.MT5Adapter`. After Task 9 that
symbol no longer exists — `__main__` uses `get_provider()`. The new test
verifies factory dispatch + legacy MT5 kwargs handling.

- [ ] **Step 1: Replace the full content of `tests/test_login.py`**

```python
"""Tests for factory dispatch + legacy MT5 kwargs handling in __main__."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


def _run_main_with_env(
    monkeypatch: pytest.MonkeyPatch, env: dict[str, str], provider_mock: MagicMock
) -> MagicMock:
    """Boot __main__.main() with the given env; capture provider.initialize kwargs."""
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    server = MagicMock()
    server.wait_for_termination.side_effect = SystemExit(0)
    with (
        patch("mt5_sidecar.__main__.get_provider", return_value=provider_mock),
        patch("mt5_sidecar.__main__.build_server", return_value=server),
    ):
        from mt5_sidecar import __main__ as entry

        with pytest.raises(SystemExit):
            entry.main()
    return provider_mock


def test_fake_provider_initializes_without_creds(monkeypatch):
    provider = MagicMock()
    env = {"BROKER_PROVIDER": "fake"}
    _run_main_with_env(monkeypatch, env, provider)
    provider.initialize.assert_called_once_with()


def test_metaapi_provider_initializes_without_legacy_kwargs(monkeypatch):
    provider = MagicMock()
    env = {
        "BROKER_PROVIDER": "metaapi",
        # Legacy MT5_* env vars are present but should be IGNORED for metaapi.
        "MT5_LOGIN": "12345",
        "MT5_SERVER": "ICMarketsSC-Demo",
        "MT5_PASSWORD": "secret",
    }
    _run_main_with_env(monkeypatch, env, provider)
    provider.initialize.assert_called_once_with()


def test_mt5_provider_uses_env_kwargs_when_all_three_present(monkeypatch):
    provider = MagicMock()
    env = {
        "BROKER_PROVIDER": "mt5",
        "MT5_LOGIN": "12345",
        "MT5_SERVER": "ICMarketsSC-Demo",
        "MT5_PASSWORD": "secret",
    }
    _run_main_with_env(monkeypatch, env, provider)
    provider.initialize.assert_called_once_with(
        login=12345, server="ICMarketsSC-Demo", password="secret"
    )


def test_mt5_provider_falls_back_to_no_args_when_env_missing(monkeypatch):
    provider = MagicMock()
    for var in ("MT5_LOGIN", "MT5_SERVER", "MT5_PASSWORD"):
        monkeypatch.delenv(var, raising=False)
    env = {"BROKER_PROVIDER": "mt5"}
    _run_main_with_env(monkeypatch, env, provider)
    provider.initialize.assert_called_once_with()


def test_mt5_provider_raises_on_non_numeric_login(monkeypatch):
    provider = MagicMock()
    env = {
        "BROKER_PROVIDER": "mt5",
        "MT5_LOGIN": "abc",  # not int-parseable
        "MT5_SERVER": "X",
        "MT5_PASSWORD": "y",
    }
    with pytest.raises(ValueError):
        _run_main_with_env(monkeypatch, env, provider)
```

- [ ] **Step 2: Run the test file**

```bash
cd mt5-sidecar
uv run pytest tests/test_login.py -v
```

Expected: 5/5 PASSED.

- [ ] **Step 3: Run the full suite**

```bash
uv run pytest -v
```

Expected: all tests pass (existing reconnect/health/server + new login).

- [ ] **Step 4: Commit**

```bash
cd ..
git add mt5-sidecar/tests/test_login.py
git commit -m "test(mt5-sidecar): rewrite test_login for factory dispatch"
```

---

## Task 14: Create `test_providers.py` — factory + Fake e2e

**Files:**
- Create: `mt5-sidecar/tests/test_providers.py`

- [ ] **Step 1: Write `tests/test_providers.py`**

```python
"""Tests for providers factory + FakeProvider end-to-end behavior."""

from __future__ import annotations

import pytest

from mt5_sidecar.providers import BrokerProvider, get_provider
from mt5_sidecar.providers.base import Candle


def test_factory_returns_fake_for_fake(monkeypatch):
    monkeypatch.setenv("BROKER_PROVIDER", "fake")
    p = get_provider()
    assert type(p).__name__ == "FakeProvider"


def test_factory_returns_metaapi_by_default(monkeypatch):
    monkeypatch.delenv("BROKER_PROVIDER", raising=False)
    p = get_provider()
    assert type(p).__name__ == "MetaApiProvider"


def test_factory_returns_metaapi_when_named(monkeypatch):
    monkeypatch.setenv("BROKER_PROVIDER", "metaapi")
    p = get_provider()
    assert type(p).__name__ == "MetaApiProvider"


def test_factory_raises_on_unknown(monkeypatch):
    monkeypatch.setenv("BROKER_PROVIDER", "totallyfake")
    with pytest.raises(ValueError, match="Unknown BROKER_PROVIDER"):
        get_provider()


def test_factory_returns_mt5_when_named_and_dep_installed(monkeypatch):
    """MT5Provider construction either succeeds (MetaTrader5 installed in
    Wine prefix) or raises ImportError (default Linux test env)."""
    monkeypatch.setenv("BROKER_PROVIDER", "mt5")
    try:
        p = get_provider()
        assert type(p).__name__ == "MT5Provider"
    except ImportError as e:
        # Expected on Linux test runners without [mt5] extra.
        assert "MetaTrader5" in str(e)


def test_fake_provider_full_lifecycle(monkeypatch):
    monkeypatch.setenv("BROKER_PROVIDER", "fake")
    p: BrokerProvider = get_provider()
    assert not p.is_alive()
    p.initialize()
    assert p.is_alive()

    p.set_quote("EURUSD", bid=1.1000, ask=1.1002)  # type: ignore[attr-defined]
    tick = p.get_quote("EURUSD")
    assert tick.bid == 1.1000
    assert tick.ask == 1.1002

    out = p.place_market_order(
        "EURUSD", "buy", 0.1, sl=1.0950, tp=1.1100, client_id="client-1"
    )
    assert out["ticket"] == "1"
    assert out["fill_price"] == 1.1002  # buy → fills at ask

    positions = p.get_open_positions()
    assert len(positions) == 1
    assert positions[0].symbol == "EURUSD"
    assert positions[0].side == "buy"

    p.shutdown()
    assert not p.is_alive()


def test_fake_provider_reconnect(monkeypatch):
    monkeypatch.setenv("BROKER_PROVIDER", "fake")
    p = get_provider()
    p.initialize()
    p.force_disconnect()  # type: ignore[attr-defined]
    assert not p.is_alive()
    p.reconnect_or_die(max_attempts=1)
    assert p.is_alive()


def test_fake_provider_rejects_when_seeded(monkeypatch):
    monkeypatch.setenv("BROKER_PROVIDER", "fake")
    p = get_provider()
    p.initialize()
    p.set_quote("EURUSD", bid=1.1000, ask=1.1002)  # type: ignore[attr-defined]
    p.reject_next_order()  # type: ignore[attr-defined]
    with pytest.raises(RuntimeError, match="order rejected"):
        p.place_market_order("EURUSD", "buy", 0.1, sl=None, tp=None, client_id=None)


def test_fake_provider_get_candles(monkeypatch):
    monkeypatch.setenv("BROKER_PROVIDER", "fake")
    p = get_provider()
    p.initialize()
    bars = [Candle(ts=i, open=1, high=2, low=0.5, close=1.5, volume=100) for i in range(5)]
    p.set_candles("EURUSD", 60, bars)  # type: ignore[attr-defined]
    got = p.get_candles("EURUSD", 60, limit=3)
    assert len(got) == 3
    assert got[-1].ts == 4
```

- [ ] **Step 2: Run the test file**

```bash
cd mt5-sidecar
uv run pytest tests/test_providers.py -v
```

Expected: 9/9 PASSED (8 if `[mt5]` extra is installed — the conditional test
short-circuits in both branches).

- [ ] **Step 3: Run the full suite**

```bash
uv run pytest -v
```

Expected: ~24 total tests, all green.

- [ ] **Step 4: Commit**

```bash
cd ..
git add mt5-sidecar/tests/test_providers.py
git commit -m "test(mt5-sidecar): add factory + FakeProvider e2e tests"
```

---

## Task 15: Create `test_metaapi_integration.py` (skipped by default)

**Files:**
- Create: `mt5-sidecar/tests/test_metaapi_integration.py`

- [ ] **Step 1: Write `tests/test_metaapi_integration.py`**

```python
"""Real-network smoke test for MetaApiProvider.

SKIPPED by default. Runs only when:
  RUN_METAAPI_INTEGRATION=1
  METAAPI_TOKEN=<real token>
  METAAPI_ACCOUNT_ID=<UUID of a registered demo MT5 account>

Hits the actual metaapi.cloud demo backend. Used by operator for pre-deploy
verification, not by CI.
"""

from __future__ import annotations

import os

import pytest


pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_METAAPI_INTEGRATION") != "1"
    or not os.environ.get("METAAPI_TOKEN")
    or not os.environ.get("METAAPI_ACCOUNT_ID"),
    reason="set RUN_METAAPI_INTEGRATION=1 + METAAPI_TOKEN + METAAPI_ACCOUNT_ID",
)


def test_metaapi_provider_connects_and_reads_account():
    """Smoke: initialize, fetch account info, shutdown."""
    from mt5_sidecar.providers.metaapi import MetaApiProvider

    p = MetaApiProvider()
    try:
        p.initialize()
        assert p.is_alive(), "is_alive() should be True after initialize"
        acct = p.get_account()
        assert acct.currency  # any non-empty string
        assert acct.balance >= 0
    finally:
        p.shutdown()
```

- [ ] **Step 2: Verify the skip path triggers in CI-like env**

```bash
cd mt5-sidecar
uv run pytest tests/test_metaapi_integration.py -v
```

Expected output contains `1 skipped` (no real-network call attempted).

- [ ] **Step 3: Run the full suite**

```bash
uv run pytest -v
```

Expected: all enabled tests pass; integration test is skipped (does not count
as failure).

- [ ] **Step 4: Commit**

```bash
cd ..
git add mt5-sidecar/tests/test_metaapi_integration.py
git commit -m "test(mt5-sidecar): add skipped-by-default MetaApi integration smoke"
```

---

## Task 16: Replace `mt5-sidecar/Dockerfile` — Linux Python, no Wine

**Files:**
- Replace: `mt5-sidecar/Dockerfile`
- Delete: `mt5-sidecar/entrypoint.sh`

- [ ] **Step 1: Replace `mt5-sidecar/Dockerfile`**

```dockerfile
# mt5-sidecar — Linux Python with pluggable broker provider.
# Provider chosen at runtime via BROKER_PROVIDER env var (default: metaapi).
# See prd/specs/2026-05-12-forex-bot-broker-provider-design.md.

FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://github.com/grpc-ecosystem/grpc-health-probe/releases/download/v0.4.25/grpc_health_probe-linux-amd64 \
      -o /usr/local/bin/grpc_health_probe \
    && chmod +x /usr/local/bin/grpc_health_probe

COPY mt5-sidecar/pyproject.toml mt5-sidecar/uv.lock /app/
COPY mt5-sidecar/src /app/src
COPY proto /proto

RUN pip install --no-cache-dir \
      grpcio==1.66.0 \
      grpcio-health-checking==1.66.0 \
      grpcio-tools==1.66.0 \
      protobuf==5.28.0 \
      metaapi-cloud-sdk>=27.0.0

# Generate proto stubs (writes into /app/src/mt5_sidecar/generated/).
RUN python -m grpc_tools.protoc \
      -I/proto \
      --python_out=/app/src/mt5_sidecar/generated \
      --grpc_python_out=/app/src/mt5_sidecar/generated \
      /proto/mt5.proto

ENV PYTHONPATH=/app/src

EXPOSE 50051

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD grpc_health_probe -addr=:50051 || exit 1

ENTRYPOINT ["python", "-m", "mt5_sidecar"]
```

- [ ] **Step 2: Delete the Wine-era entrypoint**

```bash
git rm mt5-sidecar/entrypoint.sh
```

- [ ] **Step 3: Commit (build smoke is the next task)**

```bash
git add mt5-sidecar/Dockerfile
git commit -m "feat(mt5-sidecar): replace Dockerfile with Linux Python image (no Wine)"
```

---

## Task 17: Local docker buildx smoke (verify only)

**Files:** none modified.

- [ ] **Step 1: Build the image**

```bash
docker buildx build --platform linux/amd64 -f mt5-sidecar/Dockerfile -t forex-bot/mt5-sidecar:smoke .
```

Expected: clean build, ~2 min first time; cached rebuilds <30s.

- [ ] **Step 2: Inspect size**

```bash
docker image ls forex-bot/mt5-sidecar:smoke --format "table {{.Repository}}\t{{.Size}}"
```

Expected: under 250 MB.

- [ ] **Step 3: Smoke run with fake provider (no creds)**

```bash
docker run --rm --platform linux/amd64 \
  -e BROKER_PROVIDER=fake \
  -e MT5_SIDECAR_HOST=0.0.0.0 \
  -e MT5_SIDECAR_PORT=50051 \
  -p 50099:50051 \
  --name mt5-sidecar-smoke \
  forex-bot/mt5-sidecar:smoke &

sleep 5
docker logs mt5-sidecar-smoke 2>&1 | head -5
docker stop mt5-sidecar-smoke
```

Expected logs include:
```
mt5-sidecar: provider=fake
mt5-sidecar listening on 0.0.0.0:50051
```

- [ ] **Step 4: Smoke run with metaapi provider (no creds → fail-fast)**

```bash
docker run --rm --platform linux/amd64 \
  -e BROKER_PROVIDER=metaapi \
  forex-bot/mt5-sidecar:smoke 2>&1 | head -5 || true
```

Expected output contains: `METAAPI_TOKEN + METAAPI_ACCOUNT_ID required`.

(No commit for this task — verification only.)

---

## Task 18: Add MetaApi secret placeholders to `modules/secrets`

**Files:**
- Modify: `infra/terraform/modules/secrets/main.tf`

- [ ] **Step 1: Extend the `secret_string` JSON**

In `infra/terraform/modules/secrets/main.tf`, find the existing
`aws_secretsmanager_secret_version.main` resource. Replace its
`secret_string = jsonencode({ ... })` block with:

```hcl
  secret_string = jsonencode({
    anthropicApiKey  = "REPLACE_ME"
    mt5Login         = "REPLACE_ME"
    mt5Password      = "REPLACE_ME"
    mt5Server        = "REPLACE_ME"
    metaApiToken     = "REPLACE_ME"
    metaApiAccountId = "REPLACE_ME"
    dbPassword       = var.db_password
  })
```

(Existing keys preserved; two new keys added.) The `lifecycle { ignore_changes = [secret_string] }`
already-present block means operator changes don't drift TF state.

- [ ] **Step 2: Format + validate**

```bash
cd infra/terraform/modules/secrets
terraform fmt -recursive
rm -rf .terraform .terraform.lock.hcl
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 3: Commit**

```bash
cd ../../../..
git add infra/terraform/modules/secrets
git commit -m "feat(infra): add metaApiToken + metaApiAccountId placeholders to secrets module"
```

---

## Task 19: Add `broker_provider` variable to `modules/sidecar`

**Files:**
- Modify: `infra/terraform/modules/sidecar/variables.tf`

- [ ] **Step 1: Append the new variable**

Append to `infra/terraform/modules/sidecar/variables.tf`:
```hcl

variable "broker_provider" {
  description = "Broker provider plugin selected at boot: metaapi | mt5 | fake"
  type        = string
  default     = "metaapi"

  validation {
    condition     = contains(["metaapi", "mt5", "fake"], var.broker_provider)
    error_message = "broker_provider must be one of: metaapi, mt5, fake."
  }
}
```

- [ ] **Step 2: Format**

```bash
cd infra/terraform/modules/sidecar
terraform fmt
```

(Validate happens after Task 20 wires it into main.tf.)

- [ ] **Step 3: Commit**

```bash
cd ../../../..
git add infra/terraform/modules/sidecar/variables.tf
git commit -m "feat(infra): add broker_provider variable to sidecar module"
```

---

## Task 20: Inject `BROKER_PROVIDER` + MetaApi env/secrets in `modules/sidecar`

**Files:**
- Modify: `infra/terraform/modules/sidecar/main.tf`

- [ ] **Step 1: Find the `container_definitions` JSON in `modules/sidecar/main.tf`**

The block defines `environment` (plain env vars) and `secrets` (Secrets Manager-injected). Both need entries.

- [ ] **Step 2: Add two entries to `environment`**

Locate the existing `environment` list. Currently:
```hcl
      environment = [
        { name = "MT5_SIDECAR_HOST", value = "0.0.0.0" },
        { name = "MT5_SIDECAR_PORT", value = "50051" },
      ]
```

Replace with:
```hcl
      environment = [
        { name = "MT5_SIDECAR_HOST", value = "0.0.0.0" },
        { name = "MT5_SIDECAR_PORT", value = "50051" },
        { name = "BROKER_PROVIDER",  value = var.broker_provider },
        { name = "METAAPI_REGION",   value = "london" },
      ]
```

- [ ] **Step 3: Add two entries to `secrets`**

Locate the existing `secrets` list. Currently:
```hcl
      secrets = [
        { name = "MT5_LOGIN",    valueFrom = "${var.secret_arn}:mt5Login::" },
        { name = "MT5_PASSWORD", valueFrom = "${var.secret_arn}:mt5Password::" },
        { name = "MT5_SERVER",   valueFrom = "${var.secret_arn}:mt5Server::" },
      ]
```

Replace with:
```hcl
      secrets = [
        { name = "MT5_LOGIN",          valueFrom = "${var.secret_arn}:mt5Login::" },
        { name = "MT5_PASSWORD",       valueFrom = "${var.secret_arn}:mt5Password::" },
        { name = "MT5_SERVER",         valueFrom = "${var.secret_arn}:mt5Server::" },
        { name = "METAAPI_TOKEN",      valueFrom = "${var.secret_arn}:metaApiToken::" },
        { name = "METAAPI_ACCOUNT_ID", valueFrom = "${var.secret_arn}:metaApiAccountId::" },
      ]
```

- [ ] **Step 4: Format + validate**

```bash
cd infra/terraform/modules/sidecar
terraform fmt -recursive
rm -rf .terraform .terraform.lock.hcl
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 5: Commit**

```bash
cd ../../../..
git add infra/terraform/modules/sidecar
git commit -m "feat(infra): wire BROKER_PROVIDER + MetaApi env/secrets into sidecar task def"
```

---

## Task 21: Pass `broker_provider = "metaapi"` in env composition

**Files:**
- Modify: `infra/terraform/envs/prod/main.tf`
- Modify: `infra/terraform/envs/staging/main.tf`

- [ ] **Step 1: Update `envs/prod/main.tf`**

Find the existing `module "sidecar"` block and append one argument:
```hcl
  broker_provider = "metaapi"
```

Place it immediately after `task_execution_role_arn` for readability.

- [ ] **Step 2: Update `envs/staging/main.tf`**

Same edit, same argument value.

- [ ] **Step 3: Format + validate both envs**

```bash
cd infra/terraform/envs/prod
terraform fmt -recursive
rm -rf .terraform .terraform.lock.hcl
terraform init -backend=false
terraform validate
cd ../staging
terraform fmt -recursive
rm -rf .terraform .terraform.lock.hcl
terraform init -backend=false
terraform validate
```

Expected: `Success! The configuration is valid.` for both.

- [ ] **Step 4: Commit**

```bash
cd ../../../..
git add infra/terraform/envs/prod infra/terraform/envs/staging
git commit -m "feat(infra): set broker_provider = metaapi in both envs"
```

---

## Task 22: CI grep guard against real MetaApi in tests

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Append the new check after the existing AnthropicLlm guard**

In `.github/workflows/ci.yml`, find the step `name: Verify no real Anthropic calls in tests`. After that step, add:
```yaml
      - name: Verify no real MetaApi calls in tests
        run: |
          if grep -RInE 'MetaApi\(token=' --include='*.py' --include='*.ts' mt5-sidecar/tests apps packages; then
            echo "ERROR: MetaApi cannot be instantiated in tests with a real token — use FakeProvider." >&2
            exit 1
          fi
```

- [ ] **Step 2: YAML lint smoke**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"
```

Expected: `yaml ok`.

- [ ] **Step 3: Run the grep locally to confirm it passes**

```bash
grep -RInE 'MetaApi\(token=' --include='*.py' --include='*.ts' mt5-sidecar/tests apps packages || echo "clean"
```

Expected: `clean` (no matches).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: block real MetaApi instantiation in test files"
```

---

## Task 23: Update `DEPLOY.md` + `infra/terraform/README.md` runbooks

**Files:**
- Modify: `DEPLOY.md`
- Modify: `infra/terraform/README.md`

- [ ] **Step 1: Append a "Provider switching" section to `infra/terraform/README.md`**

At end of `infra/terraform/README.md`, append:

````markdown

## Broker-provider switching (Plan 6f)

The sidecar picks its broker backend at boot via `BROKER_PROVIDER`. Valid:
`metaapi` (default), `fake` (safe-mode / rollback), `mt5` (legacy Wine path,
not deployable in the v1 image).

### Switch a deployed env

```bash
ENV=staging
PROVIDER=metaapi   # or: fake, mt5

# 1. Update the tfvar (add the line if it's not present)
grep -q '^broker_provider' infra/terraform/envs/$ENV/terraform.tfvars \
  && sed -i '' "s/^broker_provider.*/broker_provider = \"$PROVIDER\"/" infra/terraform/envs/$ENV/terraform.tfvars \
  || echo "broker_provider = \"$PROVIDER\"" >> infra/terraform/envs/$ENV/terraform.tfvars

# 2. Apply — updates the sidecar task definition revision; ECS rolling redeploys
cd infra/terraform/envs/$ENV
terraform plan -out=tfplan
terraform apply tfplan

# 3. Verify
aws logs tail /forex-bot/$ENV/mt5-sidecar --since 5m
# Expect: "mt5-sidecar: provider=<PROVIDER>"
```

### Verify provider on a running task

```bash
aws ecs describe-tasks --cluster forex-bot-$ENV-cluster \
  --tasks $(aws ecs list-tasks --cluster forex-bot-$ENV-cluster --service-name forex-bot-$ENV-mt5-sidecar --query 'taskArns[0]' --output text) \
  --query 'tasks[0].overrides.containerOverrides[0].environment[?name==`BROKER_PROVIDER`].value | [0]'
```
(If the env var was set via the task definition rather than an override, the
above returns null; check the task definition's container env block instead.)

### Rollback to safe mode

When the active provider is broken, flip to `fake` to keep the gRPC server up
but reject orders cleanly:

```bash
ENV=staging
echo "broker_provider = \"fake\"" >> infra/terraform/envs/$ENV/terraform.tfvars
cd infra/terraform/envs/$ENV
terraform apply
```

Apps see `FakeProvider` errors on quote requests (no seeded data) — they pause
trades cleanly. agent-runner does not fail catastrophically.
````

- [ ] **Step 2: Append a "Provider switching" section to `DEPLOY.md`**

At end of `DEPLOY.md` (right before the `## What's not in this guide` block,
or appended to the end if simpler):

````markdown

## Phase 6 — broker-provider switching (Plan 6f)

The sidecar can run against MetaApi (`metaapi`, default), a fake in-memory
broker (`fake`), or the legacy MT5 path (`mt5`, not in v1 prod image).

### Populate MetaApi creds (once per env, after Phase 1)

```bash
ENV=staging   # then repeat for prod
# 1. Register the env's MT5 account with metaapi.cloud. Capture:
#    - METAAPI_TOKEN  (from your MetaApi dashboard)
#    - METAAPI_ACCOUNT_ID  (UUID of the account you just registered)

# 2. Update the Secrets Manager blob
DB_PASS=$(cd infra/terraform/envs/$ENV && terraform output -raw db_password)
cat > /tmp/$ENV-secrets.json <<EOF
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
  --secret-id forex-bot/$ENV/secrets \
  --secret-string file:///tmp/$ENV-secrets.json
rm /tmp/$ENV-secrets.json

# 3. Force the sidecar task to pick up the new secrets
aws ecs update-service \
  --cluster forex-bot-$ENV-cluster \
  --service forex-bot-$ENV-mt5-sidecar \
  --force-new-deployment
```

### Switching provider

See `infra/terraform/README.md` "Broker-provider switching" section.

### Troubleshooting

- **Sidecar log says `METAAPI_TOKEN + METAAPI_ACCOUNT_ID required`**: secrets
  blob not populated yet (or task started before the update). Update secret,
  force-new-deployment.
- **Logs say `synchronized=False` for >60s**: MetaApi can't reach broker.
  Verify the MT5 account is deployed on MetaApi dashboard, broker server is
  online, account isn't expired.
- **Cost spike**: tick-stream subscriptions are the dominant cost. Add the
  symbols you don't need to MetaApi's exclusion list via their dashboard.
````

- [ ] **Step 3: Commit**

```bash
git add infra/terraform/README.md DEPLOY.md
git commit -m "docs: add broker-provider switching + MetaApi creds runbook"
```

---

## Task 24: Add Plan 6f row in root README + flip status to done

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a new row under the Plans table**

In `README.md`, locate the `## Plans` table. After the `6e — ops-cli` row,
insert:
```
| 6f — Broker-provider plugin (MetaApi) | done | provider abstraction + MetaApi cloud migration; drops Wine sidecar |
```

(If `6e` row isn't yet in the table, place the new row immediately after `6c`.)

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: record Plan 6f as done in README plan table"
```

---

## Done-Done Checklist

- [ ] `mt5-sidecar/Dockerfile` builds locally in < 5 min, image ≤ 250 MB.
- [ ] `docker run --rm -e BROKER_PROVIDER=fake forex-bot/mt5-sidecar:smoke` boots and logs `provider=fake`.
- [ ] `docker run --rm -e BROKER_PROVIDER=metaapi forex-bot/mt5-sidecar:smoke` fails fast with `METAAPI_TOKEN + METAAPI_ACCOUNT_ID required`.
- [ ] `uv run pytest -v` in `mt5-sidecar/` passes (≥ 22 tests).
- [ ] `terraform validate` passes for `modules/secrets`, `modules/sidecar`, both envs.
- [ ] `terraform fmt -check -recursive infra/terraform/` clean.
- [ ] Existing `pnpm test`, `pnpm -r typecheck`, `pnpm lint` continue to pass.
- [ ] CI grep guard rejects `MetaApi(token=` in test files (verify by inspecting `ci.yml`).
- [ ] gRPC contract (`proto/mt5.proto`) unchanged.
- [ ] `apps/agent-runner` + `apps/paper-runner` source unchanged.
- [ ] Both env stacks compile with `broker_provider = "metaapi"` set explicitly.
- [ ] Secrets Manager blob in staging + prod accepts `metaApiToken` + `metaApiAccountId` keys (verify via `aws secretsmanager describe-secret`).
- [ ] First MetaApi-backed staging deploy: paper-runner reaches sidecar, sidecar logs `Provider: metaapi` + `synchronized=true`.
- [ ] No long-lived AWS access keys created.
- [ ] All resources tagged `Project=forex-bot`, `Environment=<env>`, `ManagedBy=terraform`.
- [ ] `DEPLOY.md` and `infra/terraform/README.md` updated with the MetaApi creds population step + provider switch commands.
- [ ] Plan 6f row added to root `README.md` plans table.

## Deferred to future plans

- **Async gRPC server** (replaces the `threading.Lock` + single event loop in `MetaApiProvider._run`). Plan 7 perf hardening if measured contention hurts.
- **`Mt5LinuxProvider`** (gmag11 image + mt5linux RPyC). Add as a 4th provider plugin if MetaApi proves unsuitable.
- **`adapter.py` shim deletion**. Plan 7 cleanup task: remove the shim one release after migration.
- **MetaApi cost tracking in `BudgetTracker`**. Extend the LLM-only tracker to count MetaApi spend. Plan 6d observability.
- **Cloud-region failover for MetaApi**. Plan 7+; today we pin `london`.
- **CloudWatch alarm on MetaApi `is_alive=False`**. Plan 6d observability.
- **Sidecar Fargate downsize** (1 vCPU/2 GB → 0.5 vCPU/1 GB). Plan 7 cost tuning after the new image runs comfortably.
