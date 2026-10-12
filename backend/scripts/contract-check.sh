#!/bin/sh
# Runs the API against a disposable MongoDB database, seeds it, and validates every operation with
# apps/web/scripts/check-api-contract.mjs. Needs `make dev-up` and Node (apps/web dependencies).
set -eu
cd "$(dirname "$0")/.."
GO="${GO:-go}"
PORT="${CONTRACT_PORT:-18081}"
DB="topology_contract_$(date +%s)"
export MONGODB_DATABASE="$DB" HTTP_ADDR="127.0.0.1:$PORT" LOG_LEVEL=warn
bin="$(mktemp -d)/api"
"$GO" build -o "$bin" ./cmd/api
"$GO" run ./cmd/seed load >/dev/null
"$bin" &
pid=$!
cleanup() {
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  ./scripts/mongosh.sh "db.getSiblingDB('$DB').dropDatabase()" >/dev/null || true
}
trap cleanup EXIT
for _ in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$PORT/readyz" >/dev/null 2>&1 && break
  sleep 0.2
done
node ../apps/web/scripts/check-api-contract.mjs --url "http://127.0.0.1:$PORT/api/v1"
