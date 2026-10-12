package mongodb

import (
	"context"
	"strings"

	"go.mongodb.org/mongo-driver/v2/bson"
)

// PlanSummary is one benchmark query and the stages of its winning plan (e.g. "FETCH > IXSCAN
// sourceEntityId_1"), so benchmarks show whether the indexes are used.
type PlanSummary struct{ Name, Plan string }

// ExplainPlans explains the queries the API runs, with sampleID as the entity (cmd/apibench).
func (s *Store) ExplainPlans(ctx context.Context, sampleID string) ([]PlanSummary, error) {
	in := bson.D{{Key: "$in", Value: bson.A{sampleID}}}
	ord := bson.D{{Key: "_meta.ord", Value: 1}}
	queries := []struct {
		name string
		cmd  bson.D
	}{
		{"instance by id", bson.D{{Key: "find", Value: collServiceInstances}, {Key: "filter", Value: byID(sampleID)}}},
		{"all resources in order", bson.D{{Key: "find", Value: collResources}, {Key: "filter", Value: bson.D{}}, {Key: "sort", Value: ord}}},
		{"relationships within a subgraph", bson.D{{Key: "find", Value: collRelationships},
			{Key: "filter", Value: bson.D{{Key: "sourceEntityId", Value: in}, {Key: "targetEntityId", Value: in}}}, {Key: "sort", Value: ord}}},
		{"run events in order", bson.D{{Key: "find", Value: collEvents},
			{Key: "filter", Value: bson.D{{Key: "simulationId", Value: sampleID}}}, {Key: "sort", Value: bson.D{{Key: "seq", Value: 1}}}}},
	}
	var out []PlanSummary
	for _, q := range queries {
		res, err := s.db().RunCommand(ctx, bson.D{{Key: "explain", Value: q.cmd}, {Key: "verbosity", Value: "queryPlanner"}}).Raw()
		if err != nil {
			return nil, mapErr(err)
		}
		out = append(out, PlanSummary{q.name, summarize(res.Lookup("queryPlanner", "winningPlan"))})
	}
	return out, nil
}

func summarize(plan bson.RawValue) string {
	var stages []string
	var walk func(v bson.RawValue)
	walk = func(v bson.RawValue) {
		doc, ok := v.DocumentOK()
		if !ok {
			return
		}
		if qp, err := doc.LookupErr("queryPlan"); err == nil { // slot-based engine wraps the classic plan
			walk(qp)
			return
		}
		if st, ok := doc.Lookup("stage").StringValueOK(); ok {
			if ix, ok := doc.Lookup("indexName").StringValueOK(); ok {
				st += " " + ix
			}
			stages = append(stages, st)
		}
		walk(doc.Lookup("inputStage"))
		if many, ok := doc.Lookup("inputStages").ArrayOK(); ok {
			vals, _ := many.Values()
			for _, c := range vals {
				walk(c)
			}
		}
	}
	walk(plan)
	if len(stages) == 0 {
		return "(no plan reported)"
	}
	return strings.Join(stages, " > ")
}
