from __future__ import annotations

import grpc

from mt5_sidecar.generated import mt5_pb2, mt5_pb2_grpc
from mt5_sidecar.providers.fake import FakeProvider
from mt5_sidecar.server import build_server


def test_get_quote_round_trip() -> None:
    adapter = FakeProvider()
    adapter.initialize()
    adapter.set_quote("EURUSD", bid=1.1000, ask=1.1002)
    server = build_server(adapter, host="127.0.0.1", port=0)
    bound_port = server.add_insecure_port("127.0.0.1:0")
    server.start()
    try:
        with grpc.insecure_channel(f"127.0.0.1:{bound_port}") as channel:
            stub = mt5_pb2_grpc.MT5Stub(channel)
            t = stub.GetQuote(mt5_pb2.GetQuoteRequest(symbol="EURUSD"))
            assert t.symbol == "EURUSD"
            assert abs(t.bid - 1.1000) < 1e-9
            assert abs(t.ask - 1.1002) < 1e-9
    finally:
        server.stop(0)


def test_place_order_market_round_trip() -> None:
    adapter = FakeProvider()
    adapter.initialize()
    adapter.set_quote("EURUSD", bid=1.1000, ask=1.1002)
    server = build_server(adapter, host="127.0.0.1", port=0)
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
                    sl=1.0950,
                    tp=1.1050,
                )
            )
            assert res.ticket == "1"
            assert abs(res.fill_price - 1.1002) < 1e-9
    finally:
        server.stop(0)
