// Package config loads and validates process configuration from environment variables
// (docs/backend/LOCAL_DEVELOPMENT.md). Loading fails fast and reports every problem at once.
// Secrets are referenced by file path only and never held or logged here.
package config

import (
	"errors"
	"fmt"
	"log/slog"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Config is the validated process configuration.
type Config struct {
	HTTPAddr        string
	ShutdownTimeout time.Duration
	LogLevel        slog.Level
	LogFormat       string // "json" or "text"
	SeedMode        string // "demo" or "none"
	// Simulation run retention (B5): runs, their events, and telemetry older than this, or beyond
	// the newest SimulationMaxRuns, are deleted after each new run.
	SimulationRetention time.Duration
	SimulationMaxRuns   int
	// ArcadeDB is nil when ARCADEDB_BASE_URL is unset (B1 runs without a database).
	ArcadeDB *ArcadeDB
}

// ArcadeDB holds connection settings. The password is read from PasswordFile by the adapter (B2).
type ArcadeDB struct {
	BaseURL        *url.URL
	Database       string
	Username       string
	PasswordFile   string
	QueryLanguage  string // "sql" (ADR-DB-002)
	RequestTimeout time.Duration
}

// LogValue keeps secrets and file paths out of logs.
func (c Config) LogValue() slog.Value {
	attrs := []slog.Attr{
		slog.String("httpAddr", c.HTTPAddr),
		slog.String("shutdownTimeout", c.ShutdownTimeout.String()),
		slog.String("logLevel", c.LogLevel.String()),
		slog.String("seedMode", c.SeedMode),
		slog.String("simulationRetention", c.SimulationRetention.String()),
		slog.Int("simulationMaxRuns", c.SimulationMaxRuns),
	}
	if c.ArcadeDB != nil {
		attrs = append(attrs, slog.Group("arcadedb",
			slog.String("baseURL", c.ArcadeDB.BaseURL.Redacted()),
			slog.String("database", c.ArcadeDB.Database),
			slog.String("queryLanguage", c.ArcadeDB.QueryLanguage),
		))
	} else {
		attrs = append(attrs, slog.String("arcadedb", "not configured"))
	}
	return slog.GroupValue(attrs...)
}

// Load reads configuration through getenv (os.Getenv in production; a map in tests).
func Load(getenv func(string) string) (Config, error) {
	var errs []error
	get := func(key, fallback string) string {
		if v := strings.TrimSpace(getenv(key)); v != "" {
			return v
		}
		return fallback
	}
	duration := func(key, fallback string) time.Duration {
		raw := get(key, fallback)
		d, err := time.ParseDuration(raw)
		if err != nil || d <= 0 {
			errs = append(errs, fmt.Errorf("%s: %q is not a positive duration (e.g. 10s)", key, raw))
		}
		return d
	}
	oneOf := func(key, fallback string, allowed ...string) string {
		v := strings.ToLower(get(key, fallback))
		for _, a := range allowed {
			if v == a {
				return v
			}
		}
		errs = append(errs, fmt.Errorf("%s: %q must be one of %s", key, v, strings.Join(allowed, ", ")))
		return v
	}

	cfg := Config{
		HTTPAddr:            get("HTTP_ADDR", ":8080"),
		ShutdownTimeout:     duration("SHUTDOWN_TIMEOUT", "10s"),
		LogFormat:           oneOf("LOG_FORMAT", "json", "json", "text"),
		SeedMode:            oneOf("SEED_MODE", "demo", "demo", "none"),
		SimulationRetention: duration("SIMULATION_RETENTION", "168h"),
	}
	maxRuns := get("SIMULATION_MAX_RUNS", "200")
	if n, err := strconv.Atoi(maxRuns); err != nil || n < 1 || n > 100000 {
		errs = append(errs, fmt.Errorf("SIMULATION_MAX_RUNS: %q must be an integer between 1 and 100000", maxRuns))
	} else {
		cfg.SimulationMaxRuns = n
	}
	if _, port, err := net.SplitHostPort(cfg.HTTPAddr); err != nil || port == "" {
		errs = append(errs, fmt.Errorf("HTTP_ADDR: %q must be host:port or :port", cfg.HTTPAddr))
	}
	if err := cfg.LogLevel.UnmarshalText([]byte(get("LOG_LEVEL", "info"))); err != nil {
		errs = append(errs, fmt.Errorf("LOG_LEVEL: %q must be debug, info, warn, or error", get("LOG_LEVEL", "info")))
	}

	if raw := get("ARCADEDB_BASE_URL", ""); raw != "" {
		db := &ArcadeDB{
			Database:     get("ARCADEDB_DATABASE", "topology"),
			Username:     get("ARCADEDB_USERNAME", ""),
			PasswordFile: get("ARCADEDB_PASSWORD_FILE", ""),
			// SQL is the one implemented query language (ADR-DB-002).
			QueryLanguage:  oneOf("ARCADEDB_QUERY_LANGUAGE", "sql", "sql"),
			RequestTimeout: duration("ARCADEDB_REQUEST_TIMEOUT", "10s"),
		}
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			errs = append(errs, fmt.Errorf("ARCADEDB_BASE_URL: must be an http(s) URL with a host"))
		} else if u.User != nil {
			errs = append(errs, fmt.Errorf("ARCADEDB_BASE_URL: must not contain credentials; use ARCADEDB_USERNAME and ARCADEDB_PASSWORD_FILE"))
		}
		db.BaseURL = u
		if db.Username == "" {
			errs = append(errs, errors.New("ARCADEDB_USERNAME: required when ARCADEDB_BASE_URL is set"))
		}
		if db.PasswordFile == "" {
			errs = append(errs, errors.New("ARCADEDB_PASSWORD_FILE: required when ARCADEDB_BASE_URL is set (passwords are never read from plain variables)"))
		}
		if getenv("ARCADEDB_PASSWORD") != "" {
			errs = append(errs, errors.New("ARCADEDB_PASSWORD: not supported; put the password in the file named by ARCADEDB_PASSWORD_FILE"))
		}
		cfg.ArcadeDB = db
	}

	return cfg, errors.Join(errs...)
}
