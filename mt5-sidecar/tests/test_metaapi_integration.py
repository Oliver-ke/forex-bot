"""Real-network smoke test for MetaApiProvider.

SKIPPED by default. Runs only when:
  RUN_METAAPI_INTEGRATION=1
  METAAPI_TOKEN=<real token>
  METAAPI_ACCOUNT_ID=<UUID of a registered demo MT5 account>

Hits the actual metaapi.cloud demo backend. Used by operator for pre-deploy
verification, not by CI.
"""

from __future__ import annotations

import os

import pytest


pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_METAAPI_INTEGRATION") != "1"
    or not os.environ.get("METAAPI_TOKEN")
    or not os.environ.get("METAAPI_ACCOUNT_ID"),
    reason="set RUN_METAAPI_INTEGRATION=1 + METAAPI_TOKEN + METAAPI_ACCOUNT_ID",
)


def test_metaapi_provider_connects_and_reads_account():
    """Smoke: initialize, fetch account info, shutdown."""
    from mt5_sidecar.providers.metaapi import MetaApiProvider

    p = MetaApiProvider()
    try:
        p.initialize()
        assert p.is_alive(), "is_alive() should be True after initialize"
        acct = p.get_account()
        assert acct.currency  # any non-empty string
        assert acct.balance >= 0
    finally:
        p.shutdown()
