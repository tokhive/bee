package bee

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"testing"
	"time"

	"github.com/reclaimprotocol/reclaim-tee/tokenhive/tee"
	"github.com/tokhive/bee/beewire"
)

func claudeFileStore(t *testing.T, raw []byte) (claudeStore, string) {
	t.Helper()
	directory := t.TempDir()
	path := filepath.Join(directory, ".credentials.json")
	if raw != nil {
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
	}
	store, err := resolveClaudeStore(claudeStoreFile, &directory)
	if err != nil {
		t.Fatal(err)
	}
	return store, path
}

func TestClaudeFileStoreReadsTheOfficialFile(t *testing.T) {
	store, path := claudeFileStore(t, claudeSample(time.Now().Add(time.Hour)))
	if store.where != path || store.directory != filepath.Dir(path) {
		t.Fatalf("store at %q in %q", store.where, store.directory)
	}
	credential, err := store.read(context.Background())
	if err != nil || credential.secret.Token != "synthetic-claude-access" || credential.plan != "pro" || !credential.hasInferenceScope {
		t.Fatal("sign-in not read from .credentials.json", err)
	}

	missing, _ := claudeFileStore(t, nil)
	if _, err := missing.read(context.Background()); !errors.Is(err, errClaudeFileMissing) {
		t.Fatalf("missing file: %v", err)
	}

	// Claude Code refuses a symbolic link in place of the file, and so does Bee.
	linked, link := claudeFileStore(t, nil)
	if err := os.Symlink(path, link); err != nil {
		t.Fatal(err)
	}
	if _, err := linked.read(context.Background()); !errors.Is(err, errClaudeFileUnavailable) {
		t.Fatalf("symbolic link: %v", err)
	}
	if err := linked.writeRaw(context.Background(), claudeSample(time.Now())); err == nil {
		t.Fatal("wrote through a symbolic link")
	}
	if err := store.writeRaw(context.Background(), []byte("not json")); err == nil {
		t.Fatal("wrote an invalid credential")
	}
}

func TestClaudeStoreChoices(t *testing.T) {
	want := "file"
	if runtime.GOOS == "darwin" {
		want = "keychain"
	}
	if defaultClaudeStore() != want {
		t.Fatalf("default store on %s is %s", runtime.GOOS, defaultClaudeStore())
	}
	if _, err := resolveClaudeStore("plaintext", nil); err == nil {
		t.Fatal("unknown store accepted")
	} else if code, _, _, _ := Coded(err); code != "BEE-CONFIG-CLAUDE-STORE" {
		t.Fatal(err)
	}
	if runtime.GOOS != "darwin" {
		if _, err := resolveClaudeStore(claudeStoreKeychain, nil); err == nil {
			t.Fatal("Keychain accepted off macOS")
		} else if code, _, _, _ := Coded(err); code != "BEE-CLAUDE-UNSUPPORTED" {
			t.Fatal(err)
		}
	}
}

// A refresh Hive schedules saves the new sign-in where Claude Code reads it:
// the whole file replaced, private, with what Bee does not understand kept.
func TestClaudeRefreshSavesToTheCredentialsFile(t *testing.T) {
	store, path := claudeFileStore(t, claudeSample(time.Now().Add(time.Minute)))
	m := &claudeMaintenance{directory: store.directory, namespace: store.namespace, readRaw: store.readRaw, writeRaw: store.writeRaw, validateWrite: store.validateWrite}
	m.transport = claudeTransport(func(r *http.Request) (*http.Response, error) {
		if r.URL.String() == "https://api.anthropic.com/api/oauth/profile" {
			return claudeProfileResponse(200, claudeTestProfile), nil
		}
		return claudeProfileResponse(200, claudeRefreshResponse), nil
	})
	identity := claudeIdentity{account: "11111111-1111-4111-8111-111111111111", organization: "22222222-2222-4222-8222-222222222222"}
	current, err := m.read(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	auth := current.metadata(identity)
	if err = m.remember(context.Background(), current.claudeCredential, auth); err != nil {
		t.Fatal(err)
	}
	key, _ := tee.GenerateInboxKey()
	task := beewire.MaintenanceTask{ID: "claude-file-refresh", Kind: "refresh_authorization", Platform: "claude", DeviceID: "device", AccountGeneration: 1, AccountFingerprint: identity.fingerprint(), CredentialRevision: auth.CredentialRevision, KeyVersion: 1, Key: key.Public()}
	credential, _, err := m.execute(context.Background(), task, auth)
	if err != nil || credential.secret.Token != "synthetic-claude-new-access" {
		t.Fatal("refresh failed", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil || !bytes.Contains(raw, []byte("synthetic-claude-new-refresh")) || !bytes.Contains(raw, []byte("preserved-in-official-store")) {
		t.Fatalf("file after refresh: %v", err)
	}
	if info, _ := os.Lstat(path); info.Mode().Perm() != 0600 {
		t.Fatalf("file mode %v", info.Mode().Perm())
	}
}
