from __future__ import annotations

from types import SimpleNamespace

import grpc

from mt5_sidecar.adapter import MT5Adapter
from mt5_sidecar.generated import mt5_pb2, mt5_pb2_grpc
from mt5_sidecar.server import build_server


def _make_sdk():
    return SimpleNamespace(
        initialize=lambda **kw: True,
        shutdown=lambda: None,
        symbol_info_tick=lambda s: SimpleNamespace(time_msc=1, bid=1.0801, ask=1.0803),
        copy_rates_from_pos=lambda s, tf, start, count: [],
        account_info=lambda: None,
        positions_get=lambda: [],
        order_send=lambda req: SimpleNamespace(retcode=10009, order=42, price=1.0803),
    )


def test_get_quote_round_trip() -> None:
    server = build_server(MT5Adapter(_make_sdk()), host="127.0.0.1", port=0)
    bound_port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    try:
        with grpc.insecure_channel(f"127.0.0.1:{bound_port}") as channel:
            stub = mt5_pb2_grpc.MT5Stub(channel)
            t = stub.GetQuote(mt5_pb2.GetQuoteRequest(symbol="EURUSD"))
            assert t.symbol == "EURUSD"
            assert abs(t.bid - 1.0801) < 1e-9
    finally:
        server.stop(0)


def test_place_order_market_round_trip() -> None:
    server = build_server(MT5Adapter(_make_sdk()), host="127.0.0.1", port=0)
    bound_port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    try:
        with grpc.insecure_channel(f"127.0.0.1:{bound_port}") as channel:
            stub = mt5_pb2_grpc.MT5Stub(channel)
            res = stub.PlaceOrder(
                mt5_pb2.PlaceOrderRequest(
                    symbol="EURUSD",
                    side=mt5_pb2.SIDE_BUY,
                    lot_size=0.1,
                    type=mt5_pb2.ORDER_TYPE_MARKET,
                    sl=1.075,
                    tp=1.085,
                )
            )
            assert res.ticket == "42"
            assert abs(res.fill_price - 1.0803) < 1e-9
    finally:
        server.stop(0)
