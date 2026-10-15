package dynatrace

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// The platform query API (Grail): a query starts with execute and, while it runs, is polled.
const (
	executePath = "/platform/storage/query/v1/query:execute"
	pollPath    = "/platform/storage/query/v1/query:poll"
	// waitMs is how long one execute or poll call may wait on the server before returning RUNNING.
	waitMs           = 10000
	maxResponseBytes = 64 << 20
	maxRateRetries   = 3
	maxMessageLength = 300
)

// Errors a query can fail with. QueryError wraps one of them with the status and a fixed message.
var (
	ErrAuth        = errors.New("dynatrace rejected the credentials")
	ErrForbidden   = errors.New("dynatrace denied access")
	ErrRejected    = errors.New("dynatrace rejected the query")
	ErrGone        = errors.New("the query result expired")
	ErrRateLimited = errors.New("dynatrace rate-limited the request")
	ErrUnreachable = errors.New("dynatrace cannot be reached")
	ErrTooLarge    = errors.New("the dynatrace response is too large")
)

// QueryError is a failed query. Message is safe to show: a fixed text and, for a rejected query,
// Dynatrace's own (shortened) explanation; never credentials or response bodies otherwise.
type QueryError struct {
	Status        int
	Kind          error
	Message       string
	MissingScopes []string
}

func (e *QueryError) Error() string { return e.Message }
func (e *QueryError) Unwrap() error { return e.Kind }

// record is one result row; fields are DQL field names.
type record map[string]any

// queryResult is a finished query.
type queryResult struct {
	Records      []record
	ScannedBytes int64
	Truncated    bool
}

// grailClient runs queries against one tenant.
type grailClient struct {
	base       *url.URL
	http       *http.Client
	auth       tokenSource
	maxRecords int
	timeout    time.Duration
}

type executeRequest struct {
	Query                      string `json:"query"`
	DefaultTimeframeStart      string `json:"defaultTimeframeStart"`
	DefaultTimeframeEnd        string `json:"defaultTimeframeEnd"`
	MaxResultRecords           int    `json:"maxResultRecords"`
	RequestTimeoutMilliseconds int    `json:"requestTimeoutMilliseconds"`
	IncludeTypes               bool   `json:"includeTypes"`
}

type queryResponse struct {
	State        string `json:"state"`
	RequestToken string `json:"requestToken"`
	Result       *struct {
		Records  []record `json:"records"`
		Metadata struct {
			Grail struct {
				ScannedBytes  int64 `json:"scannedBytes"`
				Notifications []struct {
					NotificationType string `json:"notificationType"`
				} `json:"notifications"`
			} `json:"grail"`
		} `json:"metadata"`
	} `json:"result"`
}

type errorResponse struct {
	Error struct {
		Message string `json:"message"`
		Details struct {
			ErrorMessage  string   `json:"errorMessage"`
			MissingScopes []string `json:"missingScopes"`
		} `json:"details"`
	} `json:"error"`
}

// run executes q over its window ending at now and polls until it finishes, within the timeout.
func (c *grailClient) run(ctx context.Context, q Query, cfg *Config, now time.Time) (*queryResult, error) {
	ctx, cancel := context.WithTimeout(ctx, c.timeout)
	defer cancel()
	body := executeRequest{
		Query:                      q.DQL,
		DefaultTimeframeStart:      now.Add(-q.window(cfg)).UTC().Format(time.RFC3339),
		DefaultTimeframeEnd:        now.UTC().Format(time.RFC3339),
		MaxResultRecords:           c.maxRecords,
		RequestTimeoutMilliseconds: waitMs,
	}
	payload, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	res, err := c.call(ctx, http.MethodPost, c.endpoint(executePath, nil), payload)
	for err == nil && (res.State == "RUNNING" || res.State == "NOT_STARTED") {
		params := url.Values{"request-token": {res.RequestToken}, "request-timeout-milliseconds": {strconv.Itoa(waitMs)}}
		res, err = c.call(ctx, http.MethodGet, c.endpoint(pollPath, params), nil)
	}
	if err != nil {
		return nil, err
	}
	if res.State != "SUCCEEDED" || res.Result == nil {
		return nil, &QueryError{Kind: ErrRejected, Message: "the query ended in state " + res.State}
	}
	return c.result(res), nil
}

func (c *grailClient) result(res *queryResponse) *queryResult {
	out := &queryResult{ScannedBytes: res.Result.Metadata.Grail.ScannedBytes}
	for _, r := range res.Result.Records {
		if r != nil {
			out.Records = append(out.Records, r)
		}
	}
	out.Truncated = len(out.Records) >= c.maxRecords
	for _, n := range res.Result.Metadata.Grail.Notifications {
		if strings.Contains(n.NotificationType, "LIMIT") || strings.Contains(n.NotificationType, "TRUNCAT") {
			out.Truncated = true
		}
	}
	return out
}

func (c *grailClient) endpoint(path string, params url.Values) string {
	u := *c.base
	u.Path = strings.TrimSuffix(u.Path, "/") + path
	u.RawQuery = params.Encode()
	return u.String()
}

// call sends one request, retrying on 429 as Retry-After says (bounded), and decodes the reply.
func (c *grailClient) call(ctx context.Context, method, target string, payload []byte) (*queryResponse, error) {
	for attempt := 0; ; attempt++ {
		res, retryAfter, err := c.send(ctx, method, target, payload)
		if !errors.Is(err, ErrRateLimited) || attempt == maxRateRetries {
			return res, err
		}
		select {
		case <-ctx.Done():
			return nil, &QueryError{Kind: ErrUnreachable, Message: "the query timed out while rate-limited"}
		case <-time.After(retryAfter):
		}
	}
}

func (c *grailClient) send(ctx context.Context, method, target string, payload []byte) (*queryResponse, time.Duration, error) {
	token, err := c.auth.token(ctx)
	if err != nil {
		return nil, 0, err
	}
	req, err := http.NewRequestWithContext(ctx, method, target, bytes.NewReader(payload))
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := c.http.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return nil, 0, &QueryError{Kind: ErrUnreachable, Message: "the query timed out"}
		}
		return nil, 0, &QueryError{Kind: ErrUnreachable, Message: "Dynatrace cannot be reached"}
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, maxResponseBytes+1))
	if err != nil {
		return nil, 0, &QueryError{Status: res.StatusCode, Kind: ErrUnreachable, Message: "the response was cut off"}
	}
	if len(raw) > maxResponseBytes {
		return nil, 0, &QueryError{Status: res.StatusCode, Kind: ErrTooLarge, Message: "the response is larger than 64 MiB; lower limits.maxRecords"}
	}
	if res.StatusCode == http.StatusOK || res.StatusCode == http.StatusAccepted {
		var out queryResponse
		if err := json.Unmarshal(raw, &out); err != nil {
			return nil, 0, &QueryError{Status: res.StatusCode, Kind: ErrRejected, Message: "the response is not valid JSON"}
		}
		return &out, 0, nil
	}
	return nil, retryAfter(res.Header.Get("Retry-After")), statusError(res.StatusCode, raw)
}

// statusError turns an error status into a QueryError with a fixed message.
func statusError(status int, raw []byte) error {
	var body errorResponse
	_ = json.Unmarshal(raw, &body)
	explanation := body.Error.Details.ErrorMessage
	if explanation == "" {
		explanation = body.Error.Message
	}
	switch status {
	case http.StatusBadRequest:
		return &QueryError{Status: status, Kind: ErrRejected, Message: "Dynatrace rejected the query: " + shorten(explanation)}
	case http.StatusUnauthorized:
		return &QueryError{Status: status, Kind: ErrAuth, Message: "Dynatrace rejected the credentials (401)"}
	case http.StatusForbidden:
		scopes := body.Error.Details.MissingScopes
		msg := "Dynatrace denied access (403)"
		if len(scopes) > 0 {
			msg = "Missing scopes: " + strings.Join(scopes, ", ")
		}
		return &QueryError{Status: status, Kind: ErrForbidden, Message: msg, MissingScopes: scopes}
	case http.StatusGone:
		return &QueryError{Status: status, Kind: ErrGone, Message: "the query result expired before it was read"}
	case http.StatusTooManyRequests:
		return &QueryError{Status: status, Kind: ErrRateLimited, Message: "Dynatrace rate-limited the request (429)"}
	default:
		return &QueryError{Status: status, Kind: ErrUnreachable, Message: fmt.Sprintf("Dynatrace answered %d", status)}
	}
}

// retryAfter reads a Retry-After in seconds, between 1 and 10 (default 2).
func retryAfter(header string) time.Duration {
	seconds, err := strconv.Atoi(strings.TrimSpace(header))
	if err != nil || seconds < 1 {
		return 2 * time.Second
	}
	return time.Duration(min(seconds, 10)) * time.Second
}

func shorten(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return "no reason given"
	}
	if len(s) > maxMessageLength {
		return s[:maxMessageLength] + "…"
	}
	return s
}
