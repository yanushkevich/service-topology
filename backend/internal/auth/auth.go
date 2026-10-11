// Package auth implements bearer-token authentication with hashed tokens and two roles (ADR-018).
// Tokens are never stored or logged in plain text: the tokens file holds SHA-256 hashes.
package auth

import (
	"bufio"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"regexp"
	"strings"
)

// Roles. Readers may call GET endpoints; editors may also create and change data.
const (
	RoleReader = "reader"
	RoleEditor = "editor"
)

// Principal is an authenticated caller.
type Principal struct {
	Name string
	Role string
}

// CanWrite reports whether the principal may change data.
func (p Principal) CanWrite() bool { return p.Role == RoleEditor }

// Tokens maps SHA-256 hex digests of tokens to principals.
type Tokens map[string]Principal

var nameRE = regexp.MustCompile(`^[A-Za-z0-9._-]{1,64}$`)

// LoadTokens reads a tokens file: one "name role sha256-hex" per line; blank lines and # comments
// are ignored. Errors name the line, never a token or digest.
func LoadTokens(path string) (Tokens, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("AUTH_TOKENS_FILE: %w", err)
	}
	defer f.Close()
	out := Tokens{}
	sc := bufio.NewScanner(f)
	for line := 1; sc.Scan(); line++ {
		text := strings.TrimSpace(sc.Text())
		if text == "" || strings.HasPrefix(text, "#") {
			continue
		}
		fields := strings.Fields(text)
		if len(fields) != 3 || !nameRE.MatchString(fields[0]) || (fields[1] != RoleReader && fields[1] != RoleEditor) || len(fields[2]) != 64 {
			return nil, fmt.Errorf("AUTH_TOKENS_FILE line %d: want \"name reader|editor sha256-hex\"", line)
		}
		if _, err := hex.DecodeString(fields[2]); err != nil {
			return nil, fmt.Errorf("AUTH_TOKENS_FILE line %d: digest is not hex", line)
		}
		out[strings.ToLower(fields[2])] = Principal{Name: fields[0], Role: fields[1]}
	}
	if err := sc.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("AUTH_TOKENS_FILE: no tokens defined")
	}
	return out, nil
}

// Digest returns the SHA-256 hex digest of a token.
func Digest(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// Authenticate resolves a bearer token. The lookup is by digest, so the comparison never touches
// the secret itself.
func (t Tokens) Authenticate(token string) (Principal, bool) {
	if token == "" {
		return Principal{}, false
	}
	p, ok := t[Digest(token)]
	return p, ok
}

// NewToken returns a random 256-bit token (URL-safe base64, "tst_" prefix for secret scanners).
func NewToken() string {
	var b [32]byte
	_, _ = rand.Read(b[:])
	return "tst_" + base64.RawURLEncoding.EncodeToString(b[:])
}
