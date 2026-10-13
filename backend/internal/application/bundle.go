package application

import (
	"context"
	"errors"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// Data bundles (ADR-032, docs/DATA_BUNDLE.md): an import replaces the whole topology and every
// stored transit board, after the bundle checks, the entity field checks, and the board rules.

// ErrNoBundleImport reports a deployment whose storage cannot replace everything atomically.
var ErrNoBundleImport = errors.New("this deployment cannot import data bundles")

// ImportBundle validates a bundle file (JSON) and replaces the stored data with it. ifMatch, when
// set, must be the current topology revision.
func (s *Service) ImportBundle(ctx context.Context, raw []byte, ifMatch string) (*ports.ReplaceResult, error) {
	importer, ok := s.TopologyRepo.(ports.BundleImporter)
	if !ok || s.BoardRepo == nil {
		return nil, ErrNoBundleImport
	}
	b, issues, err := domain.ParseBundle(raw)
	if err != nil {
		return nil, &ErrInvalid{Param: "body", Reason: "not valid JSON: " + err.Error()}
	}
	if len(issues) == 0 {
		issues = bundleFieldIssues(b)
	}
	if len(issues) > 0 {
		return nil, &ErrValidation{Issues: issues}
	}
	for i := range b.TransitBoards {
		normalizeBoard(&b.TransitBoards[i])
	}
	res, err := importer.ReplaceAll(ctx, &b.TopologyData, b.TransitBoards, ifMatch, "import", s.boardTime())
	if errors.Is(err, ports.ErrPreconditionFailed) {
		_, current, _ := s.currentRevision(ctx)
		return nil, &ErrPrecondition{Current: current}
	}
	return res, err
}

// bundleFieldIssues runs the schema-level field checks of entity writes on every entity.
func bundleFieldIssues(b *domain.Bundle) []domain.Issue {
	var out []domain.Issue
	check := func(kind string, entity any) { out = append(out, domain.ValidateEntityFields(kind, entity)...) }
	d := &b.TopologyData
	for i := range d.Environments {
		check(domain.KindEnvironment, &d.Environments[i])
	}
	for i := range d.ServiceDefinitions {
		check(domain.KindServiceDefinition, &d.ServiceDefinitions[i])
	}
	for i := range d.ServiceInstances {
		check(domain.KindServiceInstance, &d.ServiceInstances[i])
	}
	for i := range d.Resources {
		check(domain.KindResource, &d.Resources[i])
	}
	for i := range d.Relationships {
		check(domain.KindRelationship, &d.Relationships[i])
	}
	for i := range d.EventTypes {
		check(domain.KindEventType, &d.EventTypes[i])
	}
	for i := range d.BusinessFlows {
		check(domain.KindBusinessFlow, &d.BusinessFlows[i])
	}
	return out
}

// currentRevision returns the stored topology revision, when the repository can tell.
func (s *Service) currentRevision(ctx context.Context) (*domain.TopologyData, string, error) {
	w, err := s.writer()
	if err != nil {
		return nil, "", err
	}
	return w.CurrentTopology(ctx)
}
