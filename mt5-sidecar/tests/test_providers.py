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
