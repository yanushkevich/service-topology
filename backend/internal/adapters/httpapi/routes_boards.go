package httpapi

import (
	"net/http"
	"net/url"

	"servicetopology/backend/internal/domain"
)

// Transit board definitions (ADR-031): one per service, revision-guarded like topology writes
// (ETag on reads and writes; If-Match, when sent, must be the current revision).

func (d Deps) listBoards(w http.ResponseWriter, r *http.Request) error {
	list, err := d.API.Boards(r.Context())
	if err != nil {
		return err
	}
	type summary struct {
		ServiceDefinitionID domain.EntityID `json:"serviceDefinitionId"`
		Revision            string          `json:"revision"`
		UpdatedAt           string          `json:"updatedAt"`
		Lines               int             `json:"lines"`
	}
	out := make([]summary, 0, len(list))
	for _, b := range list {
		out = append(out, summary{b.Definition.ServiceDefinitionID, b.Revision, b.UpdatedAt, len(b.Definition.Lines)})
	}
	writeJSON(w, http.StatusOK, items(out))
	return nil
}

func (d Deps) getBoard(w http.ResponseWriter, r *http.Request) error {
	b, err := d.API.Board(r.Context(), r.PathValue("serviceId"))
	if err != nil {
		return err
	}
	setETag(w, b.Revision)
	writeJSON(w, http.StatusOK, b.Definition)
	return nil
}

func (d Deps) createBoard(w http.ResponseWriter, r *http.Request) error {
	var def domain.BoardDefinition
	if err := decodeBody(w, r, maxEntityBody, &def); err != nil {
		return err
	}
	b, err := d.API.CreateBoard(r.Context(), &def)
	if err != nil {
		return err
	}
	w.Header().Set("Location", "/api/v1/transit-boards/"+url.PathEscape(b.Definition.ServiceDefinitionID))
	setETag(w, b.Revision)
	writeJSON(w, http.StatusCreated, b.Definition)
	return nil
}

func (d Deps) replaceBoard(w http.ResponseWriter, r *http.Request) error {
	var def domain.BoardDefinition
	if err := decodeBody(w, r, maxEntityBody, &def); err != nil {
		return err
	}
	b, err := d.API.ReplaceBoard(r.Context(), r.PathValue("serviceId"), &def, ifMatch(r))
	if err != nil {
		return err
	}
	setETag(w, b.Revision)
	writeJSON(w, http.StatusOK, b.Definition)
	return nil
}

func (d Deps) deleteBoard(w http.ResponseWriter, r *http.Request) error {
	if err := d.API.DeleteBoard(r.Context(), r.PathValue("serviceId"), ifMatch(r)); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
