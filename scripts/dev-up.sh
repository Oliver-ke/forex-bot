#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose up -d
echo "Waiting for services..."
docker compose ps
cat <<EOF
export PG_TEST_URL="postgres://forex:forex@127.0.0.1:5432/forex"
export REDIS_TEST_URL="redis://127.0.0.1:6379"
export DYNAMO_TEST_ENDPOINT="http://127.0.0.1:8000"
EOF
