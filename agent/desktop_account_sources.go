package bee

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"time"
	"unicode"
	"unicode/utf8"
)

type desktopAccountRead struct {
	source      DesktopAccountSource
	fingerprint *string
	plan        string
	expires     time.Time
	revision    string
	namespace   string
	codex       codexCredential
	claude      claudeCredential
}

func (r *desktopAccountRead) clear() {
	clear(r.codex.raw)
	r.codex = codexCredential{}
	r.claude = claudeCredential{}
}
func validateDesktopAccountDirectory(directory *string) error {
	if directory == nil {
		return nil
	}
	if *directory == "" || len(*directory) > 4096 || !utf8.ValidString(*directory) || !filepath.IsAbs(*directory) {
		return fmt.Errorf("account directory rejected: bytes=%d, absolute=%t; required=null or nonempty absolute path <=4096 UTF-8 bytes", len(*directory), filepath.IsAbs(*directory))
	}
	for _, char := range *directory {
		if unicode.IsControl(char) {
			return fmt.Errorf("account directory rejected: control_codepoint=%d; control characters are forbidden", char)
		}
	}
	return nil
}
func validateDesktopAccountDetect(r DesktopAccountDetectRequest) error {
	if err := validateDesktopAccountDirectory(r.Directory); err != nil {
		return err
	}
	if r.Mode != "local" && r.Mode != "official" {
		return accountFailure(r.Platform, "invalid_mode", "mode", "required=local,official")
	}
	if r.Platform == "openai" && (r.Store == "auto" || r.Store == "file" || r.Store == "keyring") || r.Platform == "claude" && (r.Store == "file" || r.Store == "keychain") {
		return nil
	}
	return accountFailure("unknown", "invalid_source", "platform_store", "required=openai:auto,file,keyring or claude:file,keychain")
}

func (r DesktopAccountDetectRequest) Validate() error { return validateDesktopAccountDetect(r) }
func desktopCodexHome(directory *string) (string, error) {
	if directory != nil {
		return *directory, nil
	}
	if value := os.Getenv("CODEX_HOME"); value != "" {
		return value, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".codex"), nil
}
func (a *DesktopAccounts) Defaults(ctx context.Context) (DesktopAccountDefaults, error) {
	if err := ctx.Err(); err != nil {
		return DesktopAccountDefaults{}, accountFailure("unknown", "deadline", "defaults", "request context canceled")
	}
	home, err := desktopCodexHome(nil)
	if err != nil {
		return DesktopAccountDefaults{}, accountFailure("openai", "home_unavailable", "defaults", "user home directory unavailable")
	}
	if err := validateDesktopAccountDirectory(&home); err != nil {
		return DesktopAccountDefaults{}, err
	}
	claudeDirectory := resolveClaudeKeychain(nil).directory
	if err := validateDesktopAccountDirectory(&claudeDirectory); err != nil {
		return DesktopAccountDefaults{}, err
	}
	keyring := DesktopAccountStore{Store: "keyring", Supported: a.goos == "darwin"}
	if !keyring.Supported {
		keyring.Reason = accountString("keyring_not_supported_on_this_os")
	}
	keychain := DesktopAccountStore{Store: "keychain", Supported: a.goos == "darwin"}
	if !keychain.Supported {
		keychain.Reason = accountString("keychain_not_supported_on_this_os")
	}
	claudeStore := "file"
	if a.goos == "darwin" {
		claudeStore = "keychain"
	}
	return DesktopAccountDefaults{Platforms: []DesktopAccountDefault{
		{Platform: "openai", Directory: home, DefaultStore: "auto", Stores: []DesktopAccountStore{{Store: "auto", Supported: true}, {Store: "file", Supported: true}, keyring}},
		{Platform: "claude", Directory: claudeDirectory, DefaultStore: claudeStore, Stores: []DesktopAccountStore{{Store: "file", Supported: true}, keychain}},
	}}, nil
}
func accountSourceFailure(platform, check string, err error) *DesktopAccountError {
	code := "source_unavailable"
	if errors.Is(err, os.ErrNotExist) || errors.Is(err, errClaudeFileMissing) || errors.Is(err, errClaudeKeychainMissing) {
		code = "source_missing"
	}
	if errors.Is(err, os.ErrPermission) {
		code = "permission_denied"
	}
	result := accountFailure(platform, code, check, "official source could not be read; check source selection and system permissions")
	result.Evidence["not_found"] = strconv.FormatBool(errors.Is(err, os.ErrNotExist))
	result.Evidence["permission_denied"] = strconv.FormatBool(errors.Is(err, os.ErrPermission))
	var pathErr *os.PathError
	if errors.As(err, &pathErr) {
		result.Evidence["os_error"] = pathErr.Err.Error()
	} else {
		result.Evidence["cause"] = err.Error()
	}
	return result
}
func (a *DesktopAccounts) readAccountSource(ctx context.Context, request DesktopAccountDetectRequest) (desktopAccountRead, *DesktopAccountError) {
	var result desktopAccountRead
	if err := ctx.Err(); err != nil {
		return result, accountFailure(request.Platform, "deadline", "source_read", "request context canceled")
	}
	if request.Platform == "openai" {
		home, err := desktopCodexHome(request.Directory)
		if err != nil {
			return result, accountSourceFailure(request.Platform, "home_directory", err)
		}
		if err := validateDesktopAccountDirectory(&home); err != nil {
			return result, accountFailure(request.Platform, "invalid_directory", "source_directory", "resolved default must be a valid absolute directory")
		}
		if canonical, err := filepath.EvalSymlinks(home); err == nil {
			home = canonical
		}
		store := request.Store
		if store == "auto" {
			store = "file"
		}
		var raw []byte
		if store == "file" {
			raw, err = readCodexFile(filepath.Join(home, "auth.json"))
			if request.Store == "auto" && errors.Is(err, os.ErrNotExist) && a.goos == "darwin" {
				store = "keyring"
				raw, err = a.readKeyring(ctx, home)
			}
		} else if a.goos == "darwin" {
			raw, err = a.readKeyring(ctx, home)
		} else {
			return result, accountFailure(request.Platform, "unsupported_store", "source_os", "keyring requires macOS")
		}
		defer clear(raw)
		if err != nil {
			return result, accountSourceFailure(request.Platform, "read_"+store, err)
		}
		credential, err := parseCodexCredential(raw)
		if err != nil {
			failure := accountFailure(request.Platform, "invalid_credentials", "parse_credential", err.Error())
			failure.Evidence["parsed"] = "false"
			return result, failure
		}
		identity := sha256.Sum256([]byte(credential.AccountID + "\x00" + credential.UserID))
		revision := sha256.Sum256([]byte(credential.Secret.Token))
		result = desktopAccountRead{source: DesktopAccountSource{Directory: &home, Store: store}, fingerprint: accountString(hex.EncodeToString(identity[:])), plan: credential.Plan, expires: credential.ExpiresAt, revision: hex.EncodeToString(revision[:]), codex: credential}
	} else {
		if request.Store == "keychain" && a.goos != "darwin" {
			return result, accountFailure(request.Platform, "unsupported_store", "source_os", "keychain requires macOS")
		}
		store, err := resolveClaudeStore(request.Store, request.Directory)
		if err != nil {
			return result, accountSourceFailure(request.Platform, "resolve_claude", err)
		}
		if err := validateDesktopAccountDirectory(&store.directory); err != nil {
			return result, accountFailure(request.Platform, "invalid_directory", "source_directory", "resolved default must be a valid absolute directory")
		}
		credential, err := store.read(ctx)
		if err != nil {
			return result, accountSourceFailure(request.Platform, "read_"+request.Store, err)
		}
		revision := sha256.Sum256([]byte(credential.secret.Token))
		// Keep null for the default namespace; replacing it with its directory changes Keychain identity.
		result = desktopAccountRead{source: DesktopAccountSource{Directory: request.Directory, Store: request.Store}, namespace: store.namespace, plan: credential.plan, expires: credential.expiresAt, revision: hex.EncodeToString(revision[:]), claude: credential}
	}
	return result, nil
}
