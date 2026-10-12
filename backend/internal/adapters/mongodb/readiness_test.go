package mongodb_test

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"servicetopology/backend/internal/adapters/mongodb"
	"servicetopology/backend/internal/config"
	"servicetopology/backend/internal/ports"
)

func unreachable(t *testing.T) *mongodb.Store {
	t.Helper()
	u, _ := url.Parse("mongodb://127.0.0.1:1/?directConnection=true")
	s, err := mongodb.Connect(&config.MongoDB{URI: u, Database: "topology", Timeout: 300 * time.Millisecond}, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = s.Close(context.Background()) })
	return s
}

func TestInitializerReportsGenericReadiness(t *testing.T) {
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	down := mongodb.NewInitializer(unreachable(t), logger)
	if err := down.Check(context.Background()); err == nil || err.Error() != "initializing" {
		t.Fatalf("before run: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	go down.Run(ctx, 10*time.Millisecond)
	time.Sleep(time.Second)
	cancel()
	if err := down.Check(context.Background()); err == nil || err.Error() != "schema not initialized (database unreachable or failing)" {
		t.Fatalf("unreachable: %v", err)
	}
}

func TestUnreachableServerIsUnavailable(t *testing.T) {
	if err := unreachable(t).Ping(context.Background()); !errors.Is(err, ports.ErrUnavailable) {
		t.Fatalf("got %v, want unavailable", err)
	}
}

func TestPasswordFileIsRequiredAndNeverEchoed(t *testing.T) {
	u, _ := url.Parse("mongodb://127.0.0.1:27017")
	if _, err := mongodb.Connect(&config.MongoDB{URI: u, Database: "topology", Username: "root", PasswordFile: filepath.Join(t.TempDir(), "missing"), Timeout: time.Second}, nil); err == nil {
		t.Fatal("missing password file accepted")
	}
	empty := filepath.Join(t.TempDir(), "empty")
	if err := os.WriteFile(empty, []byte("\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := mongodb.Connect(&config.MongoDB{URI: u, Database: "topology", Username: "root", PasswordFile: empty, Timeout: time.Second}, nil); err == nil {
		t.Fatal("empty password file accepted")
	}
}
