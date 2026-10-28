package bee

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/tee/tee"
)

type codexSource struct {
	Home           string `json:"home"`
	Store          string `json:"store"`
	KeyringBackend string `json:"keyring_backend,omitempty"`
	// transport carries the OAuth refresh; nil uses the process's proxy settings.
	transport http.RoundTripper
}

type codexCredential struct {
	Secret       tee.Secret
	AccountID    string
	UserID       string
	Plan         string
	ExpiresAt    time.Time
	Source       string
	refreshToken string
	raw          []byte
	path         string
}

func (c codexCredential) sameAuthorization(other codexCredential) bool {
	return c.Secret == other.Secret && c.AccountID == other.AccountID && c.UserID == other.UserID && c.Plan == other.Plan && c.ExpiresAt.Equal(other.ExpiresAt)
}

var errCodexExpired = errors.New("Codex access authorization has expired or is about to expire; update authorization in the official Codex client; the running Bee will synchronize automatically")
var errCodexKeyringUnsupported = errors.New("persistent Linux keyring access is not verified in this version; explicitly use the official file store instead of assuming authorization is unavailable")

func codexStatus(ctx context.Context, args []string, out io.Writer) error {
	flags := flag.NewFlagSet("bee codex-status", flag.ContinueOnError)
	flags.SetOutput(out)
	var source codexSource
	flags.StringVar(&source.Home, "codex-home", "", "official Codex configuration directory")
	flags.StringVar(&source.Store, "store", "", "authorization source: file, keyring, or auto")
	flags.StringVar(&source.KeyringBackend, "keyring-backend", "direct", "keyring backend: direct")
	queryCapabilities := flags.Bool("capabilities", false, "read-only query of official models and subscription limits")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("unexpected arguments")
	}
	report, err := readCodexStatus(ctx, source, *queryCapabilities)
	if err != nil {
		return err
	}
	return json.NewEncoder(out).Encode(report)
}

func readCodexStatus(ctx context.Context, source codexSource, queryCapabilities bool) (map[string]any, error) {
	credential, err := source.read(ctx)
	if err != nil {
		return nil, err
	}
	hash := sha256.Sum256([]byte(credential.AccountID + "\x00" + credential.UserID))
	status := map[string]any{"source": credential.Source, "account_fingerprint": hex.EncodeToString(hash[:]), "plan": credential.Plan, "expires_at": credential.ExpiresAt.UTC().Format(time.RFC3339), "validation": "local_structure_only"}
	if queryCapabilities {
		probe := &capabilitySource{home: source.Home, transport: source.transport}
		capabilities := probe.observe(ctx, credential, 1)
		current, err := source.read(ctx)
		if err != nil || !current.sameAuthorization(credential) {
			return nil, errors.New("official authorization source changed during query; check again")
		}
		status["capabilities"] = capabilities
		if probe.failure != "" {
			status["capabilities_unknown_reason"] = probe.failure
		}
	}
	return status, nil
}

func (source codexSource) read(ctx context.Context) (codexCredential, error) {
	credential, err := source.readForMaintenance(ctx)
	if err == nil && !time.Now().Add(30*time.Second).Before(credential.ExpiresAt) {
		return codexCredential{}, errCodexExpired
	}
	return credential, err
}

func (source codexSource) readForMaintenance(ctx context.Context) (codexCredential, error) {
	var empty codexCredential
	if source.Home == "" {
		return empty, errors.New("explicitly select the official Codex directory with --codex-home or the egress home setting")
	}
	if source.Store == "ephemeral" {
		return empty, errors.New("ephemeral authorization exists only inside the official Codex process and cannot be read by Bee; use the official file or direct keyring store")
	}
	if source.Store != "file" && source.Store != "keyring" && source.Store != "auto" {
		return empty, errors.New("explicitly choose the file, keyring, or auto authorization source and keep it consistent with the official client")
	}
	if source.KeyringBackend != "" && source.KeyringBackend != "direct" {
		return empty, errors.New("the Codex Secrets encryption backend is not supported; choose a readable file or direct keyring store in the official client")
	}
	home, err := filepath.Abs(source.Home)
	if err != nil {
		return empty, errors.New("invalid Codex configuration directory")
	}
	if canonical, err := filepath.EvalSymlinks(home); err == nil {
		home = canonical
	}
	var raw []byte
	selected := "file"
	if source.Store != "file" {
		raw, err = readCodexKeyring(ctx, home)
		if err == nil {
			selected = "keyring"
		} else if source.Store == "keyring" || errors.Is(err, errCodexKeyringUnsupported) {
			return empty, err
		}
	}
	if selected == "file" {
		raw, err = readCodexFile(filepath.Join(home, "auth.json"))
		if err != nil {
			return empty, err
		}
	}
	credential, err := parseCodexCredential(raw)
	if err != nil {
		return empty, err
	}
	credential.Source = selected
	credential.raw = raw
	credential.path = filepath.Join(home, "auth.json")
	return credential, nil
}

func readCodexFile(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		return nil, &credentialError{kind: "missing", detail: path}
	}
	if err != nil {
		return nil, &credentialError{kind: "read", detail: path, cause: err}
	}
	if !info.Mode().IsRegular() {
		return nil, &credentialError{kind: "regular", detail: fmt.Sprintf("%s; mode=%s", path, info.Mode())}
	}
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, &credentialError{kind: "read", detail: path, cause: err}
	}
	file := os.NewFile(uintptr(fd), path)
	defer file.Close()
	info, err = file.Stat()
	if err != nil {
		return nil, &credentialError{kind: "read", detail: path, cause: err}
	}
	if !info.Mode().IsRegular() {
		return nil, &credentialError{kind: "regular", detail: fmt.Sprintf("%s; mode=%s", path, info.Mode())}
	}
	raw, err := io.ReadAll(io.LimitReader(file, 65537))
	if err != nil {
		return nil, &credentialError{kind: "read", detail: path, cause: err}
	}
	if len(raw) > 65536 {
		return nil, &credentialError{kind: "size", detail: fmt.Sprintf("%s; bytes_read=%d", path, len(raw))}
	}
	return raw, nil
}

type credentialBuffer struct{ bytes.Buffer }

func (b *credentialBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > 65536 {
		return 0, errors.New("credential store response is too large")
	}
	return b.Buffer.Write(p)
}

func readCodexKeyring(ctx context.Context, home string) ([]byte, error) {
	if runtime.GOOS != "darwin" {
		return nil, errCodexKeyringUnsupported
	}
	hash := sha256.Sum256([]byte(home))
	account := "cli|" + hex.EncodeToString(hash[:])[:16]
	live, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	command := exec.CommandContext(live, "/usr/bin/security", "find-generic-password", "-s", "Codex Auth", "-a", account, "-w")
	var output credentialBuffer
	command.Stdout = &output
	command.Stderr = io.Discard
	if err := command.Run(); err != nil {
		return nil, errors.New("failed to read the Codex direct Keychain; verify the directory, login mode, and system permissions, or explicitly select file storage")
	}
	return bytes.TrimSpace(output.Bytes()), nil
}

type codexClaims struct {
	jwt.RegisteredClaims
	Auth struct {
		AccountID    string `json:"chatgpt_account_id"`
		UserID       string `json:"chatgpt_user_id"`
		LegacyUserID string `json:"user_id"`
		Plan         string `json:"chatgpt_plan_type"`
		FedRAMP      bool   `json:"chatgpt_account_is_fedramp"`
	} `json:"https://api.openai.com/auth"`
}

// These local claims only select an account and bound expiry; they are not verified attestation.
// The upstream must authenticate the token, and TEE receipts retain their separate full verification.
func parseCodexCredential(raw []byte) (codexCredential, error) {
	var empty codexCredential
	var auth struct {
		Mode        string          `json:"auth_mode"`
		APIKey      *string         `json:"OPENAI_API_KEY"`
		Agent       json.RawMessage `json:"agent_identity"`
		PAT         *string         `json:"personal_access_token"`
		Bedrock     json.RawMessage `json:"bedrock_api_key"`
		BedrockKeys json.RawMessage `json:"bedrock_access_keys"`
		Tokens      *struct {
			ID      string `json:"id_token"`
			Access  string `json:"access_token"`
			Refresh string `json:"refresh_token"`
			Account string `json:"account_id"`
		} `json:"tokens"`
	}
	if json.Unmarshal(raw, &auth) != nil {
		return empty, errors.New("invalid official Codex authorization JSON")
	}
	present := func(value json.RawMessage) bool { return len(value) > 0 && string(value) != "null" }
	if (auth.Mode != "" && auth.Mode != "chatgpt") || auth.APIKey != nil && *auth.APIKey != "" || auth.PAT != nil && *auth.PAT != "" || present(auth.Agent) || present(auth.Bedrock) || present(auth.BedrockKeys) || auth.Tokens == nil {
		return empty, errors.New("only official Codex ChatGPT authorization is accepted; API keys, PATs, agent identity, and proxy-specific formats are rejected")
	}
	tokens := auth.Tokens
	var identity, access codexClaims
	parser := jwt.NewParser()
	if _, _, err := parser.ParseUnverified(tokens.ID, &identity); err != nil {
		return empty, errors.New("invalid Codex ID token format")
	}
	if _, _, err := parser.ParseUnverified(tokens.Access, &access); err != nil {
		return empty, errors.New("invalid Codex access token format or expiration cannot be determined")
	}
	if access.ExpiresAt == nil {
		return empty, errCodexExpired
	}
	account := tokens.Account
	if account == "" {
		account = identity.Auth.AccountID
	}
	user := identity.Auth.UserID
	if user == "" {
		user = identity.Auth.LegacyUserID
	}
	if !beewire.ValidCodexIdentity(account) || !beewire.ValidCodexIdentity(user) || identity.Auth.AccountID != "" && identity.Auth.AccountID != account || access.Auth.AccountID != "" && access.Auth.AccountID != account || identity.Auth.UserID != "" && identity.Auth.LegacyUserID != "" && identity.Auth.UserID != identity.Auth.LegacyUserID || access.Auth.UserID != "" && access.Auth.UserID != user || access.Auth.LegacyUserID != "" && access.Auth.LegacyUserID != user {
		return empty, errors.New("Codex account identity is missing or inconsistent; verify the current account in the official client")
	}
	if identity.Auth.FedRAMP || access.Auth.FedRAMP {
		return empty, errors.New("Codex FedRAMP upstream is not configured")
	}
	if !beewire.KnownPlan("openai", identity.Auth.Plan) {
		return empty, errors.New("unknown Codex plan type; subscription supply cannot be confirmed")
	}
	secret := tee.Secret{Token: tokens.Access, Header: "authorization", Scheme: "Bearer"}
	if secret.Validate() != nil {
		return empty, errors.New("invalid Codex access credential format")
	}
	return codexCredential{Secret: secret, AccountID: account, UserID: user, Plan: identity.Auth.Plan, ExpiresAt: access.ExpiresAt.Time, refreshToken: tokens.Refresh}, nil
}

func (c codexCredential) metadata() beewire.CodexAuthorization {
	fingerprint := sha256.Sum256([]byte(c.AccountID + "\x00" + c.UserID))
	revision := sha256.Sum256([]byte(c.Secret.Token))
	return beewire.CodexAuthorization{AccountID: c.AccountID, AccountFingerprint: hex.EncodeToString(fingerprint[:]), CredentialRevision: hex.EncodeToString(revision[:]), ExpiresAt: c.ExpiresAt}
}
