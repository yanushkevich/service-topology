//go:build integration

package mongodb_test

import (
	"errors"
	"testing"

	"servicetopology/backend/internal/adapters/mongodb"
	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// A bundle import replaces the topology and every board in one transaction, guarded by the
// topology revision (ADR-032).
func TestReplaceAllOnTheDatabase(t *testing.T) {
	s, ctx := ready(t)
	data, _ := mockTopology(t)
	topo := mongodb.NewTopologyRepository(s)
	boards := mongodb.NewBoardRepository(s)
	if _, err := topo.ReplaceTopology(ctx, data, "fixture"); err != nil {
		t.Fatal(err)
	}
	old := &domain.BoardDefinition{ServiceDefinitionID: "payment-service", Stations: []domain.BoardStation{}, Lines: []domain.BoardLine{}, Policies: []domain.BoardPolicy{}, Tables: []domain.BoardTable{}}
	if _, err := boards.Create(ctx, old, "2026-10-12T08:00:00Z"); err != nil {
		t.Fatal(err)
	}
	_, rev, err := topo.CurrentTopology(ctx)
	if err != nil {
		t.Fatal(err)
	}

	smaller := *data
	smaller.EventTypes, smaller.BusinessFlows = nil, nil
	board := domain.BoardDefinition{ServiceDefinitionID: "order-service", Stations: []domain.BoardStation{{ID: "caller", Name: "Client", Kind: "caller"}, {ID: "mod", Name: "Orders", Kind: "module"}}, Lines: []domain.BoardLine{}, Policies: []domain.BoardPolicy{}, Tables: []domain.BoardTable{}}

	if _, err := topo.ReplaceAll(ctx, &smaller, []domain.BoardDefinition{board}, "stale", "import", "2026-10-13T09:00:00Z"); !errors.Is(err, ports.ErrPreconditionFailed) {
		t.Fatalf("stale import: %v", err)
	}
	if b, err := boards.Get(ctx, "payment-service"); err != nil || b.Revision != "1" {
		t.Fatalf("a stale import must write nothing: %v %+v", err, b)
	}

	res, err := topo.ReplaceAll(ctx, &smaller, []domain.BoardDefinition{board}, rev, "import", "2026-10-13T09:00:00Z")
	if err != nil || res.Revision == rev || res.Boards != 1 || res.Documents["serviceDefinitions"] != len(data.ServiceDefinitions) {
		t.Fatalf("import: %v %+v", err, res)
	}
	got, newRev, err := topo.CurrentTopology(ctx)
	if err != nil || newRev != res.Revision || len(got.EventTypes) != 0 || len(got.BusinessFlows) != 0 || len(got.Resources) != len(data.Resources) {
		t.Fatalf("read back: %v rev %s/%s, events %d, flows %d", err, newRev, res.Revision, len(got.EventTypes), len(got.BusinessFlows))
	}
	list, err := boards.List(ctx)
	if err != nil || len(list) != 1 || list[0].Definition.ServiceDefinitionID != "order-service" || list[0].Revision != "1" || list[0].UpdatedAt != "2026-10-13T09:00:00Z" {
		t.Fatalf("boards after import: %v %+v", err, list)
	}
	meta, err := topo.TopologyMeta(ctx)
	if err != nil || meta.SourceType != "import" || !meta.IsMock {
		t.Fatalf("meta: %v %+v", err, meta)
	}
}
