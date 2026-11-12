package bee

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/sha256"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/tee/tee"
)

type claudeStoredCredential struct {
	claudeCredential
	raw             []byte
	refresh, client string
	scopes          []string
}

type claudeMaintenance struct {
	directory, namespace string
	readRaw              func(context.Context) ([]byte, error)
	writeRaw             func(context.Context, []byte) error
	validateWrite        func([]byte) error
	transport            http.RoundTripper
	remembered           beewire.Authorization
	rememberedAt         time.Time
}

// rememberInterval bounds how long remember trusts that the binding it last
// wrote still describes the store.
//
// The binding is written on every synchronization cycle, and each write costs
// a second read of the credential store — a keychain subprocess on macOS,
// twice every two seconds for an authorization that changes perhaps daily.
// Almost all of that work ends at the equality check further down, having
// already paid for the read.
//
// An authorization identifies the access token, so an unchanged one means an
// unchanged binding in every case the official client actually produces: it
// rewrites the whole credential when it refreshes, rotating both tokens. The
// interval covers the case that assumption does not: a store rewritten with
// the same access token and a different refresh token leaves the recorded
// digest stale, and the offline recovery path refuses a binding whose digest
// disagrees. A minute bounds how long that can last, against a loop that
// would otherwise re-read thirty times in the same span.
const rememberInterval = time.Minute

type claudeBinding struct {
	Authorization beewire.Authorization `json:"authorization"`
	RefreshDigest string                `json:"refresh_digest"`
}

func claudeDigest(value string) string {
	hash := sha256.Sum256([]byte(value))
	return hex.EncodeToString(hash[:])
}

func (c claudeCredential) metadata(identity claudeIdentity) beewire.Authorization {
	return beewire.Authorization{AccountID: identity.organization, AccountFingerprint: identity.fingerprint(), CredentialRevision: claudeDigest(c.secret.Token), ExpiresAt: c.expiresAt}
}

func (m *claudeMaintenance) path(kind string) string {
	return filepath.Join(m.directory, ".bee-claude-"+kind+"-"+claudeDigest(m.namespace)[:16]+".json")
}

func (m *claudeMaintenance) read(ctx context.Context) (claudeStoredCredential, error) {
	raw, err := m.readRaw(ctx)
	if err != nil {
		return claudeStoredCredential{}, err
	}
	credential, err := parseClaudeCredential(raw)
	var stored struct {
		OAuth struct {
			Refresh string   `json:"refreshToken"`
			Client  string   `json:"clientId"`
			Scopes  []string `json:"scopes"`
		} `json:"claudeAiOauth"`
	}
	if err != nil || json.Unmarshal(raw, &stored) != nil {
		clear(raw)
		return claudeStoredCredential{}, errRefreshRecovery
	}
	return claudeStoredCredential{claudeCredential: credential, raw: raw, refresh: stored.OAuth.Refresh, client: stored.OAuth.Client, scopes: stored.OAuth.Scopes}, nil
}

func (m *claudeMaintenance) remember(ctx context.Context, credential claudeCredential, auth beewire.Authorization) error {
	if m.remembered == auth && time.Since(m.rememberedAt) < rememberInterval {
		return nil
	}
	current, err := m.read(ctx)
	defer clear(current.raw)
	if err != nil || current.claudeCredential != credential {
		return errClaudeSourceChanged
	}
	if os.MkdirAll(m.directory, 0700) != nil {
		return errRefreshRecovery
	}
	value := claudeBinding{Authorization: auth, RefreshDigest: claudeDigest(current.refresh)}
	raw, _ := json.Marshal(value)
	if previous, err := readCodexFile(m.path("binding")); err == nil && bytes.Equal(previous, raw) {
		m.remembered, m.rememberedAt = auth, time.Now()
		return nil
	}
	if err := privateReplace(m.path("binding"), raw); err != nil {
		return err
	}
	m.remembered, m.rememberedAt = auth, time.Now()
	return nil
}

// This binding permits only maintenance of the exact previously verified source.
// It cannot validate a new token or authorize dispatch with an expired token.
func (m *claudeMaintenance) binding(ctx context.Context) (claudeCredential, beewire.Authorization, error) {
	current, err := m.read(ctx)
	defer clear(current.raw)
	if err != nil {
		return claudeCredential{}, beewire.Authorization{}, err
	}
	raw, err := readCodexFile(m.path("binding"))
	var binding claudeBinding
	if err != nil || json.Unmarshal(raw, &binding) != nil || !binding.Authorization.ValidMetadata() || binding.Authorization.CredentialRevision != claudeDigest(current.secret.Token) || !binding.Authorization.ExpiresAt.Equal(current.expiresAt) || binding.RefreshDigest != claudeDigest(current.refresh) || current.refresh == "" {
		return claudeCredential{}, beewire.Authorization{}, errors.New("Claude lacks a verified identity record for the current credentials; update the login in the official client first")
	}
	return current.claudeCredential, binding.Authorization, nil
}

func validClaudeMaintenanceKey(key tee.InboxPublic) bool {
	parsed, err := x509.ParsePKIXPublicKey(key.PublicKey)
	public, ok := parsed.(*ecdh.PublicKey)
	return err == nil && ok && public.Curve() == ecdh.X25519() && sha256.Sum256(key.PublicKey) == key.KeyID
}

func (m *claudeMaintenance) execute(ctx context.Context, task beewire.MaintenanceTask, auth beewire.Authorization) (claudeCredential, claudeIdentity, error) {
	var empty claudeCredential
	var identity claudeIdentity
	if task.ID == "" || task.Kind != "refresh_authorization" || task.Platform != "claude" || task.AccountFingerprint != auth.AccountFingerprint || task.CredentialRevision != auth.CredentialRevision || !validClaudeMaintenanceKey(task.Key) {
		return empty, identity, errRefreshRecovery
	}
	live, valid, release, err := lockClaudeRefresh(ctx, m.directory)
	if err != nil {
		return empty, identity, err
	}
	defer release()
	current, err := m.read(live)
	defer clear(current.raw)
	if err != nil || claudeDigest(current.secret.Token) != task.CredentialRevision || !current.expiresAt.Equal(auth.ExpiresAt) {
		return empty, identity, errClaudeSourceChanged
	}
	if current.refresh == "" {
		return empty, identity, errors.New("no local Claude refresh token; update the login in the official client")
	}
	if current.client != "" && !beewire.ValidCodexIdentity(current.client) || len(current.scopes) == 0 {
		return empty, identity, errRefreshRecovery
	}
	if m.validateWrite != nil {
		if err := m.validateWrite(current.raw); err != nil {
			return empty, identity, err
		}
	}
	journal, err := readRefreshJournal(m.path("maintenance"))
	if err != nil {
		return empty, identity, err
	}
	digest := claudeDigest(current.refresh)
	if journal.State == "started" && journal.Revision == task.CredentialRevision && journal.RefreshDigest == digest {
		return empty, identity, errRefreshRecovery
	}
	journal = refreshJournal{TaskID: task.ID, Revision: task.CredentialRevision, RefreshDigest: digest, State: "started"}
	if live.Err() != nil || !valid() {
		return empty, identity, errClaudeLock
	}
	if err = saveRefreshJournal(m.path("maintenance"), journal); err != nil {
		return empty, identity, err
	}
	updated, err := refreshClaude(live, current, m.transport)
	defer clear(updated.raw)
	if err != nil {
		return empty, identity, errRefreshRecovery
	}
	identity, err = queryClaudeProfile(live, updated.claudeCredential, m.transport)
	if err != nil || identity.fingerprint() != task.AccountFingerprint {
		return empty, claudeIdentity{}, errRefreshRecovery
	}
	storage, writing, err := lockClaudeDirectory(live, filepath.Join(m.directory, ".storage-write.lock"), 15*time.Second, 5*time.Second)
	if err != nil {
		return empty, identity, errRefreshRecovery
	}
	defer storage.release()
	latest, err := m.read(writing)
	defer clear(latest.raw)
	if err != nil || latest.refresh != current.refresh || latest.secret.Token != current.secret.Token || latest.client != current.client {
		return empty, identity, errClaudeSourceChanged
	}
	// Preserve unrelated current fields under the official storage lock.
	saved, err := mergeClaudeRefresh(latest.raw, updated.raw)
	defer clear(saved)
	if err != nil {
		return empty, identity, err
	}
	if writing.Err() != nil || !valid() || !storage.valid() {
		return empty, identity, errRefreshRecovery
	}
	if err = m.writeRaw(writing, saved); err != nil {
		return empty, identity, errRefreshRecovery
	}
	verified, err := m.read(writing)
	defer clear(verified.raw)
	if err != nil || verified.claudeCredential != updated.claudeCredential || verified.refresh != updated.refresh {
		return empty, identity, errRefreshRecovery
	}
	journal.State, journal.ResultRevision = "saved", claudeDigest(verified.secret.Token)
	if err = saveRefreshJournal(m.path("maintenance"), journal); err != nil {
		return empty, identity, err
	}
	if err = m.remember(writing, verified.claudeCredential, verified.metadata(identity)); err != nil {
		return empty, identity, err
	}
	return verified.claudeCredential, identity, nil
}

func mergeClaudeRefresh(current, refreshed []byte) ([]byte, error) {
	var root, next map[string]json.RawMessage
	var oauth, updated map[string]json.RawMessage
	if json.Unmarshal(current, &root) != nil || json.Unmarshal(refreshed, &next) != nil || json.Unmarshal(root["claudeAiOauth"], &oauth) != nil || oauth == nil || json.Unmarshal(next["claudeAiOauth"], &updated) != nil {
		return nil, errRefreshRecovery
	}
	for _, key := range []string{"accessToken", "refreshToken", "expiresAt", "refreshTokenExpiresAt", "scopes"} {
		if value, ok := updated[key]; ok {
			oauth[key] = value
		}
	}
	root["claudeAiOauth"], _ = json.Marshal(oauth)
	raw, err := json.Marshal(root)
	if err != nil || len(raw) > 65536 {
		return nil, errRefreshRecovery
	}
	return raw, nil
}

func refreshClaude(ctx context.Context, current claudeStoredCredential, transport http.RoundTripper) (claudeStoredCredential, error) {
	var empty claudeStoredCredential
	clientID := current.client
	if clientID == "" {
		clientID = "9d1c250a-e61b-44d9-88ed-5944d1962f5e"
	}
	if !beewire.ValidCodexIdentity(clientID) || len(current.scopes) == 0 {
		return empty, errRefreshRecovery
	}
	body, _ := json.Marshal(map[string]string{"grant_type": "refresh_token", "refresh_token": current.refresh, "client_id": clientID, "scope": strings.Join(current.scopes, " ")})
	defer clear(body)
	req, err := http.NewRequestWithContext(ctx, "POST", "https://platform.claude.com/v1/oauth/token", bytes.NewReader(body))
	if err != nil {
		return empty, errRefreshRecovery
	}
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Transport: transport, Timeout: 30 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return empty, errRefreshRecovery
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return empty, errRefreshRecovery
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, 65537))
	defer clear(raw)
	var tokens struct {
		Access         string  `json:"access_token"`
		Refresh        *string `json:"refresh_token"`
		Expires        int64   `json:"expires_in"`
		RefreshExpires *int64  `json:"refresh_token_expires_in"`
		Scope          string  `json:"scope"`
		Type           string  `json:"token_type"`
	}
	if err != nil || len(raw) > 65536 || json.Unmarshal(raw, &tokens) != nil || tokens.Access == "" || tokens.Access == current.secret.Token || tokens.Expires < 31 || tokens.Expires > 30*24*3600 || tokens.Refresh != nil && *tokens.Refresh == "" || tokens.Type != "" && !strings.EqualFold(tokens.Type, "Bearer") {
		return empty, errRefreshRecovery
	}
	refresh := current.refresh
	if tokens.Refresh != nil {
		refresh = *tokens.Refresh
	}
	scopes := strings.Fields(tokens.Scope)
	patch := map[string]any{"accessToken": tokens.Access, "refreshToken": refresh, "expiresAt": time.Now().Add(time.Duration(tokens.Expires) * time.Second).UnixMilli(), "scopes": scopes}
	if tokens.RefreshExpires != nil {
		if *tokens.RefreshExpires <= 0 || *tokens.RefreshExpires > 10*365*24*3600 {
			return empty, errRefreshRecovery
		}
		patch["refreshTokenExpiresAt"] = time.Now().Add(time.Duration(*tokens.RefreshExpires) * time.Second).UnixMilli()
	}
	changed, _ := json.Marshal(map[string]any{"claudeAiOauth": patch})
	defer clear(changed)
	saved, err := mergeClaudeRefresh(current.raw, changed)
	if err != nil {
		return empty, err
	}
	credential, err := parseClaudeCredential(saved)
	if err != nil || !credential.available(time.Now()) || !credential.hasInferenceScope || !credential.hasProfileScope {
		clear(saved)
		return empty, errRefreshRecovery
	}
	return claudeStoredCredential{claudeCredential: credential, raw: saved, refresh: refresh, client: current.client, scopes: scopes}, nil
}
