"""gRPC server wiring MT5Adapter to the proto contract."""

from __future__ import annotations

import threading
import time
from concurrent import futures

import grpc
from grpc_health.v1 import health, health_pb2, health_pb2_grpc

from .adapter import MT5Adapter
from .generated import mt5_pb2, mt5_pb2_grpc


def _to_proto_tick(t) -> mt5_pb2.Tick:
    return mt5_pb2.Tick(ts=t.ts, symbol=t.symbol, bid=t.bid, ask=t.ask)


def _to_proto_candle(c) -> mt5_pb2.Candle:
    return mt5_pb2.Candle(
        ts=c.ts, open=c.open, high=c.high, low=c.low, close=c.close, volume=c.volume
    )


def _to_proto_account(a) -> mt5_pb2.AccountState:
    return mt5_pb2.AccountState(
        ts=a.ts,
        currency=a.currency,
        balance=a.balance,
        equity=a.equity,
        free_margin=a.free_margin,
        used_margin=a.used_margin,
        margin_level_pct=a.margin_level_pct,
    )


def _to_proto_position(p) -> mt5_pb2.Position:
    return mt5_pb2.Position(
        id=p.id,
        symbol=p.symbol,
        side=mt5_pb2.SIDE_BUY if p.side == "buy" else mt5_pb2.SIDE_SELL,
        lot_size=p.lot_size,
        entry=p.entry,
        sl=p.sl,
        tp=p.tp,
        opened_at=p.opened_at,
    )


def _build_health_servicer(
    adapter: MT5Adapter, *, refresh_interval_s: float = 5.0
) -> health.HealthServicer:
    servicer = health.HealthServicer()
    servicer.set("", health_pb2.HealthCheckResponse.SERVING)
    servicer.set(
        "forex_bot.mt5.MT5", health_pb2.HealthCheckResponse.SERVING
    )

    def _refresh() -> None:
        while True:
            ok = adapter.is_alive()
            status = (
                health_pb2.HealthCheckResponse.SERVING
                if ok
                else health_pb2.HealthCheckResponse.NOT_SERVING
            )
            servicer.set("", status)
            servicer.set("forex_bot.mt5.MT5", status)
            time.sleep(refresh_interval_s)

    threading.Thread(
        target=_refresh, name="mt5-health-refresh", daemon=True
    ).start()
    return servicer


class MT5Service(mt5_pb2_grpc.MT5Servicer):
    def __init__(self, adapter: MT5Adapter, *, stream_interval_sec: float = 0.5):
        self._adapter = adapter
        self._stream_interval_sec = stream_interval_sec

    def GetQuote(self, request, context):
        try:
            return _to_proto_tick(self._adapter.get_quote(request.symbol))
        except Exception as e:
            context.abort(grpc.StatusCode.NOT_FOUND, str(e))

    def GetCandles(self, request, context):
        try:
            cs = self._adapter.get_candles(
                request.symbol, int(request.timeframe), int(request.limit)
            )
            return mt5_pb2.CandlesResponse(candles=[_to_proto_candle(c) for c in cs])
        except Exception as e:
            context.abort(grpc.StatusCode.INTERNAL, str(e))

    def GetAccount(self, request, context):
        return _to_proto_account(self._adapter.get_account())

    def GetOpenPositions(self, request, context):
        positions = self._adapter.get_open_positions()
        return mt5_pb2.OpenPositionsResponse(
            positions=[_to_proto_position(p) for p in positions]
        )

    def PlaceOrder(self, request, context):
        if request.type != mt5_pb2.ORDER_TYPE_MARKET:
            context.abort(
                grpc.StatusCode.UNIMPLEMENTED, "only market orders supported in v1"
            )
        side = "buy" if request.side == mt5_pb2.SIDE_BUY else "sell"
        try:
            out = self._adapter.place_market_order(
                symbol=request.symbol,
                side=side,
                lot_size=request.lot_size,
                sl=request.sl if request.HasField("sl") else None,
                tp=request.tp if request.HasField("tp") else None,
                client_id=request.client_id if request.HasField("client_id") else None,
            )
            return mt5_pb2.PlaceOrderResponse(
                ticket=out["ticket"], fill_price=out["fill_price"]
            )
        except Exception as e:
            context.abort(grpc.StatusCode.FAILED_PRECONDITION, str(e))

    def ModifyOrder(self, request, context):
        context.abort(grpc.StatusCode.UNIMPLEMENTED, "ModifyOrder not yet implemented")

    def ClosePosition(self, request, context):
        context.abort(grpc.StatusCode.UNIMPLEMENTED, "ClosePosition not yet implemented")

    def StreamTicks(self, request, context):
        symbols = list(request.symbols)
        while context.is_active():
            for s in symbols:
                try:
                    yield _to_proto_tick(self._adapter.get_quote(s))
                except Exception:
                    continue
            time.sleep(self._stream_interval_sec)


def build_server(
    adapter: MT5Adapter, host: str = "0.0.0.0", port: int = 50051
) -> grpc.Server:
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=8))
    mt5_pb2_grpc.add_MT5Servicer_to_server(MT5Service(adapter), server)
    health_servicer = _build_health_servicer(adapter)
    health_pb2_grpc.add_HealthServicer_to_server(health_servicer, server)
    server.add_insecure_port(f"{host}:{port}")
    return server
