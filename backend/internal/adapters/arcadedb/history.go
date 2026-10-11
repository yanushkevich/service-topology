package arcadedb

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
	"servicetopology/backend/internal/ports"
)

// Snapshots and saved layouts are documents: indexed id (and takenAt/createdAt) plus the validated
// JSON payload. They are immutable (snapshots) or replaced whole (layouts), so a serialized payload
// keeps them exact (PERSISTENCE.md: bounded serialized snapshot payloads).

// SnapshotRepository implements ports.SnapshotRepository.
type SnapshotRepository struct{ c *Client }

// LayoutRepository implements ports.SavedLayoutRepository.
type LayoutRepository struct{ c *Client }

var (
	_ ports.SnapshotRepository    = (*SnapshotRepository)(nil)
	_ ports.SavedLayoutRepository = (*LayoutRepository)(nil)
)

// NewSnapshotRepository returns a snapshot repository using c.
func NewSnapshotRepository(c *Client) *SnapshotRepository { return &SnapshotRepository{c: c} }

// NewLayoutRepository returns a layout repository using c.
func NewLayoutRepository(c *Client) *LayoutRepository { return &LayoutRepository{c: c} }

var before = domain.Before

func payloadOf(row Record, into any) error {
	raw, ok := row["payload"].(string)
	if !ok {
		return fmt.Errorf("arcadedb: stored record has no payload")
	}
	return fixtures.DecodeStrict([]byte(raw), into)
}

// List returns summaries ordered by takenAt (oldest first), optionally bounded by RFC 3339 times.
// Times are compared as instants, so offsets other than Z sort correctly.
func (r *SnapshotRepository) List(ctx context.Context, q ports.SnapshotQuery) ([]domain.SnapshotSummary, error) {
	rows, err := r.c.Query(ctx, "SELECT summary FROM Snapshot", nil)
	if err != nil {
		return nil, err
	}
	out := []domain.SnapshotSummary{}
	for _, row := range rows {
		raw, _ := row["summary"].(string)
		var s domain.SnapshotSummary
		if err := fixtures.DecodeStrict([]byte(raw), &s); err != nil {
			return nil, fmt.Errorf("arcadedb: stored snapshot summary: %w", err)
		}
		if q.From != "" && before(s.TakenAt, q.From) || q.To != "" && before(q.To, s.TakenAt) {
			continue
		}
		out = append(out, s)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if before(out[i].TakenAt, out[j].TakenAt) != before(out[j].TakenAt, out[i].TakenAt) {
			return before(out[i].TakenAt, out[j].TakenAt)
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

// Get returns one snapshot or ports.ErrNotFound.
func (r *SnapshotRepository) Get(ctx context.Context, id string) (*domain.Snapshot, error) {
	rows, err := r.c.Query(ctx, "SELECT payload FROM Snapshot WHERE id = :id", map[string]any{"id": id})
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return nil, ports.ErrNotFound
	}
	var s domain.Snapshot
	return &s, payloadOf(rows[0], &s)
}

// Save stores a new, already validated snapshot; ports.ErrConflict if the ID exists.
func (r *SnapshotRepository) Save(ctx context.Context, s *domain.Snapshot) error {
	payload, err := json.Marshal(s)
	if err != nil {
		return err
	}
	summary, _ := json.Marshal(s.SnapshotSummary)
	_, err = r.c.Command(ctx, "INSERT INTO Snapshot SET id = :id, takenAt = :takenAt, summary = :summary, payload = :payload",
		map[string]any{"id": s.ID, "takenAt": s.TakenAt, "summary": string(summary), "payload": string(payload)})
	return err
}

// List returns layouts newest first (createdAt descending, then ID).
func (r *LayoutRepository) List(ctx context.Context) ([]domain.SavedLayout, error) {
	rows, err := r.c.Query(ctx, "SELECT payload FROM SavedLayout", nil)
	if err != nil {
		return nil, err
	}
	out := []domain.SavedLayout{}
	for _, row := range rows {
		var l domain.SavedLayout
		if err := payloadOf(row, &l); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].CreatedAt != out[j].CreatedAt {
			return before(out[j].CreatedAt, out[i].CreatedAt)
		}
		return out[i].ID < out[j].ID
	})
	return out, nil
}

// Create stores a new layout; ports.ErrConflict if the ID exists (unique index).
func (r *LayoutRepository) Create(ctx context.Context, l *domain.SavedLayout) error {
	payload, err := json.Marshal(l)
	if err != nil {
		return err
	}
	_, err = r.c.Command(ctx, "INSERT INTO SavedLayout SET id = :id, payload = :payload", map[string]any{"id": l.ID, "payload": string(payload)})
	return err
}

// Replace overwrites an existing layout; ports.ErrNotFound if it does not exist.
func (r *LayoutRepository) Replace(ctx context.Context, l *domain.SavedLayout) error {
	payload, err := json.Marshal(l)
	if err != nil {
		return err
	}
	rows, err := r.c.Command(ctx, "UPDATE SavedLayout SET payload = :payload RETURN AFTER WHERE id = :id", map[string]any{"id": l.ID, "payload": string(payload)})
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return ports.ErrNotFound
	}
	return nil
}

// Remove deletes a layout; ports.ErrNotFound if it does not exist.
func (r *LayoutRepository) Remove(ctx context.Context, id string) error {
	rows, err := r.c.Command(ctx, "DELETE FROM SavedLayout RETURN BEFORE WHERE id = :id", map[string]any{"id": id})
	if err != nil {
		return err
	}
	if len(rows) == 0 {
		return ports.ErrNotFound
	}
	return nil
}
