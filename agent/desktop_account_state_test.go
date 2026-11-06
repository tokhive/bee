package bee

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestDesktopAccountStateMigrationPreservesPrivateBackup(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ai-accounts.json")
	raw := []byte(`{"version":1,"revision":7,"entries":{"` + strings.Repeat("a", 64) + `":{"first_seen":"2026-10-26T00:00:00Z","notified":true}}}`)
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	s, err := readDesktopAccountState(path)
	if err != nil {
		t.Fatal(err)
	}
	if err = saveDesktopAccountState(path, s, 7); err != nil {
		t.Fatal(err)
	}
	s, err = readDesktopAccountState(path)
	if err != nil || s.Version != 3 || s.Revision != 8 || !s.Entries[strings.Repeat("a", 64)].Notified {
		t.Fatalf("migration did not retain notices in v3: version=%d revision=%d err=%v", s.Version, s.Revision, err)
	}
	backup, err := os.ReadFile(path + ".v1.bak")
	if err != nil || !bytes.Equal(backup, raw) {
		t.Fatalf("original migration backup not preserved: %v", err)
	}
	f, err := openRegularNoFollow(path + ".v1.bak")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := validatePrivateFile(f); err != nil {
		t.Fatal(err)
	}
}

func TestDesktopAccountStateBackupFailurePreservesOriginal(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ai-accounts.json")
	raw := []byte(`{"version":1,"revision":0,"entries":{}}`)
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(path+".v1.bak", 0700); err != nil {
		t.Fatal(err)
	}
	s, err := readDesktopAccountState(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := saveDesktopAccountState(path, s, 0); err == nil {
		t.Fatal("migration proceeded without protected backup")
	}
	after, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(after, raw) {
		t.Fatal("failed migration modified original")
	}
}

func TestDesktopAccountStateV2ScopeValidation(t *testing.T) {
	for _, scenario := range []string{"valid", "wrong_scope", "null_selections", "missing_clean", "active_and_clean", "unknown_field", "case_alias"} {
		t.Run(scenario, func(t *testing.T) {
			session := map[string]any{"run_id": "", "active": false, "clean": true}
			scope := map[string]any{"hive": "https://hive.example", "owner_id": "owner", "device_id": "device", "selections": map[string]any{}, "pending_operations": map[string]any{}, "runtime_intent": map[string]any{"running": false, "resume_platforms": []string{}}, "session": session}
			identity, _ := json.Marshal([]string{"https://hive.example", "owner", "device"})
			hash := sha256.Sum256(identity)
			key := hex.EncodeToString(hash[:])
			switch scenario {
			case "wrong_scope":
				scope["owner_id"] = "different"
			case "null_selections":
				scope["selections"] = nil
			case "missing_clean":
				delete(session, "clean")
			case "active_and_clean":
				session["active"] = true
				session["run_id"] = strings.Repeat("a", 32)
			case "unknown_field":
				scope["token"] = "synthetic-SECRET"
			case "case_alias":
				session["active"], session["clean"], session["run_id"] = true, false, strings.Repeat("a", 32)
			}
			raw, _ := json.Marshal(map[string]any{"version": 2, "revision": 1, "entries": map[string]any{}, "scopes": map[string]any{key: scope}})
			if scenario == "case_alias" {
				raw = bytes.Replace(raw, []byte(`"clean":false`), []byte(`"clean":false,"Active":false,"Clean":true`), 1)
			}
			path := filepath.Join(t.TempDir(), "ai-accounts.json")
			if err := os.WriteFile(path, raw, 0600); err != nil {
				t.Fatal(err)
			}
			_, err := readDesktopAccountState(path)
			if scenario == "valid" && err != nil {
				t.Fatalf("valid scoped v2 state rejected: %v", err)
			}
			if scenario != "valid" && err == nil {
				t.Fatal("unsafe scoped state accepted")
			}
			if err != nil && strings.Contains(err.Error(), "synthetic-SECRET") {
				t.Fatal("invalid state leaked secret")
			}
			after, _ := os.ReadFile(path)
			if !bytes.Equal(after, raw) {
				t.Fatal("read rewrote stored state")
			}
		})
	}
}

func TestDesktopAccountStateSelectionAndIntentRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ai-accounts.json")
	state, err := readDesktopAccountState(path)
	if err != nil {
		t.Fatal(err)
	}
	identity := desktopSupplyIdentity()
	scope := newDesktopAccountScope(localState{Hive: "https://hive.example", Identity: &identity})
	dir := t.TempDir()
	scope.Selections["openai"] = desktopAccountSelection{Source: DesktopAccountSource{Directory: &dir, Store: "file"}, Fingerprint: strings.Repeat("a", 64), CredentialRevision: strings.Repeat("b", 64), Revision: 1}
	scope.RuntimeIntent = desktopRuntimeIntent{Running: true, ResumePlatforms: []string{"openai"}}
	scope.Session = desktopSessionMarker{RunID: strings.Repeat("c", 32), Active: true, Clean: false}
	scope.PendingOperations["openai"] = desktopPendingOperation{ID: strings.Repeat("d", 48), Kind: "confirm_change", Stage: "submitted", Source: scope.Selections["openai"].Source, FromFingerprint: strings.Repeat("a", 64), FromGeneration: 1, ToFingerprint: strings.Repeat("e", 64), CredentialRevision: strings.Repeat("f", 64), ConfirmationID: "synthetic-confirmation-private", StartedAt: time.Now().UTC()}
	key := desktopScopeKey(scope.Hive, scope.OwnerID, scope.DeviceID)
	state.Scopes[key] = scope
	if err := saveDesktopAccountState(path, state, 0); err != nil {
		t.Fatal(err)
	}
	loaded, err := readDesktopAccountState(path)
	if err != nil {
		t.Fatal(err)
	}
	got := loaded.Scopes[key]
	if !got.RuntimeIntent.Running || !got.Session.Active || got.Session.Clean || got.Selections["openai"].Fingerprint != strings.Repeat("a", 64) {
		t.Fatal("selection or crash marker lost across reload")
	}
	if pending := got.PendingOperations["openai"]; pending.Stage != "submitted" || pending.ConfirmationID != "synthetic-confirmation-private" || pending.FromGeneration != 1 || pending.ToFingerprint != strings.Repeat("e", 64) {
		t.Fatal("pending confirmation provenance lost across reload")
	}
	original, _ := os.ReadFile(path)
	for _, scenario := range []string{"missing_selection", "ambiguous_source", "stale_revision", "unsafe_revision"} {
		t.Run(scenario, func(t *testing.T) {
			next, err := readDesktopAccountState(path)
			if err != nil {
				t.Fatal(err)
			}
			s := next.Scopes[key]
			expected := next.Revision
			switch scenario {
			case "missing_selection":
				s.RuntimeIntent.ResumePlatforms = []string{"claude"}
			case "ambiguous_source":
				selection := s.Selections["openai"]
				selection.Source.Store = "auto"
				s.Selections["openai"] = selection
			case "stale_revision":
				expected--
			case "unsafe_revision":
				selection := s.Selections["openai"]
				selection.Revision = desktopMaxRevision + 1
				s.Selections["openai"] = selection
			}
			next.Scopes[key] = s
			if err := saveDesktopAccountState(path, next, expected); err == nil {
				t.Fatal("unsafe replacement accepted")
			}
			after, _ := os.ReadFile(path)
			if !bytes.Equal(after, original) {
				t.Fatal("rejected replacement changed original state")
			}
		})
	}
}

func TestDesktopAccountsState(t *testing.T) {
	for _, scenario := range []string{"absent", "private", "permission", "symlink", "version", "duplicate", "corrupt", "missing", "null"} {
		t.Run(scenario, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "ai-accounts.json")
			raw := `{"version":1,"revision":0,"entries":{}}`
			switch scenario {
			case "version":
				raw = `{"version":99,"revision":0,"entries":{}}`
			case "duplicate":
				raw = `{"version":1,"version":1,"revision":0,"entries":{}}`
			case "corrupt":
				raw = `{"secret":"synthetic-SECRET"`
			case "missing":
				raw = `{"version":1,"entries":{}}`
			case "null":
				raw = `{"version":1,"revision":null,"entries":{}}`
			}
			if scenario != "absent" {
				if err := os.WriteFile(path, []byte(raw), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "permission" {
				if err := os.Chmod(path, 0644); err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "symlink" {
				if err := os.Rename(path, path+".real"); err != nil {
					t.Fatal(err)
				}
				if err := os.Symlink(path+".real", path); err != nil {
					t.Fatal(err)
				}
			}
			state, err := readDesktopAccountState(path)
			if scenario != "absent" && scenario != "private" {
				if err == nil {
					t.Fatal("unsafe state accepted")
				}
				after, _ := os.ReadFile(path)
				if string(after) != raw {
					t.Fatal("damaged state overwritten")
				}
				if strings.Contains(err.Error(), "synthetic-SECRET") {
					t.Fatal("state secret leaked")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			state.Entries[strings.Repeat("a", 64)] = desktopAccountNotice{FirstSeen: time.Now().UTC(), Notified: true}
			if err := saveDesktopAccountState(path, state, 0); err != nil {
				t.Fatal(err)
			}
			loaded, err := readDesktopAccountState(path)
			if err != nil || loaded.Revision != 1 || len(loaded.Entries) != 1 {
				t.Fatalf("readback=%+v err=%v", loaded, err)
			}
			if err := saveDesktopAccountState(path, state, 0); err == nil {
				t.Fatal("stale revision overwrote state")
			}
			info, _ := os.Stat(path)
			if info.Mode().Perm() != 0600 {
				t.Fatal("state permissions")
			}
		})
	}
}

func TestDesktopAccountsIssues(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ai-accounts.json")
	now := time.Now().UTC()
	key := desktopNoticeKey("https://hive.example", "owner", "openai", strings.Repeat("a", 64), "offline")
	for _, step := range []struct {
		seconds int
		active  bool
		notify  bool
	}{{0, true, false}, {59, true, false}, {60, true, true}, {61, true, false}, {62, false, false}, {63, true, false}, {123, true, true}} {
		notify, err := updateDesktopAccountNotice(path, key, now.Add(time.Duration(step.seconds)*time.Second), step.active, 60*time.Second)
		if err != nil || notify != step.notify {
			t.Fatalf("step=%+v notify=%t err=%v", step, notify, err)
		}
	}
	// Same owner/platform/account is deduplicated after process recreation;
	// device is intentionally absent from this owner-level notification key.
	notify, err := updateDesktopAccountNotice(path, key, now.Add(124*time.Second), true, time.Minute)
	if err != nil || notify {
		t.Fatal("restart repeated reminder")
	}
	if key == desktopNoticeKey("https://other.example", "owner", "openai", strings.Repeat("a", 64), "offline") {
		t.Fatal("Hive scope collapsed")
	}
	if key == desktopNoticeKey("https://hive.example", "other", "openai", strings.Repeat("a", 64), "offline") {
		t.Fatal("owner scope collapsed")
	}
	if desktopNoticeKey("hive", "owner", "openai", "", "offline") != "" {
		t.Fatal("unknown fingerprint merged")
	}
}

func TestDesktopAccountsIssuesStorageFailureKeepsProblems(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "ai-accounts.json"), []byte(`{`), 0600); err != nil {
		t.Fatal(err)
	}
	a := NewDesktopAccounts(nil)
	p := a.platforms["openai"]
	a.accountIssues(p, "openai", filepath.Join(dir, "device.json"), desktopAccountBinding{hive: "https://hive.example", owner: "owner", device: "device", fingerprint: strings.Repeat("a", 64)}, []string{"authorization_rejected", "quota_exhausted"}, true)
	codes := map[string]bool{}
	for _, issue := range p.snapshot.Issues {
		codes[issue.Code] = true
	}
	if !codes["authorization_rejected"] || !codes["quota_exhausted"] || !codes["notice_storage_unconfirmed"] {
		t.Fatalf("persistence failure hid active problems: %v", p.snapshot.Issues)
	}
}

func TestDesktopAccountsIssuesUnknownAndStaleDoNotRecover(t *testing.T) {
	for _, status := range []string{"unknown", "stale", "rate_limited"} {
		t.Run(status, func(t *testing.T) {
			dir := t.TempDir()
			path := filepath.Join(dir, "ai-accounts.json")
			fp := strings.Repeat("a", 64)
			key := desktopNoticeKey("https://hive.example", "owner", "openai", fp, "quota_exhausted")
			now := time.Now()
			if _, err := updateDesktopAccountNotice(path, key, now, true, 0); err != nil {
				t.Fatal(err)
			}
			a := NewDesktopAccounts(nil)
			p := a.platforms["openai"]
			p.snapshot.Hive.State = "ready"
			p.snapshot.Capabilities[1].Status = status
			a.accountIssues(p, "openai", filepath.Join(dir, "device.json"), desktopAccountBinding{hive: "https://hive.example", owner: "owner", device: "device", fingerprint: fp}, nil, true)
			state, err := readDesktopAccountState(path)
			if err != nil || !state.Entries[key].Notified {
				t.Fatalf("%s cleared quota problem without recovery: %+v %v", status, state, err)
			}
		})
	}
}
