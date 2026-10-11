package arcadedb_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"servicetopology/backend/internal/adapters/arcadedb"
	"servicetopology/backend/internal/config"
	"servicetopology/backend/internal/ports"
)

// Unit tests against a fake ArcadeDB HTTP API (no Docker needed); see integration_test.go for the
// real server.

func fake(t *testing.T, status int, body string) *arcadedb.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if u, p, ok := r.BasicAuth(); !ok || u != "root" || p != "s3cret-pw" {
			t.Errorf("missing or wrong basic auth")
		}
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return client(t, srv.URL)
}

func client(t *testing.T, base string) *arcadedb.Client {
	t.Helper()
	pw := filepath.Join(t.TempDir(), "pw")
	if err := os.WriteFile(pw, []byte("s3cret-pw\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	u, _ := url.Parse(base)
	c, err := arcadedb.NewClient(&config.ArcadeDB{BaseURL: u, Database: "topology", Username: "root", PasswordFile: pw, QueryLanguage: "sql", RequestTimeout: 2 * time.Second})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestErrorClassification(t *testing.T) {
	cases := []struct {
		name   string
		status int
		body   string
		want   error
	}{
		{"duplicate key", 503, `{"error":"Found duplicate key in index","exception":"com.arcadedb.exception.DuplicatedKeyException","detail":"Duplicated key [secret-value]"}`, arcadedb.ErrConflict},
		{"bad credentials", 403, `{"error":"Security error","exception":"com.arcadedb.server.security.ServerSecurityException"}`, arcadedb.ErrAuth},
		{"missing database", 404, `{"error":"Database not found","exception":"com.arcadedb.exception.DatabaseNotAvailableException"}`, arcadedb.ErrDatabaseNotFound},
		{"server error", 500, `{"error":"boom"}`, ports.ErrUnavailable},
		{"truncated", 200, `{"result":[{"id":"x"}],"truncated":true}`, arcadedb.ErrTruncated},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := fake(t, tc.status, tc.body).Query(context.Background(), "SELECT FROM Resource WHERE id = :id", map[string]any{"id": "secret-value"})
			if !errors.Is(err, tc.want) {
				t.Fatalf("got %v, want %v", err, tc.want)
			}
			for _, leak := range []string{"s3cret-pw", "secret-value", "SELECT"} {
				if strings.Contains(err.Error(), leak) {
					t.Errorf("error %q leaks %q", err, leak)
				}
			}
		})
	}
}

func TestUnreachableAndTimeout(t *testing.T) {
	_, err := client(t, "http://127.0.0.1:1").Exists(context.Background())
	if !errors.Is(err, ports.ErrUnavailable) || strings.Contains(err.Error(), "s3cret") {
		t.Fatalf("unreachable: got %v", err)
	}
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { time.Sleep(3 * time.Second) }))
	defer slow.Close()
	_, err = client(t, slow.URL).Exists(context.Background())
	if !errors.Is(err, ports.ErrUnavailable) || !strings.Contains(err.Error(), "timed out") {
		t.Fatalf("timeout: got %v", err)
	}
}

func TestPasswordFileIsRequired(t *testing.T) {
	u, _ := url.Parse("http://127.0.0.1:2480")
	_, err := arcadedb.NewClient(&config.ArcadeDB{BaseURL: u, Database: "topology", Username: "root", PasswordFile: filepath.Join(t.TempDir(), "missing")})
	if err == nil || !strings.Contains(err.Error(), "ARCADEDB_PASSWORD_FILE") {
		t.Fatalf("got %v", err)
	}
	empty := filepath.Join(t.TempDir(), "empty")
	_ = os.WriteFile(empty, []byte("\n"), 0o600)
	if _, err := arcadedb.NewClient(&config.ArcadeDB{BaseURL: u, Database: "topology", Username: "root", PasswordFile: empty}); err == nil {
		t.Fatal("empty password file accepted")
	}
}
