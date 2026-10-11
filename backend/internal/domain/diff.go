package domain

import "sort"

// SnapshotChange is one difference between two topologies (diffTopology in snapshot.ts).
type SnapshotChange struct {
	Type string   `json:"type"` // added, removed, health-changed, status-changed
	Kind string   `json:"kind"`
	ID   EntityID `json:"id"`
	From string   `json:"from,omitempty"`
	To   string   `json:"to,omitempty"`
}

// DiffTopology returns structural and health differences from before to after, sorted by change
// type, then kind, then ID (as the client).
func DiffTopology(before, after *TopologyData) []SnapshotChange {
	changes := []SnapshotChange{}
	type item struct {
		id   EntityID
		comp func(other int) *SnapshotChange
	}
	compare := func(kind string, left, right []EntityID, changed func(i, j int) *SnapshotChange) {
		ri := map[EntityID]int{}
		for j, id := range right {
			ri[id] = j
		}
		li := map[EntityID]bool{}
		for i, id := range left {
			li[id] = true
			j, ok := ri[id]
			if !ok {
				changes = append(changes, SnapshotChange{Type: "removed", Kind: kind, ID: id})
			} else if changed != nil {
				if c := changed(i, j); c != nil {
					changes = append(changes, *c)
				}
			}
		}
		for _, id := range right {
			if !li[id] {
				changes = append(changes, SnapshotChange{Type: "added", Kind: kind, ID: id})
			}
		}
	}
	ids := func(n int, id func(int) EntityID) []EntityID {
		out := make([]EntityID, n)
		for i := range out {
			out[i] = id(i)
		}
		return out
	}
	compare(KindEnvironment, ids(len(before.Environments), func(i int) EntityID { return before.Environments[i].ID }),
		ids(len(after.Environments), func(i int) EntityID { return after.Environments[i].ID }), nil)
	compare(KindServiceDefinition, ids(len(before.ServiceDefinitions), func(i int) EntityID { return before.ServiceDefinitions[i].ID }),
		ids(len(after.ServiceDefinitions), func(i int) EntityID { return after.ServiceDefinitions[i].ID }), nil)
	compare(KindServiceInstance, ids(len(before.ServiceInstances), func(i int) EntityID { return before.ServiceInstances[i].ID }),
		ids(len(after.ServiceInstances), func(i int) EntityID { return after.ServiceInstances[i].ID }), func(i, j int) *SnapshotChange {
			x, y := before.ServiceInstances[i], after.ServiceInstances[j]
			if x.Health != y.Health {
				return &SnapshotChange{Type: "health-changed", Kind: KindServiceInstance, ID: x.ID, From: x.Health, To: y.Health}
			}
			return nil
		})
	compare(KindResource, ids(len(before.Resources), func(i int) EntityID { return before.Resources[i].ID }),
		ids(len(after.Resources), func(i int) EntityID { return after.Resources[i].ID }), func(i, j int) *SnapshotChange {
			from, to := healthOrUnknown(before.Resources[i].Health), healthOrUnknown(after.Resources[j].Health)
			if from != to {
				return &SnapshotChange{Type: "health-changed", Kind: KindResource, ID: before.Resources[i].ID, From: from, To: to}
			}
			return nil
		})
	compare(KindRelationship, ids(len(before.Relationships), func(i int) EntityID { return before.Relationships[i].ID }),
		ids(len(after.Relationships), func(i int) EntityID { return after.Relationships[i].ID }), func(i, j int) *SnapshotChange {
			x, y := before.Relationships[i], after.Relationships[j]
			if x.Status != y.Status {
				return &SnapshotChange{Type: "status-changed", Kind: KindRelationship, ID: x.ID, From: x.Status, To: y.Status}
			}
			return nil
		})
	order := map[string]int{"health-changed": 0, "status-changed": 1, "added": 2, "removed": 3}
	full := fullCollators.Get().(interface{ CompareString(a, b string) int })
	defer fullCollators.Put(full)
	sort.SliceStable(changes, func(i, j int) bool {
		a, b := changes[i], changes[j]
		if order[a.Type] != order[b.Type] {
			return order[a.Type] < order[b.Type]
		}
		if c := full.CompareString(a.Kind, b.Kind); c != 0 {
			return c < 0
		}
		return full.CompareString(a.ID, b.ID) < 0
	})
	return changes
}

func healthOrUnknown(h *string) string {
	if h == nil {
		return "unknown"
	}
	return *h
}

var healthRankWorse = map[string]int{"healthy": 0, "unknown": 1, "degraded": 2, "unavailable": 3}

// WorseHealth returns the worse of two health values (unavailable > degraded > unknown > healthy).
func WorseHealth(a, b string) string {
	if healthRankWorse[b] > healthRankWorse[a] {
		return b
	}
	return a
}
