#!/bin/sh
# Online backup of the local ArcadeDB database (docs/backend/RUNBOOK.md). Runs BACKUP DATABASE, then
# copies the zip out of the container (the container's backups directory is not on a volume).
# Usage: scripts/backup.sh [database]   (default: $ARCADEDB_DATABASE or topology)
set -eu
cd "$(dirname "$0")/.."
DB="${1:-${ARCADEDB_DATABASE:-topology}}"
BASE="${ARCADEDB_BASE_URL:-http://127.0.0.1:2480}"
netrc="$(mktemp)"; trap 'rm -f "$netrc"' EXIT
printf 'machine 127.0.0.1 login %s password %s\n' "${ARCADEDB_USERNAME:-root}" "$(cat "${ARCADEDB_PASSWORD_FILE:-secrets/arcadedb_root_password.txt}")" > "$netrc"
out="$(curl -sf --netrc-file "$netrc" -X POST "$BASE/api/v1/command/$DB" -d '{"language":"sql","command":"BACKUP DATABASE"}')"
file="$(printf '%s' "$out" | sed -n 's/.*"backupFile":"\([^"]*\)".*/\1/p')"
[ -n "$file" ] || { echo "backup failed: $out" >&2; exit 1; }
mkdir -p backups
docker cp "topology-arcadedb:/home/arcadedb/backups/$DB/$file" "backups/$file" >/dev/null
echo "backups/$file"
