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
	"regexp"
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
	// Security (B6, ADR-018).
	AuthMode             string // "none" or "token"
	AuthTokensFile       string
	AllowUnauthenticated bool // permit AuthMode none on a non-loopback HTTP_ADDR
	RateLimitRPS         float64
	RateLimitBurst       int
	TrustProxyHeaders    bool
	CORSAllowedOrigins   []string
	MetricsAddr          string // "" disables /metrics
	TraversalSource      string // "memory" (default) or "database" (ADR-DB-003)
	// DynatraceConfigFile names the Dynatrace connector configuration (ADR-034); "" disables it.
	DynatraceConfigFile string
	// MongoDB is nil when MONGODB_URI is unset (the API then runs without a database).
	MongoDB *MongoDB
}

// MongoDB holds connection settings (ADR-019). The password is read from PasswordFile by the
// adapter; the URI never carries credentials.
type MongoDB struct {
	URI          *url.URL
	Database     string
	Username     string // empty: no authentication (then PasswordFile is empty too)
	PasswordFile string
	AuthSource   string
	Timeout      time.Duration // per operation, including server selection
}

// databaseName allowlists database names (they appear in logs and scripts).
var databaseName = regexp.MustCompile(`^[A-Za-z0-9_]{1,63}$`)

// IsLoopback reports whether a listen address only accepts local connections.
func IsLoopback(addr string) bool {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
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
		slog.String("authMode", c.AuthMode),
		slog.Float64("rateLimitRPS", c.RateLimitRPS),
		slog.Any("corsAllowedOrigins", c.CORSAllowedOrigins),
		slog.Bool("metrics", c.MetricsAddr != ""),
		slog.Bool("dynatrace", c.DynatraceConfigFile != ""),
	}
	if c.MongoDB != nil {
		attrs = append(attrs, slog.Group("mongodb",
			slog.String("uri", c.MongoDB.URI.Redacted()),
			slog.String("database", c.MongoDB.Database),
			slog.Bool("authenticated", c.MongoDB.Username != ""),
		))
	} else {
		attrs = append(attrs, slog.String("mongodb", "not configured"))
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
		HTTPAddr:            get("HTTP_ADDR", "127.0.0.1:8080"),
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

	cfg.AuthMode = oneOf("AUTH_MODE", "none", "none", "token")
	cfg.AuthTokensFile = get("AUTH_TOKENS_FILE", "")
	cfg.AllowUnauthenticated = get("ALLOW_UNAUTHENTICATED", "false") == "true"
	cfg.TrustProxyHeaders = get("TRUST_PROXY_HEADERS", "false") == "true"
	if cfg.AuthMode == "token" && cfg.AuthTokensFile == "" {
		errs = append(errs, errors.New("AUTH_TOKENS_FILE: required when AUTH_MODE=token"))
	}
	if cfg.AuthMode == "none" && !cfg.AllowUnauthenticated && !IsLoopback(cfg.HTTPAddr) {
		errs = append(errs, fmt.Errorf("HTTP_ADDR: %q is reachable from other machines but AUTH_MODE=none; use AUTH_MODE=token, a loopback address, or ALLOW_UNAUTHENTICATED=true behind an authenticating proxy", cfg.HTTPAddr))
	}
	if rps, err := strconv.ParseFloat(get("RATE_LIMIT_RPS", "50"), 64); err != nil || rps < 0 {
		errs = append(errs, errors.New("RATE_LIMIT_RPS: must be a non-negative number (0 disables rate limiting)"))
	} else {
		cfg.RateLimitRPS = rps
	}
	if burst, err := strconv.Atoi(get("RATE_LIMIT_BURST", "100")); err != nil || burst < 1 {
		errs = append(errs, errors.New("RATE_LIMIT_BURST: must be a positive integer"))
	} else {
		cfg.RateLimitBurst = burst
	}
	for _, o := range strings.Split(get("CORS_ALLOWED_ORIGINS", ""), ",") {
		o = strings.TrimSpace(o)
		if o == "" {
			continue
		}
		if u, err := url.Parse(o); err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Path != "" || o == "*" {
			errs = append(errs, fmt.Errorf("CORS_ALLOWED_ORIGINS: %q must be an origin like https://app.example.com (no wildcard)", o))
			continue
		}
		cfg.CORSAllowedOrigins = append(cfg.CORSAllowedOrigins, o)
	}
	cfg.TraversalSource = oneOf("TRAVERSAL_SOURCE", "memory", "memory", "database")
	cfg.DynatraceConfigFile = get("DYNATRACE_CONFIG_FILE", "")
	cfg.MetricsAddr = get("METRICS_ADDR", "")
	if cfg.MetricsAddr != "" && !IsLoopback(cfg.MetricsAddr) && !cfg.AllowUnauthenticated {
		errs = append(errs, fmt.Errorf("METRICS_ADDR: %q must be a loopback address (metrics are unauthenticated)", cfg.MetricsAddr))
	}
	if err := cfg.LogLevel.UnmarshalText([]byte(get("LOG_LEVEL", "info"))); err != nil {
		errs = append(errs, fmt.Errorf("LOG_LEVEL: %q must be debug, info, warn, or error", get("LOG_LEVEL", "info")))
	}

	if raw := get("MONGODB_URI", ""); raw != "" {
		db := &MongoDB{
			Database:     get("MONGODB_DATABASE", "topology"),
			Username:     get("MONGODB_USERNAME", ""),
			PasswordFile: get("MONGODB_PASSWORD_FILE", ""),
			AuthSource:   get("MONGODB_AUTH_SOURCE", "admin"),
			Timeout:      duration("MONGODB_TIMEOUT", "10s"),
		}
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "mongodb" && u.Scheme != "mongodb+srv") || u.Host == "" {
			errs = append(errs, errors.New("MONGODB_URI: must be a mongodb:// or mongodb+srv:// URI with a host"))
		} else if u.User != nil {
			errs = append(errs, errors.New("MONGODB_URI: must not contain credentials; use MONGODB_USERNAME and MONGODB_PASSWORD_FILE"))
		}
		db.URI = u
		if !databaseName.MatchString(db.Database) {
			errs = append(errs, fmt.Errorf("MONGODB_DATABASE: %q must be 1-63 letters, digits, or '_'", db.Database))
		}
		if (db.Username == "") != (db.PasswordFile == "") {
			errs = append(errs, errors.New("MONGODB_USERNAME and MONGODB_PASSWORD_FILE: set both, or neither for a server without authentication"))
		}
		if getenv("MONGODB_PASSWORD") != "" {
			errs = append(errs, errors.New("MONGODB_PASSWORD: not supported; put the password in the file named by MONGODB_PASSWORD_FILE"))
		}
		cfg.MongoDB = db
	}

	return cfg, errors.Join(errs...)
}
