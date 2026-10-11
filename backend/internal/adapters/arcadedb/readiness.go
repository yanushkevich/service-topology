package arcadedb

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"
)

// Initializer ensures the database and schema exist, retrying in the background until it succeeds,
// and serves as the "database" readiness check (ports.ReadinessCheck).
type Initializer struct {
	c      *Client
	logger *slog.Logger
	mu     sync.Mutex
	done   bool
	last   error
}

// NewInitializer returns an initializer for c.
func NewInitializer(c *Client, logger *slog.Logger) *Initializer {
	return &Initializer{c: c, logger: logger, last: errors.New("initializing")}
}

// Run tries EnsureSchema every interval until it succeeds or ctx ends. A newer schema stops retries.
func (i *Initializer) Run(ctx context.Context, interval time.Duration) {
	for {
		err := EnsureSchema(ctx, i.c)
		i.mu.Lock()
		i.done, i.last = err == nil, err
		i.mu.Unlock()
		if err == nil {
			i.logger.Info("database schema ready", "database", i.c.Database(), "schemaVersion", SchemaVersion)
			return
		}
		i.logger.Warn("database initialization failed; retrying", "error", err.Error(), "retryIn", interval.String())
		if errors.Is(err, ErrSchemaNewer) {
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(interval):
		}
	}
}

// Name implements ports.ReadinessCheck.
func (i *Initializer) Name() string { return "database" }

// Check implements ports.ReadinessCheck: ready once the schema is initialized and the server answers.
// Messages are generic; they never include connection details.
func (i *Initializer) Check(ctx context.Context) error {
	i.mu.Lock()
	done, last := i.done, i.last
	i.mu.Unlock()
	if !done {
		switch {
		case errors.Is(last, ErrAuth):
			return errors.New("credentials rejected")
		case errors.Is(last, ErrSchemaNewer):
			return errors.New("schema is newer than this backend")
		case last != nil && last.Error() == "initializing":
			return errors.New("initializing")
		default:
			return errors.New("schema not initialized (database unreachable or failing)")
		}
	}
	if err := i.c.Ready(ctx); err != nil {
		return errors.New("unreachable")
	}
	return nil
}
