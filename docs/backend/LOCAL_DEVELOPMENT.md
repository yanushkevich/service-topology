# Local Development: ArcadeDB

## Docker Compose
The Compose file is kept in `docs/backend/scaffold/` and moves to `backend/docker-compose.yml` in Milestone B1; commands below run from `backend/`. Create the local secret file before starting the database; do not commit it. ArcadeDB is Apache-2.0 licensed, not MIT. Pin a tested image version and review support/operations requirements before production.

```bash
mkdir -p secrets
printf '%s' 'replace-with-a-local-password' > secrets/arcadedb_root_password.txt
# Keep this file out of version control.
docker compose up -d
```

ArcadeDB Studio and HTTP API are available at `http://localhost:2480` (bound to `127.0.0.1` only). The initial Go adapter should use the HTTP/JSON API and `ARCADEDB_BASE_URL=http://localhost:2480`. The implementation must create or verify the `topology` database at startup using the documented ArcadeDB server API, then initialize schema and indexes idempotently.

Example environment variables (adjust to the implementation/config loader):
```dotenv
HTTP_ADDR=127.0.0.1:8080
ARCADEDB_BASE_URL=http://localhost:2480
ARCADEDB_DATABASE=topology
ARCADEDB_USERNAME=root
ARCADEDB_PASSWORD_FILE=./secrets/arcadedb_root_password.txt
ARCADEDB_QUERY_LANGUAGE=sql
ARCADEDB_REQUEST_TIMEOUT=10s
SEED_MODE=demo
```

Do not hardcode credentials in Go source. Configuration validation should fail fast if required settings are missing or malformed. Never commit the populated secret file.

## Configuration (implemented in B1, `backend/internal/config`)

| Variable | Default | Notes |
|---|---|---|
| `HTTP_ADDR` | `127.0.0.1:8080` | `host:port` or `:port`; non-loopback needs `AUTH_MODE=token` or `ALLOW_UNAUTHENTICATED=true` |
| `SHUTDOWN_TIMEOUT` | `10s` | graceful shutdown budget |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `LOG_FORMAT` | `json` | `json` or `text` |
| `SEED_MODE` | `demo` | `demo` or `none` |
| `AUTH_MODE` | `none` | `token` enables bearer tokens (ADR-018) |
| `AUTH_TOKENS_FILE` | — | required with `AUTH_MODE=token`; lines `name reader|editor sha256` (`make token`) |
| `ALLOW_UNAUTHENTICATED` | `false` | allow `AUTH_MODE=none` on a non-loopback address (behind an authenticating proxy only) |
| `RATE_LIMIT_RPS` / `RATE_LIMIT_BURST` | `50` / `100` | per client; `0` disables |
| `TRUST_PROXY_HEADERS` | `false` | use `X-Forwarded-For` for the client address |
| `CORS_ALLOWED_ORIGINS` | empty | comma-separated exact origins |
| `METRICS_ADDR` | empty | e.g. `127.0.0.1:9090` for Prometheus `/metrics` (loopback only) |
| `TRAVERSAL_SOURCE` | `memory` | `database` runs traversals with ArcadeDB TRAVERSE (ADR-DB-003) |
| `SIMULATION_RETENTION` | `168h` | simulation runs, events, telemetry older than this are pruned after each run (ADR-017) |
| `SIMULATION_MAX_RUNS` | `200` | keep at most this many runs |
| `ARCADEDB_BASE_URL` | unset | when unset the API runs without a database and `/readyz` is 503 |
| `ARCADEDB_DATABASE` | `topology` | |
| `ARCADEDB_USERNAME` | — | required with `ARCADEDB_BASE_URL` |
| `ARCADEDB_PASSWORD_FILE` | — | required with `ARCADEDB_BASE_URL`; `ARCADEDB_PASSWORD` is rejected, and URLs with credentials are rejected |
| `ARCADEDB_QUERY_LANGUAGE` | `sql` | `sql` or `cypher` |
| `ARCADEDB_REQUEST_TIMEOUT` | `10s` | |

Invalid configuration exits with status 2 and lists every problem. Secrets and file paths are never logged.

## Required developer commands
The implementation should expose Makefile targets or equivalent scripts:
Run from `backend/` (`GO=/path/to/go` if Go is not on `PATH`). Implemented: `make check` (gofmt, vet, unit tests; no Docker), `make test-integration` (needs `make dev-up`), `make run`, `make seed` (load the mock fixture), `make validate` (no database), `make schema-check`.
- `make dev-up` / `make dev-down`
- `make test` / `make test-integration`
- `make seed` — deterministic, idempotent mock dataset
- `make schema-check` — verify required types/indexes/constraints exist
- `make reset-local` — destructive local-only reset, requiring explicit confirmation

## Verified local setup (2026-10-11, Rancher Desktop, Docker 29.1.3, ArcadeDB 26.10.1)
```bash
cd backend
mkdir -p secrets && chmod 700 secrets
LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 24 > secrets/arcadedb_root_password.txt
chmod 600 secrets/arcadedb_root_password.txt
make dev-up            # ArcadeDB on 127.0.0.1:2480; healthy after ~20 s
make seed              # load fixtures/topology/mock.v1.json (idempotent)
make schema-check      # types, unique indexes, schema version
make test-integration  # each test uses and drops its own temporary database
make run               # API on :8080; /readyz is 200 once the schema is initialized
make contract-check    # run the API on a disposable database and validate every operation (Node needed)
```
Findings from the first run:
- **Memory.** The image defaults (generational ZGC, `-XX:MaxRAMPercentage=75`, uncapped page cache) exhausted Rancher Desktop's default 2 GB VM, which also runs k3s: the kernel OOM killer stopped ArcadeDB (Docker's `OOMKilled` stays false for a VM-wide OOM) and requests took seconds. The Compose file therefore sets Serial GC, a 384 MB heap, a 256 MB page cache, and `mem_limit: 768m` (about 150–250 MB in use). If you need more headroom, give the Rancher Desktop VM more memory or disable its Kubernetes.
- **Healthcheck.** The image has no `curl` or `bash`; the healthcheck uses `wget` against `/api/v1/ready` (no credentials needed).
- **Password rotation.** ArcadeDB applies `rootPasswordPath` only when it first creates its user file (`/home/arcadedb/config/server-users.jsonl`, inside the container). To rotate: write the new password file, then `docker compose down` and `make dev-up`. If that keeps the old password, remove the volume with `docker compose down -v` (deletes local databases), then re-seed.
- **Credentials on the command line.** Never pass the password with `curl -u`; use a netrc file in `secrets/` (`curl --netrc-file secrets/netrc …`).
- Wrong credentials return HTTP 403, an unknown database 404.

## Running with the frontend
Start the API (`make run`, `127.0.0.1:8080`), then open the frontend with `?source=api` (e.g. `http://localhost:5173/map?source=api`) or build with `VITE_DATA_SOURCE=api`. The Vite dev and preview servers proxy `/api` to `VITE_API_PROXY_TARGET` (default `http://127.0.0.1:8080`), so no CORS is needed. The data-source tag reads "Backend API · mock inventory" because the stored data is the seeded fixture.

## Startup and readiness
- Liveness indicates the Go process is running.
- Readiness checks ArcadeDB connectivity and verifies database/schema initialization has completed.
- Do not report the service ready if a required database dependency is unavailable.
- Startup must validate database compatibility and create/check schema/indexes repeatably without deleting data.
- Use graceful shutdown for HTTP listeners and client resources.

## Local reset and credentials
`make reset-local` must not delete data without explicit confirmation. `docker compose down -v` deletes the local ArcadeDB volume. The sample password is for local development only; use secrets management and a least-privilege database identity outside local development.
