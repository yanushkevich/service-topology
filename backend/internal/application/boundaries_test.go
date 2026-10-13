package application_test

import (
	"go/parser"
	"go/token"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Dependencies point inward (docs/CONVENTIONS.md "Backend layers"): adapters and cmd depend on
// application, application on ports and domain, never the other way. The HTTP, MongoDB, and file
// format adapters plug in through ports; application code never names them.
func TestApplicationAndPortsDoNotImportAdapters(t *testing.T) {
	forbidden := []string{
		"servicetopology/backend/internal/adapters",
		"servicetopology/backend/internal/app",
		"servicetopology/backend/internal/config",
		"net/http",
		"go.mongodb.org",
	}
	for _, dir := range []string{".", "../ports"} {
		files, err := filepath.Glob(filepath.Join(dir, "*.go"))
		if err != nil {
			t.Fatal(err)
		}
		for _, file := range files {
			if strings.HasSuffix(file, "_test.go") {
				continue
			}
			f, err := parser.ParseFile(token.NewFileSet(), file, nil, parser.ImportsOnly)
			if err != nil {
				t.Fatal(err)
			}
			for _, imp := range f.Imports {
				path, _ := strconv.Unquote(imp.Path.Value)
				for _, bad := range forbidden {
					if path == bad || strings.HasPrefix(path, bad+"/") {
						t.Errorf("%s imports %s", file, path)
					}
				}
			}
		}
	}
}
