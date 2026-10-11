# Security and Deployment Requirements

**Status:** Baseline recommendations; production policy remains to be selected.

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
Bind database ports to localhost in local development. Use separate least-privilege credentials per service in deployed environments, TLS where applicable, secret injection rather than committed credentials, network restrictions, and tested backup/restore. The sample Compose credentials are local-only and must never be reused.
