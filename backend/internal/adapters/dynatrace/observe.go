package dynatrace

import (
	"time"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// observeData is one tenant's refresh query results.
type observeData struct {
	Services, K8s, Databases, Hosts, Metrics, Problems []record
}

// problemHealth maps a Davis problem category to health (spec §1). Unlisted categories degrade.
var problemHealth = map[string]string{
	"AVAILABILITY":           "unavailable",
	"ERROR":                  "degraded",
	"SLOWDOWN":               "degraded",
	"RESOURCE_CONTENTION":    "degraded",
	"CUSTOM_ALERT":           "degraded",
	"MONITORING_UNAVAILABLE": "unknown",
}

// healthRank orders health from best to worst; an entity shows its worst open problem.
var healthRank = map[string]int{"healthy": 0, "unknown": 1, "degraded": 2, "unavailable": 3}

// observeTenant maps one tenant's results to states keyed by Smartscape ID. Every node present is
// healthy unless a problem affects it; services also get metrics over the window.
func observeTenant(data observeData, window time.Duration, observedAt string, example bool) map[string]ports.ObservedState {
	out := map[string]ports.ObservedState{}
	byClassic := map[string]string{} // classic ID → Smartscape ID
	for _, group := range [][]record{data.Services, data.K8s, data.Databases, data.Hosts} {
		for _, r := range group {
			id := r.str("id")
			if id == "" {
				continue
			}
			out[id] = ports.ObservedState{Health: "healthy"}
			if classic := r.str("id_classic"); classic != "" {
				byClassic[classic] = id
			}
		}
	}
	smartscapeID := func(id string) string {
		if s, ok := byClassic[id]; ok {
			return s
		}
		return id
	}
	for _, r := range data.Metrics {
		// The documented join is the Smartscape ID; a classic ID still maps through id_classic.
		id := r.str("dt.smartscape.service")
		if id == "" {
			id = smartscapeID(r.str("dt.entity.service"))
		}
		if id == "" {
			continue
		}
		state := out[id]
		state.Metrics = serviceMetrics(r, window, observedAt, example)
		if state.Health == "" {
			state.Health = "healthy"
		}
		out[id] = state
	}
	for _, r := range data.Problems {
		health, ok := problemHealth[r.str("event.category")]
		if !ok {
			health = "degraded"
		}
		for _, affected := range r.strs("affected_entity_ids") {
			id := smartscapeID(affected)
			state := out[id]
			if healthRank[health] >= healthRank[state.Health] {
				state.Health = health
			}
			state.Problems = append(state.Problems, r.str("display_id"))
			out[id] = state
		}
	}
	return out
}

// serviceMetrics converts one timeseries row: response time is in microseconds, counts are totals
// over the window.
func serviceMetrics(r record, window time.Duration, observedAt string, example bool) *domain.Metrics {
	m := &domain.Metrics{IsSimulated: example, ObservedAt: &observedAt}
	if rt, ok := r.num("rt"); ok {
		ms := rt / 1000
		m.LatencyMs = &ms
	}
	n, hasCount := r.num("n")
	if hasCount {
		perSecond := n / window.Seconds()
		m.ThroughputPerSecond = &perSecond
	}
	if f, ok := r.num("f"); ok && hasCount && n > 0 {
		percent := f / n * 100
		m.ErrorRatePercent = &percent
	}
	return m
}
