package domain

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// Data bundles (ADR-032, docs/DATA_BUNDLE.md): every data module in one file. The checks and
// their order are a port of validateBundle in apps/web/src/data/bundle/bundle.ts;
// fixtures/conformance/bundles checks the codes, paths, and entity IDs.

const (
	BundleFormat  = "service-topology.bundle"
	BundleVersion = 1

	CodeBundleUnreadable     = "bundle-unreadable"
	CodeBundleUnsupported    = "bundle-unsupported"
	CodeBundleInvalidModule  = "bundle-invalid-module"
	CodeBundleDuplicateBoard = "bundle-duplicate-board"
)

// Bundle is docs/schemas/data-bundle.v1.schema.json: the topology modules at the top level, plus
// transit board definitions.
type Bundle struct {
	Format     string       `json:"format"`
	Version    int          `json:"version"`
	ExportedAt string       `json:"exportedAt"`
	Source     BundleSource `json:"source"`
	TopologyData
	TransitBoards []BoardDefinition `json:"transitBoards,omitempty"`
}

type BundleSource struct {
	Label  string `json:"label"`
	IsMock bool   `json:"isMock"`
}

// bundleModules are the module keys in file order, with their labels and whether they are required.
var bundleModules = []struct {
	key, label string
	required   bool
}{
	{"environments", "Environments", true},
	{"serviceDefinitions", "Services", true},
	{"serviceInstances", "Service instances", true},
	{"resources", "Infrastructure", true},
	{"relationships", "Relationships", true},
	{"eventTypes", "Event types", false},
	{"businessFlows", "Business flows", false},
	{"transitBoards", "Transit boards", false},
}

// ParseBundle checks a bundle file's JSON and decodes it. err is set only for malformed JSON;
// otherwise a non-empty issue list means the bundle cannot be imported. Unknown fields are
// rejected (bundle-invalid-module), as on every write.
func ParseBundle(raw []byte) (*Bundle, []Issue, error) {
	var value any
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, nil, err
	}
	issue := func(code, path, format string, args ...any) Issue {
		return Issue{Severity: SeverityError, Code: code, Path: path, Message: fmt.Sprintf(format, args...)}
	}
	m, ok := value.(map[string]any)
	if !ok {
		return nil, []Issue{issue(CodeBundleUnreadable, "", "The file is not a JSON or YAML object.")}, nil
	}
	if m["format"] != BundleFormat {
		return nil, []Issue{issue(CodeBundleUnsupported, "format", "This is not a data bundle: %q must be %q.", "format", BundleFormat)}, nil
	}
	if v, ok := m["version"].(float64); !ok || v != BundleVersion {
		return nil, []Issue{issue(CodeBundleUnsupported, "version", "Bundle version %v is not supported; this server reads version %d.", m["version"], BundleVersion)}, nil
	}

	var out []Issue
	for _, mod := range bundleModules {
		v, present := m[mod.key]
		list, isList := v.([]any)
		switch {
		case !present && mod.required:
			out = append(out, issue(CodeBundleInvalidModule, mod.key, "%s (%q) are missing.", mod.label, mod.key))
			continue
		case present && !isList:
			out = append(out, issue(CodeBundleInvalidModule, mod.key, "%s (%q) must be a list.", mod.label, mod.key))
			continue
		}
		for i, item := range list {
			if !entryShaped(mod.key, item) {
				out = append(out, issue(CodeBundleInvalidModule, fmt.Sprintf("%s[%d]", mod.key, i), "%s: entry %d has the wrong shape.", mod.label, i+1))
			}
		}
	}
	if len(out) > 0 {
		return nil, out, nil
	}

	var b Bundle
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&b); err != nil {
		return nil, []Issue{issue(CodeBundleInvalidModule, "", "The file's entries do not have the expected fields: %v", err)}, nil
	}

	for _, i := range Validate(&b.TopologyData) {
		if i.Severity == SeverityError {
			out = append(out, i)
		}
	}
	seen := map[EntityID]bool{}
	for i, board := range b.TransitBoards {
		if seen[board.ServiceDefinitionID] {
			out = append(out, issue(CodeBundleDuplicateBoard, fmt.Sprintf("transitBoards[%d].serviceDefinitionId", i), "Two transit boards for %q.", board.ServiceDefinitionID))
		}
		seen[board.ServiceDefinitionID] = true
	}
	for i := range b.TransitBoards {
		for _, bi := range ValidateBoard(&b.TransitBoards[i], &b.TopologyData) {
			bi.Path = fmt.Sprintf("transitBoards[%d].%s", i, bi.Path)
			bi.EntityID = "" // the path names the board
			out = append(out, bi)
		}
	}
	return &b, out, nil
}

// entryShaped: topology entries are objects with a non-empty string id; boards have a
// serviceDefinitionId and lists of stations, lines, policies, and tables.
func entryShaped(module string, item any) bool {
	m, ok := item.(map[string]any)
	if !ok {
		return false
	}
	if module != "transitBoards" {
		id, ok := m["id"].(string)
		return ok && id != ""
	}
	if _, ok := m["serviceDefinitionId"].(string); !ok {
		return false
	}
	for _, k := range []string{"stations", "lines", "policies", "tables"} {
		if _, ok := m[k].([]any); !ok {
			return false
		}
	}
	return true
}

// ModuleCounts is the number of entities per topology module, keyed like the bundle.
func ModuleCounts(d *TopologyData) map[string]int {
	return map[string]int{
		"environments": len(d.Environments), "serviceDefinitions": len(d.ServiceDefinitions),
		"serviceInstances": len(d.ServiceInstances), "resources": len(d.Resources),
		"relationships": len(d.Relationships), "eventTypes": len(d.EventTypes),
		"businessFlows": len(d.BusinessFlows),
	}
}
