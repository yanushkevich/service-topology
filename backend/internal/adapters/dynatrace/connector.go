package dynatrace

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"slices"
	"sync"
	"time"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// SourceName is the source type recorded on the entities the connector creates.
const SourceName = "dynatrace"

// maxParallelQueries bounds the queries one tenant runs at once.
const maxParallelQueries = 4

// Connector implements ports.TopologySource for every configured tenant.
type Connector struct {
	cfg     *Config
	tenants []tenantClient
	log     *slog.Logger
	calls   callCache
	// Now is the clock (tests replace it).
	Now func() time.Time
}

type tenantClient struct {
	cfg    TenantConfig
	client *grailClient
}

var _ ports.TopologySource = (*Connector)(nil)

// NewConnector reads every tenant's secret and prepares its client. httpClient may be nil; the
// connector never follows redirects, so a token is never sent to another host.
func NewConnector(cfg *Config, httpClient *http.Client, log *slog.Logger) (*Connector, error) {
	if httpClient == nil {
		httpClient = &http.Client{}
	}
	noRedirects := *httpClient
	noRedirects.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	c := &Connector{cfg: cfg, log: log, Now: time.Now}
	for _, t := range cfg.Tenants {
		base, err := url.Parse(t.URL)
		if err != nil {
			return nil, err
		}
		auth, err := newTokenSource(t, &noRedirects, func() time.Time { return c.Now() })
		if err != nil {
			return nil, err
		}
		c.tenants = append(c.tenants, tenantClient{cfg: t, client: &grailClient{
			base: base, http: &noRedirects, auth: auth, maxRecords: cfg.Limits.MaxRecords, timeout: cfg.Limits.QueryTimeout.Duration,
		}})
	}
	return c, nil
}

// Name returns SourceName.
func (c *Connector) Name() string { return SourceName }

// Config returns the configuration (no secrets).
func (c *Connector) Config() *Config { return c.cfg }

// IsExample reports whether any tenant is an example tenant; its data is then never observed.
func (c *Connector) IsExample() bool {
	return slices.ContainsFunc(c.cfg.Tenants, func(t TenantConfig) bool { return t.Example })
}

// Describe returns the configuration without secrets: tenant hosts, auth kinds, environment rules.
func (c *Connector) Describe() ports.SourceDescription {
	out := ports.SourceDescription{IsExample: c.IsExample(), RefreshIntervalSeconds: int(c.cfg.Refresh.Interval.Seconds())}
	if c.cfg.CallMetrics.Enabled {
		out.CallMetricsIntervalSeconds = int(c.cfg.CallMetrics.Interval.Seconds())
	}
	for _, t := range c.cfg.Tenants {
		auth := "platform-token"
		if t.Auth.OAuth != nil {
			auth = "oauth"
		}
		host := t.URL
		if u, err := url.Parse(t.URL); err == nil {
			host = u.Host
		}
		out.Tenants = append(out.Tenants, ports.SourceTenant{ID: t.ID, Host: host, Auth: auth, IsExample: t.Example})
	}
	for _, e := range c.cfg.Environments {
		out.Environments = append(out.Environments, ports.SourceEnvironment{ID: e.ID, Name: e.Name, Kind: e.Kind, Tenant: e.Tenant, Match: e.Match.describe()})
	}
	return out
}

// Discover runs the structure queries on every tenant and maps them. Any failed query fails the
// whole discovery: a partial one would read as services having disappeared.
func (c *Connector) Discover(ctx context.Context, aliases map[string]domain.EntityID) (*ports.Discovery, error) {
	now := c.Now()
	mapper := newDiscoveryMapper(c.cfg, aliases, now.UTC().Format(time.RFC3339))
	for _, t := range c.tenants {
		results, err := c.runAll(ctx, t, structureQueries, now)
		if err != nil {
			return nil, err
		}
		data := tenantData{
			Services: results[queryServices.Name].Records, Calls: results[queryServiceCalls.Name].Records,
			BelongsTo: results[queryServiceBelongsTo.Name].Records, K8s: results[queryK8sNodes.Name].Records,
			Databases: results[queryDatabases.Name].Records, Hosts: results[queryHosts.Name].Records,
			RunsOn: results[queryServiceRunsOn.Name].Records, Publish: results[queryMessagingPublish.Name].Records,
			Receive: results[queryMessagingReceive.Name].Records,
		}
		for _, q := range structureQueries {
			if results[q.Name].Truncated {
				data.Truncated = append(data.Truncated, q.Name)
			}
		}
		mapper.addTenant(t.cfg.ID, data)
	}
	out := mapper.result()
	out.IsExample = c.IsExample()
	return &out, nil
}

// Observe runs the refresh queries on every tenant.
func (c *Connector) Observe(ctx context.Context) (*ports.Observation, error) {
	now := c.Now()
	observedAt := now.UTC().Format(time.RFC3339)
	out := &ports.Observation{ObservedAt: observedAt, IsExample: c.IsExample(), Tenants: map[string]map[string]ports.ObservedState{}}
	for _, t := range c.tenants {
		results, err := c.runAll(ctx, t, observeQueries, now)
		if err != nil {
			return nil, err
		}
		out.Tenants[t.cfg.ID] = observeTenant(observeData{
			Services: results[queryServices.Name].Records, K8s: results[queryK8sNodes.Name].Records,
			Databases: results[queryDatabases.Name].Records, Hosts: results[queryHosts.Name].Records,
			Metrics:  results[queryServiceMetrics.Name].Records,
			Problems: results[queryProblems.Name].Records,
		}, c.cfg.Refresh.MetricsWindow.Duration, observedAt, t.cfg.Example)
		if warning := c.observeCalls(ctx, t, now, out.Tenants[t.cfg.ID]); warning != "" {
			out.Warnings = append(out.Warnings, warning)
		}
	}
	return out, nil
}

// Check runs every query once on every tenant and reports what came back, never failing as a whole.
func (c *Connector) Check(ctx context.Context) []ports.SourceCheck {
	now := c.Now()
	var out []ports.SourceCheck
	for _, t := range c.tenants {
		for _, q := range checkQueries(c.cfg) {
			start := time.Now()
			res, err := t.client.run(ctx, q, c.cfg, now)
			check := ports.SourceCheck{Tenant: t.cfg.ID, Query: q.Name, DurationMs: time.Since(start).Milliseconds()}
			if err != nil {
				check.Message = errorMessage(err)
				var qe *QueryError
				if errors.As(err, &qe) {
					check.MissingScopes = qe.MissingScopes
				}
			} else {
				check.OK = true
				check.Records = len(res.Records)
				check.ScannedBytes = res.ScannedBytes
				check.MissingFields = missingFields(q, res.Records)
				if res.Truncated {
					check.Message = "The result hit limits.maxRecords."
				}
			}
			out = append(out, check)
		}
	}
	return out
}

// runAll runs queries on one tenant in parallel, so a preview stays within the server's write
// timeout. It logs each query (name, records, scanned bytes; never results) and returns the first
// failure in query order.
func (c *Connector) runAll(ctx context.Context, t tenantClient, queries []Query, now time.Time) (map[string]*queryResult, error) {
	results := make([]*queryResult, len(queries))
	errs := make([]error, len(queries))
	var wg sync.WaitGroup
	slots := make(chan struct{}, maxParallelQueries)
	for i, q := range queries {
		wg.Go(func() {
			slots <- struct{}{}
			defer func() { <-slots }()
			start := time.Now()
			results[i], errs[i] = t.client.run(ctx, q, c.cfg, now)
			if errs[i] != nil {
				c.log.WarnContext(ctx, "dynatrace query failed", "tenant", t.cfg.ID, "query", q.Name, "error", errorMessage(errs[i]))
				return
			}
			c.log.DebugContext(ctx, "dynatrace query", "tenant", t.cfg.ID, "query", q.Name, "records", len(results[i].Records),
				"scannedBytes", results[i].ScannedBytes, "ms", time.Since(start).Milliseconds())
		})
	}
	wg.Wait()
	out := map[string]*queryResult{}
	for i, q := range queries {
		if errs[i] != nil {
			return nil, &SourceError{Tenant: t.cfg.ID, Query: q.Name, Err: errs[i]}
		}
		out[q.Name] = results[i]
	}
	return out, nil
}

// SourceError names the tenant and query that failed. Its message is safe to show.
type SourceError struct {
	Tenant, Query string
	Err           error
}

func (e *SourceError) Error() string {
	return "Dynatrace tenant " + e.Tenant + ", query " + e.Query + ": " + errorMessage(e.Err)
}

// Unwrap lets callers match both the cause and ports.ErrSourceFailed.
func (e *SourceError) Unwrap() []error { return []error{e.Err, ports.ErrSourceFailed} }

// errorMessage returns a QueryError's safe message, or a fixed text for anything else.
func errorMessage(err error) string {
	var qe *QueryError
	if errors.As(err, &qe) {
		return qe.Message
	}
	if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		return "the query timed out"
	}
	return "the query failed"
}

// missingFields lists the query's expected fields that no record carries (none without records).
func missingFields(q Query, records []record) []string {
	if len(records) == 0 {
		return nil
	}
	var out []string
	for _, f := range q.Fields {
		if !slices.ContainsFunc(records, func(r record) bool { _, ok := r[f]; return ok }) {
			out = append(out, f)
		}
	}
	return out
}
