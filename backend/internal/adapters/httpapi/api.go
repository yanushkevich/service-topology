package httpapi

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"

	"servicetopology/backend/internal/application"
	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
	"servicetopology/backend/internal/ports"
)

// Body size limits (docs/backend/SECURITY.md: bound every payload).
const (
	maxSnapshotBody = 16 << 20
	maxLayoutBody   = 1 << 20
)

// apiRoutes registers the contract v1 operations from docs/api/openapi.json under /api/v1.
func (d Deps) apiRoutes(mux *http.ServeMux) {
	h := func(pattern string, fn func(http.ResponseWriter, *http.Request) error) {
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
	s := d.API
	h("GET /api/v1/environments", func(w http.ResponseWriter, r *http.Request) error {
		envs, err := s.Environments(r.Context())
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": envs})
		return nil
	})
	h("GET /api/v1/topology", func(w http.ResponseWriter, r *http.Request) error {
		data, err := s.Topology(r.Context(), r.URL.Query().Get("environmentId"))
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, data)
		return nil
	})
	h("GET /api/v1/registry", func(w http.ResponseWriter, r *http.Request) error {
		q := r.URL.Query()
		query := application.RegistryQuery{EnvironmentID: q.Get("environmentId"), Sort: q.Get("sort"), Cursor: q.Get("cursor")}
		query.Filters.Query = q.Get("q")
		var err error
		if query.Filters.Providers, err = listParam(q.Get("provider"), "provider", []string{"aws", "azure", "gcp", "on-prem", "saas", "internal", "unknown"}); err != nil {
			return err
		}
		if query.Filters.Health, err = listParam(q.Get("health"), "health", []string{"healthy", "degraded", "unavailable", "unknown"}); err != nil {
			return err
		}
		if query.Filters.Groups, err = listParam(q.Get("kind"), "kind", domain.EntityGroups); err != nil {
			return err
		}
		if raw := q.Get("limit"); raw != "" {
			if query.Limit, err = strconv.Atoi(raw); err != nil || query.Limit < 1 {
				return &application.ErrInvalid{Param: "limit", Reason: fmt.Sprintf("must be an integer between 1 and %d", application.MaxRegistryLimit)}
			}
		}
		page, err := s.Registry(r.Context(), query)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, page)
		return nil
	})
	h("GET /api/v1/entities/{kind}/{id}", func(w http.ResponseWriter, r *http.Request) error {
		e, err := s.Entity(r.Context(), r.PathValue("kind"), r.PathValue("id"))
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, e)
		return nil
	})
	h("GET /api/v1/topology/snapshots", func(w http.ResponseWriter, r *http.Request) error {
		items, err := s.Snapshots(r.Context(), r.URL.Query().Get("from"), r.URL.Query().Get("to"))
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
		return nil
	})
	h("GET /api/v1/topology/snapshots/{id}", func(w http.ResponseWriter, r *http.Request) error {
		snap, err := s.Snapshot(r.Context(), r.PathValue("id"))
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, snap)
		return nil
	})
	h("POST /api/v1/topology/snapshots", func(w http.ResponseWriter, r *http.Request) error {
		var snap domain.Snapshot
		if err := decodeBody(w, r, maxSnapshotBody, &snap); err != nil {
			return err
		}
		summary, err := s.CaptureSnapshot(r.Context(), &snap)
		if err != nil {
			return err
		}
		w.Header().Set("Location", "/api/v1/topology/snapshots/"+summary.ID)
		writeJSON(w, http.StatusCreated, summary)
		return nil
	})
	h("GET /api/v1/layouts", func(w http.ResponseWriter, r *http.Request) error {
		items, err := s.Layouts(r.Context())
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": items})
		return nil
	})
	h("POST /api/v1/layouts", func(w http.ResponseWriter, r *http.Request) error {
		var l domain.SavedLayout
		if err := decodeBody(w, r, maxLayoutBody, &l); err != nil {
			return err
		}
		if err := s.CreateLayout(r.Context(), &l); err != nil {
			return err
		}
		w.Header().Set("Location", "/api/v1/layouts/"+l.ID)
		writeJSON(w, http.StatusCreated, l)
		return nil
	})
	h("PUT /api/v1/layouts/{id}", func(w http.ResponseWriter, r *http.Request) error {
		var l domain.SavedLayout
		if err := decodeBody(w, r, maxLayoutBody, &l); err != nil {
			return err
		}
		if err := s.ReplaceLayout(r.Context(), r.PathValue("id"), &l); err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, l)
		return nil
	})
	h("GET /api/v1/topology/dependencies", func(w http.ResponseWriter, r *http.Request) error {
		q := r.URL.Query()
		maxDepth, err := intParam(q.Get("maxDepth"), "maxDepth")
		if err != nil {
			return err
		}
		limit, err := intParam(q.Get("limit"), "limit")
		if err != nil {
			return err
		}
		res, err := s.Dependencies(r.Context(), q.Get("entityId"), q.Get("direction"), maxDepth, limit)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, res)
		return nil
	})
	h("GET /api/v1/topology/neighborhood", func(w http.ResponseWriter, r *http.Request) error {
		depth, err := intParam(r.URL.Query().Get("depth"), "depth")
		if err != nil {
			return err
		}
		res, err := s.Neighborhood(r.Context(), r.URL.Query().Get("entityId"), depth)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, res)
		return nil
	})
	h("GET /api/v1/topology/impact", func(w http.ResponseWriter, r *http.Request) error {
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
		res, err := s.Impact(r.Context(), roots)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, res)
		return nil
	})
	h("GET /api/v1/propagation-rules", func(w http.ResponseWriter, r *http.Request) error {
		writeJSON(w, http.StatusOK, map[string]any{"items": domain.PropagationRules})
		return nil
	})
	h("GET /api/v1/event-types", func(w http.ResponseWriter, r *http.Request) error {
		flows, err := s.EventTypes(r.Context(), r.URL.Query().Get("environmentId"))
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": flows})
		return nil
	})
	h("GET /api/v1/event-types/{id}", func(w http.ResponseWriter, r *http.Request) error {
		flow, err := s.EventType(r.Context(), r.PathValue("id"), r.URL.Query().Get("environmentId"))
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, flow)
		return nil
	})
	h("POST /api/v1/simulations", func(w http.ResponseWriter, r *http.Request) error {
		var req domain.SimulationRequest
		if err := decodeBody(w, r, maxLayoutBody, &req); err != nil {
			return err
		}
		run, err := s.RunSimulation(r.Context(), &req)
		if err != nil {
			return err
		}
		w.Header().Set("Location", "/api/v1/simulations/"+run.ID)
		writeJSON(w, http.StatusCreated, run)
		return nil
	})
	h("GET /api/v1/simulations", func(w http.ResponseWriter, r *http.Request) error {
		limit, err := intParam(r.URL.Query().Get("limit"), "limit")
		if err != nil {
			return err
		}
		runs, err := s.Simulations(r.Context(), limit)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": runs})
		return nil
	})
	h("GET /api/v1/simulations/{id}", func(w http.ResponseWriter, r *http.Request) error {
		run, err := s.Simulation(r.Context(), r.PathValue("id"))
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, run)
		return nil
	})
	h("GET /api/v1/events", func(w http.ResponseWriter, r *http.Request) error {
		q := r.URL.Query()
		limit, err := intParam(q.Get("limit"), "limit")
		if err != nil {
			return err
		}
		page, err := s.Events(r.Context(), q.Get("simulationId"), q.Get("entityId"), q.Get("type"), q.Get("cursor"), limit)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, page)
		return nil
	})
	h("GET /api/v1/telemetry", func(w http.ResponseWriter, r *http.Request) error {
		q := r.URL.Query()
		limit, err := intParam(q.Get("limit"), "limit")
		if err != nil {
			return err
		}
		page, err := s.Telemetry(r.Context(), q.Get("simulationId"), q.Get("entityId"), q.Get("metricName"), q.Get("cursor"), limit)
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, page)
		return nil
	})
	h("GET /api/v1/topology/snapshots/{id}/diff", func(w http.ResponseWriter, r *http.Request) error {
		res, err := s.DiffSnapshot(r.Context(), r.PathValue("id"), r.URL.Query().Get("against"))
		if err != nil {
			return err
		}
		writeJSON(w, http.StatusOK, res)
		return nil
	})
	h("DELETE /api/v1/layouts/{id}", func(w http.ResponseWriter, r *http.Request) error {
		if err := s.DeleteLayout(r.Context(), r.PathValue("id")); err != nil {
			return err
		}
		w.WriteHeader(http.StatusNoContent)
		return nil
	})
}

// intParam parses an optional positive integer parameter (0 when absent).
func intParam(raw, name string) (int, error) {
	if raw == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return 0, &application.ErrInvalid{Param: name, Reason: "must be a positive integer"}
	}
	return n, nil
}

// listParam parses a comma-separated list parameter (OpenAPI style: form, explode: false) and
// checks every value against allowed. Duplicates are dropped; order is kept.
func listParam(raw, name string, allowed []string) ([]string, error) {
	out := []string{}
	if raw == "" {
		return out, nil
	}
	seen := map[string]bool{}
	for _, v := range strings.Split(raw, ",") {
		if v == "" {
			continue
		}
		ok := false
		for _, a := range allowed {
			if v == a {
				ok = true
				break
			}
		}
		if !ok {
			return nil, &application.ErrInvalid{Param: name, Reason: fmt.Sprintf("unknown value %q (allowed: %s)", v, strings.Join(allowed, ", "))}
		}
		if !seen[v] {
			seen[v] = true
			out = append(out, v)
		}
	}
	return out, nil
}

type errUnsupportedMedia struct{}

func (errUnsupportedMedia) Error() string { return "Content-Type must be application/json" }

type errTooLarge struct{ limit int64 }

func (e errTooLarge) Error() string { return fmt.Sprintf("Request body exceeds %d bytes.", e.limit) }

// decodeBody reads a JSON body strictly (unknown fields are rejected, as in the schemas).
func decodeBody(w http.ResponseWriter, r *http.Request, limit int64, into any) error {
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		return errUnsupportedMedia{}
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return errTooLarge{limit}
		}
		return &application.ErrInvalid{Param: "body", Reason: "could not be read"}
	}
	if err := fixtures.DecodeStrict(raw, into); err != nil {
		return &application.ErrInvalid{Param: "body", Reason: "not valid JSON for this operation: " + err.Error()}
	}
	return nil
}

// writeError maps errors to RFC 9457 problems. Internal details are logged, never returned.
func (d Deps) writeError(w http.ResponseWriter, r *http.Request, err error) {
	var invalid *application.ErrInvalid
	var validation *application.ErrValidation
	var notFound *application.NotFound
	var tooLarge errTooLarge
	switch {
	case errors.As(err, &invalid):
		WriteProblem(w, r, Problem{Type: problemBase + "invalid-request", Title: "Invalid request", Status: http.StatusBadRequest, Detail: invalid.Error(),
			Errors: []ProblemError{{Code: "invalid-parameter", Message: invalid.Error()}}})
	case errors.As(err, &validation):
		p := Problem{Type: problemBase + "validation-failed", Title: "Validation failed", Status: http.StatusUnprocessableEntity,
			Detail: fmt.Sprintf("%d validation issue(s).", len(validation.Issues))}
		for _, i := range validation.Issues {
			p.Errors = append(p.Errors, ProblemError{Code: i.Code, EntityID: i.EntityID, Message: i.Message})
		}
		WriteProblem(w, r, p)
	case errors.As(err, &notFound):
		WriteProblem(w, r, Problem{Type: problemBase + "not-found", Title: "Not found", Status: http.StatusNotFound, Detail: notFound.Detail})
	case errors.Is(err, ports.ErrNotFound):
		WriteProblem(w, r, Problem{Type: problemBase + "not-found", Title: "Not found", Status: http.StatusNotFound})
	case errors.Is(err, ports.ErrConflict):
		WriteProblem(w, r, Problem{Type: problemBase + "conflict", Title: "Conflict", Status: http.StatusConflict, Detail: "An item with this ID already exists."})
	case errors.As(err, &tooLarge):
		WriteProblem(w, r, Problem{Type: problemBase + "payload-too-large", Title: "Payload too large", Status: http.StatusRequestEntityTooLarge, Detail: tooLarge.Error()})
	case errors.As(err, new(errUnsupportedMedia)):
		WriteProblem(w, r, Problem{Type: problemBase + "unsupported-media-type", Title: "Unsupported media type", Status: http.StatusUnsupportedMediaType, Detail: err.Error()})
	case errors.Is(err, ports.ErrUnavailable):
		d.Logger.WarnContext(r.Context(), "dependency unavailable", "error", err.Error())
		WriteProblem(w, r, Problem{Type: problemBase + "unavailable", Title: "Service unavailable", Status: http.StatusServiceUnavailable, Detail: "The database is unavailable. Try again later."})
	default:
		d.Logger.ErrorContext(r.Context(), "request failed", "error", err.Error())
		WriteProblem(w, r, Problem{Type: problemBase + "internal", Title: "Internal server error", Status: http.StatusInternalServerError})
	}
}
