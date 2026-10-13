package application

import (
	"context"
	"errors"
	"fmt"
	"time"

	"servicetopology/backend/internal/domain"
	"servicetopology/backend/internal/ports"
)

// Transit board definitions (ADR-031): stored per service, validated against the current topology
// with the rules of apps/web/src/transit/definition.ts, and guarded by a per-board revision.

// ErrNoBoardStore reports a deployment without board storage.
var ErrNoBoardStore = errors.New("this deployment does not store transit boards")

func (s *Service) boards() (ports.BoardRepository, error) {
	if s.BoardRepo == nil {
		return nil, ErrNoBoardStore
	}
	return s.BoardRepo, nil
}

// Boards lists every stored board.
func (s *Service) Boards(ctx context.Context) ([]domain.StoredBoard, error) {
	repo, err := s.boards()
	if err != nil {
		return nil, err
	}
	return repo.List(ctx)
}

// Board returns the stored board of a service.
func (s *Service) Board(ctx context.Context, serviceID string) (*domain.StoredBoard, error) {
	repo, err := s.boards()
	if err != nil {
		return nil, err
	}
	b, err := repo.Get(ctx, serviceID)
	if errors.Is(err, ports.ErrNotFound) {
		return nil, &NotFound{Detail: fmt.Sprintf("No transit board is stored for %q.", serviceID)}
	}
	return b, err
}

// CreateBoard validates and stores a new board; a service has at most one.
func (s *Service) CreateBoard(ctx context.Context, def *domain.BoardDefinition) (*domain.StoredBoard, error) {
	repo, err := s.boards()
	if err != nil {
		return nil, err
	}
	if err := s.checkBoard(ctx, def); err != nil {
		return nil, err
	}
	b, err := repo.Create(ctx, def, s.boardTime())
	if errors.Is(err, ports.ErrConflict) {
		return nil, fmt.Errorf("%w: a transit board for %q exists", ports.ErrConflict, def.ServiceDefinitionID)
	}
	return b, err
}

// ReplaceBoard validates and stores a new revision of the board in the path; ifMatch, when set,
// must be the current revision.
func (s *Service) ReplaceBoard(ctx context.Context, serviceID string, def *domain.BoardDefinition, ifMatch string) (*domain.StoredBoard, error) {
	repo, err := s.boards()
	if err != nil {
		return nil, err
	}
	if def.ServiceDefinitionID != serviceID {
		return nil, &ErrValidation{Issues: []domain.Issue{{Severity: domain.SeverityError, Code: domain.CodeInvalidField, EntityID: def.ServiceDefinitionID, Path: "serviceDefinitionId", Message: "serviceDefinitionId: must equal the service in the path"}}}
	}
	if err := s.checkBoard(ctx, def); err != nil {
		return nil, err
	}
	b, err := repo.Replace(ctx, def, ifMatch, s.boardTime())
	if errors.Is(err, ports.ErrNotFound) {
		return nil, &NotFound{Detail: fmt.Sprintf("No transit board is stored for %q.", serviceID)}
	}
	return b, err
}

// DeleteBoard removes the board of a service; ifMatch, when set, must be the current revision.
func (s *Service) DeleteBoard(ctx context.Context, serviceID, ifMatch string) error {
	repo, err := s.boards()
	if err != nil {
		return err
	}
	if err := repo.Remove(ctx, serviceID, ifMatch); errors.Is(err, ports.ErrNotFound) {
		return &NotFound{Detail: fmt.Sprintf("No transit board is stored for %q.", serviceID)}
	} else {
		return err
	}
}

// checkBoard normalizes empty lists and validates the definition against the current topology.
func (s *Service) checkBoard(ctx context.Context, def *domain.BoardDefinition) error {
	normalizeBoard(def)
	ix, err := s.index(ctx)
	if err != nil {
		return err
	}
	if issues := domain.ValidateBoard(def, ix.Data); len(issues) > 0 {
		return &ErrValidation{Issues: issues}
	}
	return nil
}

func (s *Service) boardTime() string { return s.now().UTC().Format(time.RFC3339) }

// normalizeBoard makes required lists non-null, as the schema requires.
func normalizeBoard(def *domain.BoardDefinition) {
	if def.Stations == nil {
		def.Stations = []domain.BoardStation{}
	}
	if def.Lines == nil {
		def.Lines = []domain.BoardLine{}
	}
	if def.Policies == nil {
		def.Policies = []domain.BoardPolicy{}
	}
	if def.Tables == nil {
		def.Tables = []domain.BoardTable{}
	}
	for i := range def.Lines {
		if def.Lines[i].Patterns == nil {
			def.Lines[i].Patterns = []string{}
		}
	}
	for i := range def.Tables {
		if def.Tables[i].Writes == nil {
			def.Tables[i].Writes = []string{}
		}
		if def.Tables[i].Reads == nil {
			def.Tables[i].Reads = []string{}
		}
	}
}
