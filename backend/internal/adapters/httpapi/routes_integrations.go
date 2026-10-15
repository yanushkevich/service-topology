package httpapi

import (
	"net/http"

	"servicetopology/backend/internal/domain"
)

// Topology source integrations (ADR-034, docs/DYNATRACE_CONNECTOR.md §6): status, a connection
// check, a held preview, its apply (If-Match: the preview's base revision), and the alias list.

func (d Deps) getIntegration(w http.ResponseWriter, r *http.Request) error {
	status, err := d.API.SourceStatus(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, status)
	return nil
}

func (d Deps) checkIntegration(w http.ResponseWriter, r *http.Request) error {
	checks, err := d.API.CheckSource(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, items(checks))
	return nil
}

func (d Deps) previewIntegrationSync(w http.ResponseWriter, r *http.Request) error {
	preview, err := d.API.PreviewSync(r.Context())
	if err != nil {
		return err
	}
	setETag(w, preview.BaseRevision)
	writeJSON(w, http.StatusOK, preview)
	return nil
}

func (d Deps) applyIntegrationSync(w http.ResponseWriter, r *http.Request) error {
	var body struct {
		PreviewID string `json:"previewId"`
	}
	if err := decodeBody(w, r, maxSmallBody, &body); err != nil {
		return err
	}
	res, err := d.API.ApplySync(r.Context(), body.PreviewID, ifMatch(r))
	if err != nil {
		return err
	}
	setETag(w, res.Revision)
	writeJSON(w, http.StatusOK, res)
	return nil
}

type aliasList struct {
	Aliases map[string]domain.EntityID `json:"aliases"`
}

func (d Deps) getIntegrationAliases(w http.ResponseWriter, r *http.Request) error {
	aliases, revision, err := d.API.SourceAliases(r.Context())
	if err != nil {
		return err
	}
	setETag(w, revision)
	writeJSON(w, http.StatusOK, aliasList{Aliases: aliases})
	return nil
}

func (d Deps) replaceIntegrationAliases(w http.ResponseWriter, r *http.Request) error {
	var body aliasList
	if err := decodeBody(w, r, maxEntityBody, &body); err != nil {
		return err
	}
	if body.Aliases == nil {
		body.Aliases = map[string]domain.EntityID{}
	}
	revision, err := d.API.SaveSourceAliases(r.Context(), body.Aliases, ifMatch(r))
	if err != nil {
		return err
	}
	setETag(w, revision)
	writeJSON(w, http.StatusOK, body)
	return nil
}
