// Command fakedynatrace serves an invented Dynatrace tenant for local demos of the connector
// (docs/DYNATRACE_CONNECTOR.md §7): the Grail query API answering the connector's queries from
// fixtures/dynatrace/example-tenant.json. It accepts the platform token in -token-file. Its data
// is example data; backend/dynatrace.example.yaml marks the tenant `example: true`.
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"servicetopology/backend/internal/adapters/dynatrace/dynatracefake"
	"servicetopology/backend/internal/config"
	"servicetopology/backend/internal/fixtures"
)

func main() { os.Exit(run(os.Args[1:], os.Stderr)) }

func run(args []string, stderr io.Writer) int {
	fs := flag.NewFlagSet("fakedynatrace", flag.ContinueOnError)
	fs.SetOutput(stderr)
	addr := fs.String("addr", "127.0.0.1:8099", "listen address (loopback only)")
	tokenFile := fs.String("token-file", "secrets/dynatrace_example_token.txt", "file holding the platform token to accept")
	fixture := fs.String("fixture", "", "tenant fixture (default: fixtures/dynatrace/example-tenant.json)")
	if err := fs.Parse(args); err != nil {
		return 2
	}
	log := slog.New(slog.NewTextHandler(stderr, nil))
	if !config.IsLoopback(*addr) {
		log.Error("the fake tenant only listens on a loopback address", "addr", *addr)
		return 2
	}
	tenant, err := load(*fixture, *tokenFile)
	if err != nil {
		log.Error("cannot start the fake tenant", "error", err)
		return 1
	}
	log.Info("fake Dynatrace tenant (example data)", "url", "http://"+*addr, "queries", len(tenant.Results))
	server := &http.Server{Addr: *addr, Handler: tenant.Handler(), ReadHeaderTimeout: 5 * time.Second}
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Error("fake tenant stopped", "error", err)
		return 1
	}
	return 0
}

func load(fixture, tokenFile string) (*dynatracefake.Tenant, error) {
	if fixture == "" {
		dir, err := fixtures.Dir()
		if err != nil {
			return nil, err
		}
		fixture = filepath.Join(dir, "dynatrace", "example-tenant.json")
	}
	tenant, err := dynatracefake.Load(fixture)
	if err != nil {
		return nil, err
	}
	raw, err := os.ReadFile(tokenFile)
	if err != nil || strings.TrimSpace(string(raw)) == "" {
		return nil, fmt.Errorf("token file %s is missing or empty (make fake-dynatrace creates it)", filepath.Base(tokenFile))
	}
	tenant.Token = strings.TrimSpace(string(raw))
	return tenant, nil
}
