package httpapi

import "net/http"

// Body size limits (docs/backend/SECURITY.md: bound every payload).
const (
	maxSnapshotBody = 16 << 20
	maxLayoutBody   = 1 << 20
	maxEntityBody   = 1 << 20
	maxImportBody   = 4 << 20 // a workflow definition file plus its mapping
	maxRequestBody  = 1 << 20 // simulation requests
)

// handlerFunc is an API handler: it writes the response, or returns an error that writeError maps
// to an RFC 9457 problem.
type handlerFunc func(http.ResponseWriter, *http.Request) error

// apiRoutes registers the contract v1 operations from docs/api/openapi.json under /api/v1. The
// handlers live by area: routes_read.go (topology, registry, traversal, event types),
// routes_entities.go (writes and imports), routes_history.go (snapshots and layouts), and
// routes_simulations.go (runs, events, telemetry). Request parsing is in request.go.
func (d Deps) apiRoutes(mux *http.ServeMux) {
	h := func(pattern string, fn handlerFunc) {
		mux.HandleFunc(pattern, func(w http.ResponseWriter, r *http.Request) {
			if d.API == nil {
				WriteProblem(w, r, Problem{Type: problemBase + "unavailable", Title: "Service unavailable", Status: http.StatusServiceUnavailable, Detail: "No database is configured."})
				return
			}
			if err := fn(w, r); err != nil {
				d.writeError(w, r, err)
			}
		})
	}

	h("GET /api/v1/meta", d.getMeta)
	h("GET /api/v1/environments", d.listEnvironments)
	h("GET /api/v1/topology", d.getTopology)
	h("GET /api/v1/registry", d.getRegistry)
	h("GET /api/v1/topology/dependencies", d.getDependencies)
	h("GET /api/v1/topology/neighborhood", d.getNeighborhood)
	h("GET /api/v1/topology/impact", d.getImpact)
	h("GET /api/v1/propagation-rules", d.listPropagationRules)
	h("GET /api/v1/event-types", d.listEventTypes)
	h("GET /api/v1/event-types/{id}", d.getEventType)

	// Writes (ADR-020): one canonical entity at a time, validated against the whole topology.
	h("GET /api/v1/entities/{kind}/{id}", d.getEntity)
	h("POST /api/v1/entities/{kind}", d.createEntity)
	h("PUT /api/v1/entities/{kind}/{id}", d.replaceEntity)
	h("DELETE /api/v1/entities/{kind}/{id}", d.deleteEntity)
	h("POST /api/v1/imports/business-flows", d.importBusinessFlows)

	h("GET /api/v1/topology/snapshots", d.listSnapshots)
	h("POST /api/v1/topology/snapshots", d.captureSnapshot)
	h("GET /api/v1/topology/snapshots/{id}", d.getSnapshot)
	h("GET /api/v1/topology/snapshots/{id}/diff", d.diffSnapshot)
	h("GET /api/v1/layouts", d.listLayouts)
	h("POST /api/v1/layouts", d.createLayout)
	h("PUT /api/v1/layouts/{id}", d.replaceLayout)
	h("DELETE /api/v1/layouts/{id}", d.deleteLayout)

	h("POST /api/v1/simulations", d.runSimulation)
	h("GET /api/v1/simulations", d.listSimulations)
	h("GET /api/v1/simulations/{id}", d.getSimulation)
	h("GET /api/v1/events", d.listEvents)
	h("GET /api/v1/telemetry", d.listTelemetry)
}

// items wraps a list response as the contract's `{ "items": [...] }` envelope.
func items(v any) map[string]any { return map[string]any{"items": v} }
