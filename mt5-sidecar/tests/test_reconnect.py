"""Tests for MT5Adapter.is_alive and reconnect_or_die."""

from __future__ import annotations
from unittest.mock import MagicMock
import pytest

from mt5_sidecar.adapter import MT5Adapter


def test_is_alive_true_when_account_info_returns_value():
    sdk = MagicMock()
    sdk.account_info.return_value = MagicMock(login=12345)
    adapter = MT5Adapter(sdk)
    assert adapter.is_alive() is True


def test_is_alive_false_when_account_info_returns_none():
    sdk = MagicMock()
    sdk.account_info.return_value = None
    adapter = MT5Adapter(sdk)
    assert adapter.is_alive() is False


def test_is_alive_false_when_account_info_raises():
    sdk = MagicMock()
    sdk.account_info.side_effect = RuntimeError("disconnected")
    adapter = MT5Adapter(sdk)
    assert adapter.is_alive() is False


def test_reconnect_or_die_succeeds_on_first_attempt():
    sdk = MagicMock()
    sdk.initialize.return_value = True
    adapter = MT5Adapter(sdk)
    adapter.initialize(login=12345, server="X", password="y")
    sdk.initialize.reset_mock()
    sdk.shutdown.reset_mock()
    sdk.initialize.return_value = True
    adapter.reconnect_or_die()
    sdk.shutdown.assert_called_once()
    sdk.initialize.assert_called_once_with(login=12345, server="X", password="y")


def test_reconnect_or_die_raises_after_exhausting_attempts():
    sdk = MagicMock()
    sdk.initialize.return_value = True
    adapter = MT5Adapter(sdk)
    adapter.initialize()  # store empty kwargs
    sdk.initialize.reset_mock()
    sdk.initialize.return_value = False
    with pytest.raises(RuntimeError, match="reconnect failed"):
        adapter.reconnect_or_die(max_attempts=2)
    assert sdk.initialize.call_count == 2
