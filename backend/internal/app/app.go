// Package app wires configuration, adapters, and the HTTP server, and runs it until the context
// ends, then shuts down gracefully.
package app

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"servicetopology/backend/internal/adapters/arcadedb"
	"servicetopology/backend/internal/adapters/httpapi"
	"servicetopology/backend/internal/application"
	"servicetopology/backend/internal/auth"
	"servicetopology/backend/internal/config"
	"servicetopology/backend/internal/observability"
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
	metrics := observability.NewMetrics()
	sec := httpapi.Security{RateLimitRPS: cfg.RateLimitRPS, RateLimitBurst: cfg.RateLimitBurst, TrustProxyHeaders: cfg.TrustProxyHeaders, CORSAllowedOrigins: cfg.CORSAllowedOrigins}
	if cfg.AuthMode == "token" {
		tokens, err := auth.LoadTokens(cfg.AuthTokensFile)
		if err != nil {
			return err
		}
		sec.Tokens = tokens
		logger.Info("bearer-token authentication enabled", "tokens", len(tokens))
	} else if !config.IsLoopback(cfg.HTTPAddr) {
		logger.Warn("AUTH_MODE=none on a non-loopback address (ALLOW_UNAUTHENTICATED=true): an authenticating proxy must protect this API")
	}
	var dbCheck ports.ReadinessCheck = notConfigured{}
	var api *application.Service
	if cfg.ArcadeDB != nil {
		client, err := arcadedb.NewClient(cfg.ArcadeDB)
		if err != nil {
			return err
		}
		client.Observe = func(method, path string, status int, d time.Duration, err error) {
			op, _, _ := strings.Cut(path, "/") // endpoint only (query, command, begin…), never IDs
			metrics.Inc("arcadedb_requests_total", "ArcadeDB HTTP API calls by endpoint and status.", "endpoint", op, "status", strconv.Itoa(status))
			metrics.Observe("arcadedb_request_duration_seconds", "ArcadeDB HTTP API call duration by endpoint.", d, "endpoint", op)
		}
		topo := arcadedb.NewTopologyRepository(client)
		metrics.Gauge("topology_cache_hits_total", "Topology reads served from the revision cache.", func() float64 { h, _ := topo.CacheStats(); return float64(h) })
		metrics.Gauge("topology_cache_misses_total", "Topology reads that loaded from ArcadeDB.", func() float64 { _, m := topo.CacheStats(); return float64(m) })
		init := arcadedb.NewInitializer(client, logger)
		go init.Run(ctx, 5*time.Second)
		dbCheck = init
		api = &application.Service{
			TopologyRepo: topo,
			SnapshotRepo: arcadedb.NewSnapshotRepository(client),
			LayoutRepo:   arcadedb.NewLayoutRepository(client),
			GraphRepo:    arcadedb.NewGraphRepository(client),
			// ADR-DB-003 amendment: in-memory traversal on the cached topology unless configured.
			TraversalInDatabase: cfg.TraversalSource == "database",
			SimRepo:             arcadedb.NewSimulationRepository(client),

			SimulationRetention: cfg.SimulationRetention,
			SimulationMaxRuns:   cfg.SimulationMaxRuns,
			Logger:              logger,
		}
	}
	handler := httpapi.NewHandler(httpapi.Deps{
		Logger:        logger,
		Checks:        []ports.ReadinessCheck{dbCheck},
		API:           api,
		Security:      sec,
		Metrics:       metrics,
		SchemaVersion: arcadedb.SchemaVersion,
		AuthMode:      cfg.AuthMode,
	})
	if cfg.MetricsAddr != "" {
		mln, err := net.Listen("tcp", cfg.MetricsAddr)
		if err != nil {
			return err
		}
		msrv := &http.Server{Handler: metrics.Handler(), ReadHeaderTimeout: 5 * time.Second}
		go func() { _ = msrv.Serve(mln) }()
		defer msrv.Close()
		logger.Info("metrics listening", "addr", mln.Addr().String())
	}
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
