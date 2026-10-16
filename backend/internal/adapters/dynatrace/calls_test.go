package dynatrace_test

import (
	"context"
	"net/http"
	"slices"
	"testing"
	"time"

	"servicetopology/backend/internal/adapters/dynatrace"
)

// Metrics on calls from spans (Milestone 15.2): opt-in, read once per interval, isolated.

const (
	storefront = "SERVICE-BDAF1ECA33D4619E"
	checkout   = "SERVICE-F0B89EE9977FB93B"
	payment    = "SERVICE-30E45F0274EFB653"
)

func count(names []string, name string) int {
	n := 0
	for _, s := range names {
		if s == name {
			n++
		}
	}
	return n
}

func TestCallMetricsAreObservedOncePerInterval(t *testing.T) {
	tenant, conn, _ := fakeTenant(t, false)
	conn.Config().CallMetrics = dynatrace.CallMetricsConfig{Enabled: true, Interval: dur(5 * time.Minute)}
	clock := time.Date(2026, 10, 15, 8, 45, 0, 0, time.UTC)
	conn.Now = func() time.Time { return clock }

	obs, err := conn.Observe(context.Background())
	if err != nil || len(obs.Warnings) != 0 {
		t.Fatalf("observe: %v %v", err, obs.Warnings)
	}
	state := obs.Tenants["main"]["calls:"+storefront+"->"+checkout]
	m := state.Metrics
	// 36,000 calls in 5 minutes, 18 failed, 45 ms (sent as a string, as Grail may send longs).
	if m == nil || *m.ThroughputPerSecond != 120 || *m.ErrorRatePercent != 0.05 || *m.LatencyMs != 45 || m.IsSimulated || state.Health != "" {
		t.Fatalf("storefront → checkout = %+v %+v", state, m)
	}
	clock = clock.Add(time.Minute)
	obs, _ = conn.Observe(context.Background())
	if _, ok := obs.Tenants["main"]["calls:"+checkout+"->"+payment]; !ok {
		t.Error("a refresh within the interval must reuse the last call metrics")
	}
	if n := count(tenant.Executed, "call-metrics"); n != 1 {
		t.Errorf("call-metrics ran %d times in one interval, want 1", n)
	}
	clock = clock.Add(5 * time.Minute)
	_, _ = conn.Observe(context.Background())
	if n := count(tenant.Executed, "call-metrics"); n != 2 {
		t.Errorf("call-metrics ran %d times after the interval, want 2", n)
	}
}

func TestCallMetricsAreOffByDefault(t *testing.T) {
	tenant, conn, _ := fakeTenant(t, false)
	if _, err := conn.Observe(context.Background()); err != nil {
		t.Fatal(err)
	}
	checks := conn.Check(context.Background())
	if slices.Contains(tenant.Executed, "call-metrics") || len(checks) != 11 || conn.Describe().CallMetricsIntervalSeconds != 0 {
		t.Errorf("executed %v, %d checks", tenant.Executed, len(checks))
	}
	conn.Config().CallMetrics = dynatrace.CallMetricsConfig{Enabled: true, Interval: dur(5 * time.Minute)}
	if n := len(conn.Check(context.Background())); n != 12 || conn.Describe().CallMetricsIntervalSeconds != 300 {
		t.Errorf("enabled: %d checks", n)
	}
}

func TestACallMetricsFailureLeavesTheRefreshRunning(t *testing.T) {
	tenant, conn, _ := fakeTenant(t, false)
	conn.Config().CallMetrics = dynatrace.CallMetricsConfig{Enabled: true, Interval: dur(5 * time.Minute)}
	tenant.Fail = map[string]int{"call-metrics": http.StatusBadRequest}
	obs, err := conn.Observe(context.Background())
	if err != nil {
		t.Fatalf("the refresh must not fail: %v", err)
	}
	if len(obs.Warnings) != 1 || obs.Warnings[0] != "Metrics on calls (tenant main): Dynatrace rejected the query: Failed by the fake tenant" {
		t.Errorf("warnings = %v", obs.Warnings)
	}
	if s := obs.Tenants["main"][payment]; s.Health != "degraded" || s.Metrics == nil {
		t.Errorf("service states must still be observed: %+v", s)
	}
}

func TestExampleTenantCallMetricsStaySimulated(t *testing.T) {
	_, conn, _ := fakeTenant(t, false, func(c *dynatrace.Config) {
		c.Tenants[0].Example = true
		c.CallMetrics = dynatrace.CallMetricsConfig{Enabled: true, Interval: dur(5 * time.Minute)}
	})
	obs, _ := conn.Observe(context.Background())
	if m := obs.Tenants["main"]["calls:"+checkout+"->"+payment].Metrics; m == nil || !m.IsSimulated {
		t.Errorf("example call metrics = %+v", m)
	}
}
