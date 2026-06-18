"""Regression tests for the MetaApi provider bootstrap + data methods.

Covers three bugs that only ever surfaced against real MetaApi:
  1. MetaApi() / connection objects schedule asyncio tasks in their
     constructors, so they must be built inside a running loop.
  2. The provider must use the RPC connection (get_rpc_connection) — its
     data/order methods live there; the streaming connection exposes that data
     via terminal_state and would raise AttributeError.
  3. get_account/get_quote/get_open_positions must map the SDK responses to the
     domain dataclasses.

A fake SDK is injected via monkeypatch; no real network, and this file never
constructs the real SDK client (CI bans that in tests).
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

_FIXED_DT = datetime(2026, 1, 1, tzinfo=timezone.utc)


class _FakeRpcConnection:
    def __init__(self) -> None:
        # Built synchronously inside _bootstrap; must run under a live loop.
        asyncio.get_running_loop()

    async def connect(self) -> None:
        return None

    async def wait_synchronized(self) -> None:
        return None

    async def get_account_information(self) -> dict:
        return {
            "currency": "USD",
            "balance": 1000.0,
            "equity": 1000.0,
            "freeMargin": 1000.0,
            "margin": 0.0,
            "marginLevel": 0.0,
        }

    async def get_symbol_price(self, _symbol: str) -> dict:
        return {"time": _FIXED_DT, "bid": 1.1, "ask": 1.2}

    async def get_positions(self) -> list:
        return []

    async def close(self) -> None:
        return None


class _FakeAccount:
    connection_status = "CONNECTED"

    async def deploy(self) -> None:
        return None

    async def wait_connected(self) -> None:
        return None

    def get_rpc_connection(self) -> _FakeRpcConnection:
        return _FakeRpcConnection()

    async def get_historical_candles(self, _s: str, _tf: str, limit: int = 0) -> list:
        return []


class _FakeAccountApi:
    async def get_account(self, _acct_id: str) -> _FakeAccount:
        return _FakeAccount()


class _FakeMetaApi:
    """Mimics the real SDK: its constructor needs a running event loop."""

    def __init__(self, *_args: Any, **_kwargs: Any) -> None:
        asyncio.get_running_loop()
        self.metatrader_account_api = _FakeAccountApi()


def test_initialize_and_data_methods_use_rpc_connection(monkeypatch):
    monkeypatch.setattr(
        "mt5_sidecar.providers.metaapi.MetaApi", _FakeMetaApi, raising=True
    )
    from mt5_sidecar.providers.metaapi import MetaApiProvider

    p = MetaApiProvider()
    try:
        # Must not raise "no running event loop" (bootstrap runs in the loop)
        # nor AttributeError (RPC connection, not streaming).
        p.initialize(token="tok", account_id="acct")
        assert p.is_alive() is True

        acct = p.get_account()
        assert acct.currency == "USD"
        assert acct.balance == 1000.0

        tick = p.get_quote("EURUSD")
        assert tick.symbol == "EURUSD"
        assert tick.bid == 1.1
        assert tick.ask == 1.2

        assert p.get_open_positions() == []
    finally:
        p.shutdown()
