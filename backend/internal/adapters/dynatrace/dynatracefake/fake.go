// Package dynatracefake is a fake Dynatrace platform tenant: the Grail query API (execute, poll)
// and the SSO token endpoint, answering the connector's own queries from recorded records
// (fixtures/dynatrace/example-tenant.json; docs/DYNATRACE_CONNECTOR.md §7). For tests and local
// demos only: its data is example data.
package dynatracefake

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"sync"

	"servicetopology/backend/internal/adapters/dynatrace"
)

// Tenant is the fake's state. Results maps a query name to its records.
type Tenant struct {
	Results map[string][]json.RawMessage
	// Token is the platform token it accepts; ClientID and ClientSecret the OAuth client.
	Token, ClientID, ClientSecret string
	// Fail answers a query name with an error status (403 lists RequiredScopes as missing).
	Fail map[string]int
	// RateLimitOnce answers the first execute with 429.
	RateLimitOnce bool

	mu       sync.Mutex
	pending  map[string]pendingQuery // by request token
	issued   map[string]bool         // OAuth access tokens
	limited  bool
	Executed []string // query names, in order
}

// Load reads a tenant fixture ({"results": {query name: [records]}}).
func Load(path string) (*Tenant, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var file struct {
		Results map[string][]json.RawMessage `json:"results"`
	}
	if err := json.Unmarshal(raw, &file); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return &Tenant{Results: file.Results}, nil
}

// Handler serves the platform query API and the SSO token endpoint.
func (t *Tenant) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /platform/storage/query/v1/query:execute", t.execute)
	mux.HandleFunc("GET /platform/storage/query/v1/query:poll", t.poll)
	mux.HandleFunc("POST /sso/oauth2/token", t.oauthToken)
	return mux
}

type pendingQuery struct {
	name  string
	limit int
}

type executeBody struct {
	Query            string `json:"query"`
	MaxResultRecords int    `json:"maxResultRecords"`
}

// execute answers RUNNING with a request token, so the client always polls once.
func (t *Tenant) execute(w http.ResponseWriter, r *http.Request) {
	if !t.authorized(r) {
		writeError(w, http.StatusUnauthorized, "Unauthorized", nil)
		return
	}
	var body executeBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "The request body is not valid JSON.", nil)
		return
	}
	q, ok := dynatrace.QueryByDQL(body.Query)
	if !ok {
		writeError(w, http.StatusBadRequest, "The fake tenant answers only the connector's queries.", nil)
		return
	}
	t.mu.Lock()
	t.Executed = append(t.Executed, q.Name)
	limit := t.RateLimitOnce && !t.limited
	t.limited = t.limited || limit
	t.mu.Unlock()
	if limit {
		w.Header().Set("Retry-After", "1")
		writeError(w, http.StatusTooManyRequests, "Too many requests", nil)
		return
	}
	if status, fail := t.Fail[q.Name]; fail {
		var scopes []string
		if status == http.StatusForbidden {
			scopes = dynatrace.RequiredScopes[:1]
		}
		writeError(w, status, "Failed by the fake tenant", scopes)
		return
	}
	token := newToken()
	t.mu.Lock()
	if t.pending == nil {
		t.pending = map[string]pendingQuery{}
	}
	t.pending[token] = pendingQuery{name: q.Name, limit: body.MaxResultRecords}
	t.mu.Unlock()
	writeJSON(w, http.StatusAccepted, map[string]any{"state": "RUNNING", "requestToken": token, "progress": 0})
}

func (t *Tenant) poll(w http.ResponseWriter, r *http.Request) {
	if !t.authorized(r) {
		writeError(w, http.StatusUnauthorized, "Unauthorized", nil)
		return
	}
	token := r.URL.Query().Get("request-token")
	t.mu.Lock()
	pending, ok := t.pending[token]
	delete(t.pending, token)
	t.mu.Unlock()
	if !ok {
		writeError(w, http.StatusGone, "QUERY_GONE", nil)
		return
	}
	records := t.Results[pending.name]
	if records == nil {
		records = []json.RawMessage{}
	}
	if pending.limit > 0 && len(records) > pending.limit {
		records = records[:pending.limit]
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"state": "SUCCEEDED", "progress": 100,
		"result": map[string]any{
			"records":  records,
			"types":    []any{},
			"metadata": map[string]any{"grail": map[string]any{"scannedBytes": 1024 * len(records)}},
		},
	})
}

func (t *Tenant) oauthToken(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil || r.PostForm.Get("grant_type") != "client_credentials" ||
		t.ClientID == "" || r.PostForm.Get("client_id") != t.ClientID || r.PostForm.Get("client_secret") != t.ClientSecret {
		writeError(w, http.StatusUnauthorized, "invalid_client", nil)
		return
	}
	token := newToken()
	t.mu.Lock()
	if t.issued == nil {
		t.issued = map[string]bool{}
	}
	t.issued[token] = true
	t.mu.Unlock()
	writeJSON(w, http.StatusOK, map[string]any{"access_token": token, "token_type": "Bearer", "expires_in": 300})
}

func (t *Tenant) authorized(r *http.Request) bool {
	got := r.Header.Get("Authorization")
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.Token != "" && got == "Bearer "+t.Token {
		return true
	}
	const prefix = "Bearer "
	return len(got) > len(prefix) && t.issued[got[len(prefix):]]
}

func newToken() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError answers in the platform's error shape.
func writeError(w http.ResponseWriter, status int, message string, missingScopes []string) {
	details := map[string]any{"errorMessage": message}
	if missingScopes != nil {
		details["missingScopes"] = missingScopes
	}
	writeJSON(w, status, map[string]any{"error": map[string]any{"code": status, "message": message, "details": details}})
}
