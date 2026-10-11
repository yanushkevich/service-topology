// Package httpapi is the HTTP adapter: routing, middleware, problem responses, and operational
// endpoints. API routes from docs/api/openapi.json are added in Milestone B3.
package httpapi

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"strings"
	"time"

	"servicetopology/backend/internal/application"
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
	// API serves /api/v1; nil (no database configured) makes every API route return 503.
	API *application.Service
	// Security configures authentication, rate limiting, and CORS (zero value: none, as AUTH_MODE=none).
	Security Security
	// Metrics, if set, records request counts and durations by route pattern.
	Metrics *observability.Metrics
	// SchemaVersion and AuthMode are reported by GET /api/v1/meta.
	SchemaVersion int
	AuthMode      string
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
	d.apiRoutes(mux)
	// Catch-all: 405 (with Allow) when the path exists under other methods, else 404. Both are
	// problem+json. (A "/" pattern matches every method, so the router never sends its own 405.)
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		var allowed []string
		for _, m := range []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete} {
			probe := r.Clone(r.Context())
			probe.Method = m
			if _, pattern := mux.Handler(probe); pattern != "/" && pattern != "" {
				allowed = append(allowed, m)
			}
		}
		if len(allowed) == 0 {
			notFound(w, r)
			return
		}
		w.Header().Set("Allow", strings.Join(allowed, ", "))
		WriteProblem(w, r, Problem{Type: problemBase + "method-not-allowed", Title: "Method not allowed", Status: http.StatusMethodNotAllowed, Detail: "Allowed: " + strings.Join(allowed, ", ")})
	})
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

// middleware assigns a request ID, sets security headers, recovers panics as 500 problems, logs and
// measures each request, and applies CORS, rate limiting, and authentication (in that order).
func (d Deps) middleware(next http.Handler) http.Handler {
	lim := newLimiter(d.Security.RateLimitRPS, d.Security.RateLimitBurst)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		id := observability.RequestID(r.Header.Get("X-Request-ID"))
		r = r.WithContext(observability.WithRequestID(r.Context(), id))
		w.Header().Set("X-Request-ID", id)
		securityHeaders(w)
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		principal := ""
		defer func() {
			if v := recover(); v != nil {
				d.Logger.ErrorContext(r.Context(), "panic", "requestId", id, "panic", v)
				WriteProblem(rec, r, Problem{Title: "Internal server error", Status: http.StatusInternalServerError})
			}
			route := r.Pattern
			if route == "" {
				route = "unmatched"
			}
			d.Logger.InfoContext(r.Context(), "request",
				"requestId", id, "method", r.Method, "path", r.URL.Path, "route", route, "status", rec.status, "principal", principal,
				"durationMs", time.Since(start).Milliseconds())
			if d.Metrics != nil {
				status := strconv.Itoa(rec.status)
				d.Metrics.Inc("http_requests_total", "HTTP requests by route pattern, method, and status.", "route", route, "method", r.Method, "status", status)
				d.Metrics.Observe("http_request_duration_seconds", "HTTP request duration by route pattern.", time.Since(start), "route", route)
			}
		}()
		if d.Security.cors(rec, r) {
			return
		}
		if lim != nil && !isOperational(r.URL.Path) {
			if ok, wait := lim.allow(d.Security.clientKey(r), time.Now()); !ok {
				tooManyRequests(rec, r, wait)
				return
			}
		}
		authed := d.Security.authenticate(rec, r)
		if authed == nil {
			return // problem written; keep r for the deferred log line
		}
		r = authed
		if p, ok := PrincipalFrom(r.Context()); ok {
			principal = p.Name
		}
		next.ServeHTTP(rec, r)
	})
}
