#!/bin/sh
# Runs the API against a disposable ArcadeDB database, seeds it, and validates every operation with
# apps/web/scripts/check-api-contract.mjs. Needs `make dev-up` and Node (apps/web dependencies).
set -eu
cd "$(dirname "$0")/.."
GO="${GO:-go}"
PORT="${CONTRACT_PORT:-18081}"
DB="topology_contract_$(date +%s)"
export ARCADEDB_DATABASE="$DB" HTTP_ADDR="127.0.0.1:$PORT" LOG_LEVEL=warn
bin="$(mktemp -d)/api"
"$GO" build -o "$bin" ./cmd/api
"$GO" run ./cmd/seed load >/dev/null
"$bin" &
pid=$!
cleanup() {
  kill "$pid" 2>/dev/null || true
  wait "$pid" 2>/dev/null || true
  # Drop the disposable database (credentials from the password file, never the command line).
  pw="$(cat "$ARCADEDB_PASSWORD_FILE")"
  printf 'machine 127.0.0.1 login %s password %s\n' "$ARCADEDB_USERNAME" "$pw" > "$bin.netrc"
  curl -s -o /dev/null --netrc-file "$bin.netrc" -X POST "$ARCADEDB_BASE_URL/api/v1/server" -d "{\"command\":\"drop database $DB\"}" || true
  rm -f "$bin.netrc"
}
trap cleanup EXIT
for _ in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$PORT/readyz" >/dev/null 2>&1 && break
  sleep 0.2
done
node ../apps/web/scripts/check-api-contract.mjs --url "http://127.0.0.1:$PORT/api/v1"
