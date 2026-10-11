#!/bin/sh
# Offline restore of a backup zip into a NEW database (docs/backend/RUNBOOK.md). Refuses to
# overwrite an existing database. Restarts the ArcadeDB container (brief downtime) so it opens the
# restored files, then verifies the schema and compares record counts with the source database.
# Usage: scripts/restore.sh backups/<file>.zip <target-db> [source-db-to-compare]
set -eu
cd "$(dirname "$0")/.."
zip="$1"; target="$2"; source="${3:-}"
case "$target" in *[!A-Za-z0-9_-]*|"") echo "invalid database name" >&2; exit 2;; esac
[ -f "$zip" ] || { echo "no such backup: $zip" >&2; exit 2; }
BASE="${ARCADEDB_BASE_URL:-http://127.0.0.1:2480}"
netrc="$(mktemp)"; trap 'rm -f "$netrc"' EXIT
printf 'machine 127.0.0.1 login %s password %s\n' "${ARCADEDB_USERNAME:-root}" "$(cat "${ARCADEDB_PASSWORD_FILE:-secrets/arcadedb_root_password.txt}")" > "$netrc"
if curl -sf --netrc-file "$netrc" "$BASE/api/v1/exists/$target" | grep -q true; then
  echo "database $target already exists; restore into a new name" >&2; exit 1
fi
if docker exec topology-arcadedb test -e "/home/arcadedb/databases/$target"; then
  echo "directory databases/$target already exists" >&2; exit 1
fi
docker cp "$zip" "topology-arcadedb:/tmp/restore.zip" >/dev/null
docker exec topology-arcadedb sh -c "mkdir /home/arcadedb/databases/$target && cd /home/arcadedb/databases/$target && unzip -q /tmp/restore.zip"
docker exec -u 0 topology-arcadedb rm -f /tmp/restore.zip   # docker cp creates the file as root
docker compose restart >/dev/null 2>&1
for _ in $(seq 1 60); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' topology-arcadedb)" = healthy ] && break
  sleep 2
done
ARCADEDB_DATABASE="$target" "${GO:-go}" run ./cmd/seed schema-check
if [ -n "$source" ]; then
  count() { curl -sf --netrc-file "$netrc" -X POST "$BASE/api/v1/query/$1" -d "{\"language\":\"sql\",\"command\":\"SELECT count(*) AS n FROM $2\"}" | sed -n 's/.*"n":\([0-9]*\).*/\1/p'; }
  for t in Environment ServiceDefinition ServiceInstance Resource EventType COMMUNICATES CONTAINS HOSTED_IN Snapshot SavedLayout SimulationRun SimulationEvent TelemetryObservation TopologyState; do
    a="$(count "$source" "$t")"; b="$(count "$target" "$t")"
    [ "$a" = "$b" ] || { echo "count mismatch for $t: $source=$a $target=$b" >&2; exit 1; }
  done
  echo "restore verified: record counts match $source for every type"
fi
