package application

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"time"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// ErrImportOverwritesAuthored refuses an import whose flow ID belongs to an authored flow: the
// import would silently replace work done in the app (ADR-022).
var ErrImportOverwritesAuthored = errors.New("an authored business flow has this ID; rename the flow in the definition or delete the authored one")

// FlowImport is one import request (POST /imports/business-flows, make import-flows).
type FlowImport struct {
	// Format is "native" (JSON or YAML) or "bpmn".
	Format string `json:"format"`
	// Content is the definition file.
	Content string `json:"content"`
	// Ref names the source (e.g. the file path or repository URL), shown on imported flows.
	Ref     string            `json:"ref"`
	Mapping ports.FlowMapping `json:"mapping"`
}

// ImportedFlow says what happened to one flow of an import.
type ImportedFlow struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Status string `json:"status"` // created, updated, unchanged
}

// ImportResult is the outcome of an import; Revision is the topology revision afterwards.
type ImportResult struct {
	Flows    []ImportedFlow `json:"flows"`
	Revision string         `json:"revision"`
}

// FlowFormats are the definition formats the importer understands, by name.
type FlowFormats map[string]ports.FlowFormat

// ImportFlows imports workflow definitions as business flows (ADR-022, docs/BUSINESS_FLOWS.md §4):
// decoded by the format adapter, marked imported, and validated with the whole topology before
// anything is written. Re-importing an unchanged definition writes nothing; an imported flow is
// replaced; an authored flow with the same ID is never overwritten.
func (s *Service) ImportFlows(ctx context.Context, req FlowImport) (*ImportResult, error) {
	format := s.FlowFormats[req.Format]
	if format == nil {
		return nil, &ErrInvalid{"format", "must be native or bpmn"}
	}
	if req.Ref == "" {
		req.Ref = "upload"
	}
	flows, err := format.Decode([]byte(req.Content), req.Mapping)
	if err != nil {
		var ie *ports.ImportError
		if errors.As(err, &ie) {
			issues := make([]domain.Issue, len(ie.Problems))
			for i, p := range ie.Problems {
				issues[i] = domain.Issue{Severity: domain.SeverityError, Code: "import-invalid", EntityID: p.Element, Message: p.Message}
			}
			return nil, &ErrValidation{Issues: issues}
		}
		return nil, err
	}
	w, err := s.writer()
	if err != nil {
		return nil, err
	}
	current, rev, err := w.CurrentTopology(ctx)
	if err != nil {
		return nil, err
	}
	now := time.Now
	if s.Now != nil {
		now = s.Now
	}
	importedAt := now().UTC().Format(time.RFC3339)
	formatName, ref := req.Format, req.Ref

	candidate := cloneTopology(current)
	type planned struct {
		op   string
		flow *domain.BusinessFlow
	}
	var plan []planned
	result := &ImportResult{Revision: rev}
	for i := range flows {
		f := flows[i]
		f.Source = domain.FlowSource{Kind: "imported", Format: &formatName, Ref: &ref, ImportedAt: &importedAt}
		if issues := domain.ValidateEntityFields(domain.KindBusinessFlow, &f); len(issues) > 0 {
			return nil, &ErrValidation{Issues: issues}
		}
		at := findEntity(candidate, domain.KindBusinessFlow, f.ID)
		switch {
		case at < 0 && entityExists(candidate, f.ID):
			return nil, fmt.Errorf("%w: %s", ports.ErrConflict, f.ID)
		case at < 0:
			plan = append(plan, planned{ports.OpCreate, &f})
			applyChange(candidate, domain.KindBusinessFlow, ports.OpCreate, -1, &f)
			result.Flows = append(result.Flows, ImportedFlow{f.ID, f.Name, "created"})
		case candidate.BusinessFlows[at].Source.Kind != "imported":
			return nil, fmt.Errorf("%w: %s", ErrImportOverwritesAuthored, f.ID)
		case sameIgnoringImportTime(&candidate.BusinessFlows[at], &f):
			result.Flows = append(result.Flows, ImportedFlow{f.ID, f.Name, "unchanged"})
		default:
			plan = append(plan, planned{ports.OpReplace, &f})
			applyChange(candidate, domain.KindBusinessFlow, ports.OpReplace, at, &f)
			result.Flows = append(result.Flows, ImportedFlow{f.ID, f.Name, "updated"})
		}
	}
	if issues := domain.Validate(candidate); len(issues) > 0 {
		return nil, &ErrValidation{Issues: issues}
	}
	// Validated as a whole above; written one flow at a time on the revision chain. Only a concurrent
	// write can make a later step fail (412), and the import can then simply be run again.
	for _, p := range plan {
		rev, err = w.ApplyChange(ctx, ports.EntityChange{Op: p.op, Kind: domain.KindBusinessFlow, ID: p.flow.ID, Entity: p.flow}, rev, SourceImport)
		if errors.Is(err, ports.ErrPreconditionFailed) {
			return nil, &ErrPrecondition{}
		}
		if err != nil {
			return nil, err
		}
	}
	result.Revision = rev
	return result, nil
}

// SourceImport is the backend provenance of imported business flows.
const SourceImport = "import"

func sameIgnoringImportTime(a, b *domain.BusinessFlow) bool {
	ca, cb := *a, *b
	ca.Source.ImportedAt, cb.Source.ImportedAt = nil, nil
	ja, _ := json.Marshal(ca)
	jb, _ := json.Marshal(cb)
	var va, vb any
	_ = json.Unmarshal(ja, &va)
	_ = json.Unmarshal(jb, &vb)
	return reflect.DeepEqual(va, vb)
}
