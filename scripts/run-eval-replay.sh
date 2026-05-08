#!/usr/bin/env bash
# Pass-through to eval-replay CLI. All flags forwarded.
# Cheap mode needs --cache-dir with prepopulated responses.
# Full mode needs ANTHROPIC_API_KEY (loaded from .env if set).
set -euo pipefail
# shellcheck source=lib/load-env.sh
source "$(dirname "$0")/lib/load-env.sh"

run_tsx apps/eval-replay/src/main.ts "$@"
