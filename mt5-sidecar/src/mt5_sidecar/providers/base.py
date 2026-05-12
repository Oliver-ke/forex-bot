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
