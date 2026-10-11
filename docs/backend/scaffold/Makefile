.PHONY: dev-up dev-down test test-integration seed schema-check reset-local

dev-up:
	@test -f secrets/arcadedb_root_password.txt || (echo 'Create secrets/arcadedb_root_password.txt with an 8+ character local-only password.' && exit 1)
	docker compose up -d

dev-down:
	docker compose down

test:
	go test ./...

test-integration:
	go test -tags=integration ./...

seed:
	go run ./cmd/seed

schema-check:
	go run ./cmd/seed schema-check

reset-local:
	@echo 'Destructive local reset: this removes local ArcadeDB data.'
	@echo 'Run docker compose down -v only if you intentionally want to delete all local data.'
