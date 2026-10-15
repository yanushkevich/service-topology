package application

import (
	"context"
	"maps"
	"slices"
	"time"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// Observed health and metrics from a topology source (ADR-034, docs/DYNATRACE_CONNECTOR.md §5): a
// refresh maps the source's states onto linked entities (metadata[source] = {tenant, id}) and
// keeps them as an overlay, merged onto topology reads while fresh. Writes never store them.

// staleAfter is how many refresh intervals an overlay stays current.
const staleAfter = 3

// RefreshRecord is the outcome of the last refresh.
type RefreshRecord struct {
	At       string `json:"at"`
	OK       bool   `json:"ok"`
	Entities int    `json:"entities"`
	Error    string `json:"error,omitempty"`
}

// ObservationMeta describes the current overlay (GET /meta, GET /integrations/{source}).
type ObservationMeta struct {
	Source     string `json:"source"`
	ObservedAt string `json:"observedAt"`
	IsExample  bool   `json:"isExample"`
	Entities   int    `json:"entities"`
	Stale      bool   `json:"stale"`
	// RefreshIntervalSeconds is how often the overlay is refreshed (clients refetch as often).
	RefreshIntervalSeconds int `json:"refreshIntervalSeconds"`
}

// RefreshObservations observes the source now and replaces the overlay.
func (s *Service) RefreshObservations(ctx context.Context) error {
	ss, err := s.sourceSync()
	if err != nil {
		return err
	}
	overlay, err := s.observe(ctx, ss)
	record := &RefreshRecord{At: s.now().UTC().Format(time.RFC3339), OK: err == nil}
	if err != nil {
		record.Error = err.Error()
		ss.setRefresh(record)
		return err
	}
	record.Entities = len(overlay.Entities)
	ss.setRefresh(record)
	ss.overlay.Store(overlay)
	return ss.Store.SaveObservations(ctx, overlay)
}

func (s *Service) observe(ctx context.Context, ss *SourceSync) (*ports.ObservationOverlay, error) {
	obs, err := ss.Source.Observe(ctx)
	if err != nil {
		return nil, err
	}
	data, err := s.TopologyRepo.GetTopology(ctx, "")
	if err != nil {
		return nil, err
	}
	return overlayFor(data, obs, ss.Source.Name()), nil
}

// LoadObservations restores the stored overlay (at start-up), so a restart shows recent states.
func (s *Service) LoadObservations(ctx context.Context) error {
	ss, err := s.sourceSync()
	if err != nil {
		return err
	}
	overlay, err := ss.Store.LoadObservations(ctx, ss.Source.Name())
	if err != nil || overlay == nil {
		return err
	}
	ss.overlay.CompareAndSwap(nil, overlay)
	return nil
}

// overlayFor maps observed states onto the entities linked to the source.
func overlayFor(data *domain.TopologyData, obs *ports.Observation, source string) *ports.ObservationOverlay {
	out := &ports.ObservationOverlay{Source: source, ObservedAt: obs.ObservedAt, IsExample: obs.IsExample, Entities: map[domain.EntityID]ports.ObservedState{}}
	lookup := func(id domain.EntityID, meta map[string]any) {
		link, _ := meta[source].(map[string]any)
		tenant, _ := link["tenant"].(string)
		sourceID, _ := link["id"].(string)
		if state, ok := obs.Tenants[tenant][sourceID]; ok && sourceID != "" {
			out.Entities[id] = state
		}
	}
	for _, e := range data.ServiceInstances {
		lookup(e.ID, e.Metadata)
	}
	for _, e := range data.Resources {
		lookup(e.ID, e.Metadata)
	}
	return out
}

// currentOverlay returns the overlay if it is fresh, else nil.
func (s *Service) currentOverlay() *ports.ObservationOverlay {
	if s.Sync == nil {
		return nil
	}
	overlay := s.Sync.overlay.Load()
	if overlay == nil || s.isStale(overlay) {
		return nil
	}
	return overlay
}

func (s *Service) isStale(overlay *ports.ObservationOverlay) bool {
	at, err := time.Parse(time.RFC3339, overlay.ObservedAt)
	interval := time.Duration(s.Sync.Source.Describe().RefreshIntervalSeconds) * time.Second
	return err != nil || s.now().Sub(at) > staleAfter*interval
}

// observationMeta describes the overlay, stale or not; nil without one.
func (s *Service) observationMeta() *ObservationMeta {
	if s.Sync == nil {
		return nil
	}
	overlay := s.Sync.overlay.Load()
	if overlay == nil {
		return nil
	}
	return &ObservationMeta{Source: overlay.Source, ObservedAt: overlay.ObservedAt, IsExample: overlay.IsExample, Entities: len(overlay.Entities), Stale: s.isStale(overlay),
		RefreshIntervalSeconds: s.Sync.Source.Describe().RefreshIntervalSeconds}
}

// observed returns data with the current overlay merged on: health, metrics (instances), and the
// open problems and observation time in metadata[source]. data is shared and never modified.
func (s *Service) observed(data *domain.TopologyData) *domain.TopologyData {
	overlay := s.currentOverlay()
	if overlay == nil || len(overlay.Entities) == 0 {
		return data
	}
	out := *data
	out.ServiceInstances = slices.Clone(data.ServiceInstances)
	for i, e := range out.ServiceInstances {
		if state, ok := overlay.Entities[e.ID]; ok {
			out.ServiceInstances[i].Health = state.Health
			if state.Metrics != nil {
				m := *state.Metrics
				out.ServiceInstances[i].Metrics = &m
			}
			out.ServiceInstances[i].Metadata = observedMetadata(e.Metadata, overlay, state)
		}
	}
	out.Resources = slices.Clone(data.Resources)
	for i, e := range out.Resources {
		if state, ok := overlay.Entities[e.ID]; ok {
			health := state.Health
			out.Resources[i].Health = &health
			out.Resources[i].Metadata = observedMetadata(e.Metadata, overlay, state)
		}
	}
	return &out
}

func observedMetadata(meta map[string]any, overlay *ports.ObservationOverlay, state ports.ObservedState) map[string]any {
	out := maps.Clone(meta)
	link, _ := out[overlay.Source].(map[string]any)
	link = maps.Clone(link)
	if link == nil {
		link = map[string]any{}
	}
	link["observedAt"] = overlay.ObservedAt
	link["problems"] = append([]string{}, state.Problems...)
	out[overlay.Source] = link
	return out
}

// keepObserved stops a write from storing observed values: an entity with a source link keeps its
// stored health and link (the overlay's health, problems, and observation time are never authored).
func (s *Service) keepObserved(d *domain.TopologyData, existing int, entity any) {
	if s.Sync == nil || existing < 0 {
		return
	}
	source := s.Sync.Source.Name()
	switch e := entity.(type) {
	case *domain.ServiceInstance:
		stored := d.ServiceInstances[existing]
		if _, linked := stored.Metadata[source]; linked {
			e.Health = stored.Health
			e.Metadata = withLink(e.Metadata, stored.Metadata, source)
		}
	case *domain.InfrastructureResource:
		stored := d.Resources[existing]
		if _, linked := stored.Metadata[source]; linked {
			e.Health = stored.Health
			e.Metadata = withLink(e.Metadata, stored.Metadata, source)
		}
	case *domain.ServiceDefinition:
		stored := d.ServiceDefinitions[existing]
		if _, linked := stored.Metadata[source]; linked {
			e.Metadata = withLink(e.Metadata, stored.Metadata, source)
		}
	case *domain.CommunicationRelationship:
		stored := d.Relationships[existing]
		if _, linked := stored.Metadata[source]; linked {
			e.Metadata = withLink(e.Metadata, stored.Metadata, source)
		}
	}
}
