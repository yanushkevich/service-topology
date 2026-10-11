package auth_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"servicetopology/backend/internal/auth"
)

func TestTokensFile(t *testing.T) {
	tok := auth.NewToken()
	file := filepath.Join(t.TempDir(), "tokens")
	content := "# comment\n\nci editor " + auth.Digest(tok) + "\nviewer reader " + auth.Digest("other") + "\n"
	if err := os.WriteFile(file, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	tokens, err := auth.LoadTokens(file)
	if err != nil {
		t.Fatal(err)
	}
	if p, ok := tokens.Authenticate(tok); !ok || p.Name != "ci" || !p.CanWrite() {
		t.Fatalf("editor token: %+v %v", p, ok)
	}
	if p, ok := tokens.Authenticate("other"); !ok || p.CanWrite() {
		t.Fatalf("reader token: %+v %v", p, ok)
	}
	if _, ok := tokens.Authenticate("guess"); ok {
		t.Fatal("unknown token accepted")
	}
	bad := filepath.Join(t.TempDir(), "bad")
	_ = os.WriteFile(bad, []byte("ci admin "+tok+"\n"), 0o600)
	if _, err := auth.LoadTokens(bad); err == nil || strings.Contains(err.Error(), tok) {
		t.Fatalf("bad line: %v", err)
	}
	if !strings.HasPrefix(tok, "tst_") || len(tok) < 40 || tok == auth.NewToken() {
		t.Fatal("tokens must be random and prefixed")
	}
}
