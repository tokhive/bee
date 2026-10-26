package bee

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

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
