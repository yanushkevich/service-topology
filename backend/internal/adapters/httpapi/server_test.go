package httpapi_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"servicetopology/backend/internal/adapters/httpapi"
	"servicetopology/backend/internal/ports"
)

type check struct {
	name string
	err  error
	wait time.Duration
}

func (c check) Name() string { return c.name }
func (c check) Check(ctx context.Context) error {
	if c.wait > 0 {
		select {
		case <-time.After(c.wait):
		case <-ctx.Done():
			return errors.New("timed out")
		}
	}
	return c.err
}

func handler(checks ...ports.ReadinessCheck) http.Handler {
	return httpapi.NewHandler(httpapi.Deps{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Checks: checks, CheckTimeout: 50 * time.Millisecond})
}

func get(h http.Handler, path string, header ...string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, path, nil)
	if len(header) == 2 {
		req.Header.Set(header[0], header[1])
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestLivenessNeedsNoDependencies(t *testing.T) {
	rec := get(handler(check{name: "database", err: errors.New("down")}), "/healthz")
	if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), `"ok"`) {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
}

func TestReadinessReflectsChecks(t *testing.T) {
	if rec := get(handler(check{name: "database"}), "/readyz"); rec.Code != http.StatusOK {
		t.Fatalf("all passing: got %d %s", rec.Code, rec.Body)
	}
	rec := get(handler(check{name: "database", err: errors.New("not configured")}), "/readyz")
	var body struct {
		Status string
		Checks map[string]string
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	if rec.Code != http.StatusServiceUnavailable || body.Status != "not ready" || body.Checks["database"] != "failing: not configured" {
		t.Fatalf("failing: got %d %+v", rec.Code, body)
	}
}

func TestReadinessIsBounded(t *testing.T) {
	start := time.Now()
	rec := get(handler(check{name: "slow", wait: time.Second}), "/readyz")
	if rec.Code != http.StatusServiceUnavailable || time.Since(start) > 500*time.Millisecond {
		t.Fatalf("got %d after %v", rec.Code, time.Since(start))
	}
}

func TestUnknownPathIsProblemWithRequestID(t *testing.T) {
	rec := get(handler(), "/api/v1/nope", "X-Request-ID", "abc-123")
	var p httpapi.Problem
	if err := json.Unmarshal(rec.Body.Bytes(), &p); err != nil {
		t.Fatal(err)
	}
	if rec.Code != http.StatusNotFound || rec.Header().Get("Content-Type") != "application/problem+json" ||
		p.Status != 404 || p.Title == "" || p.Type == "" || p.RequestID != "abc-123" || rec.Header().Get("X-Request-ID") != "abc-123" {
		t.Fatalf("got %d %s %+v", rec.Code, rec.Header(), p)
	}
}

func TestUnsafeRequestIDIsReplaced(t *testing.T) {
	rec := get(handler(), "/healthz", "X-Request-ID", "bad id\nwith newline")
	if id := rec.Header().Get("X-Request-ID"); id == "" || strings.ContainsAny(id, " \n") {
		t.Fatalf("request ID not sanitized: %q", id)
	}
}

func TestPanicBecomesProblem(t *testing.T) {
	h := httpapi.NewHandler(httpapi.Deps{Logger: slog.New(slog.NewTextHandler(io.Discard, nil)), Checks: []ports.ReadinessCheck{panicky{}}})
	rec := get(h, "/readyz")
	if rec.Code != http.StatusInternalServerError || !strings.Contains(rec.Body.String(), "Internal server error") || strings.Contains(rec.Body.String(), "boom") {
		t.Fatalf("got %d %s", rec.Code, rec.Body)
	}
}

type panicky struct{}

func (panicky) Name() string                { return "panicky" }
func (panicky) Check(context.Context) error { panic("boom") }
