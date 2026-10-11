# Backend tasks. Run from backend/ (or `make -C backend <target>` from the repo root).
# GO can point at a toolchain that is not on PATH, e.g. `make check GO=/usr/local/go/bin/go`.
GO ?= go
GOFMT ?= $(dir $(shell command -v $(GO)))gofmt

.PHONY: check fmt fmt-check vet test test-integration run seed schema-check dev-up dev-down reset-local

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

## test-integration: tests against a running ArcadeDB (none until Milestone B2)
test-integration:
	$(GO) test -tags=integration ./...

## run: start the API on HTTP_ADDR (default :8080); /readyz is 503 until the database adapter exists (B2)
run:
	$(GO) run ./cmd/api

## seed: validate the shared mock fixture (loading into ArcadeDB arrives in B2)
seed:
	$(GO) run ./cmd/seed validate

schema-check:
	$(GO) run ./cmd/seed schema-check

dev-up:
	@test -f secrets/arcadedb_root_password.txt || (echo 'Create secrets/arcadedb_root_password.txt with an 8+ character local-only password.' && exit 1)
	docker compose up -d

dev-down:
	docker compose down

reset-local:
	@echo 'Destructive local reset: this removes local ArcadeDB data.'
	@echo 'Run docker compose down -v only if you intentionally want to delete all local data.'
