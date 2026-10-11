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
HTTP_ADDR=:8080
ARCADEDB_BASE_URL=http://localhost:2480
ARCADEDB_DATABASE=topology
ARCADEDB_USERNAME=root
ARCADEDB_PASSWORD_FILE=./secrets/arcadedb_root_password.txt
ARCADEDB_QUERY_LANGUAGE=sql
ARCADEDB_REQUEST_TIMEOUT=10s
SEED_MODE=demo
```

Do not hardcode credentials in Go source. Configuration validation should fail fast if required settings are missing or malformed. Never commit the populated secret file.

## Required developer commands
The implementation should expose Makefile targets or equivalent scripts:
- `make dev-up` / `make dev-down`
- `make test` / `make test-integration`
- `make seed` — deterministic, idempotent mock dataset
- `make schema-check` — verify required types/indexes/constraints exist
- `make reset-local` — destructive local-only reset, requiring explicit confirmation

## Running with the frontend
The frontend (`npm run dev`, port 5173) uses mock repositories until an HTTP repository is selected in `apps/web/src/data/selectRepository.ts` (Milestone B6). The API listens on `HTTP_ADDR` (default `:8080`); use a Vite dev proxy for `/api` rather than permissive CORS.

## Startup and readiness
- Liveness indicates the Go process is running.
- Readiness checks ArcadeDB connectivity and verifies database/schema initialization has completed.
- Do not report the service ready if a required database dependency is unavailable.
- Startup must validate database compatibility and create/check schema/indexes repeatably without deleting data.
- Use graceful shutdown for HTTP listeners and client resources.

## Local reset and credentials
`make reset-local` must not delete data without explicit confirmation. `docker compose down -v` deletes the local ArcadeDB volume. The sample password is for local development only; use secrets management and a least-privilege database identity outside local development.
