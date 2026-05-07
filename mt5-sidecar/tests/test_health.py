"""Tests for gRPC health service wiring + watchdog refresh."""

from __future__ import annotations

import time
from unittest.mock import MagicMock

import grpc
from grpc_health.v1 import health_pb2

from mt5_sidecar.adapter import MT5Adapter
from mt5_sidecar.server import _build_health_servicer, build_server


def test_build_server_returns_grpc_server():
    sdk = MagicMock()
    adapter = MT5Adapter(sdk)
    server = build_server(adapter, host="127.0.0.1", port=0)
    assert isinstance(server, grpc.Server)


def _check(servicer, service: str) -> int:
    req = health_pb2.HealthCheckRequest(service=service)
    resp = servicer.Check(req, MagicMock())
    return resp.status


def test_health_servicer_reflects_adapter_state():
    sdk = MagicMock()
    sdk.account_info.return_value = MagicMock()  # alive
    adapter = MT5Adapter(sdk)
    servicer = _build_health_servicer(adapter, refresh_interval_s=0.01)
    time.sleep(0.05)
    assert _check(servicer, "") == health_pb2.HealthCheckResponse.SERVING
    assert (
        _check(servicer, "forex_bot.mt5.MT5")
        == health_pb2.HealthCheckResponse.SERVING
    )

    # Now flip to not alive
    sdk.account_info.return_value = None
    time.sleep(0.05)
    assert _check(servicer, "") == health_pb2.HealthCheckResponse.NOT_SERVING
    assert (
        _check(servicer, "forex_bot.mt5.MT5")
        == health_pb2.HealthCheckResponse.NOT_SERVING
    )
