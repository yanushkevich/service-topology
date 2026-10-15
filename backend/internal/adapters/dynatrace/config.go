// Package dynatrace reads topology, health, and metrics from Dynatrace Smartscape on Grail through
// the platform query API (ADR-034, docs/DYNATRACE_CONNECTOR.md). It only reads from Dynatrace.
package dynatrace

import (
	"bytes"
	"errors"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"time"

	"go.yaml.in/yaml/v3"

	"servicetopology/backend/internal/domain"
)

// DefaultTokenURL is Dynatrace's SSO endpoint for OAuth client credentials.
const DefaultTokenURL = "https://sso.dynatrace.com/sso/oauth2/token"

// RequiredScopes are the read scopes a platform token or OAuth client needs (spec §3).
var RequiredScopes = []string{"storage:smartscape:read", "storage:entities:read", "storage:metrics:read", "storage:events:read", "storage:buckets:read"}

// Config is the operator's connector configuration (DYNATRACE_CONFIG_FILE). It names secret files
// and never holds secrets.
type Config struct {
	Tenants      []TenantConfig      `yaml:"tenants"`
	Environments []EnvironmentConfig `yaml:"environments"`
	Refresh      RefreshConfig       `yaml:"refresh"`
	Discovery    DiscoveryConfig     `yaml:"discovery"`
	Limits       LimitsConfig        `yaml:"limits"`
}

// TenantConfig is one Dynatrace environment ("tenant", to avoid a clash with ours).
type TenantConfig struct {
	ID  string `yaml:"id"`
	URL string `yaml:"url"`
	// Example marks a fake or demo tenant: its data is mock, never observed.
	Example bool `yaml:"example"`
	// AllowInsecureLoopback permits http:// on a loopback host (the fake tenant only).
	AllowInsecureLoopback bool       `yaml:"allowInsecureLoopback"`
	Auth                  AuthConfig `yaml:"auth"`
}

// AuthConfig is a platform token or an OAuth client, each read from a secret file.
type AuthConfig struct {
	PlatformTokenFile string       `yaml:"platformTokenFile"`
	OAuth             *OAuthConfig `yaml:"oauth"`
}

// OAuthConfig is an OAuth client for the client-credentials grant.
type OAuthConfig struct {
	ClientID         string `yaml:"clientId"`
	ClientSecretFile string `yaml:"clientSecretFile"`
	AccountURN       string `yaml:"accountUrn"`
	TokenURL         string `yaml:"tokenUrl"`
}

// EnvironmentConfig maps the services of one tenant that match Match onto one of our environments.
type EnvironmentConfig struct {
	ID     domain.EntityID `yaml:"id"`
	Name   string          `yaml:"name"`
	Kind   string          `yaml:"kind"`
	Tenant string          `yaml:"tenant"`
	Match  MatchRule       `yaml:"match"`
}

// MatchRule selects services by exactly one criterion.
type MatchRule struct {
	Tag           *TagRule `yaml:"tag"`
	K8sCluster    string   `yaml:"k8sCluster"`
	K8sNamespaces []string `yaml:"k8sNamespaces"`
	All           bool     `yaml:"all"`
}

// TagRule matches a service tag.
type TagRule struct {
	Key   string `yaml:"key"`
	Value string `yaml:"value"`
}

// RefreshConfig sets how often health and metrics are observed, and over what window.
type RefreshConfig struct {
	Interval      Duration `yaml:"interval"`
	MetricsWindow Duration `yaml:"metricsWindow"`
}

// DiscoveryConfig sets how far back structure is read.
type DiscoveryConfig struct {
	Window Duration `yaml:"window"`
}

// LimitsConfig bounds every query.
type LimitsConfig struct {
	MaxRecords   int      `yaml:"maxRecords"`
	QueryTimeout Duration `yaml:"queryTimeout"`
}

// Duration reads Go durations ("60s", "5m") from YAML.
type Duration struct{ time.Duration }

// UnmarshalYAML parses a duration string.
func (d *Duration) UnmarshalYAML(node *yaml.Node) error {
	v, err := time.ParseDuration(node.Value)
	if err != nil || v <= 0 {
		return fmt.Errorf("line %d: %q is not a positive duration (e.g. 60s)", node.Line, node.Value)
	}
	d.Duration = v
	return nil
}

var tenantID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,30}$`)

// LoadConfig reads and validates a configuration file. Relative secret paths resolve against the
// file's directory, and every secret file must exist (their contents are read by NewConnector).
func LoadConfig(path string) (*Config, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("dynatrace config: %w", err)
	}
	dec := yaml.NewDecoder(bytes.NewReader(raw))
	dec.KnownFields(true)
	var cfg Config
	if err := dec.Decode(&cfg); err != nil {
		return nil, fmt.Errorf("dynatrace config %s: %w", filepath.Base(path), err)
	}
	cfg.applyDefaults()
	cfg.resolvePaths(filepath.Dir(path))
	if err := cfg.validate(); err != nil {
		return nil, fmt.Errorf("dynatrace config %s: %w", filepath.Base(path), err)
	}
	return &cfg, nil
}

func (c *Config) applyDefaults() {
	defaults := []struct {
		field *Duration
		value time.Duration
	}{
		{&c.Refresh.Interval, time.Minute},
		{&c.Refresh.MetricsWindow, 5 * time.Minute},
		{&c.Discovery.Window, 24 * time.Hour},
		{&c.Limits.QueryTimeout, 30 * time.Second},
	}
	for _, d := range defaults {
		if d.field.Duration == 0 {
			d.field.Duration = d.value
		}
	}
	if c.Limits.MaxRecords == 0 {
		c.Limits.MaxRecords = 10000
	}
	for i := range c.Tenants {
		if o := c.Tenants[i].Auth.OAuth; o != nil && o.TokenURL == "" {
			o.TokenURL = DefaultTokenURL
		}
	}
}

func (c *Config) resolvePaths(dir string) {
	resolve := func(p *string) {
		if *p != "" && !filepath.IsAbs(*p) {
			*p = filepath.Join(dir, *p)
		}
	}
	for i := range c.Tenants {
		resolve(&c.Tenants[i].Auth.PlatformTokenFile)
		if o := c.Tenants[i].Auth.OAuth; o != nil {
			resolve(&o.ClientSecretFile)
		}
	}
}

// validate reports every problem at once, like the process configuration.
func (c *Config) validate() error {
	var errs []error
	bad := func(format string, args ...any) { errs = append(errs, fmt.Errorf(format, args...)) }
	if len(c.Tenants) == 0 {
		bad("tenants: at least one is required")
	}
	tenants := map[string]bool{}
	for i, t := range c.Tenants {
		at := fmt.Sprintf("tenants[%d]", i)
		if !tenantID.MatchString(t.ID) {
			bad("%s.id: %q must be 1-31 lowercase letters, digits, or '-'", at, t.ID)
		}
		if tenants[t.ID] {
			bad("%s.id: %q is used twice", at, t.ID)
		}
		tenants[t.ID] = true
		if err := checkURL(t.URL, t.AllowInsecureLoopback); err != nil {
			bad("%s.url: %v", at, err)
		}
		errs = append(errs, t.Auth.validate(at, t.AllowInsecureLoopback)...)
	}
	if len(c.Environments) == 0 {
		bad("environments: at least one is required")
	}
	envs := map[string]bool{}
	for i, e := range c.Environments {
		at := fmt.Sprintf("environments[%d]", i)
		if issues := domain.ValidateEntityFields(domain.KindEnvironment, &domain.Environment{ID: e.ID, Name: e.Name, Kind: e.Kind}); len(issues) > 0 {
			bad("%s: %s", at, issues[0].Message)
		}
		if envs[e.ID] {
			bad("%s.id: %q is used twice", at, e.ID)
		}
		envs[e.ID] = true
		if !tenants[e.Tenant] {
			bad("%s.tenant: %q is not a configured tenant", at, e.Tenant)
		}
		if n := e.Match.criteria(); n != 1 {
			bad("%s.match: needs exactly one of tag, k8sCluster, k8sNamespaces, all (has %d)", at, n)
		}
		if t := e.Match.Tag; t != nil && (t.Key == "" || t.Value == "") {
			bad("%s.match.tag: needs a key and a value", at)
		}
	}
	if c.Limits.MaxRecords < 1 || c.Limits.MaxRecords > 100000 {
		bad("limits.maxRecords: %d must be between 1 and 100000", c.Limits.MaxRecords)
	}
	return errors.Join(errs...)
}

func (a AuthConfig) validate(at string, allowInsecureLoopback bool) []error {
	var errs []error
	hasToken, hasOAuth := a.PlatformTokenFile != "", a.OAuth != nil
	if hasToken == hasOAuth {
		return []error{fmt.Errorf("%s.auth: set exactly one of platformTokenFile, oauth", at)}
	}
	if hasToken {
		if err := checkSecretFile(a.PlatformTokenFile); err != nil {
			errs = append(errs, fmt.Errorf("%s.auth.platformTokenFile: %w", at, err))
		}
		return errs
	}
	if a.OAuth.ClientID == "" {
		errs = append(errs, fmt.Errorf("%s.auth.oauth.clientId: is required", at))
	}
	if err := checkSecretFile(a.OAuth.ClientSecretFile); err != nil {
		errs = append(errs, fmt.Errorf("%s.auth.oauth.clientSecretFile: %w", at, err))
	}
	if err := checkURL(a.OAuth.TokenURL, allowInsecureLoopback); err != nil {
		errs = append(errs, fmt.Errorf("%s.auth.oauth.tokenUrl: %w", at, err))
	}
	return errs
}

func (m MatchRule) criteria() int {
	n := 0
	for _, set := range []bool{m.Tag != nil, m.K8sCluster != "", len(m.K8sNamespaces) > 0, m.All} {
		if set {
			n++
		}
	}
	return n
}

// checkURL accepts https, or http on a loopback host when explicitly allowed (the fake tenant).
func checkURL(raw string, allowInsecureLoopback bool) error {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return fmt.Errorf("%q must be an absolute URL without credentials, query, or fragment", raw)
	}
	switch {
	case u.Scheme == "https":
		return nil
	case u.Scheme == "http" && allowInsecureLoopback && isLoopbackHost(u.Hostname()):
		return nil
	default:
		return fmt.Errorf("%q must use https", raw)
	}
}

func isLoopbackHost(host string) bool {
	if host == "localhost" {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

// checkSecretFile reports a missing secret without revealing its contents.
func checkSecretFile(path string) error {
	if path == "" {
		return errors.New("is required")
	}
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return fmt.Errorf("%s is not a readable file", filepath.Base(path))
	}
	return nil
}

// readSecret reads a secret file, trimmed. Errors never include the contents.
func readSecret(path string) (string, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("secret file %s cannot be read", filepath.Base(path))
	}
	secret := strings.TrimSpace(string(raw))
	if secret == "" {
		return "", fmt.Errorf("secret file %s is empty", filepath.Base(path))
	}
	return secret, nil
}

// environmentsOf returns the environments of a tenant, in configuration order (first match wins).
func (c *Config) environmentsOf(tenant string) []EnvironmentConfig {
	return slices.DeleteFunc(slices.Clone(c.Environments), func(e EnvironmentConfig) bool { return e.Tenant != tenant })
}
