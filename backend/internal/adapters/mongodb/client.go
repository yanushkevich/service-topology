// Package mongodb is the MongoDB adapter (docs/backend/PERSISTENCE.md, ADR-019). It uses the official
// Go driver with typed filters only (no JavaScript, no $where, no query strings built from input),
// keeps MongoDB internals out of the API, and maps failures to the ports errors.
package mongodb

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/event"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readconcern"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"
	"go.mongodb.org/mongo-driver/v2/mongo/writeconcern"

	"servicetopology/backend/internal/config"
	"servicetopology/backend/internal/ports"
)

var (
	// ErrConflict reports a uniqueness violation (duplicate stable ID).
	ErrConflict = ports.ErrConflict
	// ErrAuth reports rejected credentials.
	ErrAuth = errors.New("database credentials rejected")
	// ErrDatabaseNotFound reports a missing database.
	ErrDatabaseNotFound = errors.New("database not found")
)

// Error is a failed MongoDB operation. Its message never contains credentials or document values
// (duplicate-key messages from the server include the key, so they are summarized).
type Error struct {
	kind error // ports.ErrUnavailable, ErrConflict, ErrAuth, or nil
	msg  string
}

func (e *Error) Error() string { return "mongodb: " + e.msg }
func (e *Error) Unwrap() error { return e.kind }

// mapErr classifies a driver error. Errors that are already classified pass through.
func mapErr(err error) error {
	var classified *Error
	switch {
	case err == nil:
		return nil
	case errors.As(err, &classified), errors.Is(err, ports.ErrNotFound), errors.Is(err, ports.ErrTooLarge):
		return err
	case mongo.IsDuplicateKeyError(err):
		return &Error{kind: ErrConflict, msg: "duplicate key"}
	case isAuthError(err):
		return &Error{kind: ErrAuth, msg: "authentication failed"}
	case errors.Is(err, context.Canceled):
		return err
	case mongo.IsTimeout(err), errors.Is(err, context.DeadlineExceeded):
		return &Error{kind: ports.ErrUnavailable, msg: "operation timed out"}
	case mongo.IsNetworkError(err), isServerSelection(err), errors.Is(err, mongo.ErrClientDisconnected):
		return &Error{kind: ports.ErrUnavailable, msg: "unreachable"}
	}
	var ce mongo.CommandError
	if errors.As(err, &ce) {
		return &Error{msg: fmt.Sprintf("command failed (%s, code %d)", ce.Name, ce.Code)}
	}
	var we mongo.WriteException
	if errors.As(err, &we) && len(we.WriteErrors) > 0 {
		return &Error{msg: fmt.Sprintf("write failed (code %d)", we.WriteErrors[0].Code)}
	}
	return &Error{msg: err.Error()}
}

func isAuthError(err error) bool {
	var ce mongo.CommandError
	if errors.As(err, &ce) && (ce.Code == 18 || ce.Code == 13) { // AuthenticationFailed, Unauthorized
		return true
	}
	return strings.Contains(err.Error(), "auth error") || strings.Contains(err.Error(), "AuthenticationFailed")
}

func isServerSelection(err error) bool {
	return strings.Contains(err.Error(), "server selection error")
}

// Store is a MongoDB client bound to one database. Copies made with WithDatabase share the
// connection pool.
type Store struct {
	client   *mongo.Client
	database string
	timeout  time.Duration
}

// Observer receives every command's name, outcome, and duration (metrics). Never values.
type Observer func(command string, ok bool, d time.Duration)

// Connect builds a store from validated configuration, reading the password file once. The
// connection is established lazily; use Ping to check it.
func Connect(cfg *config.MongoDB, observe Observer) (*Store, error) {
	opts := options.Client().
		ApplyURI(cfg.URI.String()).
		SetAppName("service-topology").
		SetTimeout(cfg.Timeout).
		SetServerSelectionTimeout(min(cfg.Timeout, 5*time.Second)).
		SetConnectTimeout(min(cfg.Timeout, 5*time.Second))
	if cfg.Username != "" {
		raw, err := os.ReadFile(cfg.PasswordFile)
		if err != nil {
			return nil, errors.New("mongodb: cannot read the password file named by MONGODB_PASSWORD_FILE")
		}
		pw := strings.TrimSpace(string(raw))
		if pw == "" {
			return nil, errors.New("mongodb: the password file named by MONGODB_PASSWORD_FILE is empty")
		}
		opts.SetAuth(options.Credential{Username: cfg.Username, Password: pw, AuthSource: cfg.AuthSource})
	}
	if observe != nil {
		opts.SetMonitor(&event.CommandMonitor{
			Succeeded: func(_ context.Context, e *event.CommandSucceededEvent) { observe(e.CommandName, true, e.Duration) },
			Failed:    func(_ context.Context, e *event.CommandFailedEvent) { observe(e.CommandName, false, e.Duration) },
		})
	}
	client, err := mongo.Connect(opts)
	if err != nil {
		return nil, mapErr(err)
	}
	return &Store{client: client, database: cfg.Database, timeout: cfg.Timeout}, nil
}

// Close disconnects the shared client.
func (s *Store) Close(ctx context.Context) error { return s.client.Disconnect(ctx) }

// Database returns the database name.
func (s *Store) Database() string { return s.database }

// WithDatabase returns a store for another database on the same connection (tests, benchmarks,
// contract checks use temporary databases).
func (s *Store) WithDatabase(name string) *Store {
	c := *s
	c.database = name
	return &c
}

func (s *Store) db() *mongo.Database { return s.client.Database(s.database) }

func (s *Store) coll(name string) *mongo.Collection { return s.db().Collection(name) }

// Ping checks that the primary answers (readiness).
func (s *Store) Ping(ctx context.Context) error {
	return mapErr(s.client.Ping(ctx, readpref.Primary()))
}

// Exists reports whether the database exists (it has at least one collection).
func (s *Store) Exists(ctx context.Context) (bool, error) {
	names, err := s.client.ListDatabaseNames(ctx, bson.D{{Key: "name", Value: s.database}})
	if err != nil {
		return false, mapErr(err)
	}
	return len(names) > 0, nil
}

// DropDatabase removes the database (temporary databases in tests and checks).
func (s *Store) DropDatabase(ctx context.Context) error { return mapErr(s.db().Drop(ctx)) }

// Count returns the number of documents in a collection (tests, restore verification).
func (s *Store) Count(ctx context.Context, collection string) (int64, error) {
	n, err := s.coll(collection).CountDocuments(ctx, bson.D{})
	return n, mapErr(err)
}

// txOptions: snapshot reads (every read in a transaction sees one point in time) and majority
// writes (committed data survives a primary change).
var txOptions = options.Transaction().SetReadConcern(readconcern.Snapshot()).SetWriteConcern(writeconcern.Majority())

// inTx runs fn in a multi-document transaction. The driver retries fn on transient errors, so fn
// must be safe to run again from the start. Any error aborts the transaction.
func (s *Store) inTx(ctx context.Context, fn func(ctx context.Context) error) error {
	sess, err := s.client.StartSession()
	if err != nil {
		return mapErr(err)
	}
	defer sess.EndSession(context.WithoutCancel(ctx))
	_, err = sess.WithTransaction(ctx, func(ctx context.Context) (any, error) { return nil, fn(ctx) }, txOptions)
	return mapErr(err)
}
