"""Tests for env-var driven MT5 login in __main__.main()."""

from __future__ import annotations
from unittest.mock import MagicMock, patch
import pytest


def _run_main_with_env(monkeypatch, env: dict[str, str], mt5_mock: MagicMock):
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    server = MagicMock()
    server.wait_for_termination.side_effect = SystemExit(0)
    with (
        patch("mt5_sidecar.__main__.MT5Adapter") as adapter_cls,
        patch("mt5_sidecar.__main__.build_server", return_value=server),
        patch.dict("sys.modules", {"MetaTrader5": mt5_mock}),
    ):
        adapter = MagicMock()
        adapter_cls.return_value = adapter
        from mt5_sidecar import __main__ as entry
        with pytest.raises(SystemExit):
            entry.main()
        return adapter


def test_login_uses_env_vars_when_all_three_present(monkeypatch):
    env = {"MT5_LOGIN": "12345", "MT5_SERVER": "ICMarketsSC-Demo", "MT5_PASSWORD": "secret"}
    adapter = _run_main_with_env(monkeypatch, env, MagicMock())
    adapter.initialize.assert_called_once_with(
        login=12345, server="ICMarketsSC-Demo", password="secret"
    )


def test_login_falls_back_to_no_args_when_env_missing(monkeypatch):
    monkeypatch.delenv("MT5_LOGIN", raising=False)
    monkeypatch.delenv("MT5_SERVER", raising=False)
    monkeypatch.delenv("MT5_PASSWORD", raising=False)
    adapter = _run_main_with_env(monkeypatch, {}, MagicMock())
    adapter.initialize.assert_called_once_with()


def test_login_raises_on_non_numeric_login(monkeypatch):
    env = {"MT5_LOGIN": "abc", "MT5_SERVER": "X", "MT5_PASSWORD": "y"}
    with pytest.raises(ValueError):
        _run_main_with_env(monkeypatch, env, MagicMock())
