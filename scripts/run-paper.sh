#!/usr/bin/env bash
# Run paper-runner with paper guards (forces PAPER_MODE/MT5_DEMO).
# Refuses to start unless the broker self-reports as demo.
set -euo pipefail
# shellcheck source=lib/load-env.sh
source "$(dirname "$0")/lib/load-env.sh"

# Defensive: paper-runner enforces these too, but fail earlier with friendlier output.
export PAPER_MODE="${PAPER_MODE:-1}"
export MT5_DEMO="${MT5_DEMO:-1}"
export PAPER_OUT_DIR="${PAPER_OUT_DIR:-./paper-out}"

require_env MT5_HOST MT5_PORT REDIS_URL ANTHROPIC_API_KEY WATCHED_SYMBOLS PAPER_BUDGET_USD

run_tsx apps/paper-runner/src/main.ts "$@"
