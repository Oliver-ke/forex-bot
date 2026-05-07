"""Entrypoint: bootstraps the real MetaTrader5 SDK and starts the gRPC server."""

from __future__ import annotations

import os
import signal
import threading
import time
from typing import NoReturn

from .adapter import MT5Adapter
from .server import build_server


def main() -> NoReturn:
    try:
        import MetaTrader5 as mt5  # type: ignore[import-not-found]
    except ImportError as e:
        raise SystemExit(
            "MetaTrader5 package not installed (install with `[mt5]` extra)"
        ) from e

    adapter = MT5Adapter(mt5)

    login = os.environ.get("MT5_LOGIN")
    server_name = os.environ.get("MT5_SERVER")
    password = os.environ.get("MT5_PASSWORD")
    if login and server_name and password:
        adapter.initialize(login=int(login), server=server_name, password=password)
    else:
        adapter.initialize()

    host = os.environ.get("MT5_SIDECAR_HOST", "0.0.0.0")
    port = int(os.environ.get("MT5_SIDECAR_PORT", "50051"))
    server = build_server(adapter, host=host, port=port)
    server.start()

    def _watchdog() -> None:
        consecutive_failures = 0
        while True:
            time.sleep(30.0)
            if adapter.is_alive():
                consecutive_failures = 0
                continue
            consecutive_failures += 1
            print(
                f"mt5-sidecar: liveness probe failed (consecutive={consecutive_failures})",
                flush=True,
            )
            if consecutive_failures == 1:
                try:
                    adapter.reconnect_or_die(max_attempts=1)
                    consecutive_failures = 0
                    continue
                except Exception as exc:
                    print(f"mt5-sidecar: reconnect attempt failed: {exc}", flush=True)
            if consecutive_failures >= 2:
                print(
                    "mt5-sidecar: liveness probe failed twice; exiting for ECS restart",
                    flush=True,
                )
                os._exit(1)

    threading.Thread(target=_watchdog, name="mt5-watchdog", daemon=True).start()

    def _shutdown(signum, frame):  # noqa: ANN001
        server.stop(grace=3)
        adapter.shutdown()
        raise SystemExit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)
    print(f"mt5-sidecar listening on {host}:{port}", flush=True)
    server.wait_for_termination()
    raise SystemExit(0)


if __name__ == "__main__":
    main()
