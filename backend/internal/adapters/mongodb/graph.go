package mongodb

import (
	"context"
	"errors"
	"fmt"
	"sort"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// GraphRepository implements ports.GraphRepository with $graphLookup over the relationships
// collection (TRAVERSAL_SOURCE=database; the default traverses the cached topology in memory).
type GraphRepository struct{ s *Store }

var _ ports.GraphRepository = (*GraphRepository)(nil)

// NewGraphRepository returns a graph repository using s.
func NewGraphRepository(s *Store) *GraphRepository { return &GraphRepository{s: s} }

// traversal fields per direction: $graphLookup matches relationships whose `to` field equals an
// entity in the frontier and continues from their `from` field. Upstream follows outgoing
// relationships (source → target), downstream incoming ones, both the undirected endpoint pair.
var traversal = map[string]struct{ from, to string }{
	ports.DirectionUpstream:   {"targetEntityId", "sourceEntityId"},
	ports.DirectionDownstream: {"sourceEntityId", "targetEntityId"},
	ports.DirectionBoth:       {"_meta.endpoints", "_meta.endpoints"},
}

// Subgraph finds every entity within maxDepth hops of startID, then loads the relationships whose
// endpoints are both in that set. A relationship found at $graphLookup depth d has its far endpoint
// at most d+1 hops away, so maxDepth hops means depth maxDepth-1.
func (g *GraphRepository) Subgraph(ctx context.Context, startID domain.EntityID, direction string, maxDepth, maxEntities int) (*ports.Subgraph, error) {
	fields, ok := traversal[direction]
	if !ok || maxDepth < 0 || maxEntities < 1 {
		return nil, fmt.Errorf("mongodb: invalid traversal arguments")
	}
	var sub *ports.Subgraph
	err := g.s.inTx(ctx, func(ctx context.Context) error { // one consistent view for both queries
		startColl := ""
		for _, c := range []string{collServiceInstances, collResources} {
			err := g.s.coll(c).FindOne(ctx, byID(startID)).Err()
			if err == nil {
				startColl = c
				break
			}
			if !errors.Is(err, mongo.ErrNoDocuments) {
				return err
			}
		}
		if startColl == "" {
			return ports.ErrNotFound
		}
		visited := map[string]bool{startID: true}
		if maxDepth > 0 {
			// Field names and depth come from the allowlist above and validated integers; the start ID
			// is a bound value.
			pipeline := mongo.Pipeline{
				{{Key: "$match", Value: byID(startID)}},
				{{Key: "$graphLookup", Value: bson.D{
					{Key: "from", Value: collRelationships},
					{Key: "startWith", Value: "$_id"},
					{Key: "connectFromField", Value: fields.from},
					{Key: "connectToField", Value: fields.to},
					{Key: "maxDepth", Value: maxDepth - 1},
					{Key: "as", Value: "found"},
				}}},
				{{Key: "$project", Value: bson.D{{Key: "found.sourceEntityId", Value: 1}, {Key: "found.targetEntityId", Value: 1}}}},
			}
			cur, err := g.s.coll(startColl).Aggregate(ctx, pipeline)
			if err != nil {
				return err
			}
			var rows []struct {
				Found []struct {
					Source string `bson:"sourceEntityId"`
					Target string `bson:"targetEntityId"`
				} `bson:"found"`
			}
			if err := cur.All(ctx, &rows); err != nil {
				return err
			}
			for _, row := range rows {
				for _, rel := range row.Found {
					if direction != ports.DirectionDownstream {
						visited[rel.Target] = true
					}
					if direction != ports.DirectionUpstream {
						visited[rel.Source] = true
					}
				}
			}
		}
		if len(visited) > maxEntities {
			return ports.ErrTooLarge
		}
		ids := make([]string, 0, len(visited))
		for id := range visited {
			if id != startID {
				ids = append(ids, id)
			}
		}
		sort.Strings(ids)
		ids = append([]string{startID}, ids...)
		in := bson.D{{Key: "$in", Value: ids}}
		sub = &ports.Subgraph{StartID: startID, EntityIDs: ids, Relationships: []domain.CommunicationRelationship{}}
		return findAll(ctx, g.s.coll(collRelationships), bson.D{{Key: "sourceEntityId", Value: in}, {Key: "targetEntityId", Value: in}}, &sub.Relationships)
	})
	if err != nil {
		return nil, err
	}
	return sub, nil
}
