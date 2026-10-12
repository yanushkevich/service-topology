#!/bin/sh
# Runs JavaScript in mongosh inside the local MongoDB container, authenticated as root. The password
# is read inside mongosh from the container's secret file, never put on a command line.
# Usage: scripts/mongosh.sh '<javascript>'   (callers validate any names they interpolate)
set -eu
docker exec -i topology-mongodb mongosh --quiet --norc --eval \
  "db.getSiblingDB('admin').auth('root', require('fs').readFileSync('/run/secrets/mongodb_root_password', 'utf8').trim()); $1"
