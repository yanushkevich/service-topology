package dynatrace

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// writeConfig writes a config file and a token file next to it, and returns the config path.
func writeConfig(t *testing.T, body string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "secrets"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "secrets", "token.txt"), []byte("dt0s16.EXAMPLE\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "dynatrace.yaml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

const validConfig = `
tenants:
  - id: main
    url: https://abc12345.apps.dynatrace.com
    auth: { platformTokenFile: secrets/token.txt }
environments:
  - { id: production, name: Production, kind: production, tenant: main, match: { tag: { key: environment, value: production } } }
`

func TestLoadConfigAppliesDefaultsAndResolvesSecretPaths(t *testing.T) {
	path := writeConfig(t, validConfig)
	cfg, err := LoadConfig(path)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.Refresh.Interval.Duration != time.Minute || cfg.Refresh.MetricsWindow.Duration != 5*time.Minute ||
		cfg.Discovery.Window.Duration != 24*time.Hour || cfg.Limits.QueryTimeout.Duration != 30*time.Second || cfg.Limits.MaxRecords != 10000 {
		t.Errorf("defaults = %+v", cfg)
	}
	if want := filepath.Join(filepath.Dir(path), "secrets", "token.txt"); cfg.Tenants[0].Auth.PlatformTokenFile != want {
		t.Errorf("token file = %s, want %s", cfg.Tenants[0].Auth.PlatformTokenFile, want)
	}
	token, err := readSecret(cfg.Tenants[0].Auth.PlatformTokenFile)
	if err != nil || token != "dt0s16.EXAMPLE" {
		t.Errorf("secret = %q, %v (trimmed)", token, err)
	}
}

func TestLoadConfigRejects(t *testing.T) {
	for _, tc := range []struct{ name, body, want string }{
		{"http URL", strings.Replace(validConfig, "https://abc12345", "http://abc12345", 1), "must use https"},
		{"loopback http without the flag", strings.Replace(validConfig, "https://abc12345.apps.dynatrace.com", "http://127.0.0.1:8099", 1), "must use https"},
		{"credentials in the URL", strings.Replace(validConfig, "https://abc12345", "https://user:pw@abc12345", 1), "without credentials"},
		{"missing secret file", strings.Replace(validConfig, "secrets/token.txt", "secrets/nope.txt", 1), "nope.txt is not a readable file"},
		{"unknown field", validConfig + "\nsurprise: true\n", "field surprise not found"},
		{"unknown tenant", strings.Replace(validConfig, "tenant: main", "tenant: other", 1), `"other" is not a configured tenant`},
		{"two rules", strings.Replace(validConfig, "match: { tag: { key: environment, value: production } }", "match: { all: true, k8sCluster: prod }", 1), "exactly one of tag"},
		{"bad environment kind", strings.Replace(validConfig, "kind: production", "kind: live", 1), "kind"},
		{"bad duration", validConfig + "refresh: { interval: soon }\n", "is not a positive duration"},
		{"both auth kinds", strings.Replace(validConfig, "auth: { platformTokenFile: secrets/token.txt }", "auth: { platformTokenFile: secrets/token.txt, oauth: { clientId: x, clientSecretFile: secrets/token.txt } }", 1), "exactly one of platformTokenFile, oauth"},
		{"bad tenant ID", strings.Replace(validConfig, "id: main", "id: Main Tenant", 1), "lowercase"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, err := LoadConfig(writeConfig(t, tc.body))
			if err == nil || !strings.Contains(err.Error(), tc.want) {
				t.Errorf("error = %v, want it to mention %q", err, tc.want)
			}
		})
	}
}

func TestLoadConfigAllowsTheLoopbackFakeAndOAuth(t *testing.T) {
	body := `
tenants:
  - id: fake
    url: http://127.0.0.1:8099
    example: true
    allowInsecureLoopback: true
    auth: { oauth: { clientId: dt0s02.EXAMPLE, clientSecretFile: secrets/token.txt, tokenUrl: "http://127.0.0.1:8099/sso/oauth2/token" } }
environments:
  - { id: production, name: Production, kind: production, tenant: fake, match: { all: true } }
`
	cfg, err := LoadConfig(writeConfig(t, body))
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.Tenants[0].Example || cfg.Tenants[0].Auth.OAuth.TokenURL != "http://127.0.0.1:8099/sso/oauth2/token" {
		t.Errorf("tenant = %+v", cfg.Tenants[0])
	}
}
