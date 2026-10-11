// Command api runs the Service Topology HTTP API (docs/backend/BACKEND_SPEC.md).
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"servicetopology/backend/internal/app"
	"servicetopology/backend/internal/config"
	"servicetopology/backend/internal/observability"
)

func main() {
	cfg, err := config.Load(os.Getenv)
	if err != nil {
		fmt.Fprintf(os.Stderr, "invalid configuration:\n%v\n", err)
		os.Exit(2)
	}
	logger := observability.NewLogger(os.Stdout, cfg.LogFormat, cfg.LogLevel)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := app.Run(ctx, cfg, logger, nil); err != nil {
		logger.Error("server failed", "error", err)
		os.Exit(1)
	}
}
