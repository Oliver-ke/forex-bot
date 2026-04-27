from __future__ import annotations

from types import SimpleNamespace

import pytest

from mt5_sidecar.adapter import MT5Adapter


def make_sdk_for_quote() -> SimpleNamespace:
    tick = SimpleNamespace(time_msc=1_700_000_000_000, bid=1.0801, ask=1.0803)
    return SimpleNamespace(
        initialize=lambda **kw: True,
        shutdown=lambda: None,
        symbol_info_tick=lambda s: tick,
        copy_rates_from_pos=lambda s, tf, start, count: None,
        account_info=lambda: None,
        positions_get=lambda: [],
        order_send=lambda req: None,
    )


def test_get_quote_returns_tick() -> None:
    adapter = MT5Adapter(make_sdk_for_quote())
    t = adapter.get_quote("EURUSD")
    assert t.symbol == "EURUSD"
    assert t.bid == 1.0801
    assert t.ask == 1.0803


def test_get_account_maps_fields() -> None:
    sdk = SimpleNamespace(
        initialize=lambda **kw: True,
        shutdown=lambda: None,
        symbol_info_tick=lambda s: None,
        copy_rates_from_pos=lambda s, tf, start, count: None,
        account_info=lambda: SimpleNamespace(
            currency="USD",
            balance=10_000.0,
            equity=10_010.0,
            margin_free=9_500.0,
            margin=500.0,
            margin_level=2010.0,
        ),
        positions_get=lambda: [],
        order_send=lambda req: None,
    )
    adapter = MT5Adapter(sdk)
    a = adapter.get_account()
    assert a.currency == "USD"
    assert a.equity == 10_010.0


def test_place_market_order_uses_ask_for_buy() -> None:
    sent: dict = {}

    def order_send(req: dict) -> SimpleNamespace:
        sent.update(req)
        return SimpleNamespace(retcode=10009, order=12345, price=1.0803)

    sdk = SimpleNamespace(
        initialize=lambda **kw: True,
        shutdown=lambda: None,
        symbol_info_tick=lambda s: SimpleNamespace(time_msc=1, bid=1.0801, ask=1.0803),
        copy_rates_from_pos=lambda s, tf, start, count: None,
        account_info=lambda: None,
        positions_get=lambda: [],
        order_send=order_send,
    )
    adapter = MT5Adapter(sdk)
    out = adapter.place_market_order(
        "EURUSD", "buy", 0.1, sl=1.075, tp=1.085, client_id="x"
    )
    assert out["ticket"] == "12345"
    assert sent["price"] == 1.0803


def test_place_order_raises_on_reject() -> None:
    sdk = SimpleNamespace(
        initialize=lambda **kw: True,
        shutdown=lambda: None,
        symbol_info_tick=lambda s: SimpleNamespace(time_msc=1, bid=1.0801, ask=1.0803),
        copy_rates_from_pos=lambda s, tf, start, count: None,
        account_info=lambda: None,
        positions_get=lambda: [],
        order_send=lambda req: SimpleNamespace(retcode=10004, order=0, price=0),
    )
    adapter = MT5Adapter(sdk)
    with pytest.raises(RuntimeError, match="rejected"):
        adapter.place_market_order(
            "EURUSD", "buy", 0.1, sl=None, tp=None, client_id=None
        )
