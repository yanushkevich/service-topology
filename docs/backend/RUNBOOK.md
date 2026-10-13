# Backend Runbook (local and single-host)

Procedures verified on 2026-10-11 against MongoDB 8.0.30 (single-node replica set) in Rancher Desktop (Docker 29.1.3). Run commands in `backend/` (the Makefile finds Go on `PATH` or at `/usr/local/go/bin/go`; override with `GO=...`).

## Start, stop, health
| Task | Command | Expected |
|---|---|---|
| Start the database | `make dev-up` | container `topology-mongodb` healthy (replica set primary) after ~10 s (`docker inspect -f '{{.State.Health.Status}}' topology-mongodb`) |
| Seed / reseed | `make seed` | idempotent: replaces the canonical topology, adds missing history fixtures |
| Import business flows | `make import-flows FILE=… [FORMAT=native\|bpmn] [MAPPING=mapping.json]` | idempotent; validates the whole topology first; never overwrites an authored flow (ADR-022) |
| Verify schema | `make schema-check` | `schema version 1 with all collections, validators, and indexes` |
| Run the API | `make run` | listens on `127.0.0.1:8080`; `curl -s localhost:8080/readyz` → 200 once the schema is initialized |
| Database shell | `make db-shell` | `mongosh` in the container; prompts for the password in `secrets/mongodb_root_password.txt` |
| Database web UI | `make db-ui` | mongo-express at `http://127.0.0.1:8081` (user `root`, same password) |
| Stop | Ctrl-C (API), `make dev-down` (database; data volume kept) | |

`/healthz` (process up) and `/readyz` (primary reachable and schema current) never need a token. Metrics: set `METRICS_ADDR=127.0.0.1:9090` and scrape `/metrics` (loopback only); MongoDB commands appear as `mongodb_commands_total{command,status}` and `mongodb_command_duration_seconds{command}`.

## Backup (online)
```sh
make backup                       # → backups/topology-<UTC time>.archive.gz
```
Streams a gzipped `mongodump` archive of `MONGODB_DATABASE` out of the container (no downtime). The password reaches `mongodump` through a temporary config file inside the container. The file is owner-only, and `backups/` is gitignored. Copy backups off the machine for real protection.

A single-database `mongodump` is not a point-in-time snapshot across collections while writes are running (only whole-deployment dumps can use `--oplog`). For a consistent local backup, stop the API first; in production, use storage snapshots or the hosting service's backups.

## Restore (online, into a new database)
```sh
make restore BACKUP=backups/topology-<time>.archive.gz TARGET=topology_restored SOURCE=topology
```
- Refuses to overwrite an existing database.
- Reads the source database name from the archive's file name and maps it to `TARGET` (`mongorestore --nsFrom/--nsTo`); documents, indexes, and validators are restored. No restart is needed.
- Verifies the schema (`seed schema-check`) and, with `SOURCE`, that document counts match in every collection.

To switch the API to the restored database: set `MONGODB_DATABASE=topology_restored` and restart the API. To replace the original instead, stop the API, back it up, drop it in `make db-shell` (`db.getSiblingDB('topology').dropDatabase()`), and restore with `TARGET=topology`; there is no automated in-place restore on purpose.

## Recovery scenarios
| Symptom | Check | Action |
|---|---|---|
| `/readyz` 503 "initializing" or "schema not initialized" | `docker ps`, `make schema-check` | start the database (`make dev-up`); the API retries every 5 s |
| `/readyz` 503 "credentials rejected" | password file vs. the root user in the volume | see "Password rotation" in `LOCAL_DEVELOPMENT.md` |
| `/readyz` 503 "schema is newer than this backend" | `db.schemaInfo.findOne()` in `make db-shell` | run the newer backend or restore a backup; never downgrade the schema by hand |
| Container restarting, `PrimarySteppedDown` warnings, 503s under load | `docker inspect -f '{{.RestartCount}} {{.State.OOMKilled}}' topology-mongodb`; `rdctl shell -- sudo dmesg \| grep -i oom` | VM-wide memory pressure (`LOCAL_DEVELOPMENT.md` "Memory"); give the VM more memory or disable its Kubernetes |
| Writes fail with "Transaction numbers are only allowed on a replica set member" | `MONGODB_URI` | connect to a replica set (`?replicaSet=rs0` locally) |
| API 503 "database is unavailable" | API log (`requestId` from the problem response) | database down, overloaded, or electing a primary; the request is safe to retry |
| Wrong data after a seed | `make schema-check`, `GET /api/v1/meta` (revision changes with each import) | `make seed` again (idempotent) or restore a backup into a new database |

## Local reset (destructive)
`docker compose down -v` deletes the volume with every local database. Take `make backup` first if anything matters.

## Tokens (AUTH_MODE=token)
`make token NAME=ci ROLE=editor` prints a token once and the line to append to the file named by `AUTH_TOKENS_FILE`. To revoke, delete the line and restart the API.
