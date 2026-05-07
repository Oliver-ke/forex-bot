"""Thin wrapper over the `MetaTrader5` SDK.

The wrapper accepts a module-like object as a parameter to enable testing with
a mock. In production the caller passes the real `MetaTrader5` module.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Iterable, Protocol

from .mappings import (
    MT5_ORDER_TYPE_BUY,
    MT5_ORDER_TYPE_SELL,
    MT5_TRADE_ACTION_DEAL,
    MT5_TRADE_RETCODE_DONE,
    PROTO_TO_MT5_TIMEFRAME,
)


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
    side: str  # "buy"|"sell"
    lot_size: float
    entry: float
    sl: float
    tp: float
    opened_at: int


class MT5Adapter:
    def __init__(self, sdk: MT5SDK):
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
