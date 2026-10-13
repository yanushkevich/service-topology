package domain_test

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/fixtures"
)

// Bundle checks must give the TypeScript reference's codes, paths, and entity IDs, in order (ADR-032).
func TestBundleValidationConformance(t *testing.T) {
	dir, err := fixtures.Dir()
	if err != nil {
		t.Fatal(err)
	}
	files, err := filepath.Glob(filepath.Join(dir, "conformance", "bundles", "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(files) < 10 {
		t.Fatalf("expected the bundle conformance set, found %d files", len(files))
	}
	for _, file := range files {
		t.Run(filepath.Base(file), func(t *testing.T) {
			raw, err := os.ReadFile(file)
			if err != nil {
				t.Fatal(err)
			}
			var c fixtures.BundleCase
			if err := fixtures.DecodeStrict(raw, &c); err != nil {
				t.Fatalf("decode: %v", err)
			}
			_, issues, err := domain.ParseBundle(c.Bundle)
			if err != nil {
				t.Fatal(err)
			}
			got := []fixtures.BundleIssue{}
			for _, i := range issues {
				got = append(got, fixtures.BundleIssue{Code: i.Code, Path: i.Path, EntityID: i.EntityID})
			}
			want := c.Expected
			if want == nil {
				want = []fixtures.BundleIssue{}
			}
			if !reflect.DeepEqual(got, want) {
				t.Errorf("%s\n got: %+v\nwant: %+v", c.Description, got, want)
			}
		})
	}
}

func TestParseBundleRejectsMalformedJSONAndUnknownFields(t *testing.T) {
	if _, _, err := domain.ParseBundle([]byte("{nope")); err == nil {
		t.Error("malformed JSON: want an error")
	}
	raw := []byte(`{"format":"service-topology.bundle","version":1,"exportedAt":"2026-10-13T00:00:00Z","source":{"label":"x","isMock":true},"environments":[],"serviceDefinitions":[],"serviceInstances":[],"resources":[],"relationships":[],"surprise":1}`)
	_, issues, err := domain.ParseBundle(raw)
	if err != nil || len(issues) != 1 || issues[0].Code != domain.CodeBundleInvalidModule {
		t.Errorf("unknown field: got %+v, %v", issues, err)
	}
}
