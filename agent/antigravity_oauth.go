package bee

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"slices"
	"strconv"
	"strings"
	"time"

	"golang.org/x/oauth2"
)

const (
	antigravityClientID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com"
	// antigravityClientSecret is the installed-application secret of the
	// Antigravity OAuth client. It ships inside every copy of the Antigravity
	// app and names the client, not a person, which is why Google does not
	// treat the secret of an installed application as confidential. It is not
	// a TokHive secret. ANTIGRAVITY_OAUTH_CLIENT_SECRET replaces it.
	antigravityClientSecret = "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"
	// antigravityRedirect is where Google sends the browser once the person
	// has signed in: a loopback address this client is known to accept.
	antigravityRedirect = "http://localhost:51121/oauth-callback"
	antigravityListen   = "127.0.0.1:51121"
)

var antigravityScopes = []string{
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs",
}

func antigravityOAuth(redirect string) *oauth2.Config {
	secret := antigravityClientSecret
	if override := os.Getenv("ANTIGRAVITY_OAUTH_CLIENT_SECRET"); override != "" {
		secret = override
	}
	return &oauth2.Config{
		ClientID: antigravityClientID, ClientSecret: secret, RedirectURL: redirect, Scopes: antigravityScopes,
		Endpoint: oauth2.Endpoint{AuthURL: "https://accounts.google.com/o/oauth2/v2/auth", TokenURL: "https://oauth2.googleapis.com/token", AuthStyle: oauth2.AuthStyleInParams},
	}
}

// antigravityOAuthContext carries the client the token endpoint is reached
// with: the proxy Bee's other Google calls use, and no redirects.
func antigravityOAuthContext(ctx context.Context, transport http.RoundTripper) context.Context {
	return context.WithValue(ctx, oauth2.HTTPClient, antigravityHTTP(transport, 30*time.Second))
}

// antigravityOAuthFailure says why a token request failed in Google's own
// error words, without quoting the response.
func antigravityOAuthFailure(err error, secrets ...string) string {
	var retrieve *oauth2.RetrieveError
	if errors.As(err, &retrieve) {
		if retrieve.ErrorCode != "" {
			return boundedFailureText(safeText("Google answered "+strconv.Quote(retrieve.ErrorCode)+" "+retrieve.ErrorDescription, secrets...), 512)
		}
		if retrieve.Response != nil {
			return fmt.Sprintf("Google answered HTTP %d", retrieve.Response.StatusCode)
		}
	}
	return boundedFailureText(safeText(err.Error(), secrets...), 512)
}

// antigravityRejections are the answers that end a sign-in: the refresh token
// was revoked or expired, or Google no longer lets this client use it.
// Repeating the request cannot change any of them.
var antigravityRejections = []string{"invalid_grant", "invalid_client", "unauthorized_client", "access_denied"}

// antigravityRejection is a refresh Google refused for good.
type antigravityRejection struct{ code string }

func (e *antigravityRejection) Error() string {
	return errAntigravitySignIn.Error() + " (Google answered " + e.code + ")"
}
func (e *antigravityRejection) Unwrap() error { return errAntigravitySignIn }

// refreshAntigravity exchanges the refresh token for a new access token.
func refreshAntigravity(ctx context.Context, current antigravityCredential, transport http.RoundTripper) (antigravityCredential, error) {
	var empty antigravityCredential
	source := antigravityOAuth("").TokenSource(antigravityOAuthContext(ctx, transport), &oauth2.Token{RefreshToken: current.RefreshToken})
	token, err := source.Token()
	if err != nil {
		var retrieve *oauth2.RetrieveError
		if errors.As(err, &retrieve) && slices.Contains(antigravityRejections, retrieve.ErrorCode) {
			return empty, &antigravityRejection{code: retrieve.ErrorCode}
		}
		return empty, errors.New("Google token refresh failed: " + antigravityOAuthFailure(err, current.RefreshToken, current.AccessToken))
	}
	updated := current
	updated.AccessToken, updated.RefreshToken, updated.Rejected = token.AccessToken, token.RefreshToken, ""
	// Whole seconds, so the expiry reads back from the store as it was written.
	updated.ExpiresAt = token.Expiry.UTC().Truncate(time.Second)
	if !strings.EqualFold(token.Type(), "Bearer") || !updated.valid() || !updated.available(time.Now()) {
		return empty, errors.New("Google token refresh returned no usable access token")
	}
	return updated, nil
}
