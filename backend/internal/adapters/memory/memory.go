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
