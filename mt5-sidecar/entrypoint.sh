#!/usr/bin/env bash
set -euo pipefail

# Boot Xvfb so Wine + MT5 can paint to a virtual display
Xvfb :99 -screen 0 1024x768x16 &
XVFB_PID=$!
trap 'kill -TERM $XVFB_PID 2>/dev/null || true' EXIT

# Run sidecar inside the Wine prefix (Python-on-Windows imports MetaTrader5).
exec wine python -m mt5_sidecar
