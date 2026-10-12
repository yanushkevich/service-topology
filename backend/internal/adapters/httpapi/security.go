package httpapi

import (
	"context"
	"math"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"servicetopology/backend/internal/auth"
)

// Security settings for the HTTP adapter (ADR-018, docs/backend/SECURITY.md).
type Security struct {
	// Tokens enables bearer authentication on /api/; nil means AUTH_MODE=none.
	Tokens auth.Tokens
	// RateLimitRPS (0 disables) and RateLimitBurst bound requests per client.
	RateLimitRPS   float64
	RateLimitBurst int
	// TrustProxyHeaders uses the first X-Forwarded-For address as the client (only behind a proxy
	// that sets it).
	TrustProxyHeaders bool
	// CORSAllowedOrigins lists exact origins allowed to call the API from a browser.
	CORSAllowedOrigins []string
}

type principalKey struct{}

// PrincipalFrom returns the authenticated caller, if any.
func PrincipalFrom(ctx context.Context) (auth.Principal, bool) {
	p, ok := ctx.Value(principalKey{}).(auth.Principal)
	return p, ok
}

func isOperational(path string) bool { return path == "/healthz" || path == "/readyz" }

// securityHeaders apply to every response: the API serves JSON only.
func securityHeaders(w http.ResponseWriter) {
	h := w.Header()
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Referrer-Policy", "no-referrer")
	h.Set("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
	h.Set("Cache-Control", "no-store")
}

// cors answers preflights and sets CORS headers for allowed origins. It returns true when the
// request has been fully handled.
func (s Security) cors(w http.ResponseWriter, r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return false
	}
	allowed := false
	for _, o := range s.CORSAllowedOrigins {
		if o == origin {
			allowed = true
			break
		}
	}
	preflight := r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != ""
	if !allowed {
		if preflight {
			WriteProblem(w, r, Problem{Type: problemBase + "forbidden", Title: "Forbidden", Status: http.StatusForbidden, Detail: "This origin is not allowed."})
			return true
		}
		return false // no CORS headers: the browser blocks the response
	}
	h := w.Header()
	h.Set("Access-Control-Allow-Origin", origin)
	h.Add("Vary", "Origin")
	h.Set("Access-Control-Expose-Headers", "X-Request-ID, Location, Retry-After, ETag")
	if preflight {
		h.Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE")
		h.Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Request-ID, If-Match")
		h.Set("Access-Control-Max-Age", "600")
		w.WriteHeader(http.StatusNoContent)
		return true
	}
	return false
}

// authenticate enforces bearer tokens and roles on /api/ routes. It returns the request to use, or
// nil when a problem response has been written.
func (s Security) authenticate(w http.ResponseWriter, r *http.Request) *http.Request {
	if s.Tokens == nil || !strings.HasPrefix(r.URL.Path, "/api/") {
		return r
	}
	scheme, token, _ := strings.Cut(r.Header.Get("Authorization"), " ")
	p, ok := s.Tokens.Authenticate(strings.TrimSpace(token))
	if !strings.EqualFold(scheme, "Bearer") || !ok {
		w.Header().Set("WWW-Authenticate", `Bearer realm="service-topology"`)
		WriteProblem(w, r, Problem{Type: problemBase + "unauthorized", Title: "Unauthorized", Status: http.StatusUnauthorized, Detail: "A valid bearer token is required."})
		return nil
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead && !p.CanWrite() {
		WriteProblem(w, r, Problem{Type: problemBase + "forbidden", Title: "Forbidden", Status: http.StatusForbidden, Detail: "This token may only read."})
		return nil
	}
	return r.WithContext(context.WithValue(r.Context(), principalKey{}, p))
}

// clientKey identifies the caller for rate limiting.
func (s Security) clientKey(r *http.Request) string {
	if s.TrustProxyHeaders {
		if fwd := r.Header.Get("X-Forwarded-For"); fwd != "" {
			first, _, _ := strings.Cut(fwd, ",")
			if ip := net.ParseIP(strings.TrimSpace(first)); ip != nil {
				return ip.String()
			}
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// limiter is a per-client token bucket.
type limiter struct {
	rps   float64
	burst float64
	mu    sync.Mutex
	b     map[string]*bucket
	calls int
}

type bucket struct {
	tokens float64
	last   time.Time
}

func newLimiter(rps float64, burst int) *limiter {
	if rps <= 0 {
		return nil
	}
	return &limiter{rps: rps, burst: float64(burst), b: map[string]*bucket{}}
}

// allow takes a token; when none is left it returns the seconds to wait.
func (l *limiter) allow(key string, now time.Time) (bool, int) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.calls++; l.calls%1024 == 0 { // drop buckets idle long enough to be full again
		for k, v := range l.b {
			if now.Sub(v.last).Seconds()*l.rps >= l.burst {
				delete(l.b, k)
			}
		}
	}
	bk := l.b[key]
	if bk == nil {
		bk = &bucket{tokens: l.burst, last: now}
		l.b[key] = bk
	}
	bk.tokens = math.Min(l.burst, bk.tokens+now.Sub(bk.last).Seconds()*l.rps)
	bk.last = now
	if bk.tokens < 1 {
		return false, int(math.Ceil((1 - bk.tokens) / l.rps))
	}
	bk.tokens--
	return true, 0
}

func tooManyRequests(w http.ResponseWriter, r *http.Request, wait int) {
	w.Header().Set("Retry-After", strconv.Itoa(max(1, wait)))
	WriteProblem(w, r, Problem{Type: problemBase + "rate-limited", Title: "Too many requests", Status: http.StatusTooManyRequests, Detail: "Request rate limit exceeded; retry later."})
}
