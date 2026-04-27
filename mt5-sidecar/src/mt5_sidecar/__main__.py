"""Entrypoint: bootstraps the real MetaTrader5 SDK and starts the gRPC server."""

from __future__ import annotations

import os
import signal
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
    adapter.initialize()
    host = os.environ.get("MT5_SIDECAR_HOST", "0.0.0.0")
    port = int(os.environ.get("MT5_SIDECAR_PORT", "50051"))
    server = build_server(adapter, host=host, port=port)
    server.start()

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
