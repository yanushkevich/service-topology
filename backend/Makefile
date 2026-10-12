# Backend tasks. Run from backend/ (or `make -C backend <target>` from the repo root).
# GO is the go on PATH, else the default macOS/Linux install at /usr/local/go; override with
# e.g. `make check GO=$$HOME/sdk/go1.27.2/bin/go`.
GO ?= $(or $(shell command -v go 2>/dev/null),$(wildcard /usr/local/go/bin/go),go)
GOFMT ?= $(dir $(shell command -v $(GO)))gofmt

# Local MongoDB defaults for the database targets; override in the environment or a local .env
# (never committed). The password is read from the file, never passed on the command line.
-include .env
export MONGODB_URI ?= mongodb://127.0.0.1:27017/?replicaSet=rs0
export MONGODB_DATABASE ?= topology
export MONGODB_USERNAME ?= root
export MONGODB_PASSWORD_FILE ?= $(CURDIR)/secrets/mongodb_root_password.txt

.PHONY: check fmt fmt-check vet test test-integration contract-check bench backup restore vulncheck token run seed validate schema-check db-shell dev-up dev-down reset-local

## check: formatting, vet, and unit/conformance tests (the B1 quality gate)
check: fmt-check vet test

fmt:
	$(GOFMT) -w .

fmt-check:
	@out="$$($(GOFMT) -l .)"; if [ -n "$$out" ]; then echo "gofmt needed:"; echo "$$out"; exit 1; fi

vet:
	$(GO) vet ./...

test:
	$(GO) test ./...

## test-integration: tests against the local MongoDB (make dev-up first); each test uses and drops
## its own temporary database, so local data is untouched
test-integration:
	$(GO) test -count=1 -tags=integration ./...

## contract-check: run the API on a disposable database and validate every operation against
## docs/api/openapi.json (Node + apps/web dependencies required)
contract-check:
	GO=$(GO) ./scripts/contract-check.sh

## bench: API latency against MongoDB on a generated dataset (temporary database); see docs/BENCHMARKS.md
bench:
	$(GO) run ./cmd/apibench -dataset inventory-1000 $(BENCHFLAGS)

## backup: online backup (mongodump archive) of $(MONGODB_DATABASE) into backups/ (see docs/backend/RUNBOOK.md)
backup:
	./scripts/backup.sh

## restore: restore into a NEW database; make restore BACKUP=backups/topology-<time>.archive.gz TARGET=topology_restored [SOURCE=topology]
restore:
	GO=$(GO) ./scripts/restore.sh "$(BACKUP)" "$(TARGET)" "$(SOURCE)"

## vulncheck: known-vulnerability scan of the Go code and dependencies (pinned govulncheck)
vulncheck:
	$(GO) run golang.org/x/vuln/cmd/govulncheck@v1.8.0 ./...

## token: create an API token (prints it once); make token NAME=ci ROLE=editor
token:
	$(GO) run ./cmd/token -name "$(NAME)" -role "$(or $(ROLE),reader)"

## run: start the API on HTTP_ADDR (default 127.0.0.1:8080) against the local MongoDB
run:
	$(GO) run ./cmd/api

## seed: load the shared mock fixture into MongoDB (idempotent; replaces the stored topology)
seed:
	$(GO) run ./cmd/seed load

## validate: validate the shared mock fixture without a database
validate:
	$(GO) run ./cmd/seed validate

schema-check:
	$(GO) run ./cmd/seed schema-check

## db-shell: interactive mongosh in the local container (prompts for the password in secrets/)
db-shell:
	docker exec -it topology-mongodb mongosh --username root --authenticationDatabase admin "$(MONGODB_DATABASE)"

dev-up:
	@test -f secrets/mongodb_root_password.txt || (echo 'Create secrets/mongodb_root_password.txt with a local-only password (see docs/backend/LOCAL_DEVELOPMENT.md).' && exit 1)
	docker compose up -d

dev-down:
	docker compose down

reset-local:
	@echo 'Destructive local reset: this removes local MongoDB data.'
	@echo 'Run docker compose down -v only if you intentionally want to delete all local data.'
