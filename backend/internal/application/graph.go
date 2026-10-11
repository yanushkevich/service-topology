package application

import (
	"context"
	"errors"
	"fmt"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// Traversal bounds (docs/backend/API_SPEC.md "Traversal"): every graph endpoint is bounded.
const (
	DefaultMaxDepth      = 10
	MaxMaxDepth          = 10
	DefaultDependencyCap = 500
	MaxDependencyLimit   = 1000
	MaxNeighborhoodDepth = 3
	// MaxVisited caps how many entities one traversal may touch in the database.
	MaxVisited = 5000
)

// DependencyResult is GET /topology/dependencies.
type DependencyResult struct {
	EntityID  domain.EntityID          `json:"entityId"`
	Direction string                   `json:"direction"`
	MaxDepth  int                      `json:"maxDepth"`
	Truncated bool                     `json:"truncated"`
	Items     []domain.DependencyEntry `json:"items"`
}

// subgraph returns an index to traverse: the cached full topology (default), or the bounded
// subgraph fetched from the database. Both give identical results for depths up to the bound.
func (s *Service) subgraph(ctx context.Context, id domain.EntityID, direction string, depth int) (*domain.Index, error) {
	if !s.TraversalInDatabase || s.GraphRepo == nil {
		ix, err := s.index(ctx)
		if err != nil {
			return nil, err
		}
		if ix.Instances[id] == nil && ix.Resources[id] == nil {
			return nil, &NotFound{Detail: fmt.Sprintf("No service instance or resource with ID %q.", id)}
		}
		return ix, nil
	}
	sub, err := s.GraphRepo.Subgraph(ctx, id, direction, depth, MaxVisited)
	switch {
	case errors.Is(err, ports.ErrNotFound):
		return nil, &NotFound{Detail: fmt.Sprintf("No service instance or resource with ID %q.", id)}
	case errors.Is(err, ports.ErrTooLarge):
		return nil, &ErrInvalid{"maxDepth", fmt.Sprintf("the traversal would visit more than %d entities; use a smaller depth", MaxVisited)}
	case err != nil:
		return nil, err
	}
	return domain.BuildIndex(&domain.TopologyData{Relationships: sub.Relationships}), nil
}

// Dependencies returns the upstream or downstream dependency tree (as the client's dependencyTree),
// computed on the bounded subgraph fetched from the database.
func (s *Service) Dependencies(ctx context.Context, id domain.EntityID, direction string, maxDepth, limit int) (*DependencyResult, error) {
	if id == "" {
		return nil, &ErrInvalid{"entityId", "required"}
	}
	if direction != ports.DirectionUpstream && direction != ports.DirectionDownstream {
		return nil, &ErrInvalid{"direction", "must be upstream or downstream"}
	}
	if maxDepth == 0 {
		maxDepth = DefaultMaxDepth
	}
	if maxDepth < 1 || maxDepth > MaxMaxDepth {
		return nil, &ErrInvalid{"maxDepth", fmt.Sprintf("must be between 1 and %d", MaxMaxDepth)}
	}
	if limit == 0 {
		limit = DefaultDependencyCap
	}
	if limit < 1 || limit > MaxDependencyLimit {
		return nil, &ErrInvalid{"limit", fmt.Sprintf("must be between 1 and %d", MaxDependencyLimit)}
	}
	ix, err := s.subgraph(ctx, id, direction, maxDepth)
	if err != nil {
		return nil, err
	}
	items := ix.DependencyTree(id, direction, maxDepth)
	res := &DependencyResult{EntityID: id, Direction: direction, MaxDepth: maxDepth, Items: items}
	if len(items) > limit {
		res.Items, res.Truncated = items[:limit], true
	}
	return res, nil
}

// NeighborhoodResult is GET /topology/neighborhood.
type NeighborhoodResult struct {
	CenterID        domain.EntityID   `json:"centerId"`
	Depth           int               `json:"depth"`
	EntityIDs       []domain.EntityID `json:"entityIds"`
	RelationshipIDs []domain.EntityID `json:"relationshipIds"`
}

// Neighborhood returns entities within depth hops ignoring direction (as the client's
// neighborhood), plus the relationships between them.
func (s *Service) Neighborhood(ctx context.Context, id domain.EntityID, depth int) (*NeighborhoodResult, error) {
	if id == "" {
		return nil, &ErrInvalid{"entityId", "required"}
	}
	if depth == 0 {
		depth = 1
	}
	if depth < 1 || depth > MaxNeighborhoodDepth {
		return nil, &ErrInvalid{"depth", fmt.Sprintf("must be between 1 and %d", MaxNeighborhoodDepth)}
	}
	ix, err := s.subgraph(ctx, id, ports.DirectionBoth, depth)
	if err != nil {
		return nil, err
	}
	set := ix.Neighborhood(id, depth)
	rels := map[domain.EntityID]bool{}
	for _, r := range ix.Data.Relationships {
		if set[r.SourceEntityID] && set[r.TargetEntityID] {
			rels[r.ID] = true
		}
	}
	return &NeighborhoodResult{CenterID: id, Depth: depth, EntityIDs: domain.SortedIDs(set), RelationshipIDs: domain.SortedIDs(rels)}, nil
}

// ImpactResult is GET /topology/impact.
type ImpactResult struct {
	Roots   []domain.FailureRoot `json:"roots"`
	Impacts []domain.Impact      `json:"impacts"`
}

// Impact is a read-only what-if: the entities affected if the roots failed, per the propagation
// rules. It needs containment and multi-hop callers, so it runs on the full topology index.
func (s *Service) Impact(ctx context.Context, roots []domain.FailureRoot) (*ImpactResult, error) {
	if len(roots) == 0 {
		return nil, &ErrInvalid{"entityId", "required"}
	}
	if len(roots) > 20 {
		return nil, &ErrInvalid{"entityId", "at most 20 roots"}
	}
	ix, err := s.index(ctx)
	if err != nil {
		return nil, err
	}
	for _, r := range roots {
		if r.Mode != domain.FailureUnavailable && r.Mode != domain.FailureDegraded {
			return nil, &ErrInvalid{"mode", "must be unavailable or degraded"}
		}
		if ix.Instances[r.EntityID] == nil && ix.Resources[r.EntityID] == nil {
			return nil, &NotFound{Detail: fmt.Sprintf("No service instance or resource with ID %q.", r.EntityID)}
		}
	}
	return &ImpactResult{Roots: roots, Impacts: ix.AnalyzeImpact(roots)}, nil
}

// EventTypes lists the event flows present in an environment, by name.
func (s *Service) EventTypes(ctx context.Context, environmentID string) ([]domain.EventFlow, error) {
	ix, err := s.envIndex(ctx, environmentID)
	if err != nil {
		return nil, err
	}
	return ix.EventFlowsIn(environmentID), nil
}

// EventType resolves one event type in an environment.
func (s *Service) EventType(ctx context.Context, id, environmentID string) (*domain.EventFlow, error) {
	ix, err := s.envIndex(ctx, environmentID)
	if err != nil {
		return nil, err
	}
	e := ix.EventTypes[id]
	if e == nil {
		return nil, &NotFound{Detail: fmt.Sprintf("No event type with ID %q.", id)}
	}
	flow, ok := ix.ResolveEventFlow(e, environmentID)
	if !ok {
		return nil, &NotFound{Detail: fmt.Sprintf("Event type %q is not carried in environment %q.", id, environmentID)}
	}
	return &flow, nil
}

func (s *Service) envIndex(ctx context.Context, environmentID string) (*domain.Index, error) {
	if environmentID == "" {
		return nil, &ErrInvalid{"environmentId", "required"}
	}
	ix, err := s.index(ctx)
	if err != nil {
		return nil, err
	}
	if ix.Environments[environmentID] == nil {
		return nil, &NotFound{Detail: fmt.Sprintf("No environment with ID %q.", environmentID)}
	}
	return ix, nil
}
