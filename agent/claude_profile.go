package bee

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"
	"time"
)

type claudeIdentity struct {
	account      string
	organization string
}

var errClaudeProfileRejected = errors.New("official Claude rejected the current access authorization; update the login in Claude Code")

func claudeUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for i, c := range value {
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
		} else if !strings.ContainsRune("0123456789abcdefABCDEF", c) {
			return false
		}
	}
	return true
}

func (identity claudeIdentity) fingerprint() string {
	hash := sha256.Sum256([]byte("claude\x00" + identity.organization + "\x00" + identity.account))
	return hex.EncodeToString(hash[:])
}

// The endpoint is fixed; a transport is injectable only for synthetic tests.
func queryClaudeProfile(ctx context.Context, credential claudeCredential, transport http.RoundTripper) (claudeIdentity, error) {
	var empty claudeIdentity
	if !credential.available(time.Now()) {
		return empty, errClaudeExpired
	}
	if !credential.hasProfileScope {
		return empty, errors.New("Claude authorization lacks the user:profile scope; account identity cannot be verified")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.anthropic.com/api/oauth/profile", nil)
	if err != nil {
		return empty, errors.New("failed to create the Claude account verification request")
	}
	req.Header.Set("Authorization", "Bearer "+credential.secret.Token)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Cache-Control", "no-cache")
	client := &http.Client{Transport: transport, Timeout: 10 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return empty, errors.New("official Claude account verification failed or timed out")
	}
	defer res.Body.Close()
	switch res.StatusCode {
	case http.StatusOK:
	case http.StatusUnauthorized:
		return empty, errClaudeProfileRejected
	case http.StatusForbidden:
		return empty, errors.New("official Claude does not allow the current authorization to query account identity")
	case http.StatusTooManyRequests:
		return empty, errors.New("official Claude account query is restricted; try again later")
	default:
		return empty, errors.New("official Claude account verification did not succeed; account identity was not confirmed")
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 65537))
	if err != nil || len(raw) > 65536 {
		return empty, errors.New("failed to read official Claude account profile or profile is too large")
	}
	var profile struct {
		Account struct {
			UUID  string `json:"uuid"`
			Email string `json:"email"`
		} `json:"account"`
		Organization struct {
			UUID string `json:"uuid"`
		} `json:"organization"`
	}
	if json.Unmarshal(raw, &profile) != nil || !claudeUUID(profile.Account.UUID) || !claudeUUID(profile.Organization.UUID) || strings.TrimSpace(profile.Account.Email) == "" {
		return empty, errors.New("official Claude account profile is missing or has an invalid format")
	}
	return claudeIdentity{account: strings.ToLower(profile.Account.UUID), organization: strings.ToLower(profile.Organization.UUID)}, nil
}
