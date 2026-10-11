// Package httpapi is the HTTP adapter: routing, middleware, problem responses, and operational
// endpoints. API routes from docs/api/openapi.json are added in Milestone B3.
package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"time"

	"servicetopology/backend/internal/observability"
	"servicetopology/backend/internal/ports"
)

// Deps are the handler's collaborators.
type Deps struct {
	Logger *slog.Logger
	// Checks are run by GET /readyz; the service is ready only when all pass.
	Checks []ports.ReadinessCheck
	// CheckTimeout bounds the whole readiness probe.
	CheckTimeout time.Duration
}

// NewHandler returns the HTTP handler with middleware applied.
func NewHandler(d Deps) http.Handler {
	if d.CheckTimeout <= 0 {
		d.CheckTimeout = 2 * time.Second
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("GET /readyz", d.ready)
	mux.HandleFunc("/", notFound)
	return d.middleware(mux)
}

type readiness struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks"`
}

func (d Deps) ready(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), d.CheckTimeout)
	defer cancel()
	body := readiness{Status: "ready", Checks: map[string]string{}}
	status := http.StatusOK
	for _, c := range d.Checks {
		if err := c.Check(ctx); err != nil {
			body.Checks[c.Name()] = "failing: " + err.Error()
			body.Status, status = "not ready", http.StatusServiceUnavailable
			continue
		}
		body.Checks[c.Name()] = "ok"
	}
	writeJSON(w, status, body)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}

// middleware assigns a request ID, recovers panics as 500 problems, and logs each request.
func (d Deps) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		id := observability.RequestID(r.Header.Get("X-Request-ID"))
		r = r.WithContext(observability.WithRequestID(r.Context(), id))
		w.Header().Set("X-Request-ID", id)
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		defer func() {
			if v := recover(); v != nil {
				d.Logger.ErrorContext(r.Context(), "panic", "requestId", id, "panic", v)
				WriteProblem(rec, r, Problem{Title: "Internal server error", Status: http.StatusInternalServerError})
			}
			d.Logger.InfoContext(r.Context(), "request",
				"requestId", id, "method", r.Method, "path", r.URL.Path, "status", rec.status, "durationMs", time.Since(start).Milliseconds())
		}()
		next.ServeHTTP(rec, r)
	})
}
