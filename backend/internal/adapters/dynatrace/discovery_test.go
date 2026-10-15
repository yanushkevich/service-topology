package dynatrace

import (
	"encoding/json"
	"os"
	"path/filepath"
	"slices"
	"testing"
	"time"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
	"servicetopology/backend/internal/ports"
)

// exampleTenant reads fixtures/dynatrace/example-tenant.json as records per query.
func exampleTenant(t *testing.T) map[string][]record {
	t.Helper()
	dir, err := fixtures.Dir()
	if err != nil {
		t.Fatal(err)
	}
	raw, err := os.ReadFile(filepath.Join(dir, "dynatrace", "example-tenant.json"))
	if err != nil {
		t.Fatal(err)
	}
	var file struct {
		Results map[string][]record `json:"results"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatal(err)
	}
	return file.Results
}

// exampleConfig splits the example tenant by its environment tag.
func exampleConfig() *Config {
	cfg := &Config{
		Tenants: []TenantConfig{{ID: "main", URL: "https://abc12345.apps.dynatrace.com"}},
		Environments: []EnvironmentConfig{
			{ID: "production", Name: "Production", Kind: "production", Tenant: "main", Match: MatchRule{Tag: &TagRule{Key: "environment", Value: "production"}}},
			{ID: "staging", Name: "Staging", Kind: "staging", Tenant: "main", Match: MatchRule{Tag: &TagRule{Key: "environment", Value: "staging"}}},
		},
	}
	cfg.applyDefaults()
	return cfg
}

func discoverExample(t *testing.T, cfg *Config, aliases map[string]domain.EntityID) ports.Discovery {
	t.Helper()
	r := exampleTenant(t)
	m := newDiscoveryMapper(cfg, aliases, "2026-10-15T08:45:00Z")
	m.addTenant("main", tenantData{Services: r["services"], Calls: r["service-calls"], BelongsTo: r["service-belongs-to"], K8s: r["k8s-nodes"], Databases: r["databases"]})
	return m.result()
}

func ids[T any](items []T, id func(T) string) []string {
	out := make([]string, 0, len(items))
	for _, it := range items {
		out = append(out, id(it))
	}
	return out
}

func TestDiscoveryMapsTheExampleTenant(t *testing.T) {
	d := discoverExample(t, exampleConfig(), map[string]domain.EntityID{"FraudScoring": "fraud-scoring"})
	data := d.Data

	if got := ids(data.ServiceDefinitions, func(s domain.ServiceDefinition) string { return s.ID }); !slices.Equal(got, []string{"checkout-service", "fraud-scoring", "inventory-service", "payment-service", "storefront-bff"}) {
		t.Errorf("definitions = %v", got)
	}
	wantInstances := []string{"checkout-service.production", "checkout-service.staging", "fraud-scoring.production", "inventory-service.production", "payment-service.production", "payment-service.staging", "storefront-bff.production"}
	if got := ids(data.ServiceInstances, func(s domain.ServiceInstance) string { return s.ID }); !slices.Equal(got, wantInstances) {
		t.Errorf("instances = %v", got)
	}
	types := map[string]int{}
	for _, r := range data.Resources {
		types[r.Type]++
	}
	// kube-system is in no mapped service's containment, so it is not mapped.
	if want := map[string]int{"cluster": 2, "namespace": 4, "workload": 7, "database": 5}; !mapsEqual(types, want) {
		t.Errorf("resource types = %v, want %v", types, want)
	}
	if issues := domain.Validate(&data); len(issues) > 0 {
		t.Errorf("the discovered topology does not validate: %+v", issues)
	}
	if got := ids(data.Environments, func(e domain.Environment) string { return e.ID }); !slices.Equal(got, []string{"production", "staging"}) {
		t.Errorf("environments = %v", got)
	}
}

func TestDiscoveryOwnersTeamsAndLinks(t *testing.T) {
	d := discoverExample(t, exampleConfig(), nil)
	def := find(d.Data.ServiceDefinitions, func(s domain.ServiceDefinition) bool { return s.ID == "payment-service" })
	if def.Owner == nil || *def.Owner != "Payments" || def.Team == nil || *def.Team != "Payments Core" || def.Category != "application" {
		t.Errorf("payment-service definition = %+v", def)
	}
	// Without an alias, "FraudScoring" becomes its own slug.
	if find(d.Data.ServiceDefinitions, func(s domain.ServiceDefinition) bool { return s.ID == "fraudscoring" }) == nil {
		t.Error("FraudScoring without an alias should map to fraudscoring")
	}
	inst := find(d.Data.ServiceInstances, func(s domain.ServiceInstance) bool { return s.ID == "payment-service.production" })
	link := inst.Metadata["dynatrace"].(map[string]any)
	if link["tenant"] != "main" || link["id"] != "SERVICE-30E45F0274EFB653" || link["idClassic"] == "" {
		t.Errorf("link = %v", link)
	}
	if inst.Health != "unknown" || inst.Provider != "unknown" {
		t.Errorf("health/provider = %s/%s; observations fill health", inst.Health, inst.Provider)
	}
	workload := find(d.Data.Resources, func(r domain.InfrastructureResource) bool { return inst.ResourceID != nil && r.ID == *inst.ResourceID })
	if workload == nil || workload.Type != "workload" || workload.Name != "payment" {
		t.Fatalf("payment-service runs in %v", workload)
	}
	namespace := find(d.Data.Resources, func(r domain.InfrastructureResource) bool { return r.ID == *workload.ParentResourceID })
	cluster := find(d.Data.Resources, func(r domain.InfrastructureResource) bool { return r.ID == *namespace.ParentResourceID })
	if namespace.Name != "payments" || cluster.Name != "prod-eu-1" || cluster.ParentResourceID != nil {
		t.Errorf("containment = %s / %s", namespace.Name, cluster.Name)
	}
	if namespace.EnvironmentID == nil || *namespace.EnvironmentID != "production" {
		t.Errorf("namespace environment = %v", namespace.EnvironmentID)
	}
}

func TestDiscoveryRelationshipsAndNotes(t *testing.T) {
	d := discoverExample(t, exampleConfig(), map[string]domain.EntityID{"FraudScoring": "fraud-scoring"})
	byID := map[string]domain.CommunicationRelationship{}
	for _, r := range d.Data.Relationships {
		byID[r.ID] = r
	}
	for id, want := range map[string]struct{ protocol, pattern string }{
		"rel:storefront-bff.production->checkout-service.production":  {"other", "synchronous"},
		"rel:checkout-service.production->payment-service.production": {"other", "synchronous"},
		"rel:payment-service.production->fraud-scoring.production":    {"other", "synchronous"},
		"rel:checkout-service.staging->payment-service.staging":       {"other", "synchronous"},
	} {
		got, ok := byID[id]
		if !ok || got.Protocol != want.protocol || got.Pattern != want.pattern {
			t.Errorf("%s = %+v (present %v)", id, got, ok)
		}
	}
	databases := 0
	for _, r := range d.Data.Relationships {
		if r.Pattern == "database" {
			databases++
		}
	}
	// P2→orders, P3→payments, P5→inventory, P3→ledger-ora (Oracle → other), S1→orders (staging).
	if databases != 5 {
		t.Errorf("database relationships = %d, want 5", databases)
	}
	// 4 service calls + 1 staging + 5 database; the duplicate checkout's call merges, the host
	// call and the unmatched caller are ignored, and the cross-environment call is dropped.
	if len(d.Data.Relationships) != 10 {
		t.Errorf("relationships = %d, want 10: %v", len(d.Data.Relationships), sortedKeys(byID))
	}
	codes := map[string][]string{}
	for _, n := range d.Notes {
		codes[n.Code] = n.IDs
	}
	if got := codes[ports.NoteServiceWithoutEnvironment]; !slices.Equal(got, []string{"SERVICE-D23519D9A286F5D5"}) {
		t.Errorf("unmatched = %v", got)
	}
	if got := codes[ports.NoteDuplicateService]; len(got) != 1 {
		t.Errorf("duplicates = %v", got)
	}
	if got := codes[ports.NoteCrossEnvironmentCall]; len(got) != 1 {
		t.Errorf("cross-environment calls = %v", got)
	}
}

func TestDiscoveryEnvironmentRules(t *testing.T) {
	cluster := exampleConfig()
	cluster.Environments = []EnvironmentConfig{
		{ID: "staging", Name: "Staging", Kind: "staging", Tenant: "main", Match: MatchRule{K8sCluster: "staging-eu-1"}},
		{ID: "production", Name: "Production", Kind: "production", Tenant: "main", Match: MatchRule{K8sNamespaces: []string{"shop", "payments"}}},
	}
	d := discoverExample(t, cluster, nil)
	if n := len(d.Data.ServiceInstances); n != 7 {
		t.Errorf("by cluster and namespaces: %d instances, want 7", n)
	}
	all := exampleConfig()
	all.Environments = []EnvironmentConfig{{ID: "production", Name: "Production", Kind: "production", Tenant: "main", Match: MatchRule{All: true}}}
	d = discoverExample(t, all, nil)
	// legacy-batch is matched by all: true; staging services merge into production instances.
	if inst := find(d.Data.ServiceInstances, func(s domain.ServiceInstance) bool { return s.ID == "legacy-batch.production" }); inst == nil || inst.ResourceID != nil {
		t.Errorf("legacy-batch = %+v (no Kubernetes containment)", inst)
	}
}

func TestSlug(t *testing.T) {
	for in, want := range map[string]string{
		"payment-service": "payment-service", "Payment Service": "payment-service", "PaymentService": "paymentservice",
		"  checkout__v2 ": "checkout-v2", "日本": "",
	} {
		if got := slug(in); got != want {
			t.Errorf("slug(%q) = %q, want %q", in, got, want)
		}
	}
	m := newDiscoveryMapper(exampleConfig(), nil, "")
	if got := m.definitionID(serviceNode{id: "SERVICE-ABC", name: "日本"}); got != "service-service-abc" {
		t.Errorf("fallback ID = %q", got)
	}
}

func TestObserveHealthAndMetrics(t *testing.T) {
	r := exampleTenant(t)
	states := observeTenant(observeData{Services: r["services"], K8s: r["k8s-nodes"], Databases: r["databases"], Metrics: r["service-metrics"], Problems: r["problems"]},
		5*time.Minute, "2026-10-15T08:45:00Z", false)

	payment := states["SERVICE-30E45F0274EFB653"]
	if payment.Health != "degraded" || !slices.Equal(payment.Problems, []string{"P-24101501"}) {
		t.Errorf("payment-service = %+v (SLOWDOWN through its classic ID)", payment)
	}
	m := payment.Metrics
	if m == nil || *m.LatencyMs != 210 || *m.ThroughputPerSecond != 20 || *m.ErrorRatePercent != 0.5 || m.IsSimulated || *m.ObservedAt != "2026-10-15T08:45:00Z" {
		t.Errorf("payment-service metrics = %+v", m)
	}
	if fraud := states["SERVICE-8E5C07EECB7B6ADD"]; fraud.Health != "healthy" || *fraud.Metrics.ErrorRatePercent != 0 {
		t.Errorf("FraudScoring = %+v", fraud)
	}
	var paymentsDB string
	for _, d := range r["databases"] {
		if d.str("name") == "payments" {
			paymentsDB = d.str("id")
		}
	}
	if db := states[paymentsDB]; db.Health != "degraded" || db.Metrics != nil {
		t.Errorf("payments database = %+v", db)
	}
	if host := states["HOST-0000000000000ABC"]; host.Health != "unavailable" {
		t.Errorf("an unmapped host still gets its problem: %+v", host)
	}
	example := observeTenant(observeData{Metrics: r["service-metrics"]}, 5*time.Minute, "t", true)
	for id, s := range example {
		if s.Metrics == nil || !s.Metrics.IsSimulated {
			t.Errorf("%s: example tenant metrics must be simulated", id)
		}
	}
}

func mapsEqual(a, b map[string]int) bool {
	if len(a) != len(b) {
		return false
	}
	for k, v := range a {
		if b[k] != v {
			return false
		}
	}
	return true
}

func find[T any](items []T, match func(T) bool) *T {
	for i := range items {
		if match(items[i]) {
			return &items[i]
		}
	}
	return nil
}
