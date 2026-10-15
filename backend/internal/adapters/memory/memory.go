// Package memory provides in-memory implementations of the ports for tests (the frontend's
// in-memory repositories have the same role). Not used in production.
package memory

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
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
	boards    map[domain.EntityID]domain.StoredBoard
	// Err, if set, is returned by every call (simulates an unavailable database).
	Err error
	// writes counts applied changes; the revision is derived from it.
	writes int
	// sources records the source that created each entity (ports.SourceWriter).
	sources      map[domain.EntityID]string
	integrations map[string]*integration
}

// New returns a store holding data, recorded as created by "fixture".
func New(data *domain.TopologyData) *Store {
	s := &Store{Data: data, snapshots: map[string]domain.Snapshot{}, layouts: map[string]domain.SavedLayout{}, boards: map[domain.EntityID]domain.StoredBoard{},
		integrations: map[string]*integration{}}
	s.recordSources(data, "fixture")
	return s
}

func (s *Store) recordSources(data *domain.TopologyData, source string) {
	s.sources = map[domain.EntityID]string{}
	if data == nil {
		return
	}
	for _, id := range entityIDs(data) {
		s.sources[id] = source
	}
}

func entityIDs(d *domain.TopologyData) []domain.EntityID {
	var out []domain.EntityID
	for _, e := range d.Environments {
		out = append(out, e.ID)
	}
	for _, e := range d.ServiceDefinitions {
		out = append(out, e.ID)
	}
	for _, e := range d.ServiceInstances {
		out = append(out, e.ID)
	}
	for _, e := range d.Resources {
		out = append(out, e.ID)
	}
	for _, e := range d.Relationships {
		out = append(out, e.ID)
	}
	for _, e := range d.EventTypes {
		out = append(out, e.ID)
	}
	for _, e := range d.BusinessFlows {
		out = append(out, e.ID)
	}
	return out
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

// TopologyMeta implements ports.TopologyMetaRepository (in-memory data is fixture data).
func (s *Store) TopologyMeta(context.Context) (*ports.TopologyMeta, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return &ports.TopologyMeta{Revision: s.revisionLocked(), SourceType: "fixture", IsMock: true}, nil
}

func (s *Store) revisionLocked() string { return fmt.Sprintf("memory-%d", s.writes) }

// CurrentTopology implements ports.TopologyWriter.
func (s *Store) CurrentTopology(context.Context) (*domain.TopologyData, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Err != nil {
		return nil, "", s.Err
	}
	return clone(s.Data), s.revisionLocked(), nil
}

func applyTo[T any](items []T, change ports.EntityChange, idOf func(*T) string) ([]T, error) {
	at := -1
	for i := range items {
		if idOf(&items[i]) == change.ID {
			at = i
		}
	}
	switch {
	case change.Op == ports.OpCreate && at >= 0:
		return nil, ports.ErrConflict
	case change.Op != ports.OpCreate && at < 0:
		return nil, ports.ErrNotFound
	case change.Op == ports.OpCreate:
		return append(items, clone(*change.Entity.(*T))), nil
	case change.Op == ports.OpReplace:
		items[at] = clone(*change.Entity.(*T))
		return items, nil
	default:
		return append(items[:at:at], items[at+1:]...), nil
	}
}

// ApplyChange implements ports.TopologyWriter (no validation here: the application validates).
func (s *Store) ApplyChange(ctx context.Context, change ports.EntityChange, expectedRevision, sourceType string) (string, error) {
	return s.ApplyChanges(ctx, []ports.EntityChange{change}, expectedRevision, sourceType)
}

var _ ports.SourceWriter = (*Store)(nil)

// ApplyChanges implements ports.SourceWriter: all changes or none, one new revision.
func (s *Store) ApplyChanges(_ context.Context, changes []ports.EntityChange, expectedRevision, sourceType string) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Err != nil {
		return "", s.Err
	}
	if expectedRevision != s.revisionLocked() {
		return "", ports.ErrPreconditionFailed
	}
	d := clone(s.Data)
	for _, change := range changes {
		if err := applyOne(d, change); err != nil {
			return "", err
		}
	}
	for _, change := range changes {
		switch change.Op {
		case ports.OpCreate:
			s.sources[change.ID] = sourceType
		case ports.OpDelete:
			delete(s.sources, change.ID)
		}
	}
	s.Data = d
	s.writes++
	return s.revisionLocked(), nil
}

// SourceTypes implements ports.SourceWriter.
func (s *Store) SourceTypes(context.Context) (map[domain.EntityID]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Err != nil {
		return nil, s.Err
	}
	out := make(map[domain.EntityID]string, len(s.sources))
	for id, source := range s.sources {
		out[id] = source
	}
	return out, nil
}

func applyOne(d *domain.TopologyData, change ports.EntityChange) error {
	var err error
	switch change.Kind {
	case domain.KindEnvironment:
		d.Environments, err = applyTo(d.Environments, change, func(e *domain.Environment) string { return e.ID })
	case domain.KindServiceDefinition:
		d.ServiceDefinitions, err = applyTo(d.ServiceDefinitions, change, func(e *domain.ServiceDefinition) string { return e.ID })
	case domain.KindServiceInstance:
		d.ServiceInstances, err = applyTo(d.ServiceInstances, change, func(e *domain.ServiceInstance) string { return e.ID })
	case domain.KindResource:
		d.Resources, err = applyTo(d.Resources, change, func(e *domain.InfrastructureResource) string { return e.ID })
	case domain.KindRelationship:
		d.Relationships, err = applyTo(d.Relationships, change, func(e *domain.CommunicationRelationship) string { return e.ID })
	case domain.KindEventType:
		d.EventTypes, err = applyTo(d.EventTypes, change, func(e *domain.EventType) string { return e.ID })
	case domain.KindBusinessFlow:
		d.BusinessFlows, err = applyTo(d.BusinessFlows, change, func(e *domain.BusinessFlow) string { return e.ID })
	default:
		err = fmt.Errorf("memory: kind %q is not writable", change.Kind)
	}
	return err
}

var _ ports.BundleImporter = (*Store)(nil)

// ReplaceAll implements ports.BundleImporter (no validation here: the application validates).
func (s *Store) ReplaceAll(_ context.Context, data *domain.TopologyData, defs []domain.BoardDefinition, expectedRevision, sourceType, updatedAt string) (*ports.ReplaceResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Err != nil {
		return nil, s.Err
	}
	if expectedRevision != "" && expectedRevision != s.revisionLocked() {
		return nil, ports.ErrPreconditionFailed
	}
	s.Data = clone(data)
	s.recordSources(data, sourceType)
	s.boards = map[domain.EntityID]domain.StoredBoard{}
	for _, def := range defs {
		s.boards[def.ServiceDefinitionID] = domain.StoredBoard{Definition: clone(def), Revision: "1", UpdatedAt: updatedAt}
	}
	s.writes++
	return &ports.ReplaceResult{Revision: s.revisionLocked(), Documents: domain.ModuleCounts(data), Boards: len(defs)}, nil
}

// Boards adapts the store to ports.BoardRepository (ADR-031), with the same revision rules as MongoDB.
func (s *Store) Boards() ports.BoardRepository { return boards{s} }

type boards struct{ s *Store }

func (b boards) lock() (func(), error) {
	b.s.mu.Lock()
	if b.s.Err != nil {
		b.s.mu.Unlock()
		return nil, b.s.Err
	}
	return b.s.mu.Unlock, nil
}

func (b boards) List(context.Context) ([]domain.StoredBoard, error) {
	unlock, err := b.lock()
	if err != nil {
		return nil, err
	}
	defer unlock()
	out := []domain.StoredBoard{}
	for _, v := range b.s.boards {
		out = append(out, clone(v))
	}
	sort.Slice(out, func(i, j int) bool {
		return out[i].Definition.ServiceDefinitionID < out[j].Definition.ServiceDefinitionID
	})
	return out, nil
}

func (b boards) Get(_ context.Context, id domain.EntityID) (*domain.StoredBoard, error) {
	unlock, err := b.lock()
	if err != nil {
		return nil, err
	}
	defer unlock()
	v, ok := b.s.boards[id]
	if !ok {
		return nil, ports.ErrNotFound
	}
	c := clone(v)
	return &c, nil
}

func (b boards) Create(_ context.Context, def *domain.BoardDefinition, updatedAt string) (*domain.StoredBoard, error) {
	unlock, err := b.lock()
	if err != nil {
		return nil, err
	}
	defer unlock()
	if _, ok := b.s.boards[def.ServiceDefinitionID]; ok {
		return nil, ports.ErrConflict
	}
	stored := domain.StoredBoard{Definition: clone(*def), Revision: "1", UpdatedAt: updatedAt}
	b.s.boards[def.ServiceDefinitionID] = stored
	c := clone(stored)
	return &c, nil
}

func (b boards) Replace(_ context.Context, def *domain.BoardDefinition, ifRevision, updatedAt string) (*domain.StoredBoard, error) {
	unlock, err := b.lock()
	if err != nil {
		return nil, err
	}
	defer unlock()
	current, ok := b.s.boards[def.ServiceDefinitionID]
	if !ok {
		return nil, ports.ErrNotFound
	}
	if ifRevision != "" && ifRevision != current.Revision {
		return nil, ports.ErrPreconditionFailed
	}
	n, _ := strconv.Atoi(current.Revision)
	stored := domain.StoredBoard{Definition: clone(*def), Revision: strconv.Itoa(n + 1), UpdatedAt: updatedAt}
	b.s.boards[def.ServiceDefinitionID] = stored
	c := clone(stored)
	return &c, nil
}

func (b boards) Remove(_ context.Context, id domain.EntityID, ifRevision string) error {
	unlock, err := b.lock()
	if err != nil {
		return err
	}
	defer unlock()
	current, ok := b.s.boards[id]
	if !ok {
		return ports.ErrNotFound
	}
	if ifRevision != "" && ifRevision != current.Revision {
		return ports.ErrPreconditionFailed
	}
	delete(b.s.boards, id)
	return nil
}

// integration is one source's state (ports.IntegrationStore).
type integration struct {
	aliases   map[string]domain.EntityID
	aliasesAt int
	lastSync  *ports.SyncRecord
}

// Integrations adapts the store to ports.IntegrationStore.
func (s *Store) Integrations() ports.IntegrationStore { return integrations{s} }

type integrations struct{ s *Store }

func (i integrations) state(source string) *integration {
	st, ok := i.s.integrations[source]
	if !ok {
		st = &integration{aliases: map[string]domain.EntityID{}}
		i.s.integrations[source] = st
	}
	return st
}

func (i integrations) Aliases(_ context.Context, source string) (map[string]domain.EntityID, string, error) {
	i.s.mu.Lock()
	defer i.s.mu.Unlock()
	st := i.state(source)
	return clone(st.aliases), strconv.Itoa(st.aliasesAt), nil
}

func (i integrations) SaveAliases(_ context.Context, source string, aliases map[string]domain.EntityID, ifRevision string) (string, error) {
	i.s.mu.Lock()
	defer i.s.mu.Unlock()
	st := i.state(source)
	if ifRevision != strconv.Itoa(st.aliasesAt) {
		return "", ports.ErrPreconditionFailed
	}
	st.aliases = clone(aliases)
	st.aliasesAt++
	return strconv.Itoa(st.aliasesAt), nil
}

func (i integrations) LastSync(_ context.Context, source string) (*ports.SyncRecord, error) {
	i.s.mu.Lock()
	defer i.s.mu.Unlock()
	return i.state(source).lastSync, nil
}

func (i integrations) SaveLastSync(_ context.Context, source string, sync *ports.SyncRecord) error {
	i.s.mu.Lock()
	defer i.s.mu.Unlock()
	i.state(source).lastSync = sync
	return nil
}
