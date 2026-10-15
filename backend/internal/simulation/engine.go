// Package simulation is a port of apps/web/src/simulation/engine.ts: a deterministic topology
// simulation over an immutable baseline. Same baseline, seed, and actions → same state as the
// client (fixtures/conformance/simulation). Everything it produces is simulated and labeled so. It
// imports only the domain.
package simulation

import (
	"fmt"
	"math"
	"math/big"
	"sort"
	"strings"
	"time"

	"servicetopology/backend/internal/domain"
)

const (
	// TickSeconds is the simulated time per tick.
	TickSeconds = 10
	// MaxEvents is how many events a state keeps (oldest dropped first).
	MaxEvents  = 500
	anomalyOn  = 1.35
	anomalyOff = 1.2
)

// Cause attributes a propagated change.
type Cause struct {
	RuleID            string `json:"ruleId"`
	RootID            string `json:"rootId"`
	CauseID           string `json:"causeId"`
	ViaRelationshipID string `json:"viaRelationshipId,omitempty"`
}

// Event is a simulated event. IsSimulated is always true.
type Event struct {
	ID          string `json:"id"`
	Tick        int    `json:"tick"`
	At          string `json:"at"`
	Type        string `json:"type"`
	EntityKind  string `json:"entityKind"`
	EntityID    string `json:"entityId"`
	From        string `json:"from,omitempty"`
	To          string `json:"to,omitempty"`
	Cause       *Cause `json:"cause,omitempty"`
	Note        string `json:"note,omitempty"`
	IsSimulated bool   `json:"isSimulated"`
}

// ActiveFailure is an injected failure.
type ActiveFailure struct {
	EntityID      string `json:"entityId"`
	Mode          string `json:"mode"`
	InjectedTick  int    `json:"injectedTick"`
	RecoverAtTick *int   `json:"recoverAtTick,omitempty"`
}

// State is the simulation state. Baseline is never mutated.
type State struct {
	Baseline  *domain.TopologyData `json:"-"`
	Data      *domain.TopologyData `json:"data"`
	Seed      uint32               `json:"seed"`
	Tick      int                  `json:"tick"`
	Clock     string               `json:"clock"`
	RNG       uint32               `json:"rng"`
	Drift     map[string]float64   `json:"drift"`
	Anomalies []string             `json:"anomalies"`
	Failures  []ActiveFailure      `json:"failures"`
	Impacts   []domain.Impact      `json:"impacts"`
	Events    []Event              `json:"events"`
	EventSeq  int                  `json:"eventSeq"`
	index     *domain.Index
}

// nextRandom is mulberry32 on uint32 arithmetic (identical to the client's Math.imul version).
func nextRandom(state uint32) (float64, uint32) {
	a := state + 0x6d2b79f5
	t := a
	t = (t ^ (t >> 15)) * (t | 1)
	t ^= t + (t^(t>>7))*(t|61)
	return float64(t^(t>>14)) / 4294967296, a
}

// jsRound is Math.round: nearest integer, ties toward +∞.
//
// Explicit float64 conversions force IEEE rounding of each product: the Go spec allows fusing
// x*y±z into one FMA instruction (arm64 does), which would differ from JavaScript's results.
func jsRound(x float64) float64 {
	f := math.Floor(x)
	if float64(x-f) >= 0.5 {
		return f + 1
	}
	return f
}

// jsISO formats like Date.prototype.toISOString (UTC, milliseconds).
func jsISO(t time.Time) string { return t.UTC().Format("2006-01-02T15:04:05.000Z") }

func parseTime(s string) (time.Time, bool) {
	t, err := time.Parse(time.RFC3339Nano, s)
	return t, err == nil
}

func addSeconds(iso string, seconds int) string {
	t, _ := parseTime(iso)
	return jsISO(t.Add(time.Duration(seconds) * time.Second))
}

// jsToFixed2 is Number.prototype.toFixed(2): the exact binary value rounded half up.
func jsToFixed2(x float64) string {
	exact := new(big.Float).SetPrec(200).SetFloat64(x).Text('f', 80)
	intPart, frac, _ := strings.Cut(exact, ".")
	frac += strings.Repeat("0", 3)
	keep, rest := frac[:2], frac[2:]
	value := new(big.Int)
	value.SetString(intPart+keep, 10)
	if rest[0] >= '5' { // ties and above round up (larger n), like toFixed
		value.Add(value, big.NewInt(1))
	}
	s := value.String()
	for len(s) < 3 {
		s = "0" + s
	}
	return s[:len(s)-2] + "." + s[len(s)-2:]
}

func latestTimestamp(data *domain.TopologyData) string {
	var times []string
	add := func(ts ...*string) {
		for _, t := range ts {
			if t != nil {
				if _, ok := parseTime(*t); ok {
					times = append(times, *t)
				}
			}
		}
	}
	obs := func(m *domain.Metrics) *string {
		if m == nil {
			return nil
		}
		return m.ObservedAt
	}
	for i := range data.ServiceInstances {
		u := data.ServiceInstances[i].UpdatedAt
		add(&u, obs(data.ServiceInstances[i].Metrics))
	}
	for i := range data.Resources {
		add(data.Resources[i].UpdatedAt, obs(data.Resources[i].Metrics))
	}
	for i := range data.Relationships {
		u := data.Relationships[i].UpdatedAt
		add(&u, obs(data.Relationships[i].Metrics))
	}
	if len(times) == 0 {
		return "2026-01-01T00:00:00.000Z"
	}
	sort.Strings(times)
	return times[len(times)-1]
}

var statusRank = map[string]int{"active": 0, "unknown": 1, "degraded": 2, "inactive": 3}

func worseStatus(a, b string) string {
	if statusRank[b] > statusRank[a] {
		return b
	}
	return a
}

func f64(v float64) *float64 { return &v }

func scaleMetrics(m *domain.Metrics, factor float64, clock, overlay string) *domain.Metrics {
	if m == nil {
		return nil
	}
	// Observed metrics (a topology source, ADR-034) stay observed: no drift, no relabelling. Only a
	// simulated failure that changes the entity replaces them, with simulated values.
	if !m.IsSimulated && overlay == "none" {
		observed := *m
		return &observed
	}
	round := func(v float64) float64 { return jsRound(float64(v*10)) / 10 }
	out := &domain.Metrics{IsSimulated: true, ObservedAt: &clock}
	if m.LatencyMs != nil {
		k := 1.0
		if overlay == "degraded" {
			k = 3
		}
		out.LatencyMs = f64(round(float64(float64(*m.LatencyMs*factor) * k)))
	}
	if m.ThroughputPerSecond != nil {
		if overlay == "down" {
			out.ThroughputPerSecond = f64(0)
		} else {
			out.ThroughputPerSecond = f64(round(float64(*m.ThroughputPerSecond * float64(2-factor))))
		}
	}
	if m.ErrorRatePercent != nil {
		if overlay == "down" {
			out.ErrorRatePercent = f64(100)
		} else {
			extra := 0.0
			if overlay == "degraded" {
				extra = 5
			}
			out.ErrorRatePercent = f64(math.Min(100, round(*m.ErrorRatePercent+extra)))
		}
	}
	return out
}

func driftOf(drift map[string]float64, id string) float64 {
	if v, ok := drift[id]; ok {
		return v
	}
	return 1
}

// derive recomputes the rendered data from baseline + failures + drift.
func derive(ix *domain.Index, failures []ActiveFailure, drift map[string]float64, clock string) (*domain.TopologyData, []domain.Impact) {
	baseline := ix.Data
	roots := make([]domain.FailureRoot, len(failures))
	for i, f := range failures {
		roots[i] = domain.FailureRoot{EntityID: f.EntityID, Mode: f.Mode}
	}
	impacts := ix.AnalyzeImpact(roots)
	override := map[string]string{}
	get := func(id string) string {
		if v, ok := override[id]; ok {
			return v
		}
		return "healthy"
	}
	for _, f := range failures {
		override[f.EntityID] = domain.WorseHealth(get(f.EntityID), f.Mode)
	}
	for _, im := range impacts {
		override[im.EntityID] = domain.WorseHealth(get(im.EntityID), im.Effect)
	}
	overlayFor := func(base, now string) string {
		switch {
		case now == base:
			return "none"
		case now == "unavailable":
			return "down"
		}
		return "degraded"
	}
	final := map[string]string{}
	out := *baseline
	out.ServiceInstances = make([]domain.ServiceInstance, len(baseline.ServiceInstances))
	for i, inst := range baseline.ServiceInstances {
		health := domain.WorseHealth(inst.Health, get(inst.ID))
		final[inst.ID] = health
		changed := health != inst.Health
		m := scaleMetrics(inst.Metrics, driftOf(drift, inst.ID), clock, overlayFor(inst.Health, health))
		inst.Health = health
		if m != nil {
			inst.Metrics = m
		}
		if changed {
			inst.UpdatedAt = clock
		}
		out.ServiceInstances[i] = inst
	}
	out.Resources = make([]domain.InfrastructureResource, len(baseline.Resources))
	for i, r := range baseline.Resources {
		base := "unknown"
		if r.Health != nil {
			base = *r.Health
		}
		var health *string
		if o, ok := override[r.ID]; ok {
			h := domain.WorseHealth(base, o)
			health = &h
		} else {
			health = r.Health
		}
		if health != nil {
			final[r.ID] = *health
		}
		changed := (health == nil) != (r.Health == nil) || (health != nil && r.Health != nil && *health != *r.Health)
		overlay := "none"
		if health != nil && changed {
			overlay = overlayFor(base, *health)
		}
		m := scaleMetrics(r.Metrics, driftOf(drift, r.ID), clock, overlay)
		r.Health = health
		if m != nil {
			r.Metrics = m
		}
		if changed {
			c := clock
			r.UpdatedAt = &c
		}
		out.Resources[i] = r
	}
	out.Relationships = make([]domain.CommunicationRelationship, len(baseline.Relationships))
	for i, r := range baseline.Relationships {
		source, sOK := final[r.SourceEntityID]
		target, tOK := final[r.TargetEntityID]
		_, sOver := override[r.SourceEntityID]
		_, tOver := override[r.TargetEntityID]
		status := r.Status
		if sOK && sOver && source == "unavailable" {
			status = worseStatus(status, "inactive")
		} else if tOK && tOver && (target == "unavailable" || target == "degraded") {
			status = worseStatus(status, "degraded")
		}
		changed := status != r.Status
		overlay := "none"
		if changed {
			overlay = "degraded"
			if status == "inactive" {
				overlay = "down"
			}
		}
		m := scaleMetrics(r.Metrics, driftOf(drift, r.ID), clock, overlay)
		r.Status = status
		if m != nil {
			r.Metrics = m
		}
		if changed {
			r.UpdatedAt = clock
		}
		out.Relationships[i] = r
	}
	return &out, impacts
}

type rootEvent struct {
	Type, EntityKind, EntityID, From, To, Note string
}

func changeEvents(before, after *domain.TopologyData, impacts []domain.Impact, failures []ActiveFailure, tick int, at string, startSeq int, root *rootEvent) []Event {
	var events []Event
	if root != nil {
		events = append(events, Event{Tick: tick, At: at, Type: root.Type, EntityKind: root.EntityKind, EntityID: root.EntityID, From: root.From, To: root.To, Note: root.Note, IsSimulated: true})
	}
	impactByID := map[string]domain.Impact{}
	for _, im := range impacts {
		impactByID[im.EntityID] = im
	}
	rootIDs := map[string]bool{}
	for _, f := range failures {
		rootIDs[f.EntityID] = true
	}
	for _, c := range domain.DiffTopology(before, after) {
		switch c.Type {
		case "health-changed":
			if root != nil && c.ID == root.EntityID {
				continue
			}
			e := Event{Tick: tick, At: at, Type: "health-changed", EntityKind: c.Kind, EntityID: c.ID, From: c.From, To: c.To, IsSimulated: true}
			if im, ok := impactByID[c.ID]; ok && !rootIDs[c.ID] {
				e.Cause = &Cause{RuleID: im.RuleID, RootID: im.RootID, CauseID: im.CauseID, ViaRelationshipID: im.ViaRelationshipID}
			} else {
				e.Note = "Returned to its recorded state"
			}
			events = append(events, e)
		case "status-changed":
			events = append(events, Event{Tick: tick, At: at, Type: "status-changed", EntityKind: domain.KindRelationship, EntityID: c.ID, From: c.From, To: c.To, IsSimulated: true})
		}
	}
	for i := range events {
		events[i].ID = fmt.Sprintf("sim-%d", startSeq+i)
	}
	return events
}

func (s *State) appendEvents(events []Event) {
	all := append(append([]Event{}, s.Events...), events...)
	if len(all) > MaxEvents {
		all = all[len(all)-MaxEvents:]
	}
	s.Events = all
	s.EventSeq += len(events)
}

func (s *State) clone() *State {
	c := *s
	c.Drift = make(map[string]float64, len(s.Drift))
	for k, v := range s.Drift {
		c.Drift[k] = v
	}
	c.Anomalies = append([]string{}, s.Anomalies...)
	c.Failures = append([]ActiveFailure{}, s.Failures...)
	c.Events = append([]Event{}, s.Events...)
	return &c
}

// Create starts a simulation. startAt defaults to the latest timestamp in the data; seed to 1.
func Create(baseline *domain.TopologyData, seed uint32, startAt string) *State {
	ix := domain.BuildIndex(baseline)
	clock := startAt
	if clock == "" {
		clock = latestTimestamp(baseline)
	}
	data, impacts := derive(ix, nil, map[string]float64{}, clock)
	return &State{Baseline: baseline, Data: data, Seed: seed, Clock: clock, RNG: seed, Drift: map[string]float64{},
		Anomalies: []string{}, Failures: []ActiveFailure{}, Impacts: impacts, Events: []Event{}, EventSeq: 1, index: ix}
}

func (s *State) withFailures(failures []ActiveFailure, root *rootEvent) *State {
	data, impacts := derive(s.index, failures, s.Drift, s.Clock)
	events := changeEvents(s.Data, data, impacts, failures, s.Tick, s.Clock, s.EventSeq, root)
	next := s.clone()
	next.Data, next.Impacts, next.Failures = data, impacts, failures
	next.appendEvents(events)
	return next
}

func (s *State) currentHealth(id string) string {
	for _, i := range s.Data.ServiceInstances {
		if i.ID == id {
			return i.Health
		}
	}
	for _, r := range s.Data.Resources {
		if r.ID == id && r.Health != nil {
			return *r.Health
		}
	}
	return "unknown"
}

// Inject simulates a failure of an instance or resource, replacing any failure of the same entity.
// durationTicks <= 0 means no scheduled recovery.
func (s *State) Inject(entityID, mode string, durationTicks int) (*State, error) {
	inst, res := s.index.Instances[entityID], s.index.Resources[entityID]
	if inst == nil && res == nil {
		return nil, fmt.Errorf("cannot fail unknown entity %q", entityID)
	}
	if mode != domain.FailureUnavailable && mode != domain.FailureDegraded {
		return nil, fmt.Errorf("unknown failure mode %q", mode)
	}
	f := ActiveFailure{EntityID: entityID, Mode: mode, InjectedTick: s.Tick}
	note := "Simulated " + mode + " failure"
	if durationTicks > 0 {
		at := s.Tick + max(1, durationTicks)
		f.RecoverAtTick = &at
		note = fmt.Sprintf("Recovers automatically after %d s (simulated)", durationTicks*TickSeconds)
	}
	var failures []ActiveFailure
	for _, x := range s.Failures {
		if x.EntityID != entityID {
			failures = append(failures, x)
		}
	}
	failures = append(failures, f)
	before := s.currentHealth(entityID)
	kind := domain.KindResource
	if inst != nil {
		kind = domain.KindServiceInstance
	}
	return s.withFailures(failures, &rootEvent{Type: "failure-injected", EntityKind: kind, EntityID: entityID, From: before, To: domain.WorseHealth(before, mode), Note: note}), nil
}

// Recover ends a failure; unchanged state if the entity is not failing.
func (s *State) Recover(entityID string) *State { return s.recover(entityID, "Recovered (simulated)") }

func (s *State) recover(entityID, note string) *State {
	found := false
	failures := []ActiveFailure{}
	for _, f := range s.Failures {
		if f.EntityID == entityID {
			found = true
		} else {
			failures = append(failures, f)
		}
	}
	if !found {
		return s
	}
	before := s.currentHealth(entityID)
	after := "unknown"
	kind := domain.KindResource
	if inst := s.index.Instances[entityID]; inst != nil {
		after, kind = inst.Health, domain.KindServiceInstance
	} else if res := s.index.Resources[entityID]; res != nil && res.Health != nil {
		after = *res.Health
	}
	return s.withFailures(failures, &rootEvent{Type: "recovered", EntityKind: kind, EntityID: entityID, From: before, To: after, Note: note})
}

// RecoverAll ends every failure, one by one in order.
func (s *State) RecoverAll() *State {
	cur := s
	for _, f := range s.Failures {
		cur = cur.Recover(f.EntityID)
	}
	return cur
}

// Step advances the clock: scheduled recoveries, then metric drift and latency-anomaly events.
func (s *State) Step(ticks int) *State {
	cur := s
	for n := 0; n < ticks; n++ {
		next := cur.clone()
		next.Tick, next.Clock = cur.Tick+1, addSeconds(cur.Clock, TickSeconds)
		cur = next
		var due []ActiveFailure
		for _, f := range cur.Failures {
			if f.RecoverAtTick != nil && *f.RecoverAtTick <= cur.Tick {
				due = append(due, f)
			}
		}
		for _, f := range due {
			cur = cur.recover(f.EntityID, "Recovered automatically (scheduled, simulated)")
		}
		rng := cur.RNG
		drift := make(map[string]float64, len(cur.Drift))
		for k, v := range cur.Drift {
			drift[k] = v
		}
		var ids []string
		instanceIDs := map[string]bool{}
		// Only simulated metrics drift; observed ones are what the source measured.
		for _, i := range cur.Baseline.ServiceInstances {
			instanceIDs[i.ID] = true
			if i.Metrics != nil && i.Metrics.IsSimulated {
				ids = append(ids, i.ID)
			}
		}
		for _, r := range cur.Baseline.Resources {
			if r.Metrics != nil && r.Metrics.IsSimulated {
				ids = append(ids, r.ID)
			}
		}
		for _, r := range cur.Baseline.Relationships {
			if r.Metrics != nil && r.Metrics.IsSimulated {
				ids = append(ids, r.ID)
			}
		}
		sort.Strings(ids)
		for _, id := range ids {
			var r float64
			r, rng = nextRandom(rng)
			value := float64(driftOf(drift, id) * float64(1+float64(float64(r-0.5)*0.16)))
			drift[id] = jsRound(float64(math.Min(1.6, math.Max(0.7, value))*1000)) / 1000
		}
		data, impacts := derive(cur.index, cur.Failures, drift, cur.Clock)
		anomalies := map[string]bool{}
		for _, a := range cur.Anomalies {
			anomalies[a] = true
		}
		var events []Event
		for _, id := range ids {
			if !instanceIDs[id] {
				continue
			}
			factor := driftOf(drift, id)
			if !anomalies[id] && factor >= anomalyOn {
				anomalies[id] = true
				events = append(events, Event{Tick: cur.Tick, At: cur.Clock, Type: "latency-anomaly", EntityKind: domain.KindServiceInstance, EntityID: id,
					Note: "Simulated latency ×" + jsToFixed2(factor) + " of recorded value", IsSimulated: true})
			} else if anomalies[id] && factor <= anomalyOff {
				delete(anomalies, id)
				events = append(events, Event{Tick: cur.Tick, At: cur.Clock, Type: "latency-normal", EntityKind: domain.KindServiceInstance, EntityID: id,
					Note: "Simulated latency back near recorded value", IsSimulated: true})
			}
		}
		for i := range events {
			events[i].ID = fmt.Sprintf("sim-%d", cur.EventSeq+i)
		}
		next = cur.clone()
		next.RNG, next.Drift, next.Data, next.Impacts = rng, drift, data, impacts
		next.Anomalies = domain.SortedIDs(anomalies)
		next.appendEvents(events)
		cur = next
	}
	return cur
}

// Reset returns to the baseline at the default start time, keeping the seed.
func (s *State) Reset(startAt string) *State { return Create(s.Baseline, s.Seed, startAt) }
