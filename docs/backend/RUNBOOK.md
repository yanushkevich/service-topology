# Backend Runbook (local and single-host)

Procedures verified on 2026-10-11 against ArcadeDB 26.10.1 in Rancher Desktop (Docker 29.1.3). Run commands in `backend/` (add `GO=/usr/local/go/bin/go` if Go is not on `PATH`).

## Start, stop, health
| Task | Command | Expected |
|---|---|---|
| Start the database | `make dev-up` | container `topology-arcadedb` healthy after ~20 s (`docker inspect -f '{{.State.Health.Status}}' topology-arcadedb`) |
| Seed / reseed | `make seed` | idempotent: replaces the canonical topology, adds missing history fixtures |
| Verify schema | `make schema-check` | `schema version 4 with all types and unique indexes` |
| Run the API | `make run` | listens on `127.0.0.1:8080`; `curl -s localhost:8080/readyz` → 200 once the schema is initialized |
| Stop | Ctrl-C (API), `make dev-down` (database; data volume kept) | |

`/healthz` (process up) and `/readyz` (database reachable and schema current) never need a token. Metrics: set `METRICS_ADDR=127.0.0.1:9090` and scrape `/metrics` (loopback only).

## Backup (online)
```sh
make backup                       # → backups/topology-backup-<timestamp>.zip
```
Runs `BACKUP DATABASE` (no downtime) and copies the zip out of the container, because the container's `backups/` directory is not on a volume. `backups/` is gitignored. Copy backups off the machine for real protection.

## Restore (offline, into a new database)
```sh
make restore BACKUP=backups/<file>.zip TARGET=topology_restored SOURCE=topology
```
- Refuses to overwrite an existing database or directory.
- Unpacks the zip into `databases/<TARGET>` and restarts the container (a few seconds of downtime): ArcadeDB opens databases at startup.
- Verifies the schema and, with `SOURCE`, that record counts match for every type.
- ArcadeDB's online `restore database … file://…` is disabled by default (`arcadedb.server.restoreImportAllowLocalUrls`); this runbook keeps that safer default.

To switch the API to the restored database: set `ARCADEDB_DATABASE=topology_restored` and restart the API. To replace the original instead, stop the API, `docker compose down`, move directories inside the volume deliberately, and start again; there is no automated in-place restore on purpose.

## Recovery scenarios
| Symptom | Check | Action |
|---|---|---|
| `/readyz` 503 "initializing" or "schema not initialized" | `docker ps`, `make schema-check` | start the database (`make dev-up`); the API retries every 5 s |
| `/readyz` 503 "credentials rejected" | password file vs. container | see "Password rotation" in `LOCAL_DEVELOPMENT.md` |
| `/readyz` 503 "schema is newer than this backend" | `SELECT version FROM SchemaInfo` | run the newer backend or restore a backup; never downgrade the schema by hand |
| Requests slow, container restarting | `docker inspect -f '{{.RestartCount}} {{.State.OOMKilled}}' topology-arcadedb`; kernel log in the VM | memory budget (`LOCAL_DEVELOPMENT.md` "Memory"); give the VM more memory |
| API 503 "database is unavailable" | API log (`requestId` from the problem response) | database down or overloaded; the request is safe to retry |
| Wrong data after a seed | `make schema-check`, `GET /api/v1/meta` (revision changes with each import) | `make seed` again (idempotent) or restore a backup into a new database |

## Local reset (destructive)
`docker compose down -v` deletes the volume with every local database. Take `make backup` first if anything matters.

## Tokens (AUTH_MODE=token)
`make token NAME=ci ROLE=editor` prints a token once and the line to append to the file named by `AUTH_TOKENS_FILE`. To revoke, delete the line and restart the API.
