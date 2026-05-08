#!/usr/bin/env bash
# Sourced by scripts/run-*.sh. Loads .env (if present) and validates required vars.
# Usage:
#   source scripts/lib/load-env.sh
#   require_env VAR1 VAR2 ...

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

require_env() {
  local missing=()
  for var in "$@"; do
    if [[ -z "${!var:-}" ]]; then
      missing+=("$var")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    echo "error: missing env vars: ${missing[*]}" >&2
    echo "set them in .env (copy from .env.example) or export before invoking." >&2
    exit 2
  fi
}

run_tsx() {
  # Run a TS file via tsx without polluting node_modules.
  cd "$REPO_ROOT"
  exec pnpm dlx tsx "$@"
}
