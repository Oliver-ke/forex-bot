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
        if not (token and acct_id):
            raise RuntimeError("METAAPI_TOKEN + METAAPI_ACCOUNT_ID required")
        self._init_kwargs = {"token": token, "account_id": acct_id}

        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        # Run the whole bootstrap inside the loop. Several SDK objects
        # (MetaApi, the connection) schedule asyncio tasks in their constructors,
        # so they must be built while the loop is running — otherwise they raise
        # "RuntimeError: no running event loop". Doing it all in one coroutine
        # guarantees a running loop for every step.
        self._run(self._bootstrap(token, acct_id))

    async def _bootstrap(self, token: str, acct_id: str) -> None:
        # No `region` option: the Python SDK auto-discovers the account's region.
        # Passing it pinned the client to a shared server that wasn't the
        # account's active API server, causing constant websocket reconnects and
        # "retrying subscription" churn (verified: region=on flaps ~1/min;
        # region=off stays connected). The SDK explicitly warns against passing
        # region for the Python/JS SDKs.
        self._api = MetaApi(token=token)
        self._account = await self._api.metatrader_account_api.get_account(acct_id)
        await self._account.deploy()
        await self._account.wait_connected()
        # RPC connection (not streaming): the data/order methods this provider
        # calls — get_account_information, get_symbol_price, get_positions,
        # create_market_*_order — live on the RPC connection. The streaming
        # connection exposes that data via terminal_state instead and would
        # raise AttributeError on these calls.
        self._connection = self._account.get_rpc_connection()
        await self._connection.connect()
        await self._connection.wait_synchronized()

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
        # The RPC connection has no `synchronized` property; use the account's
        # broker connection status (CONNECTED/DISCONNECTED) as the liveness signal.
        try:
            if self._connection is None or self._account is None:
                return False
            return "CONNECTED" in str(getattr(self._account, "connection_status", "")).upper()
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
