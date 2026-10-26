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
	"os/user"
	"path/filepath"
	"regexp"
	"runtime"
	"time"

	"github.com/tokhive/tee/tee"
	"golang.org/x/text/unicode/norm"
)

var (
	errClaudeExpired             = errors.New("Claude access authorization has expired or is about to expire; update the login in Claude Code and retry")
	errClaudeSourceChanged       = errors.New("Claude Keychain authorization changed during the query; check again")
	errClaudeKeychainMissing     = errors.New("the specified Claude Code Keychain entry was not found; verify the configuration directory, login state, and system permissions")
	errClaudeKeychainUnavailable = errors.New("failed to read the Claude Code Keychain; verify system permissions and that the keychain is unlocked")
	claudeKeychainUsername       = regexp.MustCompile(`^[a-zA-Z0-9._-]+$`)
)

// Private fields prevent accidental serialization of local credential material.
type claudeCredential struct {
	secret            tee.Secret
	expiresAt         time.Time
	plan              string
	hasRefreshToken   bool
	hasInferenceScope bool
	hasProfileScope   bool
}

type claudeKeychain struct {
	service   string
	account   string
	directory string
}

// Match Claude Code 2.1.236: hash the NFC directory string without resolving paths.
func claudeKeychainService(configDir, secureDir string, secureSet bool) string {
	directory := configDir
	if secureSet {
		directory = secureDir
	}
	service := "Claude Code-credentials"
	if directory != "" {
		hash := sha256.Sum256([]byte(norm.NFC.String(directory)))
		service += "-" + hex.EncodeToString(hash[:4])
	}
	return service
}

func resolveClaudeKeychain(directory *string) claudeKeychain {
	secureDir, secureSet := os.LookupEnv("CLAUDE_SECURESTORAGE_CONFIG_DIR")
	if directory != nil {
		secureDir, secureSet = *directory, true
	}
	account := os.Getenv("USER")
	if account == "" {
		if current, err := user.Current(); err == nil {
			account = current.Username
		}
	}
	if !claudeKeychainUsername.MatchString(account) {
		account = "claude-code-user"
	}
	configDir, configSet := os.LookupEnv("CLAUDE_CONFIG_DIR")
	storageDir := configDir
	if secureSet {
		storageDir = secureDir
	}
	if secureSet && storageDir == "" || !secureSet && !configSet {
		home, _ := os.UserHomeDir()
		storageDir = filepath.Join(home, ".claude")
	}
	if storageDir == "" {
		storageDir = "."
	}
	return claudeKeychain{service: claudeKeychainService(configDir, secureDir, secureSet), account: account, directory: norm.NFC.String(storageDir)}
}

func (source claudeKeychain) readRaw(ctx context.Context) ([]byte, error) {
	if runtime.GOOS != "darwin" {
		return nil, errors.New("Claude Keychain authorization reading is supported only on macOS")
	}
	live, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	command := exec.CommandContext(live, "/usr/bin/security", "find-generic-password", "-a", source.account, "-w", "-s", source.service)
	var output credentialBuffer
	defer func() { clear(output.Bytes()) }()
	command.Stdout, command.Stderr = &output, io.Discard
	if err := command.Run(); err != nil {
		if live.Err() != nil {
			return nil, errors.New("Claude Keychain read was cancelled or timed out")
		}
		var exit *exec.ExitError
		if errors.As(err, &exit) && exit.ExitCode() == 44 {
			return nil, errClaudeKeychainMissing
		}
		return nil, errClaudeKeychainUnavailable
	}
	return bytes.Clone(bytes.TrimSpace(output.Bytes())), nil
}

func (source claudeKeychain) writeRaw(ctx context.Context, raw []byte) error {
	if runtime.GOOS != "darwin" {
		return errClaudeKeychainUnavailable
	}
	command, err := source.writeCommand(raw)
	if err != nil {
		return err
	}
	live, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	process := exec.CommandContext(live, "/usr/bin/security", "-i")
	process.Stdin = bytes.NewBufferString(command)
	process.Stdout, process.Stderr = io.Discard, io.Discard
	if process.Run() != nil {
		return errRefreshRecovery
	}
	return nil
}

func (source claudeKeychain) writeCommand(raw []byte) (string, error) {
	if !claudeKeychainUsername.MatchString(source.account) || !regexp.MustCompile(`^Claude Code-credentials(-[0-9a-f]{8})?$`).MatchString(source.service) || !json.Valid(raw) {
		return "", errRefreshRecovery
	}
	command := "add-generic-password -U -a \"" + source.account + "\" -s \"" + source.service + "\" -X \"" + hex.EncodeToString(raw) + "\"\n"
	// The official client uses 4032 bytes as security -i's input limit. Never fall back to secret argv.
	if len(command) > 4032 {
		return "", errors.New("Claude Keychain content exceeds the safe write limit; waiting for the official client to update credentials")
	}
	return command, nil
}

func parseClaudeCredential(raw []byte) (claudeCredential, error) {
	var stored struct {
		OAuth *struct {
			Access  string   `json:"accessToken"`
			Refresh string   `json:"refreshToken"`
			Expires int64    `json:"expiresAt"`
			Scopes  []string `json:"scopes"`
			Plan    string   `json:"subscriptionType"`
		} `json:"claudeAiOauth"`
	}
	if len(raw) > 65536 {
		return claudeCredential{}, &credentialError{kind: "size", detail: fmt.Sprintf("bytes=%d", len(raw))}
	}
	if err := json.Unmarshal(raw, &stored); err != nil {
		var syntax *json.SyntaxError
		var field *json.UnmarshalTypeError
		if errors.As(err, &syntax) {
			return claudeCredential{}, &credentialError{kind: "json", detail: fmt.Sprintf("offset=%d", syntax.Offset)}
		}
		if errors.As(err, &field) {
			return claudeCredential{}, &credentialError{kind: "json_type", detail: fmt.Sprintf("offset=%d; expected=%s", field.Offset, field.Type)}
		}
		return claudeCredential{}, &credentialError{kind: "json"}
	}
	if stored.OAuth == nil {
		return claudeCredential{}, &credentialError{kind: "oauth"}
	}
	auth := stored.OAuth
	secret := tee.Secret{Token: auth.Access, Header: "authorization", Scheme: "Bearer"}
	if auth.Access == "" {
		return claudeCredential{}, &credentialError{kind: "token_missing"}
	}
	if secret.Validate() != nil {
		return claudeCredential{}, &credentialError{kind: "token_format"}
	}
	if auth.Expires <= 0 || auth.Expires > 253402300799999 {
		return claudeCredential{}, &credentialError{kind: "expiry", detail: fmt.Sprintf("expiresAt=%d", auth.Expires)}
	}

	credential := claudeCredential{secret: secret, expiresAt: time.UnixMilli(auth.Expires), plan: "unknown", hasRefreshToken: auth.Refresh != ""}
	switch auth.Plan {
	case "free", "pro", "max", "team", "enterprise":
		credential.plan = auth.Plan
	}
	for _, scope := range auth.Scopes {
		credential.hasInferenceScope = credential.hasInferenceScope || scope == "user:inference"
		credential.hasProfileScope = credential.hasProfileScope || scope == "user:profile"
	}
	return credential, nil
}

func (c claudeCredential) available(now time.Time) bool {
	return now.Add(30 * time.Second).Before(c.expiresAt)
}

func claudeStatus(ctx context.Context, args []string, out io.Writer) error {
	flags := flag.NewFlagSet("bee claude-status", flag.ContinueOnError)
	flags.SetOutput(out)
	var directory *string
	flags.Func("claude-config-dir", "explicitly select the official credential directory, overriding the environment; empty selects the default", func(value string) error {
		directory = &value
		return nil
	})
	store := flags.String("store", defaultClaudeStore(), "authorization source: keychain (macOS) or file (.credentials.json)")
	verify := flags.Bool("verify", false, "read-only verification of official account identity using the current access token")
	capabilities := flags.Bool("capabilities", false, "read-only verification of official identity and subscription capabilities")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return errors.New("claude-status accepts no extra arguments")
	}
	source, err := resolveClaudeStore(*store, directory)
	if err != nil {
		return err
	}
	if *capabilities {
		return inspectClaudeCapabilities(ctx, source.read, nil, out)
	}
	return inspectClaude(ctx, source.kind, source.read, *verify, nil, out)
}

func inspectClaude(ctx context.Context, store string, read func(context.Context) (claudeCredential, error), verify bool, transport http.RoundTripper, out io.Writer) error {
	credential, err := read(ctx)
	if err != nil {
		return err
	}
	state := "available"
	if !credential.available(time.Now()) {
		state = "expired"
	} else if !credential.hasInferenceScope {
		state = "missing_inference_scope"
	}
	status := map[string]any{
		"source": store, "status": state, "plan": credential.plan,
		"expires_at":            credential.expiresAt.UTC().Format(time.RFC3339),
		"refresh_token_present": credential.hasRefreshToken,
		"inference_scope":       credential.hasInferenceScope, "profile_scope": credential.hasProfileScope,
		"validation": "local_structure_only",
	}
	if verify {
		identity, err := queryClaudeProfile(ctx, credential, transport)
		if err != nil {
			return err
		}
		current, err := read(ctx)
		if err != nil || current != credential {
			return errClaudeSourceChanged
		}
		if !current.available(time.Now()) {
			return errClaudeExpired
		}
		status["validation"] = "official_profile_verified"
		status["account_fingerprint"] = identity.fingerprint()
	}
	return json.NewEncoder(out).Encode(status)
}
