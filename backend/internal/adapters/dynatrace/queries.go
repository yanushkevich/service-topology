package dynatrace

import "time"

// Query is one constant DQL query (spec §2). Configuration never reaches DQL: environments are
// matched in Go, and time windows travel as the API's defaultTimeframe fields.
type Query struct {
	Name string
	DQL  string
	// Fields are what the mapping reads; the connection check reports any that never come back.
	Fields []string
	window func(*Config) time.Duration
}

// The field names follow Dynatrace's public documentation (Smartscape on Grail, the semantic
// dictionary). They are unverified against a real tenant: the connection check is how to confirm
// them, and this file is the one place to correct them.
var (
	queryServices = Query{
		Name:   "services",
		DQL:    `smartscapeNodes SERVICE | fields id, name, tags, id_classic`,
		Fields: []string{"id", "name", "tags", "id_classic"},
		window: discoveryWindow,
	}
	queryServiceCalls = Query{
		Name:   "service-calls",
		DQL:    `smartscapeEdges calls | filter source_type == "SERVICE" | fields source_id, target_id, target_type`,
		Fields: []string{"source_id", "target_id", "target_type"},
		window: discoveryWindow,
	}
	queryServiceBelongsTo = Query{
		Name:   "service-belongs-to",
		DQL:    `smartscapeEdges belongs_to | filter source_type == "SERVICE" | fields source_id, target_id, target_type`,
		Fields: []string{"source_id", "target_id", "target_type"},
		window: discoveryWindow,
	}
	queryK8sNodes = Query{
		Name:   "k8s-nodes",
		DQL:    `smartscapeNodes "K8S_*" | fields id, name, type, id_classic`,
		Fields: []string{"id", "name", "type"},
		window: discoveryWindow,
	}
	queryDatabases = Query{
		Name:   "databases",
		DQL:    `smartscapeNodes "DB_*" | fields id, name, type, id_classic`,
		Fields: []string{"id", "name", "type"},
		window: discoveryWindow,
	}
	queryHosts = Query{
		Name:   "hosts",
		DQL:    `smartscapeNodes HOST | fields id, name, id_classic`,
		Fields: []string{"id", "name"},
		window: discoveryWindow,
	}
	queryServiceRunsOn = Query{
		Name:   "service-runs-on",
		DQL:    `smartscapeEdges runs_on | filter source_type == "SERVICE" and target_type == "HOST" | fields source_id, target_id`,
		Fields: []string{"source_id", "target_id"},
		window: discoveryWindow,
	}
	// Smartscape has no topic or queue nodes; channels come from the messaging metrics, by
	// destination and system (Milestone 15.1).
	queryMessagingPublish = Query{
		Name:   "messaging-publish",
		DQL:    `timeseries n = sum(dt.service.messaging.publish.count), by: { dt.smartscape.service, messaging.destination.name, messaging.system } | fieldsAdd n = arraySum(n)`,
		Fields: []string{"dt.smartscape.service", "messaging.destination.name", "messaging.system", "n"},
		window: discoveryWindow,
	}
	queryMessagingReceive = Query{
		Name:   "messaging-receive",
		DQL:    `timeseries n = sum(dt.service.messaging.receive.count), by: { dt.smartscape.service, messaging.destination.name, messaging.system } | fieldsAdd n = arraySum(n)`,
		Fields: []string{"dt.smartscape.service", "messaging.destination.name", "messaging.system", "n"},
		window: discoveryWindow,
	}
	// Joined on dt.smartscape.service (the node ID), as Dynatrace's service docs do.
	queryServiceMetrics = Query{
		Name: "service-metrics",
		DQL: `timeseries { rt = avg(dt.service.request.response_time), n = sum(dt.service.request.count), f = sum(dt.service.request.failure_count) }, by: { dt.smartscape.service }` +
			` | fieldsAdd rt = arrayAvg(rt), n = arraySum(n), f = arraySum(f)`,
		Fields: []string{"dt.smartscape.service", "rt", "n", "f"},
		window: func(c *Config) time.Duration { return c.Refresh.MetricsWindow.Duration },
	}
	// Metrics on calls (Milestone 15.2): each server span joined to its parent client span gives a
	// caller and a callee; counts are extrapolated with Dynatrace's documented multiplicity, latency
	// is the client span's duration (nanoseconds, the call as the caller sees it), failures are server
	// spans with status error. Opt-in: it scans every span in the window.
	queryCallMetrics = Query{
		Name: "call-metrics",
		DQL: `fetch spans | filter span.kind == "server" and isNotNull(dt.smartscape.service) and isNotNull(span.parent_id)` +
			` | fieldsAdd m = coalesce(sampling.multiplicity, 1) * coalesce(aggregation.count, 1) * dt.system.sampling_ratio` +
			` | fields span.parent_id, callee = dt.smartscape.service, failed = span.status_code == "error", m` +
			` | join [fetch spans | filter span.kind == "client" and isNotNull(dt.smartscape.service) | fields span.id, caller = dt.smartscape.service, call_duration = duration],` +
			` on: { left[span.parent_id] == right[span.id] }, fields: { caller, call_duration }` +
			` | filter caller != callee` +
			` | summarize { n = sum(m), f = sum(if(failed, m, else: 0)), rt = avg(call_duration) }, by: { caller, callee }`,
		Fields: []string{"caller", "callee", "n", "f", "rt"},
		window: func(c *Config) time.Duration { return c.CallMetrics.Interval.Duration },
	}
	queryProblems = Query{
		Name: "problems",
		DQL: `fetch dt.davis.problems | filter not(dt.davis.is_duplicate) | dedup event.id, sort: { timestamp desc }` +
			` | filter event.status == "ACTIVE" | fields event.id, display_id, event.name, event.category, affected_entity_ids`,
		Fields: []string{"event.id", "display_id", "event.category", "affected_entity_ids"},
		window: func(*Config) time.Duration { return 7 * 24 * time.Hour },
	}
)

// structureQueries feed a discovery; observeQueries feed a refresh. The check runs all of them.
var (
	structureQueries = []Query{queryServices, queryServiceCalls, queryServiceBelongsTo, queryK8sNodes, queryDatabases, queryHosts, queryServiceRunsOn, queryMessagingPublish, queryMessagingReceive}
	observeQueries   = []Query{queryServices, queryK8sNodes, queryDatabases, queryHosts, queryServiceMetrics, queryProblems}
	allQueries       = []Query{queryServices, queryServiceCalls, queryServiceBelongsTo, queryK8sNodes, queryDatabases, queryHosts, queryServiceRunsOn, queryMessagingPublish, queryMessagingReceive, queryServiceMetrics, queryProblems, queryCallMetrics}
)

// checkQueries are the queries a connection check runs: call metrics only when enabled.
func checkQueries(c *Config) []Query {
	if c.CallMetrics.Enabled {
		return allQueries
	}
	return allQueries[:len(allQueries)-1]
}

func discoveryWindow(c *Config) time.Duration { return c.Discovery.Window.Duration }

// QueryByDQL finds a known query by its text (used by the fake tenant, which answers only these).
func QueryByDQL(dql string) (Query, bool) {
	for _, q := range allQueries {
		if q.DQL == dql {
			return q, true
		}
	}
	return Query{}, false
}
