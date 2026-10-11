// Package memory provides in-memory implementations of the ports for tests (the frontend's
// in-memory repositories have the same role). Not used in production.
package memory

import (
	"context"
	"encoding/json"
	"sort"
	"sync"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// Store implements every repository port over plain maps.
type Store struct {
	mu        sync.Mutex
	Data      *domain.TopologyData
	snapshots map[string]domain.Snapshot
	layouts   map[string]domain.SavedLayout
	// Err, if set, is returned by every call (simulates an unavailable database).
	Err error
}

// New returns a store holding data.
func New(data *domain.TopologyData) *Store {
	return &Store{Data: data, snapshots: map[string]domain.Snapshot{}, layouts: map[string]domain.SavedLayout{}}
}

func clone[T any](v T) T {
	b, _ := json.Marshal(v)
	var out T
	_ = json.Unmarshal(b, &out)
	return out
}

func (s *Store) GetTopology(_ context.Context, environmentID string) (*domain.TopologyData, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Err != nil {
		return nil, s.Err
	}
	out := clone(s.Data)
	return out, nil
}

func (s *Store) List(_ context.Context, q ports.SnapshotQuery) ([]domain.SnapshotSummary, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Err != nil {
		return nil, s.Err
	}
	out := []domain.SnapshotSummary{}
	for _, snap := range s.snapshots {
		if q.From != "" && domain.Before(snap.TakenAt, q.From) || q.To != "" && domain.Before(q.To, snap.TakenAt) {
			continue
		}
		out = append(out, snap.SnapshotSummary)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].TakenAt != out[j].TakenAt {
			return domain.Before(out[i].TakenAt, out[j].TakenAt)
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func (s *Store) Get(_ context.Context, id string) (*domain.Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Err != nil {
		return nil, s.Err
	}
	snap, ok := s.snapshots[id]
	if !ok {
		return nil, ports.ErrNotFound
	}
	out := clone(snap)
	return &out, nil
}

func (s *Store) Save(_ context.Context, snap *domain.Snapshot) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Err != nil {
		return s.Err
	}
	if _, ok := s.snapshots[snap.ID]; ok {
		return ports.ErrConflict
	}
	s.snapshots[snap.ID] = clone(*snap)
	return nil
}

// Layouts adapts the store to ports.SavedLayoutRepository (method names overlap with snapshots).
func (s *Store) Layouts() ports.SavedLayoutRepository { return layouts{s} }

type layouts struct{ s *Store }

func (l layouts) List(context.Context) ([]domain.SavedLayout, error) {
	l.s.mu.Lock()
	defer l.s.mu.Unlock()
	if l.s.Err != nil {
		return nil, l.s.Err
	}
	out := []domain.SavedLayout{}
	for _, v := range l.s.layouts {
		out = append(out, clone(v))
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].CreatedAt != out[j].CreatedAt {
			return domain.Before(out[j].CreatedAt, out[i].CreatedAt)
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

func (l layouts) Create(_ context.Context, v *domain.SavedLayout) error {
	l.s.mu.Lock()
	defer l.s.mu.Unlock()
	if l.s.Err != nil {
		return l.s.Err
	}
	if _, ok := l.s.layouts[v.ID]; ok {
		return ports.ErrConflict
	}
	l.s.layouts[v.ID] = clone(*v)
	return nil
}

func (l layouts) Replace(_ context.Context, v *domain.SavedLayout) error {
	l.s.mu.Lock()
	defer l.s.mu.Unlock()
	if l.s.Err != nil {
		return l.s.Err
	}
	if _, ok := l.s.layouts[v.ID]; !ok {
		return ports.ErrNotFound
	}
	l.s.layouts[v.ID] = clone(*v)
	return nil
}

func (l layouts) Remove(_ context.Context, id string) error {
	l.s.mu.Lock()
	defer l.s.mu.Unlock()
	if l.s.Err != nil {
		return l.s.Err
	}
	if _, ok := l.s.layouts[id]; !ok {
		return ports.ErrNotFound
	}
	delete(l.s.layouts, id)
	return nil
}

// Subgraph implements ports.GraphRepository with a bounded BFS over the in-memory topology.
func (s *Store) Subgraph(_ context.Context, startID domain.EntityID, direction string, maxDepth, maxEntities int) (*ports.Subgraph, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Err != nil {
		return nil, s.Err
	}
	ix := domain.BuildIndex(s.Data)
	if ix.Instances[startID] == nil && ix.Resources[startID] == nil {
		return nil, ports.ErrNotFound
	}
	seen := map[domain.EntityID]bool{startID: true}
	order := []domain.EntityID{startID}
	frontier := []domain.EntityID{startID}
	for d := 0; d < maxDepth && len(frontier) > 0; d++ {
		var next []domain.EntityID
		for _, id := range frontier {
			var peers []domain.EntityID
			if direction != ports.DirectionDownstream {
				for _, r := range ix.Outgoing[id] {
					peers = append(peers, r.TargetEntityID)
				}
			}
			if direction != ports.DirectionUpstream {
				for _, r := range ix.Incoming[id] {
					peers = append(peers, r.SourceEntityID)
				}
			}
			for _, p := range peers {
				if !seen[p] {
					seen[p] = true
					order = append(order, p)
					next = append(next, p)
				}
			}
		}
		frontier = next
	}
	if len(order) > maxEntities {
		return nil, ports.ErrTooLarge
	}
	sub := &ports.Subgraph{StartID: startID, EntityIDs: order, Relationships: []domain.CommunicationRelationship{}}
	for _, r := range s.Data.Relationships {
		if seen[r.SourceEntityID] && seen[r.TargetEntityID] {
			sub.Relationships = append(sub.Relationships, r)
		}
	}
	return sub, nil
}

// Simulations adapts the store to ports.SimulationRepository.
func (s *Store) Simulations() ports.SimulationRepository { return &sims{s: s} }

type sims struct {
	s         *Store
	runs      []domain.SimulationRun
	events    map[string][]domain.StoredEvent
	telemetry map[string][]domain.TelemetryObservation
}

func (m *sims) Save(_ context.Context, run *domain.SimulationRun, events []domain.StoredEvent, telemetry []domain.TelemetryObservation) error {
	m.s.mu.Lock()
	defer m.s.mu.Unlock()
	if m.s.Err != nil {
		return m.s.Err
	}
	if m.events == nil {
		m.events, m.telemetry = map[string][]domain.StoredEvent{}, map[string][]domain.TelemetryObservation{}
	}
	m.runs = append(m.runs, clone(*run))
	m.events[run.ID] = clone(events)
	m.telemetry[run.ID] = clone(telemetry)
	return nil
}

func (m *sims) Get(_ context.Context, id string) (*domain.SimulationRun, error) {
	m.s.mu.Lock()
	defer m.s.mu.Unlock()
	for _, r := range m.runs {
		if r.ID == id {
			out := clone(r)
			return &out, nil
		}
	}
	return nil, ports.ErrNotFound
}

func (m *sims) List(_ context.Context, limit int) ([]domain.SimulationRun, error) {
	m.s.mu.Lock()
	defer m.s.mu.Unlock()
	out := []domain.SimulationRun{}
	for i := len(m.runs) - 1; i >= 0 && (limit <= 0 || len(out) < limit); i-- {
		out = append(out, clone(m.runs[i]))
	}
	return out, nil
}

func (m *sims) Events(_ context.Context, sim, entity, typ string) ([]domain.StoredEvent, error) {
	m.s.mu.Lock()
	defer m.s.mu.Unlock()
	out := []domain.StoredEvent{}
	for _, e := range m.events[sim] {
		if (entity == "" || e.Event["entityId"] == entity) && (typ == "" || e.Event["type"] == typ) {
			out = append(out, e)
		}
	}
	return out, nil
}

func (m *sims) Telemetry(_ context.Context, sim, subject, metric string) ([]domain.TelemetryObservation, error) {
	m.s.mu.Lock()
	defer m.s.mu.Unlock()
	out := []domain.TelemetryObservation{}
	for _, o := range m.telemetry[sim] {
		if (subject == "" || o.SubjectID == subject) && (metric == "" || o.MetricName == metric) {
			out = append(out, o)
		}
	}
	return out, nil
}

func (m *sims) Prune(_ context.Context, olderThan string, keep int) (int, error) {
	m.s.mu.Lock()
	defer m.s.mu.Unlock()
	var kept []domain.SimulationRun
	removed := 0
	for i := len(m.runs) - 1; i >= 0; i-- { // newest first
		r := m.runs[i]
		if (keep > 0 && len(kept) >= keep) || (olderThan != "" && domain.Before(r.CreatedAt, olderThan)) {
			delete(m.events, r.ID)
			delete(m.telemetry, r.ID)
			removed++
			continue
		}
		kept = append([]domain.SimulationRun{r}, kept...)
	}
	m.runs = kept
	return removed, nil
}
