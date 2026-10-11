// Package arcadedb is the ArcadeDB adapter (docs/backend/PERSISTENCE.md, ADR-DB-001/002). It talks
// to the ArcadeDB HTTP/JSON API with SQL and parameter binding only, keeps ArcadeDB record IDs
// internal, and maps failures to the ports errors.
package arcadedb

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"

	"servicetopology/backend/internal/config"
	"servicetopology/backend/internal/ports"
)

// DefaultLimit is sent with every query. Results that hit it are reported as truncated errors rather
// than returned as complete (ArcadeDB's server default is 20,000 rows).
const DefaultLimit = 100_000

// Error is a failed ArcadeDB request. Its message never contains credentials, command text, or
// parameter values; Detail (from the server) is for logs only and may contain data values.
type Error struct {
	Status    int    // HTTP status, 0 for transport errors
	Exception string // ArcadeDB exception class, e.g. com.arcadedb.exception.DuplicatedKeyException
	Summary   string // ArcadeDB "error" field
	Detail    string
	kind      error // ports.ErrUnavailable, ErrConflict, ErrAuth, ErrDatabaseNotFound, or nil
	cause     error // transport error (no credentials: auth travels in a header)
	timeout   bool
}

func (e *Error) Error() string {
	name := e.Exception[strings.LastIndex(e.Exception, ".")+1:]
	switch {
	case e.Status == 0 && e.timeout:
		return "arcadedb: request timed out"
	case e.Status == 0 && e.cause != nil:
		return "arcadedb: unreachable: " + e.cause.Error()
	case e.Status == 0:
		return "arcadedb: unreachable"
	case name != "":
		return fmt.Sprintf("arcadedb: %d %s (%s)", e.Status, e.Summary, name)
	default:
		return fmt.Sprintf("arcadedb: HTTP %d", e.Status)
	}
}

func (e *Error) Unwrap() error { return e.kind }

var (
	// ErrConflict reports a uniqueness violation (duplicate stable ID).
	ErrConflict = ports.ErrConflict
	// ErrAuth reports rejected credentials.
	ErrAuth = errors.New("database credentials rejected")
	// ErrDatabaseNotFound reports a missing database.
	ErrDatabaseNotFound = errors.New("database not found")
	// ErrTruncated reports a result that hit the query limit.
	ErrTruncated = errors.New("query result truncated")
)

// Client is a minimal ArcadeDB HTTP API client bound to one database.
type Client struct {
	base     *url.URL
	database string
	username string
	password string
	http     *http.Client
	// Observe, if set, is called after every request (tests, metrics). It receives no credentials.
	Observe func(method, path string, status int, d time.Duration, err error)
}

// NewClient builds a client from validated configuration, reading the password file once.
func NewClient(cfg *config.ArcadeDB) (*Client, error) {
	raw, err := os.ReadFile(cfg.PasswordFile)
	if err != nil {
		return nil, fmt.Errorf("ARCADEDB_PASSWORD_FILE: cannot read the password file: %w", errors.Unwrap(err))
	}
	password := strings.TrimRight(string(raw), "\r\n")
	if password == "" {
		return nil, errors.New("ARCADEDB_PASSWORD_FILE: the password file is empty")
	}
	return &Client{
		base:     cfg.BaseURL,
		database: cfg.Database,
		username: cfg.Username,
		password: password,
		http:     &http.Client{Timeout: cfg.RequestTimeout},
	}, nil
}

// Database returns the database name the client is bound to.
func (c *Client) Database() string { return c.database }

// WithDatabase returns a copy of the client bound to another database (integration tests).
func (c *Client) WithDatabase(name string) *Client {
	cp := *c
	cp.database = name
	return &cp
}

type response struct {
	Result    json.RawMessage `json:"result"`
	Truncated bool            `json:"truncated"`
	Error     string          `json:"error"`
	Exception string          `json:"exception"`
	Detail    string          `json:"detail"`
}

func (c *Client) do(ctx context.Context, method, path, session string, body any) (*response, http.Header, error) {
	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, nil, err
		}
		reader = bytes.NewReader(b)
	}
	req, err := http.NewRequestWithContext(ctx, method, c.base.JoinPath("/api/v1", path).String(), reader)
	if err != nil {
		return nil, nil, err
	}
	req.SetBasicAuth(c.username, c.password)
	req.Header.Set("Content-Type", "application/json")
	if session != "" {
		req.Header.Set("arcadedb-session-id", session)
	}
	start := time.Now()
	resp, err := c.http.Do(req)
	if c.Observe != nil {
		status := 0
		if resp != nil {
			status = resp.StatusCode
		}
		defer func() { c.Observe(method, path, status, time.Since(start), err) }()
	}
	if err != nil {
		if ctx.Err() != nil {
			return nil, nil, ctx.Err()
		}
		var ne interface{ Timeout() bool }
		timeout := errors.As(err, &ne) && ne.Timeout()
		return nil, nil, &Error{kind: ports.ErrUnavailable, cause: errors.Unwrap(err), timeout: timeout}
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(io.LimitReader(resp.Body, 256<<20))
	var out response
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	if resp.StatusCode >= 300 {
		e := &Error{Status: resp.StatusCode, Exception: out.Exception, Summary: out.Error, Detail: out.Detail}
		switch {
		case strings.HasSuffix(out.Exception, "DuplicatedKeyException"):
			e.kind = ErrConflict
		case resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden:
			e.kind = ErrAuth
		case strings.HasSuffix(out.Exception, "DatabaseNotAvailableException"):
			e.kind = ErrDatabaseNotFound
		case resp.StatusCode >= 500 || resp.StatusCode == http.StatusServiceUnavailable:
			e.kind = ports.ErrUnavailable
		}
		return nil, nil, e
	}
	return &out, resp.Header, nil
}

// Ready reports whether the server accepts requests (GET /api/v1/ready, no credentials needed).
func (c *Client) Ready(ctx context.Context) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.base.JoinPath("/api/v1/ready").String(), nil)
	if err != nil {
		return err
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return &Error{kind: ports.ErrUnavailable}
	}
	resp.Body.Close()
	if resp.StatusCode != http.StatusNoContent && resp.StatusCode != http.StatusOK {
		return &Error{Status: resp.StatusCode, kind: ports.ErrUnavailable}
	}
	return nil
}

// Exists reports whether the bound database exists.
func (c *Client) Exists(ctx context.Context) (bool, error) {
	out, _, err := c.do(ctx, http.MethodGet, "exists/"+url.PathEscape(c.database), "", nil)
	if err != nil {
		return false, err
	}
	var exists bool
	if err := json.Unmarshal(out.Result, &exists); err != nil {
		return false, fmt.Errorf("arcadedb: unexpected exists response")
	}
	return exists, nil
}

// serverCommand runs a server-level command. Only fixed command prefixes with a validated database
// name are used (database names cannot be bound as parameters).
func (c *Client) serverCommand(ctx context.Context, verb string) error {
	if !validDatabaseName(c.database) {
		return fmt.Errorf("arcadedb: invalid database name %q", c.database)
	}
	_, _, err := c.do(ctx, http.MethodPost, "server", "", map[string]string{"command": verb + " database " + c.database})
	return err
}

// CreateDatabase creates the bound database.
func (c *Client) CreateDatabase(ctx context.Context) error { return c.serverCommand(ctx, "create") }

// DropDatabase drops the bound database (integration tests only; never called by the application).
func (c *Client) DropDatabase(ctx context.Context) error { return c.serverCommand(ctx, "drop") }

func validDatabaseName(name string) bool {
	if name == "" || len(name) > 64 {
		return false
	}
	for _, r := range name {
		if !(r == '_' || r == '-' || (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9')) {
			return false
		}
	}
	return true
}

// Record is one result row. Keys starting with "@" are ArcadeDB metadata (@rid, @type, …).
type Record = map[string]any

type statement struct {
	Language string         `json:"language"`
	Command  string         `json:"command"`
	Params   map[string]any `json:"params,omitempty"`
	Limit    int            `json:"limit,omitempty"`
}

func (c *Client) run(ctx context.Context, endpoint, session, sql string, params map[string]any) ([]Record, error) {
	out, _, err := c.do(ctx, http.MethodPost, endpoint+"/"+url.PathEscape(c.database), session,
		statement{Language: "sql", Command: sql, Params: params, Limit: DefaultLimit})
	if err != nil {
		return nil, err
	}
	if out.Truncated {
		return nil, ErrTruncated
	}
	var records []Record
	if len(out.Result) > 0 {
		dec := json.NewDecoder(bytes.NewReader(out.Result))
		dec.UseNumber() // keep integers exact
		if err := dec.Decode(&records); err != nil {
			return nil, fmt.Errorf("arcadedb: unexpected result shape")
		}
	}
	return records, nil
}

// Query runs an idempotent SQL query outside a transaction.
func (c *Client) Query(ctx context.Context, sql string, params map[string]any) ([]Record, error) {
	return c.run(ctx, "query", "", sql, params)
}

// Command runs a SQL command outside a transaction (schema DDL).
func (c *Client) Command(ctx context.Context, sql string, params map[string]any) ([]Record, error) {
	return c.run(ctx, "command", "", sql, params)
}

// Tx is a server-side transaction (ArcadeDB HTTP session). A failed command aborts it on the server;
// Commit then fails, so a partial write is never committed.
type Tx struct {
	c       *Client
	session string
	done    bool
}

// Begin starts a transaction.
func (c *Client) Begin(ctx context.Context) (*Tx, error) {
	_, header, err := c.do(ctx, http.MethodPost, "begin/"+url.PathEscape(c.database), "", nil)
	if err != nil {
		return nil, err
	}
	session := header.Get("arcadedb-session-id")
	if session == "" {
		return nil, errors.New("arcadedb: begin returned no session")
	}
	return &Tx{c: c, session: session}, nil
}

// Command runs a SQL command inside the transaction.
func (t *Tx) Command(ctx context.Context, sql string, params map[string]any) ([]Record, error) {
	return t.c.run(ctx, "command", t.session, sql, params)
}

// Query runs a SQL query inside the transaction.
func (t *Tx) Query(ctx context.Context, sql string, params map[string]any) ([]Record, error) {
	return t.c.run(ctx, "query", t.session, sql, params)
}

// Commit commits the transaction.
func (t *Tx) Commit(ctx context.Context) error {
	t.done = true
	_, _, err := t.c.do(ctx, http.MethodPost, "commit/"+url.PathEscape(t.c.database), t.session, nil)
	return err
}

// Rollback aborts the transaction; it is a no-op after Commit. Use it in a defer.
func (t *Tx) Rollback() {
	if t.done {
		return
	}
	t.done = true
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, _, _ = t.c.do(ctx, http.MethodPost, "rollback/"+url.PathEscape(t.c.database), t.session, nil)
}
