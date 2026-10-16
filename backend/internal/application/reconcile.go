package application

import (
	"encoding/json"
	"maps"
	"slices"

	"servicetopology/backend/internal/domain"
)

// Reconciling a topology source's discovery with the stored topology (ADR-034,
// docs/DYNATRACE_CONNECTOR.md §4). Pure: the caller loads the inputs and validates the result.
//
// Entities the source created are owned: they follow the source, keeping what it does not
// provide. Every other entity is authored: the source only links to it (metadata[source]).

// Sync change operations, as listed in a preview.
const (
	SyncCreate = "create" // new, owned by the source
	SyncUpdate = "update" // owned, changed in the source
	SyncLink   = "link"   // authored, linked to the source
	SyncKeep   = "keep"   // owned, gone from the source, still used by authored data
	SyncDelete = "delete" // owned, gone from the source
)

// SyncChange is one change of a sync. Entity (a pointer to the domain value) is nil for deletes.
type SyncChange struct {
	Op     string            `json:"op"`
	Kind   string            `json:"kind"`
	ID     domain.EntityID   `json:"id"`
	Name   string            `json:"name"`
	UsedBy []domain.EntityID `json:"usedBy,omitempty"`
	Entity any               `json:"-"`
}

type reconcileInput struct {
	stored     *domain.TopologyData
	sources    map[domain.EntityID]string // the source that created each stored entity
	discovered *domain.TopologyData
	source     string
	now        string
	// boardRefs maps an entity ID to the boards that use it (their service, or a station link).
	boardRefs map[domain.EntityID][]domain.EntityID
}

// reconciler accumulates changes onto a copy of the stored topology.
type reconciler struct {
	in      reconcileInput
	result  *domain.TopologyData
	changes []SyncChange
	seen    map[domain.EntityID]bool
	// renamed maps a discovered ID to the stored entity it matched under another ID.
	renamed map[domain.EntityID]domain.EntityID
}

// reconcile returns the changes and the topology they produce.
func reconcile(in reconcileInput) ([]SyncChange, *domain.TopologyData) {
	r := &reconciler{in: in, result: cloneTopology(in.stored), seen: map[domain.EntityID]bool{}, renamed: map[domain.EntityID]domain.EntityID{}}
	d := in.discovered
	reconcileKind(r, domain.KindEnvironment, &r.result.Environments, d.Environments, environmentKind)
	reconcileKind(r, domain.KindServiceDefinition, &r.result.ServiceDefinitions, d.ServiceDefinitions, definitionKind)
	reconcileKind(r, domain.KindResource, &r.result.Resources, d.Resources, resourceKind)
	reconcileKind(r, domain.KindServiceInstance, &r.result.ServiceInstances, r.remapInstances(d.ServiceInstances), instanceKind)
	reconcileKind(r, domain.KindRelationship, &r.result.Relationships, r.remapRelationships(d.Relationships), relationshipKind)
	r.retire()
	return r.changes, r.result
}

// entityKind holds what reconciling one kind needs.
type entityKind[T any] struct {
	id   func(*T) domain.EntityID
	name func(*T) string
	// match finds a stored entity under another ID (an instance by service and environment, a
	// relationship by its endpoints); nil to match by ID only.
	match func(stored []T, discovered *T) (int, bool)
	// owned merges a discovered entity into an owned one; link links an authored one.
	owned, link func(stored, discovered T, source string) T
	// stamp sets updatedAt on a changed entity (nil for kinds without one).
	stamp func(*T, string)
	// keep marks an owned entity that is gone but still used.
	keep func(T, string, string) T
}

// reconcileKind creates, updates, or links each discovered entity of one kind.
func reconcileKind[T any](r *reconciler, kind string, current *[]T, discovered []T, k entityKind[T]) {
	at := map[domain.EntityID]int{}
	for i := range *current {
		at[k.id(&(*current)[i])] = i
	}
	for _, d := range discovered {
		i, ok := at[k.id(&d)]
		if !ok && k.match != nil {
			i, ok = k.match(*current, &d)
		}
		if !ok {
			*current = append(*current, d)
			at[k.id(&d)] = len(*current) - 1
			r.seen[k.id(&d)] = true
			r.add(SyncCreate, kind, k.id(&d), k.name(&d), d)
			continue
		}
		stored := (*current)[i]
		id := k.id(&stored)
		r.seen[id] = true
		if id != k.id(&d) {
			r.renamed[k.id(&d)] = id
		}
		op, next := SyncLink, k.link(stored, d, r.in.source)
		if r.in.sources[id] == r.in.source {
			op, next = SyncUpdate, k.owned(stored, d, r.in.source)
		}
		if sameJSON(stored, next) {
			continue
		}
		if k.stamp != nil {
			k.stamp(&next, r.in.now)
		}
		(*current)[i] = next
		r.add(op, kind, id, k.name(&next), next)
	}
}

func (r *reconciler) add(op, kind string, id domain.EntityID, name string, entity any) {
	change := SyncChange{Op: op, Kind: kind, ID: id, Name: name}
	switch e := entity.(type) {
	case domain.Environment:
		change.Entity = &e
	case domain.ServiceDefinition:
		change.Entity = &e
	case domain.ServiceInstance:
		change.Entity = &e
	case domain.InfrastructureResource:
		change.Entity = &e
	case domain.CommunicationRelationship:
		change.Entity = &e
	}
	r.changes = append(r.changes, change)
}

// remapInstances points discovered instances at the stored resources they matched.
func (r *reconciler) remapInstances(instances []domain.ServiceInstance) []domain.ServiceInstance {
	out := slices.Clone(instances)
	for i := range out {
		if out[i].ResourceID != nil {
			id := r.resolve(*out[i].ResourceID)
			out[i].ResourceID = &id
		}
	}
	return out
}

// remapRelationships points discovered relationships at the stored entities they matched. An ID
// derived from the endpoints ("rel:<source>-><target>") is derived again, so it never names an
// entity that does not exist.
func (r *reconciler) remapRelationships(rels []domain.CommunicationRelationship) []domain.CommunicationRelationship {
	out := slices.Clone(rels)
	for i := range out {
		derived := out[i].ID == relationshipID(out[i].SourceEntityID, out[i].TargetEntityID)
		out[i].SourceEntityID = r.resolve(out[i].SourceEntityID)
		out[i].TargetEntityID = r.resolve(out[i].TargetEntityID)
		if derived {
			out[i].ID = relationshipID(out[i].SourceEntityID, out[i].TargetEntityID)
		}
	}
	return out
}

func relationshipID(source, target domain.EntityID) domain.EntityID {
	return "rel:" + source + "->" + target
}

func (r *reconciler) resolve(id domain.EntityID) domain.EntityID {
	if stored, ok := r.renamed[id]; ok {
		return stored
	}
	return id
}

// retire deletes owned entities the source no longer has, except those still used by what remains;
// those are kept and marked. Keeping one can keep what it uses, so this repeats until stable.
func (r *reconciler) retire() {
	gone := map[domain.EntityID]bool{}
	for id := range entityKinds(r.result) {
		if r.in.sources[id] == r.in.source && !r.seen[id] {
			gone[id] = true
		}
	}
	// A kept service stays deployed: its instances are kept with it.
	definitionOf := map[domain.EntityID]domain.EntityID{}
	for _, e := range r.result.ServiceInstances {
		definitionOf[e.ID] = e.ServiceDefinitionID
	}
	kept := map[domain.EntityID][]domain.EntityID{}
	for changed := true; changed; {
		changed = false
		users := referencesOf(r.result, gone, r.in.boardRefs)
		for id := range gone {
			if def, isInstance := definitionOf[id]; isInstance && kept[def] != nil {
				users[id] = append(users[id], def)
			}
			if len(users[id]) > 0 {
				delete(gone, id)
				kept[id] = users[id]
				changed = true
			}
		}
	}
	r.keepAll(kept)
	r.deleteAll(gone)
}

// keepAll marks kept entities: health unknown, relationships inactive, and metadata[source].missingSince.
func (r *reconciler) keepAll(kept map[domain.EntityID][]domain.EntityID) {
	keepIn := func(kind string, id domain.EntityID, name string, before, after any) {
		if !sameJSON(before, after) {
			r.add(SyncKeep, kind, id, name, after)
			r.changes[len(r.changes)-1].UsedBy = kept[id]
		}
	}
	src, now := r.in.source, r.in.now
	for i, e := range r.result.ServiceDefinitions {
		if _, ok := kept[e.ID]; ok {
			r.result.ServiceDefinitions[i] = definitionKind.keep(e, src, now)
			keepIn(domain.KindServiceDefinition, e.ID, e.Name, e, r.result.ServiceDefinitions[i])
		}
	}
	for i, e := range r.result.ServiceInstances {
		if _, ok := kept[e.ID]; ok {
			r.result.ServiceInstances[i] = instanceKind.keep(e, src, now)
			keepIn(domain.KindServiceInstance, e.ID, e.ID, e, r.result.ServiceInstances[i])
		}
	}
	for i, e := range r.result.Resources {
		if _, ok := kept[e.ID]; ok {
			r.result.Resources[i] = resourceKind.keep(e, src, now)
			keepIn(domain.KindResource, e.ID, e.Name, e, r.result.Resources[i])
		}
	}
	for i, e := range r.result.Relationships {
		if _, ok := kept[e.ID]; ok {
			r.result.Relationships[i] = relationshipKind.keep(e, src, now)
			keepIn(domain.KindRelationship, e.ID, e.ID, e, r.result.Relationships[i])
		}
	}
}

// deleteAll removes the gone entities, relationships first so the list reads from edges inward.
func (r *reconciler) deleteAll(gone map[domain.EntityID]bool) {
	drop := func(kind string, id domain.EntityID, name string) bool {
		if !gone[id] {
			return false
		}
		r.changes = append(r.changes, SyncChange{Op: SyncDelete, Kind: kind, ID: id, Name: name})
		return true
	}
	d := r.result
	d.Relationships = slices.DeleteFunc(d.Relationships, func(e domain.CommunicationRelationship) bool { return drop(domain.KindRelationship, e.ID, e.ID) })
	d.ServiceInstances = slices.DeleteFunc(d.ServiceInstances, func(e domain.ServiceInstance) bool { return drop(domain.KindServiceInstance, e.ID, e.ID) })
	d.Resources = slices.DeleteFunc(d.Resources, func(e domain.InfrastructureResource) bool { return drop(domain.KindResource, e.ID, e.Name) })
	d.ServiceDefinitions = slices.DeleteFunc(d.ServiceDefinitions, func(e domain.ServiceDefinition) bool { return drop(domain.KindServiceDefinition, e.ID, e.Name) })
	d.Environments = slices.DeleteFunc(d.Environments, func(e domain.Environment) bool { return drop(domain.KindEnvironment, e.ID, e.Name) })
}

// entityKinds lists the IDs of the kinds a source can own.
func entityKinds(d *domain.TopologyData) map[domain.EntityID]string {
	out := map[domain.EntityID]string{}
	for _, e := range d.Environments {
		out[e.ID] = domain.KindEnvironment
	}
	for _, e := range d.ServiceDefinitions {
		out[e.ID] = domain.KindServiceDefinition
	}
	for _, e := range d.ServiceInstances {
		out[e.ID] = domain.KindServiceInstance
	}
	for _, e := range d.Resources {
		out[e.ID] = domain.KindResource
	}
	for _, e := range d.Relationships {
		out[e.ID] = domain.KindRelationship
	}
	return out
}

// referencesOf maps each referenced ID to the entities (outside skip) and boards that reference it.
func referencesOf(d *domain.TopologyData, skip map[domain.EntityID]bool, boardRefs map[domain.EntityID][]domain.EntityID) map[domain.EntityID][]domain.EntityID {
	users := map[domain.EntityID][]domain.EntityID{}
	use := func(user domain.EntityID, ids ...*domain.EntityID) {
		if skip[user] {
			return
		}
		for _, id := range ids {
			if id != nil && *id != "" && *id != user && !slices.Contains(users[*id], user) {
				users[*id] = append(users[*id], user)
			}
		}
	}
	for _, e := range d.ServiceInstances {
		use(e.ID, &e.ServiceDefinitionID, e.EnvironmentID, e.ResourceID)
	}
	for _, e := range d.Resources {
		use(e.ID, e.ParentResourceID, e.EnvironmentID)
	}
	for _, e := range d.Relationships {
		use(e.ID, &e.SourceEntityID, &e.TargetEntityID)
	}
	for _, e := range d.EventTypes {
		for _, list := range [][]domain.EntityID{e.ChannelResourceIDs, e.ProducerServiceIDs, e.ConsumerServiceIDs} {
			for i := range list {
				use(e.ID, &list[i])
			}
		}
	}
	for _, f := range d.BusinessFlows {
		for i := range f.Steps {
			use(f.ID, &f.Steps[i].ServiceDefinitionID)
		}
		for i := range f.Transitions {
			use(f.ID, f.Transitions[i].Via.CallerServiceID)
		}
	}
	for id, boards := range boardRefs {
		for _, b := range boards {
			use(b, &id)
		}
	}
	return users
}

// withLink returns metadata with metadata[source] set to the discovered entity's link.
func withLink(stored, discovered map[string]any, source string) map[string]any {
	out := maps.Clone(stored)
	if out == nil {
		out = map[string]any{}
	}
	out[source] = discovered[source]
	return out
}

// markMissing returns metadata whose link records when the source stopped seeing the entity.
func markMissing(meta map[string]any, source, now string) map[string]any {
	out := maps.Clone(meta)
	if out == nil {
		out = map[string]any{}
	}
	link, _ := out[source].(map[string]any)
	link = maps.Clone(link)
	if link == nil {
		link = map[string]any{}
	}
	if _, ok := link["missingSince"]; !ok {
		link["missingSince"] = now
	}
	out[source] = link
	return out
}

// sameJSON compares two values by their JSON form (map keys are sorted).
func sameJSON(a, b any) bool {
	ja, errA := json.Marshal(a)
	jb, errB := json.Marshal(b)
	return errA == nil && errB == nil && string(ja) == string(jb)
}
