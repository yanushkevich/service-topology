//go:build integration

package arcadedb_test

import (
	"os"
	"testing"
	"time"

	"servicetopology/backend/internal/adapters/arcadedb"
)

// traceSlow logs requests slower than 500 ms when ARCADEDB_TRACE=1 (diagnostics for flaky runs).
func traceSlow(t *testing.T, c *arcadedb.Client) {
	if os.Getenv("ARCADEDB_TRACE") != "1" {
		return
	}
	c.Observe = func(method, path string, status int, d time.Duration, err error) {
		if d > 500*time.Millisecond || err != nil {
			t.Logf("%s %s -> %d in %v (err=%v)", method, path, status, d.Round(time.Millisecond), err)
		}
	}
}
