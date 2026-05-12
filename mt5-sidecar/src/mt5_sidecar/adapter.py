"""DEPRECATED: import from `mt5_sidecar.providers` instead.

This module re-exports the legacy `MT5Adapter` (now `MT5Provider`) plus the
shared dataclasses (Tick, Candle, Account, Position) for one release window.
Slated for deletion in a Plan 7 cleanup task.

New code should:
    from mt5_sidecar.providers import get_provider, BrokerProvider
    from mt5_sidecar.providers.base import Tick, Candle, Account, Position
    from mt5_sidecar.providers.mt5_native import MT5Provider
"""

from __future__ import annotations

from .providers.base import Account, BrokerProvider, Candle, Position, Tick
from .providers.mt5_native import MT5Provider, MT5SDK

# Back-compat alias: tests + downstream still reference MT5Adapter.
MT5Adapter = MT5Provider

__all__ = [
    "Account",
    "BrokerProvider",
    "Candle",
    "MT5Adapter",
    "MT5Provider",
    "MT5SDK",
    "Position",
    "Tick",
]
