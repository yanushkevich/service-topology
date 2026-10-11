package arcadedb

import (
	"context"
	"fmt"
	"strconv"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// GraphRepository implements ports.GraphRepository with SQL TRAVERSE over COMMUNICATES edges.
type GraphRepository struct{ c *Client }

var _ ports.GraphRepository = (*GraphRepository)(nil)

// NewGraphRepository returns a graph repository using c.
func NewGraphRepository(c *Client) *GraphRepository { return &GraphRepository{c: c} }

var traverseFunc = map[string]string{
	ports.DirectionUpstream:   `out("COMMUNICATES")`,
	ports.DirectionDownstream: `in("COMMUNICATES")`,
	ports.DirectionBoth:       `both("COMMUNICATES")`,
}

// Subgraph runs TRAVERSE from the start vertex (found through its type's unique id index), then
// loads the relationships whose endpoints are both in the visited set.
func (g *GraphRepository) Subgraph(ctx context.Context, startID domain.EntityID, direction string, maxDepth, maxEntities int) (*ports.Subgraph, error) {
	fn, ok := traverseFunc[direction]
	if !ok || maxDepth < 0 || maxEntities < 1 {
		return nil, fmt.Errorf("arcadedb: invalid traversal arguments")
	}
	tx, err := g.c.Begin(ctx) // one consistent view for both queries
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()

	startType := ""
	for _, t := range []string{"ServiceInstance", "Resource"} {
		rows, err := tx.Query(ctx, "SELECT id FROM "+t+" WHERE id = :id", map[string]any{"id": startID})
		if err != nil {
			return nil, err
		}
		if len(rows) > 0 {
			startType = t
			break
		}
	}
	if startType == "" {
		return nil, ports.ErrNotFound
	}
	// Direction, depth, and limit are validated integers/allowlisted functions, never raw input.
	sql := "SELECT id FROM (TRAVERSE " + fn + " FROM (SELECT FROM " + startType + " WHERE id = :id) MAXDEPTH " +
		strconv.Itoa(maxDepth) + " STRATEGY BREADTH_FIRST) LIMIT " + strconv.Itoa(maxEntities+1)
	rows, err := tx.Query(ctx, sql, map[string]any{"id": startID})
	if err != nil {
		return nil, err
	}
	if len(rows) > maxEntities {
		return nil, ports.ErrTooLarge
	}
	sub := &ports.Subgraph{StartID: startID, Relationships: []domain.CommunicationRelationship{}}
	for _, r := range rows {
		if id, ok := r["id"].(string); ok {
			sub.EntityIDs = append(sub.EntityIDs, id)
		}
	}
	rels, err := tx.Query(ctx, "SELECT FROM COMMUNICATES WHERE sourceEntityId IN :ids AND targetEntityId IN :ids ORDER BY ord",
		map[string]any{"ids": sub.EntityIDs})
	if err != nil {
		return nil, err
	}
	if err := fromRecords(rels, &sub.Relationships); err != nil {
		return nil, err
	}
	return sub, nil
}
