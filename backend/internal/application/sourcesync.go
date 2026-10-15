package application

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"maps"
	"slices"
	"sync"
	"time"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// Syncing a topology source (ADR-034, docs/DYNATRACE_CONNECTOR.md §4–6): a connection check, a
// held preview of the reconciled changes, and an atomic apply guarded by the topology revision.

// Errors of source syncs.
var (
	ErrSourceNotConfigured = errors.New("no topology source is configured")
	ErrSourceBusy          = errors.New("a preview or check is already running; try again when it finishes")
	ErrPreviewExpired      = errors.New("the preview expired; preview again")
	ErrNoSourceWrites      = errors.New("this deployment cannot apply source syncs")
)

// PreviewTTL is how long a preview can be applied.
const PreviewTTL = 10 * time.Minute

// MaxAliases bounds the alias list.
const MaxAliases = 1000

// SourceSync holds a source and its previews. One preview or check runs at a time.
type SourceSync struct {
	Source ports.TopologySource
	Store  ports.IntegrationStore

	running  sync.Mutex
	mu       sync.Mutex
	previews map[string]*SyncPreview
}

// NewSourceSync returns the sync state for one source.
func NewSourceSync(source ports.TopologySource, store ports.IntegrationStore) *SourceSync {
	return &SourceSync{Source: source, Store: store, previews: map[string]*SyncPreview{}}
}

// SyncPreview is what applying a sync would change. Only its ID is needed to apply it.
type SyncPreview struct {
	ID           string                    `json:"id"`
	Source       string                    `json:"source"`
	BaseRevision string                    `json:"baseRevision"`
	CreatedAt    string                    `json:"createdAt"`
	ExpiresAt    string                    `json:"expiresAt"`
	DiscoveredAt string                    `json:"discoveredAt"`
	IsExample    bool                      `json:"isExample"`
	Summary      map[string]map[string]int `json:"summary"`
	Changes      []SyncChange              `json:"changes"`
	Notes        []ports.DiscoveryNote     `json:"notes"`
	Issues       []domain.Issue            `json:"issues"`
	CanApply     bool                      `json:"canApply"`
	expires      time.Time
}

// SourceStatus is the source's configuration and last sync (GET /integrations/{source}).
type SourceStatus struct {
	Source string `json:"source"`
	ports.SourceDescription
	LastSync   *ports.SyncRecord `json:"lastSync"`
	AliasCount int               `json:"aliasCount"`
}

// SyncResult is an applied sync.
type SyncResult struct {
	Revision string                    `json:"revision"`
	Summary  map[string]map[string]int `json:"summary"`
}

func (s *Service) sourceSync() (*SourceSync, error) {
	if s.Sync == nil {
		return nil, ErrSourceNotConfigured
	}
	return s.Sync, nil
}

// SourceStatus describes the configured source.
func (s *Service) SourceStatus(ctx context.Context) (*SourceStatus, error) {
	ss, err := s.sourceSync()
	if err != nil {
		return nil, err
	}
	last, err := ss.Store.LastSync(ctx, ss.Source.Name())
	if err != nil {
		return nil, err
	}
	aliases, _, err := ss.Store.Aliases(ctx, ss.Source.Name())
	if err != nil {
		return nil, err
	}
	return &SourceStatus{Source: ss.Source.Name(), SourceDescription: ss.Source.Describe(), LastSync: last, AliasCount: len(aliases)}, nil
}

// CheckSource runs the connection check.
func (s *Service) CheckSource(ctx context.Context) ([]ports.SourceCheck, error) {
	ss, err := s.sourceSync()
	if err != nil {
		return nil, err
	}
	if !ss.running.TryLock() {
		return nil, ErrSourceBusy
	}
	defer ss.running.Unlock()
	return ss.Source.Check(ctx), nil
}

// PreviewSync discovers, reconciles, and validates, and holds the result for PreviewTTL.
func (s *Service) PreviewSync(ctx context.Context) (*SyncPreview, error) {
	ss, err := s.sourceSync()
	if err != nil {
		return nil, err
	}
	writer, ok := s.TopologyRepo.(ports.SourceWriter)
	if !ok {
		return nil, ErrNoSourceWrites
	}
	if !ss.running.TryLock() {
		return nil, ErrSourceBusy
	}
	defer ss.running.Unlock()
	in, revision, err := s.reconcileInput(ctx, ss, writer)
	if err != nil {
		return nil, err
	}
	changes, result := reconcile(in.reconcileInput)
	now := s.now()
	p := &SyncPreview{
		ID: s.previewID(), Source: in.source, BaseRevision: revision,
		CreatedAt: now.UTC().Format(time.RFC3339), ExpiresAt: now.Add(PreviewTTL).UTC().Format(time.RFC3339), expires: now.Add(PreviewTTL),
		DiscoveredAt: in.discovery.DiscoveredAt, IsExample: in.discovery.IsExample,
		Summary: summarize(changes), Changes: changes, Notes: in.discovery.Notes, Issues: syncIssues(changes, result),
	}
	p.CanApply = !slices.ContainsFunc(p.Issues, func(i domain.Issue) bool { return i.Severity == domain.SeverityError })
	ss.hold(p, now)
	return p, nil
}

type syncInput struct {
	reconcileInput
	discovery *ports.Discovery
}

// reconcileInput loads what a reconcile needs: the stored topology, who created each entity,
// the boards' references, the aliases, and the discovery.
func (s *Service) reconcileInput(ctx context.Context, ss *SourceSync, writer ports.SourceWriter) (*syncInput, string, error) {
	source := ss.Source.Name()
	aliases, _, err := ss.Store.Aliases(ctx, source)
	if err != nil {
		return nil, "", err
	}
	discovery, err := ss.Source.Discover(ctx, aliases)
	if err != nil {
		return nil, "", err
	}
	w, err := s.writer()
	if err != nil {
		return nil, "", err
	}
	stored, revision, err := w.CurrentTopology(ctx)
	if err != nil {
		return nil, "", err
	}
	sources, err := writer.SourceTypes(ctx)
	if err != nil {
		return nil, "", err
	}
	boardRefs, err := s.boardRefs(ctx)
	if err != nil {
		return nil, "", err
	}
	in := reconcileInput{stored: stored, sources: sources, discovered: &discovery.Data, source: source, now: discovery.DiscoveredAt, boardRefs: boardRefs}
	return &syncInput{reconcileInput: in, discovery: discovery}, revision, nil
}

// boardRefs maps entity IDs to the stored boards that use them.
func (s *Service) boardRefs(ctx context.Context) (map[domain.EntityID][]domain.EntityID, error) {
	out := map[domain.EntityID][]domain.EntityID{}
	if s.BoardRepo == nil {
		return out, nil
	}
	boards, err := s.BoardRepo.List(ctx)
	if err != nil {
		return nil, err
	}
	for _, b := range boards {
		board := "transit-board:" + b.Definition.ServiceDefinitionID
		out[b.Definition.ServiceDefinitionID] = append(out[b.Definition.ServiceDefinitionID], board)
		for _, st := range b.Definition.Stations {
			if st.EntityID != nil {
				out[*st.EntityID] = append(out[*st.EntityID], board)
			}
		}
	}
	return out, nil
}

// syncIssues validates every written entity's fields and the resulting topology.
func syncIssues(changes []SyncChange, result *domain.TopologyData) []domain.Issue {
	issues := []domain.Issue{}
	for _, c := range changes {
		if c.Entity != nil {
			issues = append(issues, domain.ValidateEntityFields(c.Kind, c.Entity)...)
		}
	}
	return append(issues, domain.Validate(result)...)
}

func summarize(changes []SyncChange) map[string]map[string]int {
	out := map[string]map[string]int{}
	for _, c := range changes {
		if out[c.Kind] == nil {
			out[c.Kind] = map[string]int{}
		}
		out[c.Kind][c.Op]++
	}
	return out
}

// ApplySync applies a held preview. ifMatch, when set, must be the preview's base revision.
func (s *Service) ApplySync(ctx context.Context, previewID, ifMatch string) (*SyncResult, error) {
	ss, err := s.sourceSync()
	if err != nil {
		return nil, err
	}
	writer, ok := s.TopologyRepo.(ports.SourceWriter)
	if !ok {
		return nil, ErrNoSourceWrites
	}
	if previewID == "" {
		return nil, &ErrInvalid{Param: "previewId", Reason: "is required"}
	}
	p, err := ss.take(previewID, s.now())
	if err != nil {
		return nil, err
	}
	if !p.CanApply {
		return nil, &ErrValidation{Issues: p.Issues}
	}
	if ifMatch != "" && ifMatch != p.BaseRevision {
		return nil, &ErrPrecondition{}
	}
	revision := p.BaseRevision
	if len(p.Changes) > 0 {
		revision, err = writer.ApplyChanges(ctx, entityChanges(p.Changes), p.BaseRevision, p.Source)
		if errors.Is(err, ports.ErrPreconditionFailed) {
			return nil, &ErrPrecondition{}
		}
		if err != nil {
			return nil, err
		}
	}
	record := &ports.SyncRecord{AppliedAt: s.now().UTC().Format(time.RFC3339), Revision: revision, Summary: p.Summary}
	if err := ss.Store.SaveLastSync(ctx, p.Source, record); err != nil && s.Logger != nil {
		s.Logger.WarnContext(ctx, "the sync was applied but its record was not saved", "source", p.Source, "error", err.Error())
	}
	return &SyncResult{Revision: revision, Summary: p.Summary}, nil
}

// entityChanges converts preview changes into storage writes.
func entityChanges(changes []SyncChange) []ports.EntityChange {
	out := make([]ports.EntityChange, 0, len(changes))
	for _, c := range changes {
		op := ports.OpReplace
		switch c.Op {
		case SyncCreate:
			op = ports.OpCreate
		case SyncDelete:
			op = ports.OpDelete
		}
		out = append(out, ports.EntityChange{Op: op, Kind: c.Kind, ID: c.ID, Entity: c.Entity})
	}
	return out
}

// SourceAliases returns the alias list and its revision.
func (s *Service) SourceAliases(ctx context.Context) (map[string]domain.EntityID, string, error) {
	ss, err := s.sourceSync()
	if err != nil {
		return nil, "", err
	}
	return ss.Store.Aliases(ctx, ss.Source.Name())
}

// SaveSourceAliases replaces the alias list (revision-guarded by ifMatch, which is required).
func (s *Service) SaveSourceAliases(ctx context.Context, aliases map[string]domain.EntityID, ifMatch string) (string, error) {
	ss, err := s.sourceSync()
	if err != nil {
		return "", err
	}
	if ifMatch == "" {
		return "", &ErrInvalid{Param: "If-Match", Reason: "is required; send the alias list's ETag"}
	}
	if len(aliases) > MaxAliases {
		return "", &ErrInvalid{Param: "aliases", Reason: fmt.Sprintf("at most %d", MaxAliases)}
	}
	var issues []domain.Issue
	for _, name := range slices.Sorted(maps.Keys(aliases)) {
		def := &domain.ServiceDefinition{ID: aliases[name], Name: name, Category: "other", Protocols: []string{}}
		for _, issue := range domain.ValidateEntityFields(domain.KindServiceDefinition, def) {
			issue.Message = fmt.Sprintf("alias %q: %s", name, issue.Message)
			issues = append(issues, issue)
		}
	}
	if len(issues) > 0 {
		return "", &ErrValidation{Issues: issues}
	}
	rev, err := ss.Store.SaveAliases(ctx, ss.Source.Name(), aliases, ifMatch)
	if errors.Is(err, ports.ErrPreconditionFailed) {
		return "", &ErrPrecondition{}
	}
	return rev, err
}

func (s *Service) previewID() string {
	if s.NewID != nil {
		return s.NewID()
	}
	var b [8]byte
	_, _ = rand.Read(b[:])
	return "preview-" + hex.EncodeToString(b[:])
}

// hold stores a preview and drops expired ones.
func (ss *SourceSync) hold(p *SyncPreview, now time.Time) {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	maps.DeleteFunc(ss.previews, func(_ string, held *SyncPreview) bool { return now.After(held.expires) })
	ss.previews[p.ID] = p
}

// take removes and returns a held preview.
func (ss *SourceSync) take(id string, now time.Time) (*SyncPreview, error) {
	ss.mu.Lock()
	defer ss.mu.Unlock()
	p, ok := ss.previews[id]
	if !ok {
		return nil, &NotFound{Detail: fmt.Sprintf("No sync preview %q. Previews can be applied for %s.", id, PreviewTTL)}
	}
	delete(ss.previews, id)
	if now.After(p.expires) {
		return nil, ErrPreviewExpired
	}
	return p, nil
}
