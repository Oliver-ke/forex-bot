"""Tests for factory dispatch + legacy MT5 kwargs handling in __main__."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


def _run_main_with_env(
    monkeypatch: pytest.MonkeyPatch, env: dict[str, str], provider_mock: MagicMock
) -> MagicMock:
    """Boot __main__.main() with the given env; capture provider.initialize kwargs."""
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    server = MagicMock()
    server.wait_for_termination.side_effect = SystemExit(0)
    with (
        patch("mt5_sidecar.__main__.get_provider", return_value=provider_mock),
        patch("mt5_sidecar.__main__.build_server", return_value=server),
    ):
        from mt5_sidecar import __main__ as entry

        with pytest.raises(SystemExit):
            entry.main()
    return provider_mock


def test_fake_provider_initializes_without_creds(monkeypatch):
    provider = MagicMock()
    env = {"BROKER_PROVIDER": "fake"}
    _run_main_with_env(monkeypatch, env, provider)
    provider.initialize.assert_called_once_with()


def test_metaapi_provider_initializes_without_legacy_kwargs(monkeypatch):
    provider = MagicMock()
    env = {
        "BROKER_PROVIDER": "metaapi",
        # Legacy MT5_* env vars are present but should be IGNORED for metaapi.
        "MT5_LOGIN": "12345",
        "MT5_SERVER": "ICMarketsSC-Demo",
        "MT5_PASSWORD": "secret",
    }
    _run_main_with_env(monkeypatch, env, provider)
    provider.initialize.assert_called_once_with()


def test_mt5_provider_uses_env_kwargs_when_all_three_present(monkeypatch):
    provider = MagicMock()
    env = {
        "BROKER_PROVIDER": "mt5",
        "MT5_LOGIN": "12345",
        "MT5_SERVER": "ICMarketsSC-Demo",
        "MT5_PASSWORD": "secret",
    }
    _run_main_with_env(monkeypatch, env, provider)
    provider.initialize.assert_called_once_with(
        login=12345, server="ICMarketsSC-Demo", password="secret"
    )


def test_mt5_provider_falls_back_to_no_args_when_env_missing(monkeypatch):
    provider = MagicMock()
    for var in ("MT5_LOGIN", "MT5_SERVER", "MT5_PASSWORD"):
        monkeypatch.delenv(var, raising=False)
    env = {"BROKER_PROVIDER": "mt5"}
    _run_main_with_env(monkeypatch, env, provider)
    provider.initialize.assert_called_once_with()


def test_mt5_provider_raises_on_non_numeric_login(monkeypatch):
    provider = MagicMock()
    env = {
        "BROKER_PROVIDER": "mt5",
        "MT5_LOGIN": "abc",  # not int-parseable
        "MT5_SERVER": "X",
        "MT5_PASSWORD": "y",
    }
    with pytest.raises(ValueError):
        _run_main_with_env(monkeypatch, env, provider)
