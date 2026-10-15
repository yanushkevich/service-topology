package dynatrace

import (
	"fmt"
	"maps"
	"regexp"
	"slices"
	"sort"
	"strings"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// tenantData is one tenant's structure query results.
type tenantData struct {
	Services, Calls, BelongsTo, K8s, Databases []record
	Truncated                                  []string
}

// Resource types for Smartscape node types (spec §1). Other node types are not mapped.
var k8sResourceTypes = map[string]string{
	"K8S_CLUSTER": "cluster", "K8S_NAMESPACE": "namespace",
	"K8S_DEPLOYMENT": "workload", "K8S_STATEFULSET": "workload", "K8S_DAEMONSET": "workload",
	"K8S_CRONJOB": "workload", "K8S_JOB": "workload",
}

// Protocols of database vendors (the suffix of DB_DATABASE_<VENDOR> and DB_INSTANCE_<VENDOR>).
var vendorProtocols = map[string]string{"POSTGRES": "postgresql", "MYSQL": "mysql", "MARIADB": "mysql"}

const maxNoteIDs = 20

// discoveryMapper turns every tenant's records into one canonical topology. One mapper serves
// one discovery; the maps collect entities by canonical ID, so duplicates merge.
type discoveryMapper struct {
	cfg     *Config
	aliases map[string]domain.EntityID
	now     string

	defs      map[domain.EntityID]*domain.ServiceDefinition
	instances map[domain.EntityID]*domain.ServiceInstance
	resources map[domain.EntityID]*domain.InfrastructureResource
	rels      map[domain.EntityID]*domain.CommunicationRelationship
	// resourceEnvs collects the environments of the services in or calling each resource.
	resourceEnvs map[domain.EntityID]map[domain.EntityID]bool

	unmatched, duplicates, crossEnv, truncated []string
}

// serviceNode is a decoded SERVICE record.
type serviceNode struct {
	id, name, idClassic string
	tags                map[string]string
}

// smartscapeNode is a decoded K8S_* or DB_* record.
type smartscapeNode struct {
	id, name, kind, idClassic string
}

func newDiscoveryMapper(cfg *Config, aliases map[string]domain.EntityID, now string) *discoveryMapper {
	return &discoveryMapper{
		cfg: cfg, aliases: aliases, now: now,
		defs:         map[domain.EntityID]*domain.ServiceDefinition{},
		instances:    map[domain.EntityID]*domain.ServiceInstance{},
		resources:    map[domain.EntityID]*domain.InfrastructureResource{},
		rels:         map[domain.EntityID]*domain.CommunicationRelationship{},
		resourceEnvs: map[domain.EntityID]map[domain.EntityID]bool{},
	}
}

// addTenant maps one tenant: its services into environments, their containment, then their calls.
func (m *discoveryMapper) addTenant(tenant string, data tenantData) {
	nodes := indexNodes(data.K8s, data.Databases)
	belongs := edgesBySource(data.BelongsTo)
	instanceOf := map[string]domain.EntityID{} // Dynatrace service ID → instance ID
	for _, svc := range decodeServices(data.Services) {
		env, ok := m.environmentFor(tenant, svc, belongs[svc.id], nodes)
		if !ok {
			m.unmatched = append(m.unmatched, svc.id)
			continue
		}
		instanceOf[svc.id] = m.addService(tenant, svc, env, belongs[svc.id], nodes)
	}
	for _, call := range data.Calls {
		m.addCall(tenant, call, instanceOf, nodes)
	}
	for _, q := range data.Truncated {
		m.truncated = append(m.truncated, tenant+": "+q)
	}
}

// environmentFor returns the first of the tenant's environments whose rule matches the service.
func (m *discoveryMapper) environmentFor(tenant string, svc serviceNode, belongs []record, nodes map[string]smartscapeNode) (EnvironmentConfig, bool) {
	namesOf := func(kind string) []string {
		var out []string
		for _, b := range belongs {
			if b.str("target_type") == kind {
				out = append(out, nodes[b.str("target_id")].name)
			}
		}
		return out
	}
	for _, env := range m.cfg.environmentsOf(tenant) {
		rule := env.Match
		switch {
		case rule.All:
			return env, true
		case rule.Tag != nil && svc.tags[rule.Tag.Key] == rule.Tag.Value:
			return env, true
		case rule.K8sCluster != "" && slices.Contains(namesOf("K8S_CLUSTER"), rule.K8sCluster):
			return env, true
		case len(rule.K8sNamespaces) > 0 && slices.ContainsFunc(namesOf("K8S_NAMESPACE"), func(n string) bool { return slices.Contains(rule.K8sNamespaces, n) }):
			return env, true
		}
	}
	return EnvironmentConfig{}, false
}

// addService adds the service's definition, its instance in env, and its containment, and returns
// the instance ID. A second Dynatrace service with the same name in env merges into the first.
func (m *discoveryMapper) addService(tenant string, svc serviceNode, env EnvironmentConfig, belongs []record, nodes map[string]smartscapeNode) domain.EntityID {
	defID := m.definitionID(svc)
	if _, ok := m.defs[defID]; !ok {
		m.defs[defID] = &domain.ServiceDefinition{
			ID: defID, Name: svc.name, Category: "application", Protocols: []string{},
			Owner: tagPtr(svc.tags, "owner"), Team: tagPtr(svc.tags, "team"),
			Metadata: map[string]any{"dynatrace": map[string]any{"name": svc.name}},
		}
	}
	instanceID := defID + "." + env.ID
	link := map[string]any{"tenant": tenant, "id": svc.id, "idClassic": svc.idClassic}
	if existing, ok := m.instances[instanceID]; ok {
		m.duplicates = append(m.duplicates, svc.id)
		meta := existing.Metadata["dynatrace"].(map[string]any)
		meta["also"] = append(asList(meta["also"]), link)
		return instanceID
	}
	envID := env.ID
	m.instances[instanceID] = &domain.ServiceInstance{
		ID: instanceID, ServiceDefinitionID: defID, EnvironmentID: &envID,
		Provider: "unknown", Health: "unknown", UpdatedAt: m.now,
		ResourceID: m.addContainment(tenant, env.ID, belongs, nodes),
		Metadata:   map[string]any{"dynatrace": link},
	}
	return instanceID
}

// addContainment adds the cluster, namespace, and workload a service belongs to, each the parent
// of the next, and returns the innermost one.
func (m *discoveryMapper) addContainment(tenant string, env domain.EntityID, belongs []record, nodes map[string]smartscapeNode) *domain.EntityID {
	byType := map[string]string{} // resource type → the first Dynatrace ID of that type, by ID
	for _, b := range belongs {
		resourceType, ok := k8sResourceTypes[b.str("target_type")]
		target := b.str("target_id")
		if !ok || target == "" {
			continue
		}
		if current, seen := byType[resourceType]; !seen || target < current {
			byType[resourceType] = target
		}
	}
	var parent, innermost *domain.EntityID
	for _, resourceType := range []string{"cluster", "namespace", "workload"} {
		target, ok := byType[resourceType]
		if !ok {
			continue
		}
		id := m.addResource(tenant, target, resourceType, nodes[target], parent, env)
		parent, innermost = &id, &id
	}
	return innermost
}

// addResource adds (or reuses) a resource for a Smartscape node and records env on it.
func (m *discoveryMapper) addResource(tenant, nodeID, resourceType string, node smartscapeNode, parent *domain.EntityID, env domain.EntityID) domain.EntityID {
	id := resourceID(tenant, nodeID)
	if _, ok := m.resources[id]; !ok {
		name := node.name
		if name == "" {
			name = nodeID
		}
		m.resources[id] = &domain.InfrastructureResource{
			ID: id, Name: name, Type: resourceType, Provider: "unknown", ParentResourceID: parent, UpdatedAt: &m.now,
			Metadata: map[string]any{"dynatrace": map[string]any{"tenant": tenant, "id": nodeID, "idClassic": node.idClassic, "type": node.kind}},
		}
		m.resourceEnvs[id] = map[domain.EntityID]bool{}
	}
	m.resourceEnvs[id][env] = true
	return id
}

// addCall maps a calls edge from a mapped service to a service or a database.
func (m *discoveryMapper) addCall(tenant string, call record, instanceOf map[string]domain.EntityID, nodes map[string]smartscapeNode) {
	source, ok := instanceOf[call.str("source_id")]
	if !ok {
		return
	}
	sourceEnv := *m.instances[source].EnvironmentID
	target, targetType := call.str("target_id"), call.str("target_type")
	switch {
	case targetType == "SERVICE":
		dest, ok := instanceOf[target]
		if !ok || dest == source {
			return
		}
		if destEnv := *m.instances[dest].EnvironmentID; destEnv != sourceEnv {
			m.crossEnv = append(m.crossEnv, call.str("source_id")+" → "+target)
			return
		}
		m.addRelationship(tenant, source, dest, "other", "synchronous")
	case strings.HasPrefix(targetType, "DB_"):
		db := m.addResource(tenant, target, "database", nodes[target], nil, sourceEnv)
		m.addRelationship(tenant, source, db, vendorProtocol(targetType), "database")
	}
}

func (m *discoveryMapper) addRelationship(tenant string, source, target domain.EntityID, protocol, pattern string) {
	id := "rel:" + source + "->" + target
	if _, ok := m.rels[id]; ok {
		return
	}
	m.rels[id] = &domain.CommunicationRelationship{
		ID: id, SourceEntityID: source, TargetEntityID: target, Protocol: protocol, Pattern: pattern,
		Direction: "unidirectional", Status: "active", UpdatedAt: m.now,
		Metadata: map[string]any{"dynatrace": map[string]any{"tenant": tenant}},
	}
}

// definitionID is the alias of the service's name, else a slug of it.
func (m *discoveryMapper) definitionID(svc serviceNode) domain.EntityID {
	if alias, ok := m.aliases[svc.name]; ok && alias != "" {
		return alias
	}
	if s := slug(svc.name); s != "" {
		return s
	}
	return "service-" + strings.ToLower(svc.id)
}

// result assembles the discovery: environments in configuration order, everything else by ID.
func (m *discoveryMapper) result() ports.Discovery {
	for id, envs := range m.resourceEnvs {
		if len(envs) == 1 {
			env := slices.Collect(maps.Keys(envs))[0]
			m.resources[id].EnvironmentID = &env
		}
	}
	data := domain.TopologyData{
		Environments:       []domain.Environment{},
		ServiceDefinitions: values(m.defs),
		ServiceInstances:   values(m.instances),
		Resources:          values(m.resources),
		Relationships:      values(m.rels),
	}
	for _, e := range m.cfg.Environments {
		data.Environments = append(data.Environments, domain.Environment{ID: e.ID, Name: e.Name, Kind: e.Kind})
	}
	return ports.Discovery{Data: data, Notes: m.notes(), DiscoveredAt: m.now}
}

func (m *discoveryMapper) notes() []ports.DiscoveryNote {
	notes := []ports.DiscoveryNote{}
	add := func(code string, ids []string, format string) {
		if len(ids) == 0 {
			return
		}
		sort.Strings(ids)
		notes = append(notes, ports.DiscoveryNote{Code: code, Message: fmt.Sprintf(format, len(ids)), IDs: ids[:min(len(ids), maxNoteIDs)]})
	}
	add(ports.NoteServiceWithoutEnvironment, m.unmatched, "%d services match no environment rule and were skipped.")
	add(ports.NoteDuplicateService, m.duplicates, "%d services share a name with another service in the same environment and were merged into it.")
	add(ports.NoteCrossEnvironmentCall, m.crossEnv, "%d calls cross environments and were dropped.")
	add(ports.NoteTruncatedResult, m.truncated, "%d query results hit limits.maxRecords and may be incomplete.")
	return notes
}

// decodeServices reads SERVICE records, sorted by ID so merges are deterministic.
func decodeServices(records []record) []serviceNode {
	out := make([]serviceNode, 0, len(records))
	for _, r := range records {
		if id := r.str("id"); id != "" {
			name := r.str("name")
			if name == "" {
				name = id
			}
			out = append(out, serviceNode{id: id, name: name, idClassic: r.str("id_classic"), tags: r.tags()})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].id < out[j].id })
	return out
}

func indexNodes(groups ...[]record) map[string]smartscapeNode {
	out := map[string]smartscapeNode{}
	for _, records := range groups {
		for _, r := range records {
			if id := r.str("id"); id != "" {
				out[id] = smartscapeNode{id: id, name: r.str("name"), kind: r.str("type"), idClassic: r.str("id_classic")}
			}
		}
	}
	return out
}

func edgesBySource(edges []record) map[string][]record {
	out := map[string][]record{}
	for _, e := range edges {
		out[e.str("source_id")] = append(out[e.str("source_id")], e)
	}
	return out
}

func resourceID(tenant, nodeID string) domain.EntityID {
	return "dt-" + tenant + "-" + strings.ToLower(nodeID)
}

func vendorProtocol(nodeType string) string {
	vendor := strings.TrimPrefix(strings.TrimPrefix(nodeType, "DB_DATABASE_"), "DB_INSTANCE_")
	if p, ok := vendorProtocols[vendor]; ok {
		return p
	}
	return "other"
}

var nonSlug = regexp.MustCompile(`[^a-z0-9]+`)

// slug lowercases a name and joins its words with '-': "Payment Service" → "payment-service".
func slug(name string) string {
	s := strings.Trim(nonSlug.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if len(s) > 120 {
		s = strings.TrimRight(s[:120], "-")
	}
	return s
}

func tagPtr(tags map[string]string, key string) *string {
	if v := tags[key]; v != "" {
		return &v
	}
	return nil
}

func asList(v any) []any {
	list, _ := v.([]any)
	return list
}

// values returns a map's values sorted by key.
func values[T any](m map[domain.EntityID]*T) []T {
	out := make([]T, 0, len(m))
	for _, k := range sortedKeys(m) {
		out = append(out, *m[k])
	}
	return out
}
