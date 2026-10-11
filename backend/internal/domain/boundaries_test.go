package domain_test

import (
	"go/parser"
	"go/token"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// The domain package is pure: standard library only, and no network, database, or HTTP packages
// (docs/backend/BACKEND_SPEC.md). Mirrors the frontend's domain boundary test.
func TestDomainImportsOnlyPureStandardLibrary(t *testing.T) {
	files, err := filepath.Glob("*.go")
	if err != nil {
		t.Fatal(err)
	}
	forbidden := []string{"net", "database", "os/exec", "servicetopology/backend/internal/adapters", "servicetopology/backend/internal/config"}
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
			// golang.org/x/text is allowed: pure collation tables, needed for client-identical sorting.
			if strings.Contains(strings.Split(path, "/")[0], ".") && !strings.HasPrefix(path, "golang.org/x/text/") {
				t.Errorf("%s imports third-party package %q", file, path)
			}
			for _, bad := range forbidden {
				if path == bad || strings.HasPrefix(path, bad+"/") {
					t.Errorf("%s imports %q", file, path)
				}
			}
		}
	}
}
