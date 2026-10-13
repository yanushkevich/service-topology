package httpapi

import (
	"net/http"

	"servicetopology/backend/internal/domain"
)

// Isolated simulation runs and their events and telemetry (always simulated, never observed).

func (d Deps) runSimulation(w http.ResponseWriter, r *http.Request) error {
	var req domain.SimulationRequest
	if err := decodeBody(w, r, maxRequestBody, &req); err != nil {
		return err
	}
	run, err := d.API.RunSimulation(r.Context(), &req)
	if err != nil {
		return err
	}
	w.Header().Set("Location", "/api/v1/simulations/"+run.ID)
	writeJSON(w, http.StatusCreated, run)
	return nil
}

func (d Deps) listSimulations(w http.ResponseWriter, r *http.Request) error {
	limit, err := intParam(r.URL.Query().Get("limit"), "limit")
	if err != nil {
		return err
	}
	runs, err := d.API.Simulations(r.Context(), limit)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, items(runs))
	return nil
}

func (d Deps) getSimulation(w http.ResponseWriter, r *http.Request) error {
	run, err := d.API.Simulation(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, run)
	return nil
}

func (d Deps) listEvents(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	limit, err := intParam(q.Get("limit"), "limit")
	if err != nil {
		return err
	}
	page, err := d.API.Events(r.Context(), q.Get("simulationId"), q.Get("entityId"), q.Get("type"), q.Get("cursor"), limit)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, page)
	return nil
}

func (d Deps) listTelemetry(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	limit, err := intParam(q.Get("limit"), "limit")
	if err != nil {
		return err
	}
	page, err := d.API.Telemetry(r.Context(), q.Get("simulationId"), q.Get("entityId"), q.Get("metricName"), q.Get("cursor"), limit)
	if err != nil {
		return err
	}
	writeJSON(w, http.StatusOK, page)
	return nil
}
