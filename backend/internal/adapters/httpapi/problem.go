package httpapi

import (
	"encoding/json"
	"net/http"

	"servicetopology/backend/internal/observability"
)

// Problem is an RFC 9457 problem details object (the `Problem` schema in docs/api/openapi.json).
// RequestID is an extension member; it is proposed for the contract in docs/backend/API_SPEC.md.
type Problem struct {
	Type      string         `json:"type"`
	Title     string         `json:"title"`
	Status    int            `json:"status"`
	Detail    string         `json:"detail,omitempty"`
	Instance  string         `json:"instance,omitempty"`
	Errors    []ProblemError `json:"errors,omitempty"`
	RequestID string         `json:"requestId,omitempty"`
}

// ProblemError is one validation issue, using the validateTopology / parseSavedLayout codes.
type ProblemError struct {
	Code     string `json:"code"`
	EntityID string `json:"entityId,omitempty"`
	Message  string `json:"message"`
}

// Problem type URIs follow the examples in docs/API_CONTRACT.md.
const problemBase = "https://topology.example.test/problems/"

// WriteProblem writes p as application/problem+json. Detail must never include internal errors,
// query text, credentials, or paths.
func WriteProblem(w http.ResponseWriter, r *http.Request, p Problem) {
	if p.Type == "" {
		p.Type = "about:blank"
	}
	if p.Instance == "" {
		p.Instance = r.URL.Path
	}
	p.RequestID = observability.RequestIDFrom(r.Context())
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(p.Status)
	_ = json.NewEncoder(w).Encode(p)
}

func notFound(w http.ResponseWriter, r *http.Request) {
	WriteProblem(w, r, Problem{Type: problemBase + "not-found", Title: "Not found", Status: http.StatusNotFound, Detail: "No resource at this path."})
}
