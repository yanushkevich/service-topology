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

	"servicetopology/backend/internal/adapters/arcadedb"
	"servicetopology/backend/internal/adapters/httpapi"
	"servicetopology/backend/internal/application"
	"servicetopology/backend/internal/config"
	"servicetopology/backend/internal/ports"
)

// notConfigured is the readiness check when no database is configured.
type notConfigured struct{}

func (notConfigured) Name() string { return "database" }
func (notConfigured) Check(context.Context) error {
	return errors.New("not configured (ARCADEDB_BASE_URL is unset)")
}

// Run serves HTTP until ctx is done. onListen, if set, receives the bound address (tests use
// HTTP_ADDR=127.0.0.1:0).
func Run(ctx context.Context, cfg config.Config, logger *slog.Logger, onListen func(addr string)) error {
	var dbCheck ports.ReadinessCheck = notConfigured{}
	var api *application.Service
	if cfg.ArcadeDB != nil {
		client, err := arcadedb.NewClient(cfg.ArcadeDB)
		if err != nil {
			return err
		}
		init := arcadedb.NewInitializer(client, logger)
		go init.Run(ctx, 5*time.Second)
		dbCheck = init
		api = &application.Service{
			TopologyRepo: arcadedb.NewTopologyRepository(client),
			SnapshotRepo: arcadedb.NewSnapshotRepository(client),
			LayoutRepo:   arcadedb.NewLayoutRepository(client),
			GraphRepo:    arcadedb.NewGraphRepository(client),
			SimRepo:      arcadedb.NewSimulationRepository(client),

			SimulationRetention: cfg.SimulationRetention,
			SimulationMaxRuns:   cfg.SimulationMaxRuns,
			Logger:              logger,
		}
	}
	handler := httpapi.NewHandler(httpapi.Deps{
		Logger: logger,
		Checks: []ports.ReadinessCheck{dbCheck},
		API:    api,
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
