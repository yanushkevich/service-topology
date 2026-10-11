package arcadedb_test

import (
	"context"
	"io"
	"log/slog"
	"testing"
	"time"

	"servicetopology/backend/internal/adapters/arcadedb"
)

func TestInitializerReportsGenericReadiness(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	// Rejected credentials: not ready, with a message that names the cause but no details.
	bad := arcadedb.NewInitializer(fake(t, 403, `{"error":"Security error","exception":"x.ServerSecurityException"}`), logger)
	if err := bad.Check(context.Background()); err == nil || err.Error() != "initializing" {
		t.Fatalf("before run: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	go bad.Run(ctx, 10*time.Millisecond)
	time.Sleep(100 * time.Millisecond)
	cancel()
	if err := bad.Check(context.Background()); err == nil || err.Error() != "credentials rejected" {
		t.Fatalf("auth failure: %v", err)
	}

	// Unreachable server.
	down := arcadedb.NewInitializer(client(t, "http://127.0.0.1:1"), logger)
	ctx, cancel = context.WithCancel(context.Background())
	go down.Run(ctx, 10*time.Millisecond)
	time.Sleep(100 * time.Millisecond)
	cancel()
	if err := down.Check(context.Background()); err == nil || err.Error() != "schema not initialized (database unreachable or failing)" {
		t.Fatalf("unreachable: %v", err)
	}
}
