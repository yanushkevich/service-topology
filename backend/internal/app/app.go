// Package app wires configuration, adapters, and the HTTP server, and runs it until the context
// ends, then shuts down gracefully.
package app

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"time"

	"servicetopology/backend/internal/adapters/httpapi"
	"servicetopology/backend/internal/config"
	"servicetopology/backend/internal/ports"
)

// databaseCheck reports database readiness. Until the ArcadeDB adapter exists (Milestone B2) it is
// never ready, so /readyz honestly reports 503.
type databaseCheck struct{ configured bool }

func (databaseCheck) Name() string { return "database" }
func (c databaseCheck) Check(context.Context) error {
	if !c.configured {
		return errors.New("not configured (ARCADEDB_BASE_URL is unset)")
	}
	return errors.New("ArcadeDB adapter not implemented yet (Milestone B2)")
}

// Run serves HTTP until ctx is done. onListen, if set, receives the bound address (tests use
// HTTP_ADDR=127.0.0.1:0).
func Run(ctx context.Context, cfg config.Config, logger *slog.Logger, onListen func(addr string)) error {
	handler := httpapi.NewHandler(httpapi.Deps{
		Logger: logger,
		Checks: []ports.ReadinessCheck{databaseCheck{configured: cfg.ArcadeDB != nil}},
	})
	srv := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       15 * time.Second,
		WriteTimeout:      30 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 20,
		ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
	}
	ln, err := net.Listen("tcp", cfg.HTTPAddr)
	if err != nil {
		return err
	}
	logger.Info("listening", "addr", ln.Addr().String(), "config", cfg)
	if onListen != nil {
		onListen(ln.Addr().String())
	}

	serveErr := make(chan error, 1)
	go func() { serveErr <- srv.Serve(ln) }()

	select {
	case err := <-serveErr:
		return err
	case <-ctx.Done():
	}
	logger.Info("shutting down", "timeout", cfg.ShutdownTimeout.String())
	shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), cfg.ShutdownTimeout)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		return err
	}
	if err := <-serveErr; !errors.Is(err, http.ErrServerClosed) {
		return err
	}
	logger.Info("stopped")
	return nil
}
