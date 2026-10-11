package domain

import (
	"fmt"
	"strings"
	"time"
)

// Validation codes for snapshots and saved layouts (API problem `errors[].code`). The TypeScript
// parsers (parseSnapshot, parseSavedLayout) accept or reject without codes; these name the reason.
const (
	CodeInvalidSnapshot = "invalid-snapshot"
	CodeInvalidLayout   = "invalid-layout"
)

var (
	providers    = []string{"aws", "azure", "gcp", "on-prem", "saas", "internal", "unknown"}
	healthValues = []string{"healthy", "degraded", "unavailable", "unknown"}
	layoutModes  = []string{"topology", "infrastructure"}
)

func isTimestamp(s string) bool {
	_, err := time.Parse(time.RFC3339Nano, s)
	return err == nil
}

// ValidateSnapshot mirrors parseSnapshot: envelope fields, the simulated-provenance rule, and a
// valid topology. Topology issues keep their own codes.
func ValidateSnapshot(s *Snapshot) []Issue {
	var issues []Issue
	bad := func(format string, args ...any) {
		issues = append(issues, Issue{Severity: SeverityError, Code: CodeInvalidSnapshot, EntityID: s.ID, Message: fmt.Sprintf(format, args...)})
	}
	if s.SchemaVersion != SnapshotSchemaVersion {
		bad("schemaVersion must be %d", SnapshotSchemaVersion)
	}
	if s.ID == "" {
		bad("id is required")
	}
	if !isTimestamp(s.TakenAt) {
		bad("takenAt must be an RFC 3339 date-time")
	}
	switch s.Source {
	case SnapshotSourceFixture, SnapshotSourceSimulation, SnapshotSourceObserved:
	default:
		bad("source must be fixture, simulation, or observed")
	}
	if s.Source != SnapshotSourceObserved && !s.IsSimulated {
		bad("isSimulated must be true unless source is observed")
	}
	return append(issues, Validate(&s.Data)...)
}

// ValidateSavedLayout mirrors parseSavedLayout (and the schema's uniqueItems). Field paths are in
// the messages.
func ValidateSavedLayout(l *SavedLayout) []Issue {
	var issues []Issue
	bad := func(format string, args ...any) {
		issues = append(issues, Issue{Severity: SeverityError, Code: CodeInvalidLayout, EntityID: l.ID, Message: fmt.Sprintf(format, args...)})
	}
	if l.SchemaVersion != SavedLayoutSchemaVersion {
		bad("schemaVersion must be %d", SavedLayoutSchemaVersion)
	}
	if l.ID == "" {
		bad("id is required")
	}
	if strings.TrimSpace(l.Name) == "" {
		bad("name is required")
	}
	if !isTimestamp(l.CreatedAt) {
		bad("createdAt must be an RFC 3339 date-time")
	}
	if !contains(layoutModes, l.View.LayoutMode) {
		bad("view.layoutMode must be topology or infrastructure")
	}
	list := func(field string, values, allowed []string) {
		seen := map[string]bool{}
		for _, v := range values {
			if !contains(allowed, v) {
				bad("view.filters.%s contains unknown value %q", field, v)
			}
			if seen[v] {
				bad("view.filters.%s repeats %q", field, v)
			}
			seen[v] = true
		}
	}
	list("providers", l.View.Filters.Providers, providers)
	list("health", l.View.Filters.Health, healthValues)
	list("groups", l.View.Filters.Groups, EntityGroups)
	return issues
}

// NormalizeSavedLayout applies parseSavedLayout's normalization (trimmed name, non-nil lists).
func NormalizeSavedLayout(l *SavedLayout) {
	l.Name = strings.TrimSpace(l.Name)
	for _, p := range []*[]string{&l.View.Filters.Providers, &l.View.Filters.Health, &l.View.Filters.Groups, &l.View.CollapsedGroupIDs} {
		if *p == nil {
			*p = []string{}
		}
	}
	if l.Positions == nil {
		l.Positions = map[string]Position{}
	}
}
