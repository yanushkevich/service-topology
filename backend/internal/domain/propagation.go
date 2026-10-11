package domain

import (
	"sort"
)

// Failure propagation: a port of apps/web/src/domain/propagation.ts. Rules are data so the API can
// list them and every impact names the rule that produced it.

// Failure modes.
const (
	FailureUnavailable = "unavailable"
	FailureDegraded    = "degraded"
)

// PropagationRule describes one rule (same IDs and text as the client).
type PropagationRule struct {
	ID         string `json:"id"`
	Title      string `json:"title"`
	When       string `json:"when"`
	Effect     string `json:"effect"`
	Rationale  string `json:"rationale"`
	Transitive bool   `json:"transitive"`
}

// PropagationRules is the rule table, in the client's order.
var PropagationRules = []PropagationRule{
	{"containment", "Containment failure", "An infrastructure resource (cluster, namespace, broker, region…) becomes unavailable.", "Everything it contains, including service instances running in it, becomes unavailable.", "Containment answers \"where does this run?\": if the host is gone, so is what runs on it.", true},
	{"synchronous-call", "Synchronous dependency", "A service is called synchronously (HTTP, HTTPS, gRPC, GraphQL, WebSocket) and the callee is unavailable or degraded.", "The caller becomes degraded. Callers of the caller are affected in turn.", "A synchronous caller waits for the response, so callee failures and latency surface in the caller.", true},
	{"data-access", "Data store dependency", "A database, cache, or search index the service reads or writes is unavailable or degraded.", "The service becomes degraded. Its callers are affected in turn.", "Data access is synchronous from the service’s point of view.", true},
	{"scheduled-job", "Scheduled job dependency", "A scheduled job’s target is unavailable or degraded.", "The job becomes degraded (its runs fail or slow down).", "A job run is a synchronous call that happens on a timer.", true},
	{"publish-to-failed-channel", "Publishing to a failed topic/queue", "A Kafka topic, RabbitMQ queue, or exchange that a service publishes to is unavailable.", "The producer becomes degraded (publishes fail).", "Producers depend on the channel accepting messages. A merely degraded channel (backlog) still accepts them.", true},
	{"consume-from-failed-channel", "Consuming from a failed topic/queue", "A topic, queue, or exchange that delivers to a consumer is unavailable.", "The consumer becomes degraded (no new messages; data goes stale).", "The consumer keeps running but its input stops.", true},
	{"consumer-backlog", "Consumer backlog", "A consumer of a topic or queue is unavailable.", "The topic/queue becomes degraded (backlog grows). Producers are not affected.", "Asynchronous messaging decouples producers from consumers; the channel absorbs the failure as backlog.", false},
}

var (
	syncProtocols = map[string]bool{"http": true, "https": true, "grpc": true, "graphql": true, "websocket": true, "tcp": true, "tls": true}
	dataProtocols = map[string]bool{"postgresql": true, "mysql": true, "mongodb": true, "redis": true}
	severity      = map[string]int{FailureDegraded: 1, FailureUnavailable: 2}
)

// FailureRoot is a simulated failure.
type FailureRoot struct {
	EntityID EntityID `json:"entityId"`
	Mode     string   `json:"mode"`
}

// Impact is one affected entity with the rule and path that explain it.
type Impact struct {
	EntityID          EntityID   `json:"entityId"`
	Effect            string     `json:"effect"`
	RuleID            string     `json:"ruleId"`
	RootID            EntityID   `json:"rootId"`
	ViaRelationshipID EntityID   `json:"viaRelationshipId,omitempty"`
	CauseID           EntityID   `json:"causeId"`
	Path              []EntityID `json:"path"`
}

func (ix *Index) isChannel(id EntityID) bool {
	r := ix.Resources[id]
	return r != nil && eventChannelTypes[r.Type]
}

func (ix *Index) ruleForCaller(r *CommunicationRelationship, targetEffect string) string {
	if ix.isChannel(r.TargetEntityID) {
		if targetEffect == FailureUnavailable {
			return "publish-to-failed-channel"
		}
		return ""
	}
	if ix.isChannel(r.SourceEntityID) {
		return ""
	}
	switch {
	case r.Pattern == "scheduled":
		return "scheduled-job"
	case r.Pattern == "database" || dataProtocols[r.Protocol]:
		return "data-access"
	case r.Pattern == "synchronous" || syncProtocols[r.Protocol]:
		return "synchronous-call"
	}
	return ""
}

// containedEntities returns child resources (recursively) and instances hosted in them, sorted in
// code-unit order like the client's Array.prototype.sort().
func (ix *Index) containedEntities(resourceID EntityID) []EntityID {
	var out []EntityID
	stack := []EntityID{resourceID}
	seen := map[EntityID]bool{resourceID: true}
	for len(stack) > 0 {
		id := stack[len(stack)-1]
		stack = stack[:len(stack)-1]
		for _, inst := range ix.InstancesByResource[id] {
			out = append(out, inst.ID)
		}
		for _, child := range ix.ChildResources[id] {
			if seen[child.ID] {
				continue
			}
			seen[child.ID] = true
			out = append(out, child.ID)
			stack = append(stack, child.ID)
		}
	}
	sort.Strings(out)
	return out
}

// AnalyzeImpact propagates simulated failures breadth-first. Each entity appears once with its most
// severe effect (ties keep the first found); roots are not listed. Read-only.
func (ix *Index) AnalyzeImpact(roots []FailureRoot) []Impact {
	full := fullCollators.Get().(interface{ CompareString(a, b string) int })
	defer fullCollators.Put(full)
	byID := func(rels []*CommunicationRelationship) []*CommunicationRelationship {
		out := append([]*CommunicationRelationship(nil), rels...)
		sort.SliceStable(out, func(i, j int) bool { return full.CompareString(out[i].ID, out[j].ID) < 0 })
		return out
	}
	rootIDs := map[EntityID]bool{}
	for _, r := range roots {
		rootIDs[r.EntityID] = true
	}
	type item struct {
		id, effect, rootID EntityID
		path               []EntityID
	}
	sortedRoots := append([]FailureRoot(nil), roots...)
	sort.SliceStable(sortedRoots, func(i, j int) bool { return full.CompareString(sortedRoots[i].EntityID, sortedRoots[j].EntityID) < 0 })
	var queue []item
	for _, r := range sortedRoots {
		queue = append(queue, item{r.EntityID, r.Mode, r.EntityID, []EntityID{r.EntityID}})
	}
	best := map[EntityID]Impact{}
	var order []EntityID // insertion order of best (Map iteration order in the client)
	record := func(im Impact, transitive bool) {
		if rootIDs[im.EntityID] {
			return
		}
		if existing, ok := best[im.EntityID]; ok && severity[existing.Effect] >= severity[im.Effect] {
			return
		} else if !ok {
			order = append(order, im.EntityID)
		}
		best[im.EntityID] = im
		if transitive {
			queue = append(queue, item{im.EntityID, im.Effect, im.RootID, im.Path})
		}
	}
	extend := func(path []EntityID, id EntityID) []EntityID { return append(append([]EntityID{}, path...), id) }

	for len(queue) > 0 {
		cur := queue[0]
		queue = queue[1:]
		if cur.effect == FailureUnavailable && ix.Resources[cur.id] != nil {
			for _, child := range ix.containedEntities(cur.id) {
				record(Impact{EntityID: child, Effect: FailureUnavailable, RuleID: "containment", RootID: cur.rootID, CauseID: cur.id, Path: extend(cur.path, child)}, true)
			}
		}
		for _, r := range byID(ix.Incoming[cur.id]) {
			if ix.isChannel(r.SourceEntityID) {
				if cur.effect == FailureUnavailable {
					record(Impact{EntityID: r.SourceEntityID, Effect: FailureDegraded, RuleID: "consumer-backlog", RootID: cur.rootID, ViaRelationshipID: r.ID, CauseID: cur.id, Path: extend(cur.path, r.SourceEntityID)}, false)
				}
				continue
			}
			if rule := ix.ruleForCaller(r, cur.effect); rule != "" {
				record(Impact{EntityID: r.SourceEntityID, Effect: FailureDegraded, RuleID: rule, RootID: cur.rootID, ViaRelationshipID: r.ID, CauseID: cur.id, Path: extend(cur.path, r.SourceEntityID)}, true)
			}
		}
		if cur.effect == FailureUnavailable && ix.isChannel(cur.id) {
			for _, r := range byID(ix.Outgoing[cur.id]) {
				record(Impact{EntityID: r.TargetEntityID, Effect: FailureDegraded, RuleID: "consume-from-failed-channel", RootID: cur.rootID, ViaRelationshipID: r.ID, CauseID: cur.id, Path: extend(cur.path, r.TargetEntityID)}, true)
			}
		}
	}
	out := make([]Impact, 0, len(order))
	for _, id := range order {
		out = append(out, best[id])
	}
	sort.SliceStable(out, func(i, j int) bool {
		if len(out[i].Path) != len(out[j].Path) {
			return len(out[i].Path) < len(out[j].Path)
		}
		return full.CompareString(out[i].EntityID, out[j].EntityID) < 0
	})
	return out
}
