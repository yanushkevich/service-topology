package arcadedb

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// Backend-only properties stored next to the canonical fields and stripped on read
// (DOMAIN_MODEL.md "Metrics and provenance"; never part of the API payload).
const (
	propOrder      = "ord"        // position in the canonical collection, so reads preserve order
	propRecordedAt = "recordedAt" // when this backend stored the record
	propSourceType = "sourceType" // where the record came from: "fixture", later adapter names
)

var backendOnly = map[string]bool{propOrder: true, propRecordedAt: true, propSourceType: true}

// ValidationError is returned when a topology fails domain validation; nothing was written.
type ValidationError struct{ Issues []domain.Issue }

func (e *ValidationError) Error() string {
	return fmt.Sprintf("topology failed validation with %d issue(s), first: %s %s", len(e.Issues), e.Issues[0].Code, e.Issues[0].EntityID)
}

// TopologyRepository stores and reads the canonical topology. It implements ports.TopologyRepository.
//
// Reads are cached by revision: every import writes a new random revision to the TopologyState
// document in the same transaction as the data, and every read first fetches the revision (one
// indexed lookup) inside its read session. An unchanged revision returns the cached topology; a
// changed one (also from another process, e.g. `seed load`) re-reads it. Returned data is shared and
// must be treated as read-only.
type TopologyRepository struct {
	c   *Client
	now func() time.Time

	mu       sync.Mutex
	revision string
	cached   *domain.TopologyData
}

var _ ports.TopologyRepository = (*TopologyRepository)(nil)

// NewTopologyRepository returns a repository using c.
func NewTopologyRepository(c *Client) *TopologyRepository {
	return &TopologyRepository{c: c, now: time.Now}
}

// ImportResult counts what an import wrote.
type ImportResult struct {
	Vertices map[string]int
	Edges    map[string]int
}

// ReplaceTopology validates data and, in one transaction, replaces the stored canonical topology
// with it (snapshots and layouts are untouched). Importing the same data twice yields the same
// state, so seeding is idempotent. On any failure nothing is committed.
func (r *TopologyRepository) ReplaceTopology(ctx context.Context, data *domain.TopologyData, sourceType string) (ImportResult, error) {
	if issues := domain.Validate(data); len(issues) > 0 {
		return ImportResult{}, &ValidationError{Issues: issues}
	}
	ix := domain.BuildIndex(data)
	res := ImportResult{Vertices: map[string]int{}, Edges: map[string]int{}}
	recordedAt := r.now().UTC().Format(time.RFC3339)

	tx, err := r.c.Begin(ctx)
	if err != nil {
		return res, err
	}
	defer tx.Rollback()

	// DELETE VERTEX also removes every edge attached to the deleted vertices.
	for _, t := range vertexTypes {
		if _, err := tx.Command(ctx, "DELETE VERTEX FROM "+t, nil); err != nil {
			return res, err
		}
	}

	vertex := func(typ string, ord int, entity any) error {
		props, err := toProperties(entity)
		if err != nil {
			return err
		}
		props[propOrder], props[propRecordedAt], props[propSourceType] = ord, recordedAt, sourceType
		sql, params := setStatement("CREATE VERTEX "+typ, props)
		if _, err := tx.Command(ctx, sql, params); err != nil {
			return err
		}
		res.Vertices[typ]++
		return nil
	}
	for i := range data.Environments {
		if err := vertex("Environment", i, data.Environments[i]); err != nil {
			return res, err
		}
	}
	for i := range data.ServiceDefinitions {
		if err := vertex("ServiceDefinition", i, data.ServiceDefinitions[i]); err != nil {
			return res, err
		}
	}
	for i := range data.ServiceInstances {
		if err := vertex("ServiceInstance", i, data.ServiceInstances[i]); err != nil {
			return res, err
		}
	}
	for i := range data.Resources {
		if err := vertex("Resource", i, data.Resources[i]); err != nil {
			return res, err
		}
	}
	for i := range data.EventTypes {
		if err := vertex("EventType", i, data.EventTypes[i]); err != nil {
			return res, err
		}
	}

	// edge creates exactly one edge; a missing endpoint is an error, never a silent no-op.
	edge := func(typ, fromType, fromID, toType, toID string, props map[string]any) error {
		params := map[string]any{"from": fromID, "to": toID}
		sql := "CREATE EDGE " + typ + " FROM (SELECT FROM " + fromType + " WHERE id = :from) TO (SELECT FROM " + toType + " WHERE id = :to)"
		if len(props) > 0 {
			set, setParams := setClause(props)
			sql += " SET " + set
			for k, v := range setParams {
				params[k] = v
			}
		}
		rows, err := tx.Command(ctx, sql, params)
		if err != nil {
			return err
		}
		if len(rows) != 1 {
			return fmt.Errorf("arcadedb: %s %s → %s created %d edges, want 1", typ, fromID, toID, len(rows))
		}
		res.Edges[typ]++
		return nil
	}
	endpointType := func(id string) string {
		if ix.Instances[id] != nil {
			return "ServiceInstance"
		}
		return "Resource"
	}

	for i := range data.ServiceInstances {
		inst := &data.ServiceInstances[i]
		if err := edge("INSTANCE_OF", "ServiceInstance", inst.ID, "ServiceDefinition", inst.ServiceDefinitionID, nil); err != nil {
			return res, err
		}
		if err := edge("IN_ENVIRONMENT", "ServiceInstance", inst.ID, "Environment", *inst.EnvironmentID, nil); err != nil {
			return res, err
		}
		if inst.ResourceID != nil {
			if err := edge("HOSTED_IN", "ServiceInstance", inst.ID, "Resource", *inst.ResourceID, nil); err != nil {
				return res, err
			}
		}
	}
	for i := range data.Resources {
		res0 := &data.Resources[i]
		if res0.ParentResourceID != nil {
			if err := edge("CONTAINS", "Resource", *res0.ParentResourceID, "Resource", res0.ID, nil); err != nil {
				return res, err
			}
		}
		if res0.EnvironmentID != nil {
			if err := edge("IN_ENVIRONMENT", "Resource", res0.ID, "Environment", *res0.EnvironmentID, nil); err != nil {
				return res, err
			}
		}
	}
	for i := range data.Relationships {
		rel := data.Relationships[i]
		props, err := toProperties(rel)
		if err != nil {
			return res, err
		}
		props[propOrder], props[propRecordedAt], props[propSourceType] = i, recordedAt, sourceType
		if err := edge("COMMUNICATES", endpointType(rel.SourceEntityID), rel.SourceEntityID, endpointType(rel.TargetEntityID), rel.TargetEntityID, props); err != nil {
			return res, err
		}
	}
	for i := range data.EventTypes {
		e := &data.EventTypes[i]
		for _, ch := range e.ChannelResourceIDs {
			if err := edge("CARRIED_ON", "EventType", e.ID, "Resource", ch, nil); err != nil {
				return res, err
			}
		}
		for _, d := range e.ProducerServiceIDs {
			if err := edge("PRODUCED_BY", "EventType", e.ID, "ServiceDefinition", d, nil); err != nil {
				return res, err
			}
		}
		for _, d := range e.ConsumerServiceIDs {
			if err := edge("CONSUMED_BY", "EventType", e.ID, "ServiceDefinition", d, nil); err != nil {
				return res, err
			}
		}
	}
	var b [16]byte
	_, _ = rand.Read(b[:])
	if _, err := tx.Command(ctx, "UPDATE TopologyState SET id = 'topology', revision = :rev, recordedAt = :at UPSERT WHERE id = 'topology'",
		map[string]any{"rev": hex.EncodeToString(b[:]), "at": recordedAt}); err != nil {
		return res, err
	}
	return res, tx.Commit(ctx)
}

// GetTopology returns the stored canonical topology in its original collection order. Environment
// filtering is not implemented yet (it is defined with the API in Milestone B3).
func (r *TopologyRepository) GetTopology(ctx context.Context, environmentID domain.EntityID) (*domain.TopologyData, error) {
	if environmentID != "" {
		return nil, fmt.Errorf("arcadedb: environment filtering is not implemented yet (Milestone B3)")
	}
	// Read every collection inside one transaction so the parts come from the same state.
	tx, err := r.c.Begin(ctx)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	rows, err := tx.Query(ctx, "SELECT revision FROM TopologyState WHERE id = 'topology'", nil)
	if err != nil {
		return nil, err
	}
	revision := ""
	if len(rows) > 0 {
		revision, _ = rows[0]["revision"].(string)
	}
	r.mu.Lock()
	if revision != "" && revision == r.revision && r.cached != nil {
		cached := r.cached
		r.mu.Unlock()
		return cached, nil
	}
	r.mu.Unlock()
	data := &domain.TopologyData{}
	reads := []struct {
		from string
		into any
	}{
		{"Environment", &data.Environments},
		{"ServiceDefinition", &data.ServiceDefinitions},
		{"ServiceInstance", &data.ServiceInstances},
		{"Resource", &data.Resources},
		{"COMMUNICATES", &data.Relationships},
		{"EventType", &data.EventTypes},
	}
	for _, read := range reads {
		rows, err := tx.Query(ctx, "SELECT FROM "+read.from+" ORDER BY ord", nil)
		if err != nil {
			return nil, err
		}
		if err := fromRecords(rows, read.into); err != nil {
			return nil, fmt.Errorf("arcadedb: stored %s records do not match the domain model: %w", read.from, err)
		}
	}
	// Collections are arrays in the contract; an absent event type list stays absent.
	for _, p := range []any{&data.Environments, &data.ServiceDefinitions, &data.ServiceInstances, &data.Resources, &data.Relationships} {
		ensureNonNil(p)
	}
	if revision != "" {
		r.mu.Lock()
		r.revision, r.cached = revision, data
		r.mu.Unlock()
	}
	return data, nil
}

// toProperties converts a domain value to its canonical JSON object (field names from the schema).
func toProperties(v any) (map[string]any, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	var m map[string]any
	return m, dec.Decode(&m)
}

// fromRecords strips ArcadeDB metadata and backend-only properties and strictly decodes the rest.
func fromRecords(rows []Record, into any) error {
	clean := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		m := make(map[string]any, len(row))
		for k, v := range row {
			if strings.HasPrefix(k, "@") || backendOnly[k] {
				continue
			}
			m[k] = v
		}
		clean = append(clean, m)
	}
	b, err := json.Marshal(clean)
	if err != nil {
		return err
	}
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.DisallowUnknownFields()
	return dec.Decode(into)
}

func ensureNonNil(p any) {
	switch s := p.(type) {
	case *[]domain.Environment:
		if *s == nil {
			*s = []domain.Environment{}
		}
	case *[]domain.ServiceDefinition:
		if *s == nil {
			*s = []domain.ServiceDefinition{}
		}
	case *[]domain.ServiceInstance:
		if *s == nil {
			*s = []domain.ServiceInstance{}
		}
	case *[]domain.InfrastructureResource:
		if *s == nil {
			*s = []domain.InfrastructureResource{}
		}
	case *[]domain.CommunicationRelationship:
		if *s == nil {
			*s = []domain.CommunicationRelationship{}
		}
	}
}

// propertyName allowlists property names used in SET clauses. They come from the domain types'
// JSON tags (and the backend-only constants), never from request input, but are checked anyway.
var propertyName = regexp.MustCompile(`^[A-Za-z][A-Za-z0-9]*$`)

// setClause builds "a = :p_a, b = :p_b" with every value bound as a parameter. Keys are sorted so
// statements are deterministic.
func setClause(props map[string]any) (string, map[string]any) {
	keys := make([]string, 0, len(props))
	for k := range props {
		if !propertyName.MatchString(k) {
			panic("arcadedb: unsafe property name " + k) // programming error: names come from struct tags
		}
		keys = append(keys, k)
	}
	sort.Strings(keys)
	parts := make([]string, len(keys))
	params := make(map[string]any, len(keys))
	for i, k := range keys {
		parts[i] = k + " = :p_" + k
		params["p_"+k] = props[k]
	}
	return strings.Join(parts, ", "), params
}

func setStatement(prefix string, props map[string]any) (string, map[string]any) {
	set, params := setClause(props)
	return prefix + " SET " + set, params
}

// IsValidation reports whether err is a ValidationError.
func IsValidation(err error) bool {
	var v *ValidationError
	return errors.As(err, &v)
}
