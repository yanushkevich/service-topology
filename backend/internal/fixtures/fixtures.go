// Package fixtures locates and decodes the shared JSON fixtures in <repo>/fixtures, which are
// generated from the frontend reference implementation (apps/web/src/contract/fixtures.test.ts).
package fixtures

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"servicetopology/backend/internal/domain"
)

// Dir returns the repository's fixtures directory by walking up from the working directory, so
// tests work from any package. TOPOLOGY_FIXTURES_DIR overrides it.
func Dir() (string, error) {
	if dir := os.Getenv("TOPOLOGY_FIXTURES_DIR"); dir != "" {
		return dir, nil
	}
	wd, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for dir := wd; ; dir = filepath.Dir(dir) {
		candidate := filepath.Join(dir, "fixtures", "topology")
		if info, err := os.Stat(candidate); err == nil && info.IsDir() {
			return filepath.Join(dir, "fixtures"), nil
		}
		if parent := filepath.Dir(dir); parent == dir {
			return "", errors.New("fixtures directory not found above " + wd)
		}
	}
}

// DecodeStrict decodes JSON and rejects unknown fields, mirroring `additionalProperties: false` in
// the topology schema.
func DecodeStrict(raw []byte, v any) error {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		return err
	}
	if dec.More() {
		return errors.New("trailing data after JSON value")
	}
	return nil
}

// LoadTopology reads and strictly decodes a TopologyData file.
func LoadTopology(path string) (*domain.TopologyData, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var data domain.TopologyData
	if err := DecodeStrict(raw, &data); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return &data, nil
}

// ExpectedIssue is the comparable part of a validation issue (messages may differ by language).
type ExpectedIssue struct {
	Severity domain.Severity `json:"severity"`
	Code     string          `json:"code"`
	EntityID domain.EntityID `json:"entityId"`
}

// ValidationCase is one file in fixtures/conformance/validation.
type ValidationCase struct {
	Description string              `json:"description"`
	Topology    domain.TopologyData `json:"topology"`
	Expected    []ExpectedIssue     `json:"expected"`
}
