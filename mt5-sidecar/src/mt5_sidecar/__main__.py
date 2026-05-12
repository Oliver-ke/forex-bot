"""Entrypoint: starts the gRPC server with a BrokerProvider chosen at boot."""

from __future__ import annotations

import os
import signal
import threading
import time
from typing import Any, NoReturn

from .providers import BrokerProvider, get_provider
from .server import build_server


def _legacy_mt5_kwargs() -> dict[str, Any]:
    """Build kwargs for the legacy MT5Provider from MT5_* env vars, if all
    three are present. Returns {} otherwise (provider then uses last-known
    login). MetaApi/Fake providers ignore this entirely."""
    login = os.environ.get("MT5_LOGIN")
    server_name = os.environ.get("MT5_SERVER")
    password = os.environ.get("MT5_PASSWORD")
    if login and server_name and password:
        return {"login": int(login), "server": server_name, "password": password}
    return {}


def main() -> NoReturn:
    provider_name = os.environ.get("BROKER_PROVIDER", "metaapi").lower()
    print(f"mt5-sidecar: provider={provider_name}", flush=True)

    provider: BrokerProvider = get_provider()
    init_kwargs = _legacy_mt5_kwargs() if provider_name == "mt5" else {}
    provider.initialize(**init_kwargs)

    host = os.environ.get("MT5_SIDECAR_HOST", "0.0.0.0")
    port = int(os.environ.get("MT5_SIDECAR_PORT", "50051"))
    server = build_server(provider, host=host, port=port)
    server.start()

    def _watchdog() -> None:
        consecutive_failures = 0
        while True:
            time.sleep(30.0)
            if provider.is_alive():
                consecutive_failures = 0
                continue
            consecutive_failures += 1
            print(
                f"mt5-sidecar: liveness probe failed (consecutive={consecutive_failures})",
                flush=True,
            )
            if consecutive_failures == 1:
                try:
                    provider.reconnect_or_die(max_attempts=1)
                    consecutive_failures = 0
                    continue
                except Exception as exc:
                    print(
                        f"mt5-sidecar: reconnect attempt failed: {exc}",
                        flush=True,
                    )
            if consecutive_failures >= 2:
                print(
                    "mt5-sidecar: liveness probe failed twice; exiting for ECS restart",
                    flush=True,
                )
                os._exit(1)

    threading.Thread(
        target=_watchdog, name="mt5-watchdog", daemon=True
    ).start()

    def _shutdown(signum, frame):  # noqa: ANN001
        server.stop(grace=3)
        provider.shutdown()
        raise SystemExit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)
    print(f"mt5-sidecar listening on {host}:{port}", flush=True)
    server.wait_for_termination()
    raise SystemExit(0)


if __name__ == "__main__":
    main()
