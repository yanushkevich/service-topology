package application

import (
	"slices"
	"testing"

	"servicetopology/backend/internal/domain"
)

const now = "2026-10-15T08:45:00Z"

func strPtr(s string) *string { return &s }

// discovered is a small source topology: two services in production in one workload, a call, and
// a database.
func discovered() *domain.TopologyData {
	prod := "production"
	link := func(id string) map[string]any {
		return map[string]any{"dynatrace": map[string]any{"tenant": "main", "id": id}}
	}
	return &domain.TopologyData{
		Environments: []domain.Environment{{ID: "production", Name: "Production", Kind: "production"}},
		ServiceDefinitions: []domain.ServiceDefinition{
			{ID: "checkout", Name: "checkout", Category: "application", Protocols: []string{}, Metadata: link("SERVICE-1")},
			{ID: "payment", Name: "payment", Category: "application", Protocols: []string{}, Team: strPtr("Payments"), Metadata: link("SERVICE-2")},
		},
		ServiceInstances: []domain.ServiceInstance{
			{ID: "checkout.production", ServiceDefinitionID: "checkout", EnvironmentID: &prod, Provider: "unknown", Health: "unknown", UpdatedAt: now, ResourceID: strPtr("dt-main-wl"), Metadata: link("SERVICE-1")},
			{ID: "payment.production", ServiceDefinitionID: "payment", EnvironmentID: &prod, Provider: "unknown", Health: "unknown", UpdatedAt: now, Metadata: link("SERVICE-2")},
		},
		Resources: []domain.InfrastructureResource{
			{ID: "dt-main-wl", Name: "checkout", Type: "workload", Provider: "unknown", EnvironmentID: &prod, UpdatedAt: strPtr(now), Metadata: link("K8S_DEPLOYMENT-1")},
			{ID: "dt-main-db", Name: "orders", Type: "database", Provider: "unknown", EnvironmentID: &prod, UpdatedAt: strPtr(now), Metadata: link("DB-1")},
		},
		Relationships: []domain.CommunicationRelationship{
			{ID: "rel:checkout.production->payment.production", SourceEntityID: "checkout.production", TargetEntityID: "payment.production", Protocol: "other", Pattern: "synchronous", Direction: "unidirectional", Status: "active", UpdatedAt: now, Metadata: map[string]any{"dynatrace": map[string]any{"tenant": "main", "id": "calls:SERVICE-1->SERVICE-2"}}},
			{ID: "rel:payment.production->dt-main-db", SourceEntityID: "payment.production", TargetEntityID: "dt-main-db", Protocol: "postgresql", Pattern: "database", Direction: "unidirectional", Status: "active", UpdatedAt: now, Metadata: map[string]any{"dynatrace": map[string]any{"tenant": "main"}}},
		},
	}
}

func empty() *domain.TopologyData {
	return &domain.TopologyData{Environments: []domain.Environment{}, ServiceDefinitions: []domain.ServiceDefinition{}, ServiceInstances: []domain.ServiceInstance{}, Resources: []domain.InfrastructureResource{}, Relationships: []domain.CommunicationRelationship{}}
}

// owned records every entity of d as created by the source.
func owned(d *domain.TopologyData) map[domain.EntityID]string {
	out := map[domain.EntityID]string{}
	for id := range entityKinds(d) {
		out[id] = "dynatrace"
	}
	return out
}

func run(stored *domain.TopologyData, sources map[domain.EntityID]string, found *domain.TopologyData) ([]SyncChange, *domain.TopologyData) {
	return reconcile(reconcileInput{stored: stored, sources: sources, discovered: found, source: "dynatrace", now: now})
}

func ops(changes []SyncChange) map[string][]domain.EntityID {
	out := map[string][]domain.EntityID{}
	for _, c := range changes {
		out[c.Op] = append(out[c.Op], c.ID)
	}
	return out
}

func TestReconcileCreatesThenIsStable(t *testing.T) {
	changes, result := run(empty(), nil, discovered())
	if got := ops(changes); len(got[SyncCreate]) != 9 || len(got) != 1 {
		t.Fatalf("first sync = %v", got)
	}
	if issues := domain.Validate(result); len(issues) > 0 {
		t.Fatalf("result does not validate: %v", issues)
	}
	again, _ := run(result, owned(result), discovered())
	if len(again) != 0 {
		t.Errorf("a second sync of the same discovery changed %v", ops(again))
	}
}

func TestReconcileUpdatesOwnedKeepingWhatTheSourceDoesNotProvide(t *testing.T) {
	_, stored := run(empty(), nil, discovered())
	// Edits made here: a description, a category, and a protocol the source cannot tell.
	stored.ServiceDefinitions[1].Description = strPtr("Takes payments")
	stored.ServiceDefinitions[1].Category = "api"
	stored.Relationships[0].Protocol = "grpc"
	found := discovered()
	found.ServiceDefinitions[1].Name = "payment-v2"
	changes, result := run(stored, owned(stored), found)
	if got := ops(changes); !slices.Equal(got[SyncUpdate], []domain.EntityID{"payment"}) || len(got) != 1 {
		t.Fatalf("changes = %v", got)
	}
	def := result.ServiceDefinitions[1]
	if def.Name != "payment-v2" || *def.Description != "Takes payments" || def.Category != "api" || *def.Team != "Payments" {
		t.Errorf("payment = %+v", def)
	}
	if result.Relationships[0].Protocol != "grpc" {
		t.Errorf("an edited protocol was overwritten by \"other\"")
	}
}

func TestReconcileLinksAuthoredEntitiesWithoutOverwriting(t *testing.T) {
	prod := "production"
	stored := empty()
	stored.Environments = []domain.Environment{{ID: "production", Name: "Prod", Kind: "production"}}
	stored.ServiceDefinitions = []domain.ServiceDefinition{{ID: "payment", Name: "Payment Service", Owner: strPtr("Finance"), Category: "api", Protocols: []string{"grpc"}}}
	// An authored instance of payment in production under another ID, and an authored call to it.
	stored.ServiceInstances = []domain.ServiceInstance{{ID: "payment-prod", ServiceDefinitionID: "payment", EnvironmentID: &prod, Provider: "aws", Health: "healthy", UpdatedAt: "2026-10-01T00:00:00Z"}}
	sources := map[domain.EntityID]string{"production": "fixture", "payment": "fixture", "payment-prod": "manual"}

	changes, result := run(stored, sources, discovered())
	got := ops(changes)
	if !slices.Equal(got[SyncLink], []domain.EntityID{"payment", "payment-prod"}) {
		t.Errorf("links = %v (all ops %v)", got[SyncLink], got)
	}
	if slices.Contains(got[SyncCreate], "payment.production") {
		t.Error("an authored instance of the same service and environment was duplicated")
	}
	def := result.ServiceDefinitions[0]
	if def.Name != "Payment Service" || *def.Owner != "Finance" || def.Category != "api" || def.Metadata["dynatrace"] == nil {
		t.Errorf("authored definition = %+v", def)
	}
	if env := result.Environments[0]; env.Name != "Prod" {
		t.Errorf("authored environment renamed to %q", env.Name)
	}
	// The discovered call now points at the authored instance.
	if !slices.ContainsFunc(result.Relationships, func(r domain.CommunicationRelationship) bool {
		return r.SourceEntityID == "checkout.production" && r.TargetEntityID == "payment-prod"
	}) {
		t.Errorf("relationships = %+v", result.Relationships)
	}
	if issues := domain.Validate(result); len(issues) > 0 {
		t.Errorf("result does not validate: %v", issues)
	}
}

func TestReconcileLinksAnAuthoredRelationshipBetweenTheSameEntities(t *testing.T) {
	_, stored := run(empty(), nil, discovered())
	sources := owned(stored)
	stored.Relationships[0].ID = "checkout-calls-payment"
	stored.Relationships[0].Metadata = nil
	sources["checkout-calls-payment"] = "manual"
	changes, result := run(stored, sources, discovered())
	if got := ops(changes); !slices.Equal(got[SyncLink], []domain.EntityID{"checkout-calls-payment"}) || got[SyncCreate] != nil {
		t.Errorf("changes = %v", got)
	}
	if n := len(result.Relationships); n != 2 {
		t.Errorf("relationships = %d, want 2 (no duplicate)", n)
	}
}

func TestReconcileDeletesWhatDisappearedUnlessUsed(t *testing.T) {
	_, stored := run(empty(), nil, discovered())
	sources := owned(stored)
	found := discovered()
	found.ServiceDefinitions = found.ServiceDefinitions[:1]
	found.ServiceInstances = found.ServiceInstances[:1]
	found.Resources = found.Resources[:1]
	found.Relationships = nil

	changes, result := run(stored, sources, found)
	got := ops(changes)
	wantDeleted := []domain.EntityID{"rel:checkout.production->payment.production", "rel:payment.production->dt-main-db", "payment.production", "dt-main-db", "payment"}
	if !slices.Equal(got[SyncDelete], wantDeleted) {
		t.Errorf("deleted = %v, want %v", got[SyncDelete], wantDeleted)
	}
	if issues := domain.Validate(result); len(issues) > 0 {
		t.Errorf("result does not validate: %v", issues)
	}

	// The same disappearance while an authored flow uses payment: the service is kept and flagged.
	stored.BusinessFlows = []domain.BusinessFlow{{ID: "flow-pay", Name: "Pay", Steps: []domain.FlowStep{{ID: "s1", Name: "Charge", ServiceDefinitionID: "payment", Kind: "task"}}}}
	sources["flow-pay"] = "manual"
	changes, result = run(stored, sources, found)
	got = ops(changes)
	if !slices.Equal(got[SyncKeep], []domain.EntityID{"payment", "payment.production"}) {
		t.Fatalf("kept = %v (all %v)", got[SyncKeep], got)
	}
	for _, c := range changes {
		if c.ID == "payment" && !slices.Equal(c.UsedBy, []domain.EntityID{"flow-pay"}) {
			t.Errorf("payment used by %v", c.UsedBy)
		}
	}
	inst := result.ServiceInstances[slices.IndexFunc(result.ServiceInstances, func(i domain.ServiceInstance) bool { return i.ID == "payment.production" })]
	if inst.Health != "unknown" || inst.Metadata["dynatrace"].(map[string]any)["missingSince"] != now {
		t.Errorf("kept instance = %+v", inst)
	}
	if !slices.Contains(got[SyncDelete], "dt-main-db") || !slices.Contains(got[SyncDelete], "rel:payment.production->dt-main-db") {
		t.Errorf("unused entities must still be deleted: %v", got[SyncDelete])
	}

	// Rediscovered: the flag is cleared.
	_, kept := run(stored, sources, found)
	changes, result = run(kept, sources, discovered())
	if got := ops(changes); !slices.Contains(got[SyncUpdate], "payment.production") {
		t.Errorf("rediscovery = %v", got)
	}
	inst = result.ServiceInstances[slices.IndexFunc(result.ServiceInstances, func(i domain.ServiceInstance) bool { return i.ID == "payment.production" })]
	if _, flagged := inst.Metadata["dynatrace"].(map[string]any)["missingSince"]; flagged {
		t.Error("missingSince remains after rediscovery")
	}
}

func TestReconcileKeepsWhatABoardLinks(t *testing.T) {
	_, stored := run(empty(), nil, discovered())
	found := discovered()
	found.Resources = found.Resources[:1]
	found.Relationships = found.Relationships[:1]
	changes, _ := reconcile(reconcileInput{stored: stored, sources: owned(stored), discovered: found, source: "dynatrace", now: now,
		boardRefs: map[domain.EntityID][]domain.EntityID{"dt-main-db": {"transit-board:payment"}}})
	if got := ops(changes); !slices.Equal(got[SyncKeep], []domain.EntityID{"dt-main-db"}) {
		t.Errorf("changes = %v", got)
	}
}

func TestReconcileLinksAuthoredChannelsThroughTheirBroker(t *testing.T) {
	prod := "production"
	stored := empty()
	stored.Environments = []domain.Environment{{ID: "production", Name: "Production", Kind: "production"}}
	broker := strPtr("kafka-prod")
	stored.Resources = []domain.InfrastructureResource{
		{ID: "kafka-prod", Name: "kafka", Type: "broker", Provider: "aws", EnvironmentID: &prod},
		// Its environment is inherited from the broker.
		{ID: "topic-orders", Name: "orders.events", Type: "topic", Provider: "aws", ParentResourceID: broker},
		{ID: "notifications", Name: "notifications", Type: "exchange", Provider: "aws", ParentResourceID: broker},
	}
	sources := map[domain.EntityID]string{"production": "fixture", "kafka-prod": "fixture", "topic-orders": "fixture", "notifications": "fixture"}
	found := discovered()
	found.Resources = append(found.Resources,
		domain.InfrastructureResource{ID: "dt-main-kafka-orders-events-production", Name: "orders.events", Type: "topic", Provider: "unknown", EnvironmentID: &prod,
			Metadata: map[string]any{"dynatrace": map[string]any{"tenant": "main", "system": "kafka", "destination": "orders.events"}}},
		// Same name as the authored exchange, but a queue: a different channel.
		domain.InfrastructureResource{ID: "dt-main-rabbitmq-notifications-production", Name: "notifications", Type: "queue", Provider: "unknown", EnvironmentID: &prod})
	found.Relationships = append(found.Relationships, domain.CommunicationRelationship{
		ID: "rel:checkout.production->dt-main-kafka-orders-events-production", SourceEntityID: "checkout.production", TargetEntityID: "dt-main-kafka-orders-events-production",
		Protocol: "kafka", Pattern: "asynchronous", Direction: "unidirectional", Status: "active", UpdatedAt: now})

	changes, result := run(stored, sources, found)
	got := ops(changes)
	if !slices.Contains(got[SyncLink], "topic-orders") || slices.Contains(got[SyncCreate], "dt-main-kafka-orders-events-production") {
		t.Errorf("the authored topic must be linked, not duplicated: %v", got)
	}
	if !slices.Contains(got[SyncCreate], "dt-main-rabbitmq-notifications-production") {
		t.Errorf("a queue named like an exchange is another channel: %v", got)
	}
	if !slices.ContainsFunc(result.Relationships, func(r domain.CommunicationRelationship) bool {
		return r.ID == "rel:checkout.production->topic-orders" && r.SourceEntityID == "checkout.production" && r.TargetEntityID == "topic-orders"
	}) {
		t.Errorf("the producer must point at the authored topic, under a matching ID: %+v", result.Relationships)
	}
	if issues := domain.Validate(result); len(issues) > 0 {
		t.Errorf("result does not validate: %v", issues)
	}
}

// A topology synced before ADR-008 was followed (an owned workload per instance) loses the workload
// on the next sync: the instance moves to its namespace, and nothing uses the workload any more.
func TestReconcileRetiresWorkloadsFromAnEarlierSync(t *testing.T) {
	_, stored := run(empty(), nil, discovered())
	prod := "production"
	found := discovered()
	found.Resources[0] = domain.InfrastructureResource{ID: "dt-main-ns", Name: "shop", Type: "namespace", Provider: "unknown", EnvironmentID: &prod, UpdatedAt: strPtr(now),
		Metadata: map[string]any{"dynatrace": map[string]any{"tenant": "main", "id": "K8S_NAMESPACE-1"}}}
	found.ServiceInstances[0].ResourceID = strPtr("dt-main-ns")

	changes, result := run(stored, owned(stored), found)
	got := ops(changes)
	if !slices.Equal(got[SyncDelete], []domain.EntityID{"dt-main-wl"}) || !slices.Contains(got[SyncCreate], "dt-main-ns") || !slices.Contains(got[SyncUpdate], "checkout.production") {
		t.Errorf("changes = %v", got)
	}
	if issues := domain.Validate(result); len(issues) > 0 {
		t.Errorf("result does not validate: %v", issues)
	}
}
