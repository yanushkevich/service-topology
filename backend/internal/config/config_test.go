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
	if cfg.HTTPAddr != ":8080" || cfg.ShutdownTimeout != 10*time.Second || cfg.LogLevel != slog.LevelInfo || cfg.LogFormat != "json" || cfg.SeedMode != "demo" || cfg.ArcadeDB != nil {
		t.Fatalf("unexpected defaults: %+v", cfg)
	}
}

func TestArcadeDBSettings(t *testing.T) {
	cfg, err := config.Load(env(map[string]string{
		"ARCADEDB_BASE_URL":        "http://localhost:2480",
		"ARCADEDB_USERNAME":        "root",
		"ARCADEDB_PASSWORD_FILE":   "./secrets/arcadedb_root_password.txt",
		"ARCADEDB_QUERY_LANGUAGE":  "SQL",
		"ARCADEDB_REQUEST_TIMEOUT": "5s",
	}))
	if err != nil {
		t.Fatal(err)
	}
	db := cfg.ArcadeDB
	if db == nil || db.BaseURL.Host != "localhost:2480" || db.Database != "topology" || db.QueryLanguage != "sql" || db.RequestTimeout != 5*time.Second {
		t.Fatalf("unexpected ArcadeDB config: %+v", db)
	}
}

func TestReportsEveryProblemAtOnce(t *testing.T) {
	_, err := config.Load(env(map[string]string{
		"HTTP_ADDR":               "8080",
		"SHUTDOWN_TIMEOUT":        "soon",
		"LOG_LEVEL":               "loud",
		"LOG_FORMAT":              "xml",
		"ARCADEDB_BASE_URL":       "http://root:secret@localhost:2480",
		"ARCADEDB_QUERY_LANGUAGE": "gremlin",
		"ARCADEDB_PASSWORD":       "secret",
	}))
	if err == nil {
		t.Fatal("expected errors")
	}
	for _, key := range []string{"HTTP_ADDR", "SHUTDOWN_TIMEOUT", "LOG_LEVEL", "LOG_FORMAT", "ARCADEDB_BASE_URL", "ARCADEDB_QUERY_LANGUAGE", "ARCADEDB_USERNAME", "ARCADEDB_PASSWORD_FILE", "ARCADEDB_PASSWORD:"} {
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
		"ARCADEDB_BASE_URL": "https://db.example.test", "ARCADEDB_USERNAME": "svc", "ARCADEDB_PASSWORD_FILE": "/run/secrets/pw",
	}))
	if err != nil {
		t.Fatal(err)
	}
	if s := cfg.LogValue().String(); strings.Contains(s, "/run/secrets") || strings.Contains(s, "svc") {
		t.Fatalf("log value leaks credentials: %s", s)
	}
}
