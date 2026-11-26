package bee

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"github.com/tokhive/bee/beewire"
)

// An account record is how the desktop app knows an account it added: a
// stable id, where its sign-in comes from and what to show for it. Records
// live in accounts.json beside the device configuration and hold no
// credential.
type accountRecord struct {
	ID       string `json:"id"`
	Platform string `json:"platform"`
	// Source is "local" for the official client's own sign-in on this
	// machine, or "import" for a credential file copied into Bee's
	// accounts directory.
	Source      string    `json:"source"`
	Email       string    `json:"email,omitempty"`
	Plan        string    `json:"plan,omitempty"`
	Fingerprint string    `json:"fingerprint,omitempty"`
	AddedAt     time.Time `json:"added_at"`
}

const (
	accountSourceLocal  = "local"
	accountSourceImport = "import"
)

type accountsFile struct {
	Accounts []accountRecord `json:"accounts"`
}

func accountsPath(configPath string) string {
	return filepath.Join(filepath.Dir(configPath), "accounts.json")
}

// importDirectory holds an imported account's copy of its credential file.
func importDirectory(configPath, id string) string {
	return filepath.Join(filepath.Dir(configPath), "accounts", id)
}

func newAccountID() string {
	raw := make([]byte, 8)
	rand.Read(raw)
	return "acc_" + hex.EncodeToString(raw)
}

func readAccounts(configPath string) ([]accountRecord, error) {
	path := accountsPath(configPath)
	file, err := openRegularNoFollow(path)
	if errors.Is(err, os.ErrNotExist) {
		return []accountRecord{}, nil
	}
	if err != nil {
		return nil, err
	}
	defer file.Close()
	if err := validatePrivateFile(file); err != nil {
		return nil, err
	}
	var stored accountsFile
	decoder := json.NewDecoder(io.LimitReader(file, 1<<20))
	if err := decoder.Decode(&stored); err != nil {
		return nil, fmt.Errorf("decode %s: %w", path, err)
	}
	if stored.Accounts == nil {
		stored.Accounts = []accountRecord{}
	}
	return stored.Accounts, nil
}

func writeAccounts(configPath string, records []accountRecord) error {
	raw, err := json.MarshalIndent(accountsFile{Accounts: records}, "", "  ")
	if err != nil {
		return err
	}
	return writePrivateFile(accountsPath(configPath), append(raw, '\n'), ".accounts-*")
}

// platformUpstreams are the upstreams an account of platform is served from.
func platformUpstreams(platform string) []string {
	field := map[string]string{"openai": "codex", "claude": "claude", beewire.GooglePlatform: "antigravity"}[platform]
	var targets []string
	for _, entry := range platformTargets {
		if entry.field == field {
			targets = append(targets, entry.target)
		}
	}
	return targets
}

// editEgress rewrites the egress configuration through edit, keeping every
// field it does not touch. A configuration left with no account source and no
// target is removed, since an empty one cannot be read back.
func editEgress(ctx context.Context, path string, edit func(fields map[string]json.RawMessage, targets []string) []string) error {
	fields := map[string]json.RawMessage{}
	if _, err := os.Lstat(path); err == nil {
		if _, err := readEgress(ctx, path); err != nil {
			return err
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		if err := json.Unmarshal(raw, &fields); err != nil {
			return err
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	var targets []string
	if raw, ok := fields["targets"]; ok {
		if err := json.Unmarshal(raw, &targets); err != nil {
			return err
		}
	}
	targets = edit(fields, targets)
	if len(targets) == 0 {
		delete(fields, "targets")
		if len(fields) == 0 || len(fields) == 1 && fields["connect_proxy"] != nil {
			if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
				return err
			}
			return nil
		}
	}
	encoded, err := json.Marshal(targets)
	if err != nil {
		return err
	}
	fields["targets"] = encoded
	raw, err := json.MarshalIndent(fields, "", "  ")
	if err != nil {
		return err
	}
	// Check the result reads back before it replaces anything.
	if _, err := decodeEgress(raw); err != nil {
		return err
	}
	return writePrivateFile(path, append(raw, '\n'), ".egress-*")
}

// addEgressSource adds a platform's account source to the egress file.
func addEgressSource(ctx context.Context, path, platform string, source any) error {
	encoded, err := json.Marshal(source)
	if err != nil {
		return err
	}
	return editEgress(ctx, path, func(fields map[string]json.RawMessage, targets []string) []string {
		switch platform {
		case "openai":
			fields["codex"] = encoded
			fields["capabilities"] = json.RawMessage(`{}`)
		case "claude":
			fields["claude"] = encoded
		case beewire.GooglePlatform:
			fields["antigravity"] = encoded
		}
		for _, target := range platformUpstreams(platform) {
			if !slices.Contains(targets, target) {
				targets = append(targets, target)
			}
		}
		return targets
	})
}

// removeEgressSource drops a platform's account source and its upstream.
func removeEgressSource(ctx context.Context, path, platform string) error {
	return editEgress(ctx, path, func(fields map[string]json.RawMessage, targets []string) []string {
		switch platform {
		case "openai":
			delete(fields, "codex")
			delete(fields, "capabilities")
		case "claude":
			delete(fields, "claude")
		case beewire.GooglePlatform:
			delete(fields, "antigravity")
		}
		upstreams := platformUpstreams(platform)
		return slices.DeleteFunc(targets, func(t string) bool { return slices.Contains(upstreams, t) })
	})
}

// maskEmail keeps the first character and the domain, for log lines.
func maskEmail(email string) string {
	local, domain, ok := strings.Cut(email, "@")
	if !ok || local == "" {
		return ""
	}
	return local[:1] + "***@" + domain
}
