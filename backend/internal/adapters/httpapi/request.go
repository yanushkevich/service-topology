package httpapi

import (
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"slices"
	"strconv"
	"strings"

	"servicetopology/backend/internal/application"
	"servicetopology/backend/internal/fixtures"
)

// Request parsing shared by the handlers: query parameters, bounded JSON bodies, and entity tags.

// intParam parses an optional positive integer parameter (0 when absent).
func intParam(raw, name string) (int, error) {
	if raw == "" {
		return 0, nil
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n < 1 {
		return 0, &application.ErrInvalid{Param: name, Reason: "must be a positive integer"}
	}
	return n, nil
}

// listParam parses a comma-separated list parameter (OpenAPI style: form, explode: false) and
// checks every value against allowed. Duplicates are dropped; order is kept.
func listParam(raw, name string, allowed []string) ([]string, error) {
	out := []string{}
	for _, v := range strings.Split(raw, ",") {
		if v == "" || slices.Contains(out, v) {
			continue
		}
		if !slices.Contains(allowed, v) {
			return nil, &application.ErrInvalid{Param: name, Reason: fmt.Sprintf("unknown value %q (allowed: %s)", v, strings.Join(allowed, ", "))}
		}
		out = append(out, v)
	}
	return out, nil
}

type errUnsupportedMedia struct{}

func (errUnsupportedMedia) Error() string { return "Content-Type must be application/json" }

type errTooLarge struct{ limit int64 }

func (e errTooLarge) Error() string { return fmt.Sprintf("Request body exceeds %d bytes.", e.limit) }

// readBody reads a JSON request body up to limit bytes.
func readBody(w http.ResponseWriter, r *http.Request, limit int64) ([]byte, error) {
	if mt, _, err := mime.ParseMediaType(r.Header.Get("Content-Type")); err != nil || mt != "application/json" {
		return nil, errUnsupportedMedia{}
	}
	r.Body = http.MaxBytesReader(w, r.Body, limit)
	raw, err := io.ReadAll(r.Body)
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			return nil, errTooLarge{limit}
		}
		return nil, &application.ErrInvalid{Param: "body", Reason: "could not be read"}
	}
	return raw, nil
}

// decodeBody reads a JSON body strictly (unknown fields are rejected, as in the schemas).
func decodeBody(w http.ResponseWriter, r *http.Request, limit int64, into any) error {
	raw, err := readBody(w, r, limit)
	if err != nil {
		return err
	}
	if err := fixtures.DecodeStrict(raw, into); err != nil {
		return &application.ErrInvalid{Param: "body", Reason: "not valid JSON for this operation: " + err.Error()}
	}
	return nil
}

// setETag sets the topology revision as a strong entity tag (RFC 9110).
func setETag(w http.ResponseWriter, revision string) {
	if revision != "" {
		w.Header().Set("ETag", `"`+revision+`"`)
	}
}

// ifMatch returns the revision in an If-Match header ("" when absent or "*"). Weak tags compare by
// their opaque value; lists are not supported (one topology revision at a time).
func ifMatch(r *http.Request) string {
	v := strings.TrimSpace(r.Header.Get("If-Match"))
	if v == "" || v == "*" {
		return ""
	}
	v = strings.TrimPrefix(v, "W/")
	return strings.Trim(v, `"`)
}
