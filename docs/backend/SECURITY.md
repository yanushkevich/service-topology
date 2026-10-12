# Security and Deployment Requirements

**Status:** Baseline implemented in Milestone B6 (ADR-018); production identity (OIDC/SSO), tenancy, and audit remain to be selected. Implemented controls are listed first.

## Implemented (B6, verified by tests)
| Control | Implementation | Evidence |
|---|---|---|
| Authentication / roles | `AUTH_MODE=token`: bearer tokens, SHA-256 digests in `AUTH_TOKENS_FILE`, reader/editor | `security_test.go`, `auth_test.go` |
| No accidental exposure | default `127.0.0.1:8080`; refuses `AUTH_MODE=none` on non-loopback without `ALLOW_UNAUTHENTICATED=true`; metrics loopback-only | `config_test.go` |
| No query injection | typed driver filters (`bson.D`) with input only as values; no `$where`, JavaScript, or query strings; field and collection names are constants; stored JSON is converted value by value, never parsed as Extended JSON | injection tests (memory and MongoDB): operator-shaped IDs match nothing, `$`/dotted keys round-trip literally |
| Input bounds | body limits (16 MB / 1 MB), strict JSON, page/depth/limit/roots/ticks caps, 5,000 visited entities | `api_test.go`, contract check |
| Rate limiting | per-client token bucket, 429 + `Retry-After`, health exempt | `security_test.go` |
| CORS | exact-origin allowlist, no wildcard, no credentials; preflight 403 for others | `security_test.go` |
| Response headers | `nosniff`, CSP `default-src 'none'; frame-ancestors 'none'`, `no-referrer`, `no-store` | `security_test.go` |
| Error hygiene | RFC 9457 problems; no SQL, stack traces, credentials, or internal addresses; `requestId` for correlation | `api_test.go`, `client_test.go` |
| Secrets | database password only via file; `MONGODB_PASSWORD` and credentials in the URI rejected; never logged | `config_test.go` |
| Entity writes | editor role in token mode; 1 MB body limit; strict JSON (unknown fields 400); schema enums and whole-topology validation before writing; IDs without slashes or control characters, ≤ 200 characters; `If-Match` revision guard | `entities_test.go`, contract check |
| Database exposure | MongoDB bound to `127.0.0.1:27017` with access control on (root user from a Docker secret); backups owner-only; the optional mongo-express UI only on `127.0.0.1:8081`, behind basic auth, credentials from the secret file | Compose file, RUNBOOK |
| Dependency scanning | `make vulncheck` (govulncheck v1.8.0): no vulnerabilities; `npm audit`: 0 (2026-10-11) | closeout |

## Non-negotiable safeguards
- Do not deploy production data endpoints without authentication and authorization, even if the initial local prototype has no identity provider.
- Define workspace/tenant boundaries before multi-user deployment. Every query and mutation must enforce the selected scope server-side.
- Store credentials in a secret manager or deployment secret facility; never in source control, fixtures, logs, or frontend bundles.
- Validate and bound all inputs: page sizes, graph depth, list filters, metadata size, payload size, time ranges and layout payloads.
- Use parameterized queries only. Never concatenate user input into SQL, Cypher, or other query strings. Dynamic vertex/edge type names must come from strict server-side allowlists.
- Enforce timeouts, graceful cancellation, and rate limits appropriate to deployment.
- Avoid exposing endpoints, connection strings, auth metadata, tokens, or unfiltered provider metadata in logs/API responses.
- Apply restrictive CORS policy for known frontend origins; do not use wildcard origins with credentials.
- Configure TLS at the trusted ingress/proxy boundary and document the trust model.
- Use least-privilege database roles; migration role should be separate from runtime role where practical.
- Validate URL-like endpoint fields to avoid unsafe downstream fetches if any future feature dereferences them; never fetch arbitrary user-supplied URLs by default.
- Provide dependency scanning, static analysis, secret scanning and vulnerability remediation in CI.

## Identity/auth decisions before launch
Choose: existing reverse proxy/SSO, OIDC, or another explicit model; define roles (read-only, operator, admin), audit requirements, service-to-service access, session/token handling, and whether personal saved layouts are supported. These choices are unresolved in the UI docs.

## Operational endpoints
`/healthz` should reveal minimal liveness. `/readyz` should return dependency status without exposing internal connection details. Protect metrics/debug/pprof endpoints; do not expose them publicly by default.

## Privacy and deletion
Set policy for endpoint/resource metadata, event payloads, snapshot retention, user layout ownership and audit records before real inventory data is imported.


## Database security
Bind database ports to localhost in local development (`backend/docker-compose.yml` publishes `127.0.0.1:27017` only). Use separate least-privilege credentials per service in deployed environments, TLS where applicable, secret injection rather than committed credentials, network restrictions, and tested backup/restore. The sample Compose credentials are local-only and must never be reused.
