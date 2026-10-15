package dynatrace

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// tokenSource returns the bearer token for platform requests.
type tokenSource interface {
	token(ctx context.Context) (string, error)
}

// staticToken is a platform token, used as is.
type staticToken string

func (t staticToken) token(context.Context) (string, error) { return string(t), nil }

// oauthToken gets access tokens with the client-credentials grant and reuses each until shortly
// before it expires.
type oauthToken struct {
	cfg    OAuthConfig
	secret string
	http   *http.Client
	now    func() time.Time

	mu      sync.Mutex
	current string
	expires time.Time
}

// tokenRefreshMargin renews an access token this long before it expires.
const tokenRefreshMargin = 30 * time.Second

func (o *oauthToken) token(ctx context.Context) (string, error) {
	o.mu.Lock()
	defer o.mu.Unlock()
	if o.current != "" && o.now().Before(o.expires.Add(-tokenRefreshMargin)) {
		return o.current, nil
	}
	form := url.Values{
		"grant_type":    {"client_credentials"},
		"client_id":     {o.cfg.ClientID},
		"client_secret": {o.secret},
		"scope":         {strings.Join(RequiredScopes, " ")},
	}
	if o.cfg.AccountURN != "" {
		form.Set("resource", o.cfg.AccountURN)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, o.cfg.TokenURL, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	res, err := o.http.Do(req)
	if err != nil {
		return "", &QueryError{Kind: ErrUnreachable, Message: "the SSO endpoint cannot be reached"}
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 1<<16))
	if res.StatusCode != http.StatusOK {
		return "", &QueryError{Status: res.StatusCode, Kind: ErrAuth, Message: "the SSO endpoint refused the OAuth client (" + res.Status + ")"}
	}
	var granted struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &granted); err != nil || granted.AccessToken == "" {
		return "", &QueryError{Status: res.StatusCode, Kind: ErrAuth, Message: "the SSO endpoint returned no access token"}
	}
	o.current = granted.AccessToken
	o.expires = o.now().Add(time.Duration(granted.ExpiresIn) * time.Second)
	return o.current, nil
}

// newTokenSource reads the tenant's secret file and returns its token source.
func newTokenSource(t TenantConfig, client *http.Client, now func() time.Time) (tokenSource, error) {
	if t.Auth.OAuth == nil {
		token, err := readSecret(t.Auth.PlatformTokenFile)
		if err != nil {
			return nil, fmt.Errorf("tenant %s: %w", t.ID, err)
		}
		return staticToken(token), nil
	}
	secret, err := readSecret(t.Auth.OAuth.ClientSecretFile)
	if err != nil {
		return nil, fmt.Errorf("tenant %s: %w", t.ID, err)
	}
	return &oauthToken{cfg: *t.Auth.OAuth, secret: secret, http: client, now: now}, nil
}
