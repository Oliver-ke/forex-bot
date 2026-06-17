"""Regression test for the MetaApi provider event-loop bootstrap.

The real metaapi_cloud_sdk MetaApi constructor schedules an asyncio task
(asyncio.create_task), so it must be built while an event loop is running.
The provider previously constructed it outside the loop, which crashed every
real boot with "RuntimeError: no running event loop". This test stands in a
fake SDK whose __init__ requires a running loop and asserts initialize()
succeeds.

No real network; the fake is injected via monkeypatch, so this file never
constructs the real SDK client and stays clear of the CI ban on doing so in
tests.
"""

from __future__ import annotations

import asyncio
from typing import Any


class _FakeConnection:
    synchronized = True

    async def connect(self) -> None:
        return None

    async def wait_synchronized(self) -> None:
        return None

    async def close(self) -> None:
        return None


class _FakeAccount:
    async def deploy(self) -> None:
        return None

    async def wait_connected(self) -> None:
        return None

    def get_streaming_connection(self) -> _FakeConnection:
        return _FakeConnection()


class _FakeAccountApi:
    async def get_account(self, _acct_id: str) -> _FakeAccount:
        return _FakeAccount()


class _FakeMetaApi:
    """Mimics the real SDK: its constructor needs a running event loop."""

    def __init__(self, *_args: Any, **_kwargs: Any) -> None:
        # Raises RuntimeError("no running event loop") if built outside a loop —
        # exactly the failure mode of the real metaapi_cloud_sdk constructor.
        asyncio.get_running_loop()
        self.metatrader_account_api = _FakeAccountApi()


def test_initialize_constructs_metaapi_inside_running_loop(monkeypatch):
    monkeypatch.setattr(
        "mt5_sidecar.providers.metaapi.MetaApi", _FakeMetaApi, raising=True
    )
    from mt5_sidecar.providers.metaapi import MetaApiProvider

    p = MetaApiProvider()
    try:
        # Must not raise "RuntimeError: no running event loop".
        p.initialize(token="tok", account_id="acct", region="london")
        assert p.is_alive() is True
    finally:
        p.shutdown()
