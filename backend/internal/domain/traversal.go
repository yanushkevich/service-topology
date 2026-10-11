package domain

import (
	"sort"
)

// Traversal: a port of apps/web/src/domain/traversal.ts (identical results; conformance fixtures in
// /fixtures/conformance/traversal).

// Highlight modes for ReachFrom.
const (
	ModeDirect     = "direct"
	ModeUpstream   = "upstream"
	ModeDownstream = "downstream"
)

// Reach is a set of entities and relationships.
type Reach struct {
	EntityIDs       map[EntityID]bool
	RelationshipIDs map[EntityID]bool
}

// ReachFrom returns what a highlight mode reaches from startID (including startID): direct
// neighbours both ways, or everything transitively upstream (outgoing) / downstream (incoming).
func (ix *Index) ReachFrom(startID EntityID, mode string) Reach {
	r := Reach{EntityIDs: map[EntityID]bool{startID: true}, RelationshipIDs: map[EntityID]bool{}}
	if mode == ModeDirect {
		for _, rel := range ix.Outgoing[startID] {
			r.EntityIDs[rel.TargetEntityID], r.RelationshipIDs[rel.ID] = true, true
		}
		for _, rel := range ix.Incoming[startID] {
			r.EntityIDs[rel.SourceEntityID], r.RelationshipIDs[rel.ID] = true, true
		}
		return r
	}
	edges, upstream := ix.Incoming, mode == ModeUpstream
	if upstream {
		edges = ix.Outgoing
	}
	queue := []EntityID{startID}
	for len(queue) > 0 {
		current := queue[0]
		queue = queue[1:]
		for _, rel := range edges[current] {
			r.RelationshipIDs[rel.ID] = true
			next := rel.SourceEntityID
			if upstream {
				next = rel.TargetEntityID
			}
			if !r.EntityIDs[next] {
				r.EntityIDs[next] = true
				queue = append(queue, next)
			}
		}
	}
	return r
}

// Neighborhood returns entities within depth hops of centerID, ignoring direction.
func (ix *Index) Neighborhood(centerID EntityID, depth int) map[EntityID]bool {
	seen := map[EntityID]bool{centerID: true}
	frontier := []EntityID{centerID}
	for hop := 0; hop < depth && len(frontier) > 0; hop++ {
		var next []EntityID
		for _, id := range frontier {
			var peers []EntityID
			for _, rel := range ix.Outgoing[id] {
				peers = append(peers, rel.TargetEntityID)
			}
			for _, rel := range ix.Incoming[id] {
				peers = append(peers, rel.SourceEntityID)
			}
			for _, p := range peers {
				if !seen[p] {
					seen[p] = true
					next = append(next, p)
				}
			}
		}
		frontier = next
	}
	return seen
}

// DependencyEntry is one entity in a dependency tree at its shortest distance.
type DependencyEntry struct {
	EntityID          EntityID   `json:"entityId"`
	Depth             int        `json:"depth"`
	ViaRelationshipID EntityID   `json:"viaRelationshipId"`
	ParentID          EntityID   `json:"parentId"`
	Path              []EntityID `json:"path"`
}

// DependencyTree walks upstream (outgoing) or downstream (incoming) breadth-first: each entity once
// at its shortest distance, relationships tried in ID order, results ordered by depth then ID.
// maxDepth <= 0 means unbounded.
func (ix *Index) DependencyTree(startID EntityID, direction string, maxDepth int) []DependencyEntry {
	full := fullCollators.Get().(interface{ CompareString(a, b string) int })
	defer fullCollators.Put(full)
	edges, upstream := ix.Incoming, direction == ModeUpstream
	if upstream {
		edges = ix.Outgoing
	}
	type node struct {
		id   EntityID
		path []EntityID
	}
	seen := map[EntityID]bool{startID: true}
	out := []DependencyEntry{}
	frontier := []node{{startID, []EntityID{startID}}}
	for depth := 1; len(frontier) > 0 && (maxDepth <= 0 || depth <= maxDepth); depth++ {
		var next []node
		for _, n := range frontier {
			rels := append([]*CommunicationRelationship(nil), edges[n.id]...)
			sort.SliceStable(rels, func(i, j int) bool { return full.CompareString(rels[i].ID, rels[j].ID) < 0 })
			for _, rel := range rels {
				peer := rel.SourceEntityID
				if upstream {
					peer = rel.TargetEntityID
				}
				if seen[peer] {
					continue
				}
				seen[peer] = true
				path := append(append([]EntityID{}, n.path...), peer)
				out = append(out, DependencyEntry{EntityID: peer, Depth: depth, ViaRelationshipID: rel.ID, ParentID: n.id, Path: path})
				next = append(next, node{peer, path})
			}
		}
		frontier = next
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].Depth != out[j].Depth {
			return out[i].Depth < out[j].Depth
		}
		return full.CompareString(out[i].EntityID, out[j].EntityID) < 0
	})
	return out
}

// SortedIDs returns the keys of a set in code-unit order (JavaScript's default sort for ASCII IDs).
func SortedIDs(set map[EntityID]bool) []EntityID {
	out := make([]EntityID, 0, len(set))
	for id := range set {
		out = append(out, id)
	}
	sort.Strings(out)
	return out
}
