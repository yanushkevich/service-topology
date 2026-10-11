// Package application holds the use cases behind the HTTP API (docs/backend/API_SPEC.md). It
// depends on ports and the domain only.
package application

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// ErrInvalid reports a bad request parameter (HTTP 400).
type ErrInvalid struct{ Param, Reason string }

func (e *ErrInvalid) Error() string { return fmt.Sprintf("invalid %s: %s", e.Param, e.Reason) }

// ErrValidation reports a payload that failed domain validation (HTTP 422).
type ErrValidation struct{ Issues []domain.Issue }

func (e *ErrValidation) Error() string { return fmt.Sprintf("%d validation issue(s)", len(e.Issues)) }

// NotFound wraps ports.ErrNotFound with a human-readable detail.
type NotFound struct{ Detail string }

func (e *NotFound) Error() string { return e.Detail }
func (e *NotFound) Unwrap() error { return ports.ErrNotFound }

// Service implements the API use cases.
type Service struct {
	TopologyRepo ports.TopologyRepository
	SnapshotRepo ports.SnapshotRepository
	LayoutRepo   ports.SavedLayoutRepository
	GraphRepo    ports.GraphRepository
	SimRepo      ports.SimulationRepository
	// Retention for simulation runs (zero values disable pruning).
	SimulationRetention time.Duration
	SimulationMaxRuns   int
	// Now and NewID are injectable for tests.
	Now   func() time.Time
	NewID func() string
	// Logger receives non-fatal problems such as failed retention pruning.
	Logger *slog.Logger
}

func (s *Service) index(ctx context.Context) (*domain.Index, error) {
	data, err := s.TopologyRepo.GetTopology(ctx, "")
	if err != nil {
		return nil, err
	}
	return domain.BuildIndex(data), nil
}

// Environments returns environments in display order.
func (s *Service) Environments(ctx context.Context) ([]domain.Environment, error) {
	ix, err := s.index(ctx)
	if err != nil {
		return nil, err
	}
	return domain.SortEnvironments(ix.Data.Environments), nil
}

// Topology returns the canonical topology, or its projection onto one environment.
func (s *Service) Topology(ctx context.Context, environmentID string) (*domain.TopologyData, error) {
	ix, err := s.index(ctx)
	if err != nil {
		return nil, err
	}
	if environmentID == "" {
		return ix.Data, nil
	}
	out, ok := ix.FilterEnvironment(environmentID)
	if !ok {
		return nil, &NotFound{Detail: fmt.Sprintf("No environment with ID %q.", environmentID)}
	}
	return out, nil
}

// RegistryQuery is a parsed GET /registry request.
type RegistryQuery struct {
	EnvironmentID string
	Filters       domain.Filters
	Sort          string // "name", "-name", … (default "health")
	Cursor        string
	Limit         int // 1..500 (default 100)
}

// RegistryPage is one page of rows; NextCursor is nil at the end.
type RegistryPage struct {
	Items      []domain.RegistryRow `json:"items"`
	NextCursor *string              `json:"nextCursor"`
}

// MaxRegistryLimit is the contract's page-size maximum.
const MaxRegistryLimit = 500

type cursor struct {
	Offset int    `json:"o"`
	Query  string `json:"q"`
}

// fingerprint ties a cursor to the query that produced it.
func (q RegistryQuery) fingerprint() string { return fingerprintOf(q.EnvironmentID, q.Filters, q.Sort) }

func fingerprintOf(parts ...any) string {
	b, _ := json.Marshal(parts)
	sum := sha256.Sum256(b)
	return hex.EncodeToString(sum[:8])
}

func encodeCursor(offset int, fingerprint string) string {
	b, _ := json.Marshal(cursor{Offset: offset, Query: fingerprint})
	return base64.RawURLEncoding.EncodeToString(b)
}

func decodeCursor(raw, fingerprint string) (int, bool) {
	b, err := base64.RawURLEncoding.DecodeString(raw)
	var c cursor
	if err != nil || json.Unmarshal(b, &c) != nil || c.Offset < 0 || c.Query != fingerprint {
		return 0, false
	}
	return c.Offset, true
}

// Registry filters, sorts (identically to the client), and pages registry rows. Cursors are
// opaque, valid only for the same query, and offset-based: if the topology changes between pages,
// rows may shift (documented in docs/API_CONTRACT.md).
func (s *Service) Registry(ctx context.Context, q RegistryQuery) (*RegistryPage, error) {
	if q.EnvironmentID == "" {
		return nil, &ErrInvalid{"environmentId", "required"}
	}
	if q.Sort == "" {
		q.Sort = "health"
	}
	sortSpec, ok := domain.ParseRegistrySort(q.Sort)
	if !ok {
		return nil, &ErrInvalid{"sort", "unknown sort key"}
	}
	if q.Limit == 0 {
		q.Limit = 100
	}
	if q.Limit < 1 || q.Limit > MaxRegistryLimit {
		return nil, &ErrInvalid{"limit", fmt.Sprintf("must be between 1 and %d", MaxRegistryLimit)}
	}
	offset := 0
	if q.Cursor != "" {
		o, ok := decodeCursor(q.Cursor, q.fingerprint())
		if !ok {
			return nil, &ErrInvalid{"cursor", "unknown, malformed, or from a different query"}
		}
		offset = o
	}
	ix, err := s.index(ctx)
	if err != nil {
		return nil, err
	}
	if ix.Environments[q.EnvironmentID] == nil {
		return nil, &NotFound{Detail: fmt.Sprintf("No environment with ID %q.", q.EnvironmentID)}
	}
	rows := domain.SortRegistryRows(domain.FilterRegistryRows(ix.BuildRegistryRows(), q.Filters, q.EnvironmentID), sortSpec)
	page := &RegistryPage{Items: []domain.RegistryRow{}}
	if offset < len(rows) {
		end := min(offset+q.Limit, len(rows))
		page.Items = rows[offset:end]
		if end < len(rows) {
			next := encodeCursor(end, q.fingerprint())
			page.NextCursor = &next
		}
	}
	return page, nil
}

// Entity returns one canonical entity by kind and ID.
func (s *Service) Entity(ctx context.Context, kind, id string) (any, error) {
	ix, err := s.index(ctx)
	if err != nil {
		return nil, err
	}
	var found any
	switch kind {
	case domain.KindEnvironment:
		if e := ix.Environments[id]; e != nil {
			found = e
		}
	case domain.KindServiceDefinition:
		if e := ix.Definitions[id]; e != nil {
			found = e
		}
	case domain.KindServiceInstance:
		if e := ix.Instances[id]; e != nil {
			found = e
		}
	case domain.KindResource:
		if e := ix.Resources[id]; e != nil {
			found = e
		}
	case domain.KindRelationship:
		if e := ix.Relationships[id]; e != nil {
			found = e
		}
	default:
		return nil, &ErrInvalid{"kind", "must be environment, service-definition, service-instance, resource, or relationship"}
	}
	if found == nil {
		return nil, &NotFound{Detail: fmt.Sprintf("No %s with ID %q.", kind, id)}
	}
	return found, nil
}

// Snapshots lists snapshot summaries, oldest first, within optional RFC 3339 bounds.
func (s *Service) Snapshots(ctx context.Context, from, to string) ([]domain.SnapshotSummary, error) {
	for name, v := range map[string]string{"from": from, "to": to} {
		if v != "" && !validTime(v) {
			return nil, &ErrInvalid{name, "must be an RFC 3339 date-time"}
		}
	}
	return s.SnapshotRepo.List(ctx, ports.SnapshotQuery{From: from, To: to})
}

// Snapshot returns one snapshot.
func (s *Service) Snapshot(ctx context.Context, id string) (*domain.Snapshot, error) {
	snap, err := s.SnapshotRepo.Get(ctx, id)
	if errors.Is(err, ports.ErrNotFound) {
		return nil, &NotFound{Detail: fmt.Sprintf("No snapshot with ID %q.", id)}
	}
	return snap, err
}

// CaptureSnapshot validates and stores a new snapshot.
func (s *Service) CaptureSnapshot(ctx context.Context, snap *domain.Snapshot) (*domain.SnapshotSummary, error) {
	if issues := domain.ValidateSnapshot(snap); len(issues) > 0 {
		return nil, &ErrValidation{Issues: issues}
	}
	if err := s.SnapshotRepo.Save(ctx, snap); err != nil {
		return nil, err
	}
	return &snap.SnapshotSummary, nil
}

// Layouts lists saved layouts, newest first.
func (s *Service) Layouts(ctx context.Context) ([]domain.SavedLayout, error) {
	return s.LayoutRepo.List(ctx)
}

func checkLayout(l *domain.SavedLayout) error {
	domain.NormalizeSavedLayout(l)
	if issues := domain.ValidateSavedLayout(l); len(issues) > 0 {
		return &ErrValidation{Issues: issues}
	}
	return nil
}

// CreateLayout validates and stores a new layout.
func (s *Service) CreateLayout(ctx context.Context, l *domain.SavedLayout) error {
	if err := checkLayout(l); err != nil {
		return err
	}
	return s.LayoutRepo.Create(ctx, l)
}

// ReplaceLayout validates and replaces the layout with the path ID.
func (s *Service) ReplaceLayout(ctx context.Context, id string, l *domain.SavedLayout) error {
	if l.ID != id {
		return &ErrValidation{Issues: []domain.Issue{{Severity: domain.SeverityError, Code: domain.CodeInvalidLayout, EntityID: l.ID, Message: "body id must equal the path id"}}}
	}
	if err := checkLayout(l); err != nil {
		return err
	}
	if err := s.LayoutRepo.Replace(ctx, l); errors.Is(err, ports.ErrNotFound) {
		return &NotFound{Detail: fmt.Sprintf("No layout with ID %q.", id)}
	} else {
		return err
	}
}

// DeleteLayout removes a layout.
func (s *Service) DeleteLayout(ctx context.Context, id string) error {
	if err := s.LayoutRepo.Remove(ctx, id); errors.Is(err, ports.ErrNotFound) {
		return &NotFound{Detail: fmt.Sprintf("No layout with ID %q.", id)}
	} else {
		return err
	}
}

func validTime(s string) bool {
	_, err := time.Parse(time.RFC3339Nano, s)
	return err == nil
}
