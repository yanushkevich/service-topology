# Local Development: MongoDB

## Docker Compose
`backend/docker-compose.yml` runs MongoDB 8.0 (`mongo:8.0.30`) as a **single-node replica set** (`rs0`): the backend's imports, simulation runs, and retention are multi-document transactions, which need one (ADR-DB-004). Commands below run from `backend/`. Create the local secret file before starting the database; do not commit it (`secrets/` is gitignored). MongoDB Community Server is licensed under SSPL-1.0; see ADR-019 before offering the product as a hosted service.

```bash
cd backend
mkdir -p secrets && chmod 700 secrets
(umask 077; openssl rand -base64 24 | tr -d '/+=\n' > secrets/mongodb_root_password.txt)
make dev-up            # MongoDB on 127.0.0.1:27017; healthy (replica set primary) after ~10 s
```

How the container works:
- The official image creates the `root` user from the Docker secret (`MONGO_INITDB_ROOT_PASSWORD_FILE`) on first start.
- With access control on, a replica set needs a key file for internal authentication. A single node never uses it, so the entrypoint generates a fresh one at every start (`/tmp/mongo-keyfile`).
- The health check initiates the replica set on first start (idempotent) and reports healthy once the node is the writable primary. It reads the password inside `mongosh`, never from a command line.
- The member host is `127.0.0.1:27017`, which is also how the host reaches the published port, so `replicaSet=rs0` in the URI works from the host.
- Memory: `--wiredTigerCacheSizeGB 0.25` (MongoDB 8's minimum) and `mem_limit: 640m`; about 150–310 MB resident. The health check runs `mongosh` (a Node.js process of about 100 MB), so it runs every 5 s only while starting and every 30 s afterwards.
- Web UI (verified 2026-10-12: 401 without or with wrong credentials, 200 after login): `mongo-express:1.0.2-20-alpine3.19` (latest release, 2024; little maintenance, local use only) in the opt-in `ui` profile, behind HTTP basic auth. It shares the database container's network namespace because the replica set advertises its member as `127.0.0.1:27017`, which only reaches the database from there; its port 8081 is therefore published on the `mongodb` service (`127.0.0.1` only). Alternative without VM memory: MongoDB Compass with `mongodb://root@127.0.0.1:27017/?authSource=admin&directConnection=true`.

## Configuration (`backend/internal/config`)

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
| `TRAVERSAL_SOURCE` | `memory` | `database` runs dependency/neighborhood traversals with `$graphLookup` (ADR-DB-004) |
| `SIMULATION_RETENTION` | `168h` | simulation runs, events, telemetry older than this are pruned after each run (ADR-017) |
| `SIMULATION_MAX_RUNS` | `200` | keep at most this many runs |
| `DYNATRACE_CONFIG_FILE` | unset | the Dynatrace connector's YAML configuration (ADR-034, `docs/DYNATRACE_CONNECTOR.md` §3); secrets are files it names. Needs a database. Example: `dynatrace.example.yaml` (the fake tenant) |
| `MONGODB_URI` | unset | e.g. `mongodb://127.0.0.1:27017/?replicaSet=rs0`; `mongodb+srv://` works too. When unset the API runs without a database and `/readyz` is 503. Credentials in the URI are rejected |
| `MONGODB_DATABASE` | `topology` | letters, digits, `_` |
| `MONGODB_USERNAME` | — | set together with `MONGODB_PASSWORD_FILE`, or neither for a server without authentication |
| `MONGODB_PASSWORD_FILE` | — | the password is read from this file; `MONGODB_PASSWORD` is rejected |
| `MONGODB_AUTH_SOURCE` | `admin` | authentication database |
| `MONGODB_TIMEOUT` | `10s` | per operation; server selection and connect use at most 5 s of it |

The Makefile exports local defaults for the `MONGODB_*` variables (override them in the environment or a gitignored `backend/.env`; see `.env.example`). Invalid configuration exits with status 2 and lists every problem. Secrets and file paths are never logged.

## Commands (run in `backend/`)
The Makefile uses `go` from `PATH`, else `/usr/local/go/bin/go`; override with `GO=...`.

| Command | What it does |
|---|---|
| `make check` | gofmt, vet, unit tests (no Docker) |
| `make dev-up` / `make dev-down` | start / stop MongoDB (data stays in the `backend_mongodb_data` volume) |
| `make seed` | create collections/indexes if needed, load `fixtures/topology/mock.v1.json` and the snapshot fixtures (idempotent) |
| `make import-flows FILE=../fixtures/flows/order-cancellation.bpmn` | import business flows from a native flow file or BPMN 2.0 (`FORMAT`, `MAPPING` optional; ADR-022) |
| `make fake-dynatrace` | serve an invented Dynatrace tenant on `127.0.0.1:8099` (creates `secrets/dynatrace_example_token.txt`); then `DYNATRACE_CONFIG_FILE=dynatrace.example.yaml make run` (ADR-034) |
| `make validate` | validate the mock fixture without a database |
| `make schema-check` | verify collections, validators, indexes, and schema version |
| `make test-integration` | integration tests; each uses and drops its own temporary database |
| `make run` | API on `127.0.0.1:8080`; `/readyz` is 200 once the schema is initialized |
| `make contract-check` | run the API on a disposable database and validate every operation (Node needed) |
| `make bench` | API latency on 1,000 entities (`BENCHFLAGS="-c 8"`, `-traversal database`) |
| `make backup` / `make restore` | see `RUNBOOK.md` |
| `make db-shell` | interactive `mongosh` in the container (prompts for the password) |
| `make db-ui` | web UI (mongo-express) at `http://127.0.0.1:8081`; log in as `root` with the password in `secrets/mongodb_root_password.txt`. Opt-in (Compose profile `ui`); `make dev-down` stops it too |
| `make reset-local` | prints the destructive reset steps; deletes nothing itself |

## Verified local setup (2026-10-11, Rancher Desktop, Docker 29.1.3, MongoDB 8.0.30)
```bash
make dev-up && make seed && make schema-check
make test-integration  # 17 tests, including 918 traversal-parity checks
make contract-check    # 59/59
make run
```
Findings:
- **Memory.** Rancher Desktop's default 2 GB VM also runs k3s, and its root filesystem is an in-memory tmpfs (about 600 MB). Under sustained load (8 concurrent benchmark clients with database traversal), the kernel's VM-wide OOM killer stopped `mongod` and `coredns`; Docker's `OOMKilled` stays false in that case and the container restarts. Give the VM more memory (4 GB) or disable its Kubernetes if you see `PrimarySteppedDown` warnings or 503s.
- **Cache minimum.** MongoDB 8 refuses `--wiredTigerCacheSizeGB` below 0.25.
- **Credentials on the command line.** Never pass the password to `mongosh -p`; use `scripts/mongosh.sh` (authenticates inside the container from the secret file) or `make db-shell` (prompts).
- **Password rotation.** The root user is created only when the data volume is empty. To rotate, change it in `mongosh` (`db.getSiblingDB('admin').changeUserPassword('root', passwordPrompt())`) and then update `secrets/mongodb_root_password.txt`; or delete the volume and re-seed.

## Running with the frontend
Start the API (`make run`, `127.0.0.1:8080`), then open the frontend with `?source=api` (e.g. `http://localhost:5173/map?source=api`) or build with `VITE_DATA_SOURCE=api`. The Vite dev and preview servers proxy `/api` to `VITE_API_PROXY_TARGET` (default `http://127.0.0.1:8080`), so no CORS is needed. The data-source tag reads "Backend API · mock inventory" because the stored data is the seeded fixture.

## Startup and readiness
- `/healthz` reports the Go process is running.
- `/readyz` is 200 once collections, validators, and indexes are initialized and the primary answers a ping. Until then it is 503 with a generic reason (`initializing`, `credentials rejected`, `schema not initialized (database unreachable or failing)`).
- The API initializes the schema in the background at start-up and retries every 5 s while MongoDB is unavailable. It refuses a database whose schema version is newer than its own.
- Graceful shutdown closes HTTP listeners, then the MongoDB client.

## Local reset and credentials
`docker compose down -v` (or `docker volume rm backend_mongodb_data`) deletes the local MongoDB data; then `make dev-up && make seed`. The root user and generated password are for local development only; use secrets management and a least-privilege database user (`readWrite` on the application database) elsewhere.

The former ArcadeDB volume `backend_arcadedb_data` and `secrets/arcadedb_root_password.txt` are no longer used; delete them when you no longer need the old data (`docker volume rm backend_arcadedb_data`).
