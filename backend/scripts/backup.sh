#!/bin/sh
# Online backup of one local MongoDB database with mongodump (docs/backend/RUNBOOK.md): a gzipped
# archive streamed out of the container into backups/<db>-<UTC time>.archive.gz. The password goes
# to mongodump through a temporary config file inside the container, never a command line.
# Usage: scripts/backup.sh [database]   (default: $MONGODB_DATABASE or topology)
set -eu
cd "$(dirname "$0")/.."
DB="${1:-${MONGODB_DATABASE:-topology}}"
case "$DB" in *[!A-Za-z0-9_]*|"") echo "invalid database name (letters, digits, '_')" >&2; exit 2;; esac
umask 077  # backups hold the data; owner-only
mkdir -p backups
file="backups/$DB-$(date -u +%Y%m%dT%H%M%SZ).archive.gz"
docker exec topology-mongodb sh -c '
  umask 077
  printf "password: %s\n" "$(cat /run/secrets/mongodb_root_password)" > /tmp/dump.yaml
  mongodump --quiet --config /tmp/dump.yaml --username root --authenticationDatabase admin --db "$1" --archive --gzip
  status=$?; rm -f /tmp/dump.yaml; exit $status' sh "$DB" > "$file" || { rm -f "$file"; echo "backup failed" >&2; exit 1; }
[ -s "$file" ] || { rm -f "$file"; echo "backup is empty" >&2; exit 1; }
echo "$file"
