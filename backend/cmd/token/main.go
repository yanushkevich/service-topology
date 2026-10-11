// Command token creates an API token (ADR-018). It prints the token once and the line to append to
// AUTH_TOKENS_FILE (which stores only the SHA-256 digest).
//
//	go run ./cmd/token -name ci -role editor
package main

import (
	"flag"
	"fmt"
	"os"

	"servicetopology/backend/internal/auth"
)

func main() {
	name := flag.String("name", "", "token name (letters, digits, . _ -)")
	role := flag.String("role", auth.RoleReader, "reader or editor")
	flag.Parse()
	if *name == "" || (*role != auth.RoleReader && *role != auth.RoleEditor) {
		fmt.Fprintln(os.Stderr, "usage: token -name <name> -role reader|editor")
		os.Exit(2)
	}
	tok := auth.NewToken()
	fmt.Printf("token (shown once; send as \"Authorization: Bearer <token>\"):\n%s\n\nappend to AUTH_TOKENS_FILE:\n%s %s %s\n", tok, *name, *role, auth.Digest(tok))
}
