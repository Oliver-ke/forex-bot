#!/usr/bin/env bash
# Start the MT5 Python gRPC sidecar (foreground, Ctrl-C to stop).
# Listens on MT5_SIDECAR_HOST:MT5_SIDECAR_PORT (default 0.0.0.0:50051).
# Note: the MetaTrader5 Python package is Windows-only and is installed at
# deploy time via Wine. On macOS dev, the sidecar will fail-fast unless you
# either (a) run it in the docker image with Wine + MT5 mounted, or
# (b) point the agent at a remote sidecar host via MT5_HOST.
set -euo pipefail
# shellcheck source=lib/load-env.sh
source "$(dirname "$0")/lib/load-env.sh"

cd "$REPO_ROOT/mt5-sidecar"

if [[ ! -d ".venv" ]]; then
  echo "==> first run: setting up uv venv"
  uv venv
  uv pip install -e ".[dev]"
  make proto
fi

# Forward MT5_HOST/MT5_PORT to the sidecar's bind vars when caller set them.
export MT5_SIDECAR_HOST="${MT5_SIDECAR_HOST:-${MT5_HOST:-0.0.0.0}}"
export MT5_SIDECAR_PORT="${MT5_SIDECAR_PORT:-${MT5_PORT:-50051}}"

echo "==> mt5-sidecar listening on ${MT5_SIDECAR_HOST}:${MT5_SIDECAR_PORT}"
exec uv run mt5-sidecar
