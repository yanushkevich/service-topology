package application

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"time"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
	"servicetopology/backend/internal/ports"
)

// Writing the canonical topology one entity at a time (ADR-020): create, replace, delete. Every
// write validates the whole resulting topology with the same rules as the client
// (domain.Validate = validateTopology), so a write can never store an invalid topology. A delete of
// an entity that others still reference fails that validation, and the issues name the blockers.

// SourceManual marks entities written through the API (stored as backend-only provenance).
const SourceManual = "manual"

// ErrPrecondition reports a stale If-Match revision (HTTP 412).
type ErrPrecondition struct{ Current string }

func (e *ErrPrecondition) Error() string { return "the topology changed since it was read" }
func (e *ErrPrecondition) Unwrap() error { return ports.ErrPreconditionFailed }

// ErrImportedFlow refuses API writes to an imported business flow, and creating one marked imported:
// imported flows change only through the importer (ADR-022), so the next import cannot lose edits.
var ErrImportedFlow = errors.New("imported business flows are read-only; change the source and import again, or duplicate it as an authored flow")

// ErrReadOnly reports a repository that cannot write (HTTP 405).
var ErrReadOnly = errors.New("this deployment's topology is read-only")

// WriteResult is the stored entity (with server-set fields), its ID, and the new topology revision.
type WriteResult struct {
	ID       string
	Entity   any
	Revision string
}

func (s *Service) writer() (ports.TopologyWriter, error) {
	w, ok := s.TopologyRepo.(ports.TopologyWriter)
	if !ok {
		return nil, ErrReadOnly
	}
	return w, nil
}

// TopologyRevision returns the topology with its revision (ETag of GET /topology).
func (s *Service) TopologyRevision(ctx context.Context, environmentID string) (*domain.TopologyData, string, error) {
	w, err := s.writer()
	if err != nil {
		data, err := s.Topology(ctx, environmentID)
		return data, "", err
	}
	data, rev, err := w.CurrentTopology(ctx)
	if err != nil {
		return nil, "", err
	}
	if environmentID == "" {
		return data, rev, nil
	}
	out, ok := domain.BuildIndex(data).FilterEnvironment(environmentID)
	if !ok {
		return nil, "", &NotFound{Detail: fmt.Sprintf("No environment with ID %q.", environmentID)}
	}
	return out, rev, nil
}

// DecodeEntity strictly decodes a request body into the domain type for kind.
func DecodeEntity(kind string, raw []byte) (any, error) {
	var v any
	switch kind {
	case domain.KindEnvironment:
		v = &domain.Environment{}
	case domain.KindServiceDefinition:
		v = &domain.ServiceDefinition{}
	case domain.KindServiceInstance:
		v = &domain.ServiceInstance{}
	case domain.KindResource:
		v = &domain.InfrastructureResource{}
	case domain.KindRelationship:
		v = &domain.CommunicationRelationship{}
	case domain.KindEventType:
		v = &domain.EventType{}
	case domain.KindBusinessFlow:
		v = &domain.BusinessFlow{}
	default:
		return nil, invalidKind()
	}
	if err := fixtures.DecodeStrict(raw, v); err != nil {
		return nil, &ErrInvalid{"body", "not valid JSON for a " + kind + ": " + err.Error()}
	}
	return v, nil
}

func invalidKind() error {
	return &ErrInvalid{"kind", "must be environment, service-definition, service-instance, resource, relationship, event-type, or business-flow"}
}

// CreateEntity stores a new entity. ifMatch, when set, must equal the current revision.
func (s *Service) CreateEntity(ctx context.Context, kind string, entity any, ifMatch string) (*WriteResult, error) {
	return s.write(ctx, ports.OpCreate, kind, "", entity, ifMatch)
}

// ReplaceEntity replaces the entity with the path ID (the body's id must match).
func (s *Service) ReplaceEntity(ctx context.Context, kind, id string, entity any, ifMatch string) (*WriteResult, error) {
	return s.write(ctx, ports.OpReplace, kind, id, entity, ifMatch)
}

// DeleteEntity removes an entity that nothing references any more.
func (s *Service) DeleteEntity(ctx context.Context, kind, id, ifMatch string) (*WriteResult, error) {
	return s.write(ctx, ports.OpDelete, kind, id, nil, ifMatch)
}

func (s *Service) write(ctx context.Context, op, kind, pathID string, entity any, ifMatch string) (*WriteResult, error) {
	if !slices.Contains(domain.WritableKinds, kind) {
		return nil, invalidKind()
	}
	w, err := s.writer()
	if err != nil {
		return nil, err
	}
	current, rev, err := w.CurrentTopology(ctx)
	if err != nil {
		return nil, err
	}
	if ifMatch != "" && ifMatch != rev {
		return nil, &ErrPrecondition{Current: rev}
	}
	candidate := cloneTopology(current)
	id := pathID
	if op != ports.OpDelete {
		if issues := domain.ValidateEntityFields(kind, entity); len(issues) > 0 {
			return nil, &ErrValidation{Issues: issues}
		}
		id = entityID(entity)
		if op == ports.OpReplace && id != pathID {
			return nil, &ErrValidation{Issues: []domain.Issue{{Severity: domain.SeverityError, Code: domain.CodeInvalidField, EntityID: id, Message: "id: must equal the ID in the path; IDs cannot be changed"}}}
		}
	}
	existing := findEntity(candidate, kind, id)
	if kind == domain.KindBusinessFlow {
		if f, ok := entity.(*domain.BusinessFlow); ok && f.Source.Kind == "imported" {
			return nil, ErrImportedFlow
		}
		if existing >= 0 && candidate.BusinessFlows[existing].Source.Kind == "imported" {
			return nil, ErrImportedFlow
		}
	}
	switch {
	case op == ports.OpCreate && entityExists(candidate, id):
		return nil, fmt.Errorf("%w: %s", ports.ErrConflict, id)
	case op != ports.OpCreate && existing < 0:
		return nil, &NotFound{Detail: fmt.Sprintf("No %s with ID %q.", kind, id)}
	}
	if entity != nil {
		s.setServerFields(candidate, existing, entity)
	}
	applyChange(candidate, kind, op, existing, entity)
	if issues := domain.Validate(candidate); len(issues) > 0 {
		return nil, &ErrValidation{Issues: issues}
	}
	newRev, err := w.ApplyChange(ctx, ports.EntityChange{Op: op, Kind: kind, ID: id, Entity: entity}, rev, SourceManual)
	if errors.Is(err, ports.ErrPreconditionFailed) {
		return nil, &ErrPrecondition{}
	}
	if err != nil {
		return nil, err
	}
	return &WriteResult{ID: id, Entity: entity, Revision: newRev}, nil
}

func cloneTopology(d *domain.TopologyData) *domain.TopologyData {
	raw, _ := json.Marshal(d)
	out := &domain.TopologyData{}
	_ = json.Unmarshal(raw, out)
	return out
}

func entityID(entity any) string {
	switch e := entity.(type) {
	case *domain.Environment:
		return e.ID
	case *domain.ServiceDefinition:
		return e.ID
	case *domain.ServiceInstance:
		return e.ID
	case *domain.InfrastructureResource:
		return e.ID
	case *domain.CommunicationRelationship:
		return e.ID
	case *domain.EventType:
		return e.ID
	case *domain.BusinessFlow:
		return e.ID
	}
	return ""
}

// entityExists reports whether any collection holds id (IDs are unique across collections).
func entityExists(d *domain.TopologyData, id string) bool {
	for _, kind := range domain.WritableKinds {
		if findEntity(d, kind, id) >= 0 {
			return true
		}
	}
	return false
}

func indexOf[T any](items []T, id string, idOf func(*T) string) int {
	for i := range items {
		if idOf(&items[i]) == id {
			return i
		}
	}
	return -1
}

func findEntity(d *domain.TopologyData, kind, id string) int {
	switch kind {
	case domain.KindEnvironment:
		return indexOf(d.Environments, id, func(e *domain.Environment) string { return e.ID })
	case domain.KindServiceDefinition:
		return indexOf(d.ServiceDefinitions, id, func(e *domain.ServiceDefinition) string { return e.ID })
	case domain.KindServiceInstance:
		return indexOf(d.ServiceInstances, id, func(e *domain.ServiceInstance) string { return e.ID })
	case domain.KindResource:
		return indexOf(d.Resources, id, func(e *domain.InfrastructureResource) string { return e.ID })
	case domain.KindRelationship:
		return indexOf(d.Relationships, id, func(e *domain.CommunicationRelationship) string { return e.ID })
	case domain.KindEventType:
		return indexOf(d.EventTypes, id, func(e *domain.EventType) string { return e.ID })
	case domain.KindBusinessFlow:
		return indexOf(d.BusinessFlows, id, func(e *domain.BusinessFlow) string { return e.ID })
	}
	return -1
}

func change[T any](items []T, op string, at int, v *T) []T {
	switch op {
	case ports.OpCreate:
		return append(items, *v)
	case ports.OpReplace:
		items[at] = *v
		return items
	default:
		return slices.Delete(items, at, at+1)
	}
}

func applyChange(d *domain.TopologyData, kind, op string, at int, entity any) {
	switch kind {
	case domain.KindEnvironment:
		e, _ := entity.(*domain.Environment)
		d.Environments = change(d.Environments, op, at, e)
	case domain.KindServiceDefinition:
		e, _ := entity.(*domain.ServiceDefinition)
		d.ServiceDefinitions = change(d.ServiceDefinitions, op, at, e)
	case domain.KindServiceInstance:
		e, _ := entity.(*domain.ServiceInstance)
		d.ServiceInstances = change(d.ServiceInstances, op, at, e)
	case domain.KindResource:
		e, _ := entity.(*domain.InfrastructureResource)
		d.Resources = change(d.Resources, op, at, e)
	case domain.KindRelationship:
		e, _ := entity.(*domain.CommunicationRelationship)
		d.Relationships = change(d.Relationships, op, at, e)
	case domain.KindEventType:
		e, _ := entity.(*domain.EventType)
		d.EventTypes = change(d.EventTypes, op, at, e)
		if len(d.EventTypes) == 0 {
			d.EventTypes = nil
		}
	case domain.KindBusinessFlow:
		e, _ := entity.(*domain.BusinessFlow)
		d.BusinessFlows = change(d.BusinessFlows, op, at, e)
		if len(d.BusinessFlows) == 0 {
			d.BusinessFlows = nil
		}
	}
}

// setServerFields sets what clients cannot write: updatedAt is the write time, and telemetry is
// kept from the stored entity (new entities have none). Required arrays are never null.
func (s *Service) setServerFields(d *domain.TopologyData, existing int, entity any) {
	now := time.Now
	if s.Now != nil {
		now = s.Now
	}
	ts := now().UTC().Format(time.RFC3339)
	switch e := entity.(type) {
	case *domain.ServiceDefinition:
		if e.Protocols == nil {
			e.Protocols = []string{}
		}
	case *domain.ServiceInstance:
		e.UpdatedAt = ts
		e.Metrics = nil
		if existing >= 0 {
			e.Metrics = d.ServiceInstances[existing].Metrics
		}
	case *domain.InfrastructureResource:
		e.UpdatedAt = &ts
		e.Metrics = nil
		if existing >= 0 {
			e.Metrics = d.Resources[existing].Metrics
		}
	case *domain.CommunicationRelationship:
		e.UpdatedAt = ts
		e.Metrics = nil
		if existing >= 0 {
			e.Metrics = d.Relationships[existing].Metrics
		}
	case *domain.EventType:
		for _, p := range []*[]domain.EntityID{&e.ChannelResourceIDs, &e.ProducerServiceIDs, &e.ConsumerServiceIDs} {
			if *p == nil {
				*p = []domain.EntityID{}
			}
		}
	case *domain.BusinessFlow:
		if e.Transitions == nil {
			e.Transitions = []domain.FlowTransition{}
		}
		for i := range e.Transitions {
			if e.Transitions[i].Policies == nil {
				e.Transitions[i].Policies = []domain.FlowPolicy{}
			}
		}
	}
}
