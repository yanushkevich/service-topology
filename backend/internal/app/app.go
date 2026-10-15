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

	"servicetopology/backend/internal/adapters/dynatrace"
	"servicetopology/backend/internal/adapters/flowformats"
	"servicetopology/backend/internal/adapters/httpapi"
	"servicetopology/backend/internal/adapters/mongodb"
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
	return errors.New("not configured (MONGODB_URI is unset)")
}

// newDynatrace loads the connector configuration and reads its secrets (ADR-034). The log names
// tenants by ID only.
func newDynatrace(path string, logger *slog.Logger) (*dynatrace.Connector, error) {
	cfg, err := dynatrace.LoadConfig(path)
	if err != nil {
		return nil, err
	}
	conn, err := dynatrace.NewConnector(cfg, nil, logger)
	if err != nil {
		return nil, err
	}
	logger.Info("dynatrace connector enabled", "tenants", len(cfg.Tenants), "environments", len(cfg.Environments), "example", conn.IsExample())
	return conn, nil
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
	if cfg.MongoDB != nil {
		store, err := mongodb.Connect(cfg.MongoDB, func(command string, ok bool, d time.Duration) {
			status := map[bool]string{true: "ok", false: "error"}[ok] // command names only (find, insert…), never values
			metrics.Inc("mongodb_commands_total", "MongoDB commands by name and outcome.", "command", command, "status", status)
			metrics.Observe("mongodb_command_duration_seconds", "MongoDB command duration by name.", d, "command", command)
		})
		if err != nil {
			return err
		}
		defer store.Close(context.WithoutCancel(ctx))
		topo := mongodb.NewTopologyRepository(store)
		metrics.Gauge("topology_cache_hits_total", "Topology reads served from the revision cache.", func() float64 { h, _ := topo.CacheStats(); return float64(h) })
		metrics.Gauge("topology_cache_misses_total", "Topology reads that loaded from MongoDB.", func() float64 { _, m := topo.CacheStats(); return float64(m) })
		init := mongodb.NewInitializer(store, logger)
		go init.Run(ctx, 5*time.Second)
		dbCheck = init
		api = &application.Service{
			FlowFormats:  application.FlowFormats{"native": flowformats.Native{}, "bpmn": flowformats.BPMN{}},
			TopologyRepo: topo,
			SnapshotRepo: mongodb.NewSnapshotRepository(store),
			LayoutRepo:   mongodb.NewLayoutRepository(store),
			BoardRepo:    mongodb.NewBoardRepository(store),
			GraphRepo:    mongodb.NewGraphRepository(store),
			// ADR-DB-003 amendment: in-memory traversal on the cached topology unless configured.
			TraversalInDatabase: cfg.TraversalSource == "database",
			SimRepo:             mongodb.NewSimulationRepository(store),

			SimulationRetention: cfg.SimulationRetention,
			SimulationMaxRuns:   cfg.SimulationMaxRuns,
			Logger:              logger,
		}
		if cfg.DynatraceConfigFile != "" {
			source, err := newDynatrace(cfg.DynatraceConfigFile, logger)
			if err != nil {
				return err
			}
			api.Sync = application.NewSourceSync(source, mongodb.NewIntegrationRepository(store))
		}
	}
	if cfg.DynatraceConfigFile != "" && cfg.MongoDB == nil {
		logger.Warn("DYNATRACE_CONFIG_FILE is ignored: the Dynatrace connector needs a database (MONGODB_URI)")
	}
	handler := httpapi.NewHandler(httpapi.Deps{
		Logger:        logger,
		Checks:        []ports.ReadinessCheck{dbCheck},
		API:           api,
		Security:      sec,
		Metrics:       metrics,
		SchemaVersion: mongodb.SchemaVersion,
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
