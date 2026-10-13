package httpapi

import (
	"net/http"
	"net/url"

	"servicetopology/backend/internal/application"
	"servicetopology/backend/internal/fixtures"
)

// Entity writes (ADR-020) and business-flow imports (ADR-022). Every write answers with the new
// topology revision as the ETag; If-Match, when sent, must equal the current revision.

func (d Deps) createEntity(w http.ResponseWriter, r *http.Request) error {
	kind := r.PathValue("kind")
	entity, err := readEntity(w, r, kind)
	if err != nil {
		return err
	}
	res, err := d.API.CreateEntity(r.Context(), kind, entity, ifMatch(r))
	if err != nil {
		return err
	}
	w.Header().Set("Location", "/api/v1/entities/"+kind+"/"+url.PathEscape(res.ID))
	setETag(w, res.Revision)
	writeJSON(w, http.StatusCreated, res.Entity)
	return nil
}

func (d Deps) replaceEntity(w http.ResponseWriter, r *http.Request) error {
	kind := r.PathValue("kind")
	entity, err := readEntity(w, r, kind)
	if err != nil {
		return err
	}
	res, err := d.API.ReplaceEntity(r.Context(), kind, r.PathValue("id"), entity, ifMatch(r))
	if err != nil {
		return err
	}
	setETag(w, res.Revision)
	writeJSON(w, http.StatusOK, res.Entity)
	return nil
}

func (d Deps) deleteEntity(w http.ResponseWriter, r *http.Request) error {
	res, err := d.API.DeleteEntity(r.Context(), r.PathValue("kind"), r.PathValue("id"), ifMatch(r))
	if err != nil {
		return err
	}
	setETag(w, res.Revision)
	w.WriteHeader(http.StatusNoContent)
	return nil
}

// importBusinessFlows imports workflow definitions as business flows: native JSON/YAML or BPMN 2.0.
func (d Deps) importBusinessFlows(w http.ResponseWriter, r *http.Request) error {
	raw, err := readBody(w, r, maxImportBody)
	if err != nil {
		return err
	}
	var req application.FlowImport
	if err := fixtures.DecodeStrict(raw, &req); err != nil {
		return &application.ErrInvalid{Param: "body", Reason: "not a valid import request: " + err.Error()}
	}
	res, err := d.API.ImportFlows(r.Context(), req)
	if err != nil {
		return err
	}
	setETag(w, res.Revision)
	writeJSON(w, http.StatusOK, res)
	return nil
}

// readEntity reads the body as the canonical entity type of kind (unknown fields are rejected).
func readEntity(w http.ResponseWriter, r *http.Request, kind string) (any, error) {
	raw, err := readBody(w, r, maxEntityBody)
	if err != nil {
		return nil, err
	}
	return application.DecodeEntity(kind, raw)
}
