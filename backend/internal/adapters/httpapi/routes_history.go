package httpapi

import (
	"net/http"

	"servicetopology/backend/internal/domain"
)

// Snapshot history ("as of", compare) and saved layouts.

func (d Deps) listSnapshots(w http.ResponseWriter, r *http.Request) error {
	list, err := d.API.Snapshots(r.Context(), r.URL.Query().Get("from"), r.URL.Query().Get("to"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, items(list))
	return nil
}

func (d Deps) getSnapshot(w http.ResponseWriter, r *http.Request) error {
	snap, err := d.API.Snapshot(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, snap)
	return nil
}

func (d Deps) captureSnapshot(w http.ResponseWriter, r *http.Request) error {
	var snap domain.Snapshot
	if err := decodeBody(w, r, maxSnapshotBody, &snap); err != nil {
		return err
	}
	summary, err := d.API.CaptureSnapshot(r.Context(), &snap)
	if err != nil {
		return err
	}
	w.Header().Set("Location", "/api/v1/topology/snapshots/"+summary.ID)
	writeJSON(w, http.StatusCreated, summary)
	return nil
}

func (d Deps) diffSnapshot(w http.ResponseWriter, r *http.Request) error {
	res, err := d.API.DiffSnapshot(r.Context(), r.PathValue("id"), r.URL.Query().Get("against"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, res)
	return nil
}

func (d Deps) listLayouts(w http.ResponseWriter, r *http.Request) error {
	list, err := d.API.Layouts(r.Context())
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, items(list))
	return nil
}

func (d Deps) createLayout(w http.ResponseWriter, r *http.Request) error {
	var l domain.SavedLayout
	if err := decodeBody(w, r, maxLayoutBody, &l); err != nil {
		return err
	}
	if err := d.API.CreateLayout(r.Context(), &l); err != nil {
		return err
	}
	w.Header().Set("Location", "/api/v1/layouts/"+l.ID)
	writeJSON(w, http.StatusCreated, l)
	return nil
}

func (d Deps) replaceLayout(w http.ResponseWriter, r *http.Request) error {
	var l domain.SavedLayout
	if err := decodeBody(w, r, maxLayoutBody, &l); err != nil {
		return err
	}
	if err := d.API.ReplaceLayout(r.Context(), r.PathValue("id"), &l); err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, l)
	return nil
}

func (d Deps) deleteLayout(w http.ResponseWriter, r *http.Request) error {
	if err := d.API.DeleteLayout(r.Context(), r.PathValue("id")); err != nil {
		return err
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}
