#!/usr/bin/env bash
# Pass-through to event-study CLI. All flags forwarded.
# Cheap-mode + no override LLM needs CHEAP_FAKE_LLM=1 (always-long fake).
set -euo pipefail
# shellcheck source=lib/load-env.sh
source "$(dirname "$0")/lib/load-env.sh"

run_tsx apps/eval-event-study/src/main.ts "$@"
