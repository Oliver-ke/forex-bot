"""Pytest fixtures shared across sidecar tests."""

from __future__ import annotations

import pytest


@pytest.fixture
def fake_now() -> int:
    return 1_700_000_000_000
