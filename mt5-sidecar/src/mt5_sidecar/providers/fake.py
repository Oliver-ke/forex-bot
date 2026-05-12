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
