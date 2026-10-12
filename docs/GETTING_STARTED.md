# Getting Started: Run All Services Locally

How to start the whole stack on one machine: MongoDB, the optional database UI, the Go API, and the frontend. Details live in `docs/backend/LOCAL_DEVELOPMENT.md` (backend), `docs/backend/RUNBOOK.md` (operations), and `docs/DEVELOPER_GUIDE.md` (frontend).

| Service | URL | Started by | Needed for |
|---|---|---|---|
| Frontend (Vite dev server) | http://localhost:5173 | `npm run dev` (repo root) | everything |
| Go API | http://127.0.0.1:8080 (`/api/v1`, `/healthz`, `/readyz`) | `make run` (`backend/`) | `?source=api` |
| MongoDB 8.0 (single-node replica set) | `mongodb://127.0.0.1:27017/?replicaSet=rs0` | `make dev-up` (`backend/`) | the API |
| mongo-express (optional web UI) | http://127.0.0.1:8081 | `make db-ui` (`backend/`) | browsing the database |

The frontend works on its own with built-in mock data. Only `?source=api` needs the API and database.

## Prerequisites
- **Node.js 22+** and npm.
- **Go 1.27+.** If `go` is not on `PATH`, add `export PATH="$PATH:/usr/local/go/bin"` to `~/.zshrc`. The backend Makefile also finds `/usr/local/go/bin/go` on its own.
- **Docker.** On macOS, Rancher Desktop or Docker Desktop. Give the VM **at least 4 GB of memory**, or turn off its Kubernetes: with 2 GB plus k3s, the VM runs out of memory and kills MongoDB (see Troubleshooting).
- **openssl** (preinstalled on macOS) for generating the local password.

## One-time setup
```sh
# Frontend dependencies
cd apps/web && npm install && cd ../..

# Local database password (gitignored; never commit it)
cd backend
mkdir -p secrets && chmod 700 secrets
(umask 077; openssl rand -base64 24 | tr -d '/+=\n' > secrets/mongodb_root_password.txt)
cd ..
```

## Start everything
Use three terminals, all starting at the repository root.

**Terminal 1: database and API**
```sh
cd backend
make dev-up         # MongoDB; healthy after ~10 s (first start: also initiates the replica set)
make seed           # load the mock topology and history fixtures (idempotent; safe to repeat)
make run            # Go API on 127.0.0.1:8080; stays in the foreground
```
Check that it is ready: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8080/readyz` prints `200`.

**Terminal 2: frontend**
```sh
npm run dev         # Vite on http://localhost:5173; proxies /api to 127.0.0.1:8080
```

**Terminal 3 (optional): database UI**
```sh
cd backend
make db-ui          # mongo-express on http://127.0.0.1:8081
```
Verified 2026-10-12 (4 GB VM): 401 without or with wrong credentials, 200 after login. Log in as `root` with the password in `backend/secrets/mongodb_root_password.txt`. The data is in the `topology` database. A desktop alternative that uses no Docker memory is MongoDB Compass with `mongodb://root@127.0.0.1:27017/?authSource=admin&directConnection=true`.

## Open the app
| URL | Data |
|---|---|
| http://localhost:5173/map | built-in mock data (no backend needed) |
| http://localhost:5173/map?source=api | the Go API and MongoDB; the data tag reads "Backend API · mock inventory" |
| http://localhost:5173/registry?dataset=inventory-1000 | generated 1,000-entity dataset (frontend only) |

The `source` and `dataset` parameters stay in the URL while you navigate. To make the API the default, start the frontend with `VITE_DATA_SOURCE=api npm run dev`.

## Production build of the frontend (optional)
```sh
npm run build
cd apps/web && npm run preview   # http://localhost:4173; also proxies /api to the API
```

## Stop
| What | How |
|---|---|
| API, frontend | Ctrl-C in their terminals |
| MongoDB and mongo-express | `cd backend && make dev-down` (data is kept in the `backend_mongodb_data` volume) |
| Delete all local data | `cd backend && docker compose down -v`, then `make dev-up && make seed` (back up first with `make backup` if needed) |

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| `make: go: No such file or directory` | Go is not on `PATH` and not at `/usr/local/go/bin` | install Go, or `make run GO=/path/to/go` |
| `make dev-up` says to create the password file | no `secrets/mongodb_root_password.txt` | see "One-time setup" |
| `make run` fails with `address already in use` | another process holds port 8080 (check with `lsof -nP -iTCP:8080 -sTCP:LISTEN`) | stop it, or use another port: `HTTP_ADDR=127.0.0.1:8090 make run`, then start the frontend with `VITE_API_PROXY_TARGET=http://127.0.0.1:8090 npm run dev` |
| `/readyz` returns 503 "initializing" or "schema not initialized" | MongoDB not running or not yet healthy | `make dev-up`; wait for `docker inspect -f '{{.State.Health.Status}}' topology-mongodb` to print `healthy`; the API retries every 5 s |
| `/readyz` returns 503 "credentials rejected" | the password file does not match the user stored in the data volume | see "Password rotation" in `docs/backend/LOCAL_DEVELOPMENT.md` |
| The app with `?source=api` shows an error banner | API not running, or on another port | start `make run`; check `VITE_API_PROXY_TARGET` |
| MongoDB "unhealthy" or stuck in "starting", `docker exec` is slow, `make db-ui` says "dependency failed to start", API returns 503 | the Docker VM is out of memory; the kernel kills `mongod` (Docker's `OOMKilled` stays false) | give the VM 4 GB or more, or turn off its Kubernetes, or stop containers you do not need; then `cd backend && docker compose restart mongodb`. Check with `rdctl shell -- free -m` and `rdctl shell -- sudo dmesg \| grep "Killed process"` (Rancher Desktop) |
| mongo-express logs `mongo: Name does not resolve` | an older Compose file without `ME_CONFIG_MONGODB_URL` | update `backend/docker-compose.yml` and run `make db-ui` again |

## Checks
```sh
npm run check:all            # frontend (typecheck, lint, tests, build) and backend (gofmt, vet, tests)
cd backend
make test-integration        # backend against MongoDB (temporary databases)
make contract-check          # running API against docs/api/openapi.json
```
