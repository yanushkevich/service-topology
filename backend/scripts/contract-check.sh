#!/bin/sh
# Runs the API against a disposable MongoDB database, seeds it, and validates every operation with
# apps/web/scripts/check-api-contract.mjs. Needs `make dev-up` and Node (apps/web dependencies).
set -eu
cd "$(dirname "$0")/.."
GO="${GO:-go}"
PORT="${CONTRACT_PORT:-18081}"
DB="topology_contract_$(date +%s)"
export MONGODB_DATABASE="$DB" HTTP_ADDR="127.0.0.1:$PORT" LOG_LEVEL=warn
tmp="$(mktemp -d)"
bin="$tmp/api"
"$GO" build -o "$bin" ./cmd/api
"$GO" build -o "$tmp/fakedynatrace" ./cmd/fakedynatrace
"$GO" run ./cmd/seed load >/dev/null

# The fake Dynatrace tenant (ADR-034) with a throwaway token, so the connector's operations run too.
FAKE_PORT="${CONTRACT_FAKE_DYNATRACE_PORT:-18099}"
(umask 077 && openssl rand -hex 24 > "$tmp/dynatrace_token.txt")
cat > "$tmp/dynatrace.yaml" <<YAML
tenants:
  - { id: example, url: "http://127.0.0.1:$FAKE_PORT", example: true, allowInsecureLoopback: true, auth: { platformTokenFile: dynatrace_token.txt } }
environments:
  - { id: production, name: Production, kind: production, tenant: example, match: { tag: { key: environment, value: production } } }
  - { id: staging, name: Staging, kind: staging, tenant: example, match: { tag: { key: environment, value: staging } } }
callMetrics: { enabled: true, interval: 5m }
YAML
"$tmp/fakedynatrace" -addr "127.0.0.1:$FAKE_PORT" -token-file "$tmp/dynatrace_token.txt" 2>/dev/null &
fake=$!
export DYNATRACE_CONFIG_FILE="$tmp/dynatrace.yaml"

"$bin" &
pid=$!
cleanup() {
  kill "$pid" "$fake" 2>/dev/null || true
  wait "$pid" "$fake" 2>/dev/null || true
  rm -rf "$tmp"
  ./scripts/mongosh.sh "db.getSiblingDB('$DB').dropDatabase()" >/dev/null || true
}
trap cleanup EXIT
for _ in $(seq 1 50); do
  curl -sf "http://127.0.0.1:$PORT/readyz" >/dev/null 2>&1 && break
  sleep 0.2
done
node ../apps/web/scripts/check-api-contract.mjs --url "http://127.0.0.1:$PORT/api/v1"
