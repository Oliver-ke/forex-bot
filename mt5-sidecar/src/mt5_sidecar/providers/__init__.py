"""Broker provider plugins. Selection driven by BROKER_PROVIDER env var.

Usage:
    from mt5_sidecar.providers import get_provider, BrokerProvider
    provider = get_provider()   # honours BROKER_PROVIDER; defaults to metaapi
    provider.initialize()
"""

from __future__ import annotations

import os

from .base import Account, BrokerProvider, Candle, Position, Tick


def get_provider() -> BrokerProvider:
    """Construct a provider based on the BROKER_PROVIDER env var.

    Valid values: 'metaapi' (default), 'fake', 'mt5'.
    Raises ValueError on any other value.
    """
    name = os.environ.get("BROKER_PROVIDER", "metaapi").lower()
    if name == "metaapi":
        from .metaapi import MetaApiProvider

        return MetaApiProvider()
    if name == "fake":
        from .fake import FakeProvider

        return FakeProvider()
    if name == "mt5":
        from .mt5_native import MT5Provider

        return MT5Provider()
    raise ValueError(
        f"Unknown BROKER_PROVIDER={name!r}. Valid: metaapi, fake, mt5"
    )


__all__ = [
    "Account",
    "BrokerProvider",
    "Candle",
    "Position",
    "Tick",
    "get_provider",
]
