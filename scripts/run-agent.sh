#!/usr/bin/env bash
# Run agent-runner with envs from .env (or current shell).
# Production-ish: real MT5 + Redis + Anthropic.
set -euo pipefail
# shellcheck source=lib/load-env.sh
source "$(dirname "$0")/lib/load-env.sh"

require_env MT5_HOST MT5_PORT REDIS_URL ANTHROPIC_API_KEY WATCHED_SYMBOLS

run_tsx apps/agent-runner/src/main.ts "$@"
