#!/bin/sh
# Online restore of a backup archive into a NEW database (docs/backend/RUNBOOK.md); refuses to
# overwrite an existing one. Restores documents, indexes, and validators, then verifies the schema
# and, given a source database, compares document counts per collection.
# Usage: scripts/restore.sh backups/<db>-<time>.archive.gz <target-db> [source-db-to-compare]
set -eu
cd "$(dirname "$0")/.."
archive="$1"; target="$2"; source="${3:-}"
for name in "$target" "$source"; do
  case "$name" in *[!A-Za-z0-9_]*) echo "invalid database name: $name" >&2; exit 2;; esac
done
[ -n "$target" ] || { echo "target database required" >&2; exit 2; }
[ -f "$archive" ] || { echo "no such backup: $archive" >&2; exit 2; }
# The archive's database is the file name before the timestamp (scripts/backup.sh).
from="$(basename "$archive" | sed -n 's/^\([A-Za-z0-9_]*\)-[0-9]\{8\}T[0-9]\{6\}Z\.archive\.gz$/\1/p')"
[ -n "$from" ] || { echo "cannot read the database name from $archive (expected <db>-<time>.archive.gz)" >&2; exit 2; }
if ./scripts/mongosh.sh "quit(db.adminCommand({ listDatabases: 1, nameOnly: true }).databases.some(d => d.name === '$target') ? 3 : 0)"; then :; else
  echo "database $target already exists (or MongoDB is unreachable); restore into a new name" >&2; exit 1
fi
docker exec -i topology-mongodb sh -c '
  umask 077
  printf "password: %s\n" "$(cat /run/secrets/mongodb_root_password)" > /tmp/restore.yaml
  mongorestore --quiet --config /tmp/restore.yaml --username root --authenticationDatabase admin \
    --archive --gzip --nsInclude "$1.*" --nsFrom "$1.*" --nsTo "$2.*"
  status=$?; rm -f /tmp/restore.yaml; exit $status' sh "$from" "$target" < "$archive"
MONGODB_DATABASE="$target" "${GO:-go}" run ./cmd/seed schema-check
if [ -n "$source" ]; then
  ./scripts/mongosh.sh "
    const a = db.getSiblingDB('$source'), b = db.getSiblingDB('$target');
    const names = a.getCollectionNames();
    const bad = names.filter(c => a.getCollection(c).countDocuments() !== b.getCollection(c).countDocuments());
    if (bad.length) { print('count mismatch: ' + bad.join(', ')); quit(1) }
    print('restore verified: document counts match $source in ' + names.length + ' collections')"
fi
