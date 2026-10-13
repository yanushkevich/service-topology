package httpapi

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"servicetopology/backend/internal/application"
	"servicetopology/backend/internal/domain"
)

// Read operations: metadata, the topology, the registry, traversal, and event types.

func (d Deps) getMeta(w http.ResponseWriter, r *http.Request) error {
	mode := d.AuthMode
	if mode == "" {
		mode = "none"
	}
	meta, err := d.API.Meta(r.Context(), d.SchemaVersion, mode)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, meta)
	return nil
}

func (d Deps) listEnvironments(w http.ResponseWriter, r *http.Request) error {
	envs, err := d.API.Environments(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, items(envs))
	return nil
}

// getTopology returns the topology with its revision as the ETag (the If-Match value for writes).
func (d Deps) getTopology(w http.ResponseWriter, r *http.Request) error {
	data, rev, err := d.API.TopologyRevision(r.Context(), r.URL.Query().Get("environmentId"))
	if err != nil {
		return err
	}
	setETag(w, rev)
	writeJSON(w, http.StatusOK, data)
	return nil
}

func (d Deps) getRegistry(w http.ResponseWriter, r *http.Request) error {
	query, err := registryQuery(r)
	if err != nil {
		return err
	}
	page, err := d.API.Registry(r.Context(), query)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, page)
	return nil
}

// registryQuery reads the registry's filters, sort, and paging from the query string.
func registryQuery(r *http.Request) (application.RegistryQuery, error) {
	q := r.URL.Query()
	query := application.RegistryQuery{EnvironmentID: q.Get("environmentId"), Sort: q.Get("sort"), Cursor: q.Get("cursor")}
	query.Filters.Query = q.Get("q")
	var err error
	if query.Filters.Providers, err = listParam(q.Get("provider"), "provider", domain.ProviderValues); err != nil {
		return query, err
	}
	if query.Filters.Health, err = listParam(q.Get("health"), "health", domain.HealthValues); err != nil {
		return query, err
	}
	if query.Filters.Groups, err = listParam(q.Get("kind"), "kind", domain.EntityGroups); err != nil {
		return query, err
	}
	if raw := q.Get("limit"); raw != "" {
		if query.Limit, err = strconv.Atoi(raw); err != nil || query.Limit < 1 {
			return query, &application.ErrInvalid{Param: "limit", Reason: fmt.Sprintf("must be an integer between 1 and %d", application.MaxRegistryLimit)}
		}
	}
	return query, nil
}

func (d Deps) getEntity(w http.ResponseWriter, r *http.Request) error {
	e, err := d.API.Entity(r.Context(), r.PathValue("kind"), r.PathValue("id"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, e)
	return nil
}

func (d Deps) getDependencies(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	maxDepth, err := intParam(q.Get("maxDepth"), "maxDepth")
	if err != nil {
		return err
	}
	limit, err := intParam(q.Get("limit"), "limit")
	if err != nil {
		return err
	}
	res, err := d.API.Dependencies(r.Context(), q.Get("entityId"), q.Get("direction"), maxDepth, limit)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, res)
	return nil
}

func (d Deps) getNeighborhood(w http.ResponseWriter, r *http.Request) error {
	depth, err := intParam(r.URL.Query().Get("depth"), "depth")
	if err != nil {
		return err
	}
	res, err := d.API.Neighborhood(r.Context(), r.URL.Query().Get("entityId"), depth)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, res)
	return nil
}

// getImpact explains what fails when the listed entities fail (comma-separated entityId).
func (d Deps) getImpact(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	mode := q.Get("mode")
	if mode == "" {
		mode = domain.FailureUnavailable
	}
	var roots []domain.FailureRoot
	for _, id := range strings.Split(q.Get("entityId"), ",") {
		if id != "" {
			roots = append(roots, domain.FailureRoot{EntityID: id, Mode: mode})
		}
	}
	res, err := d.API.Impact(r.Context(), roots)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, res)
	return nil
}

func (d Deps) listPropagationRules(w http.ResponseWriter, _ *http.Request) error {
	writeJSON(w, http.StatusOK, items(domain.PropagationRules))
	return nil
}

func (d Deps) listEventTypes(w http.ResponseWriter, r *http.Request) error {
	flows, err := d.API.EventTypes(r.Context(), r.URL.Query().Get("environmentId"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, items(flows))
	return nil
}

func (d Deps) getEventType(w http.ResponseWriter, r *http.Request) error {
	flow, err := d.API.EventType(r.Context(), r.PathValue("id"), r.URL.Query().Get("environmentId"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, flow)
	return nil
}
