package dynatrace

import (
	"context"
	"sync"
	"time"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// Metrics on calls (Milestone 15.2, docs/DYNATRACE_CONNECTOR.md §5): read from spans every
// callMetrics.interval, reused by the refreshes in between, and isolated: a failure never stops the
// health and service-metric refresh. States are keyed by callKey, which discovery puts in each
// service-to-service relationship's link.

// callCache holds each tenant's last call states and when they were read.
type callCache struct {
	mu     sync.Mutex
	states map[string]map[string]ports.ObservedState
	at     map[string]time.Time
}

// callKey is the link ID of the calls from one Dynatrace service to another.
func callKey(caller, callee string) string { return "calls:" + caller + "->" + callee }

// observeCalls adds the tenant's call states to states, reading spans when the last read is an
// interval old. It returns a warning instead of failing; cached states older than three intervals
// are dropped so stale call metrics are never shown.
func (c *Connector) observeCalls(ctx context.Context, t tenantClient, now time.Time, states map[string]ports.ObservedState) string {
	if !c.cfg.CallMetrics.Enabled {
		return ""
	}
	interval := c.cfg.CallMetrics.Interval.Duration
	c.calls.mu.Lock()
	defer c.calls.mu.Unlock()
	if c.calls.states == nil {
		c.calls.states, c.calls.at = map[string]map[string]ports.ObservedState{}, map[string]time.Time{}
	}
	warning := ""
	if last, ok := c.calls.at[t.cfg.ID]; !ok || now.Sub(last) >= interval {
		res, err := t.client.run(ctx, queryCallMetrics, c.cfg, now)
		if err == nil {
			c.calls.states[t.cfg.ID] = callStates(res.Records, interval, now.UTC().Format(time.RFC3339), t.cfg.Example)
			c.calls.at[t.cfg.ID] = now
		} else {
			c.log.WarnContext(ctx, "dynatrace call metrics failed", "tenant", t.cfg.ID, "error", errorMessage(err))
			warning = "Metrics on calls (tenant " + t.cfg.ID + "): " + errorMessage(err)
		}
	}
	if last, ok := c.calls.at[t.cfg.ID]; ok && now.Sub(last) > 3*interval {
		delete(c.calls.states, t.cfg.ID)
	}
	for key, state := range c.calls.states[t.cfg.ID] {
		states[key] = state
	}
	return warning
}

// callStates converts call-metrics rows: n calls and f failures over the window, rt the average
// client-span duration in nanoseconds.
func callStates(records []record, window time.Duration, observedAt string, example bool) map[string]ports.ObservedState {
	out := map[string]ports.ObservedState{}
	for _, r := range records {
		caller, callee := r.str("caller"), r.str("callee")
		n, hasCount := r.num("n")
		if caller == "" || callee == "" || !hasCount || n <= 0 {
			continue
		}
		m := &domain.Metrics{IsSimulated: example, ObservedAt: &observedAt}
		perSecond := n / window.Seconds()
		m.ThroughputPerSecond = &perSecond
		if f, ok := r.num("f"); ok {
			percent := f / n * 100
			m.ErrorRatePercent = &percent
		}
		if rt, ok := r.num("rt"); ok {
			ms := rt / 1e6
			m.LatencyMs = &ms
		}
		out[callKey(caller, callee)] = ports.ObservedState{Metrics: m}
	}
	return out
}
