package config_test

import (
	"log/slog"
	"strings"
	"testing"
	"time"

	"servicetopology/backend/internal/config"
)

func env(m map[string]string) func(string) string { return func(k string) string { return m[k] } }

func TestDefaultsWithoutDatabase(t *testing.T) {
	cfg, err := config.Load(env(nil))
	if err != nil {
		t.Fatal(err)
	}
	if cfg.HTTPAddr != "127.0.0.1:8080" || cfg.ShutdownTimeout != 10*time.Second || cfg.LogLevel != slog.LevelInfo || cfg.LogFormat != "json" || cfg.SeedMode != "demo" || cfg.MongoDB != nil {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
}

func TestMongoDBSettings(t *testing.T) {
	cfg, err := config.Load(env(map[string]string{
		"MONGODB_URI":           "mongodb://127.0.0.1:27017/?replicaSet=rs0",
		"MONGODB_USERNAME":      "root",
		"MONGODB_PASSWORD_FILE": "./secrets/mongodb_root_password.txt",
		"MONGODB_TIMEOUT":       "5s",
	}))
	if err != nil {
		t.Fatal(err)
	}
	db := cfg.MongoDB
	if db == nil || db.URI.Host != "127.0.0.1:27017" || db.Database != "topology" || db.AuthSource != "admin" || db.Timeout != 5*time.Second {
		t.Fatalf("unexpected MongoDB config: %+v", db)
	}
	// A server without authentication: neither username nor password file.
	if cfg, err := config.Load(env(map[string]string{"MONGODB_URI": "mongodb+srv://cluster.example.test"})); err != nil || cfg.MongoDB.Username != "" {
		t.Fatalf("unauthenticated settings: %v", err)
	}
}

func TestReportsEveryProblemAtOnce(t *testing.T) {
	_, err := config.Load(env(map[string]string{
		"HTTP_ADDR":            "8080",
		"AUTH_MODE":            "token",
		"RATE_LIMIT_RPS":       "fast",
		"CORS_ALLOWED_ORIGINS": "*",
		"SHUTDOWN_TIMEOUT":     "soon",
		"LOG_LEVEL":            "loud",
		"LOG_FORMAT":           "xml",
		"MONGODB_URI":          "mongodb://root:secret@localhost:27017",
		"MONGODB_DATABASE":     "top logy",
		"MONGODB_USERNAME":     "root",
		"MONGODB_PASSWORD":     "secret",
	}))
	if err == nil {
		t.Fatal("expected errors")
	}
	for _, key := range []string{"HTTP_ADDR", "SHUTDOWN_TIMEOUT", "LOG_LEVEL", "LOG_FORMAT", "MONGODB_URI", "MONGODB_DATABASE", "MONGODB_PASSWORD_FILE", "MONGODB_PASSWORD:", "AUTH_TOKENS_FILE", "RATE_LIMIT_RPS", "CORS_ALLOWED_ORIGINS"} {
		if !strings.Contains(err.Error(), key) {
			t.Errorf("error does not mention %s:\n%v", key, err)
		}
	}
	if strings.Contains(err.Error(), "secret") {
		t.Errorf("error leaks a secret:\n%v", err)
	}
}

func TestLogValueHidesSecrets(t *testing.T) {
	cfg, err := config.Load(env(map[string]string{
		"MONGODB_URI": "mongodb://db.example.test:27017", "MONGODB_USERNAME": "svc", "MONGODB_PASSWORD_FILE": "/run/secrets/pw",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if s := cfg.LogValue().String(); strings.Contains(s, "/run/secrets") || strings.Contains(s, "svc") {
		t.Fatalf("log value leaks credentials: %s", s)
	}
}

func TestRefusesUnauthenticatedNetworkExposure(t *testing.T) {
	if _, err := config.Load(env(map[string]string{"HTTP_ADDR": ":8080"})); err == nil || !strings.Contains(err.Error(), "AUTH_MODE=none") {
		t.Fatalf("all-interfaces without auth must be refused: %v", err)
	}
	if _, err := config.Load(env(map[string]string{"HTTP_ADDR": ":8080", "ALLOW_UNAUTHENTICATED": "true"})); err != nil {
		t.Fatalf("explicit opt-in refused: %v", err)
	}
	if _, err := config.Load(env(map[string]string{"HTTP_ADDR": "0.0.0.0:8080", "AUTH_MODE": "token", "AUTH_TOKENS_FILE": "/run/secrets/tokens"})); err != nil {
		t.Fatalf("token auth on all interfaces refused: %v", err)
	}
	if _, err := config.Load(env(map[string]string{"METRICS_ADDR": "0.0.0.0:9090"})); err == nil {
		t.Fatal("metrics on all interfaces must be refused")
	}
	for addr, want := range map[string]bool{"127.0.0.1:1": true, "[::1]:1": true, "localhost:1": true, ":1": false, "0.0.0.0:1": false, "10.0.0.5:1": false} {
		if config.IsLoopback(addr) != want {
			t.Errorf("IsLoopback(%q) != %v", addr, want)
		}
	}
}
