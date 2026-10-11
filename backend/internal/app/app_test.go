package app_test

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"testing"
	"time"

	"servicetopology/backend/internal/app"
	"servicetopology/backend/internal/config"
)

func TestServesAndShutsDownGracefully(t *testing.T) {
	cfg, err := config.Load(func(k string) string {
		return map[string]string{"HTTP_ADDR": "127.0.0.1:0", "SHUTDOWN_TIMEOUT": "2s"}[k]
	})
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	addr := make(chan string, 1)
	done := make(chan error, 1)
	go func() {
		done <- app.Run(ctx, cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), func(a string) { addr <- a })
	}()

	base := "http://" + <-addr
	// No keep-alives: Go's client may dial a spare connection that never sends a request, and
	// http.Server.Shutdown only closes such "new" connections after 5 s, longer than this timeout.
	client := &http.Client{Transport: &http.Transport{DisableKeepAlives: true}, Timeout: 2 * time.Second}
	for path, want := range map[string]int{"/healthz": 200, "/readyz": 503} {
		resp, err := client.Get(base + path)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != want {
			t.Errorf("%s: got %d, want %d (B1 has no database, so it is never ready)", path, resp.StatusCode, want)
		}
	}

	cancel()
	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run returned %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("server did not shut down")
	}
	if _, err := client.Get(base + "/healthz"); err == nil {
		t.Fatal("server still accepting connections after shutdown")
	}
}

func TestListenErrorIsReturned(t *testing.T) {
	cfg, _ := config.Load(func(k string) string { return map[string]string{"HTTP_ADDR": "256.0.0.1:1"}[k] })
	if err := app.Run(context.Background(), cfg, slog.New(slog.NewTextHandler(io.Discard, nil)), nil); err == nil {
		t.Fatal("expected a listen error")
	}
}
