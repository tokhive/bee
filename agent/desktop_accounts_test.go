package bee

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// 风险矩阵：默认加载零凭证读取；显式检测不写来源；非法目录及不可信
// 身份 fail closed；重复检测使旧候选失效；所有账号写操作零副作用。
func desktopCodexFixture(t *testing.T, expires time.Time) []byte {
	t.Helper()
	claims, _ := json.Marshal(map[string]any{"exp": expires.Unix(), "https://api.openai.com/auth": map[string]any{"chatgpt_account_id": "synthetic-account", "chatgpt_user_id": "synthetic-user", "chatgpt_plan_type": "plus"}})
	jwt := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"RS256","typ":"JWT"}`)) + "." + base64.RawURLEncoding.EncodeToString(claims) + ".c3ludGhldGlj"
	raw, _ := json.Marshal(map[string]any{"auth_mode": "chatgpt", "tokens": map[string]string{"id_token": jwt, "access_token": jwt, "refresh_token": "synthetic-refresh-SECRET", "account_id": "synthetic-account"}})
	return raw
}

func TestDesktopAccountsDefaults(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CODEX_HOME", dir)
	t.Setenv("CLAUDE_CONFIG_DIR", dir)
	a := NewDesktopAccounts(&DesktopDevice{path: filepath.Join(dir, "device.json")})
	defaults, err := a.Defaults(context.Background())
	if err != nil || len(defaults.Platforms) != 2 || defaults.Platforms[0].Directory != dir {
		t.Fatalf("defaults=%+v err=%v", defaults, err)
	}
	for _, platform := range []string{"openai", "claude"} {
		s, err := a.Snapshot(context.Background(), platform, false)
		if err != nil || s.Candidate.State != "not_checked" || s.Candidate.Reference != nil || s.CheckedAt != nil {
			t.Fatalf("snapshot=%+v err=%v", s, err)
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("passive loading created files: %v %v", entries, err)
	}
}

func TestDesktopAccountsDetect(t *testing.T) {
	for _, platform := range []string{"openai", "claude"} {
		for _, scenario := range []string{"valid", "expired", "missing", "corrupt", "symlink", "permission"} {
			t.Run(platform+"/"+scenario, func(t *testing.T) {
				dir := t.TempDir()
				name := "auth.json"
				if platform == "claude" {
					name = ".credentials.json"
				}
				expiry := time.Now().Add(time.Hour)
				if scenario == "expired" {
					expiry = time.Now().Add(30 * time.Second)
				}
				raw := desktopCodexFixture(t, expiry)
				if platform == "claude" {
					raw = claudeSample(expiry)
				}
				if scenario == "corrupt" {
					raw = []byte(`{"synthetic-SECRET":`)
				}
				path := filepath.Join(dir, name)
				if scenario != "missing" {
					if err := os.WriteFile(path, raw, 0600); err != nil {
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
				if scenario == "permission" {
					if err := os.Chmod(path, 0000); err != nil {
						t.Fatal(err)
					}
					defer os.Chmod(path, 0600)
				}
				a := NewDesktopAccounts(nil)
				s, err := a.Detect(context.Background(), DesktopAccountDetectRequest{Platform: platform, Directory: &dir, Store: "file", Mode: "local"})
				if err != nil {
					t.Fatal(err)
				}
				if scenario == "valid" {
					if s.Candidate.State != "available" || s.Candidate.Reference == nil || s.Candidate.IdentityVerified {
						t.Fatalf("candidate=%+v", s.Candidate)
					}
					if (s.Candidate.Fingerprint == nil) != (platform == "claude") {
						t.Fatal("local fingerprint trust mismatch")
					}
				} else if s.Candidate.Reference != nil || s.Candidate.Error == nil {
					t.Fatalf("failure accepted: %+v", s.Candidate)
				}
				public, _ := json.Marshal(s)
				for _, secret := range []string{"synthetic-SECRET", "synthetic-refresh-SECRET", "synthetic-claude-access", "synthetic-account", "c3ludGhldGlj"} {
					if strings.Contains(string(public), secret) {
						t.Fatal("secret in public DTO")
					}
				}
				if scenario == "valid" {
					after, _ := os.ReadFile(path)
					if string(after) != string(raw) {
						t.Fatal("source modified")
					}
				}
			})
		}
	}
	t.Run("directory validation", func(t *testing.T) {
		for _, directory := range []string{"", "relative", "/tmp/a\n", "/tmp/a\x00", "/" + strings.Repeat("a", 4096), "/" + strings.Repeat("é", 2048)} {
			_, err := NewDesktopAccounts(nil).Detect(context.Background(), DesktopAccountDetectRequest{Platform: "openai", Directory: &directory, Store: "file", Mode: "local"})
			if err == nil {
				t.Fatalf("accepted directory bytes=%d", len(directory))
			}
		}
		boundary := "/" + strings.Repeat("a", 4095)
		if err := validateDesktopAccountDirectory(&boundary); err != nil {
			t.Fatalf("4096-byte boundary: %v", err)
		}
		if err := validateDesktopAccountDirectory(nil); err != nil {
			t.Fatal(err)
		}
	})
	t.Run("Claude namespace NFC without path resolution", func(t *testing.T) {
		one, two := "/tmp/cafe\u0301", "/tmp/café"
		if resolveClaudeKeychain(&one).service != resolveClaudeKeychain(&two).service {
			t.Fatal("NFC namespace mismatch")
		}
		alias := "/tmp/alias/../café"
		if resolveClaudeKeychain(&alias).service == resolveClaudeKeychain(&two).service {
			t.Fatal("Claude namespace cleaned")
		}
	})
}

func TestDesktopAccountsBlockedActions(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), desktopCodexFixture(t, time.Now().Add(time.Hour)), 0600); err != nil {
		t.Fatal(err)
	}
	a := NewDesktopAccounts(&DesktopDevice{path: filepath.Join(dir, "device.json")})
	request := DesktopAccountDetectRequest{Platform: "openai", Directory: &dir, Store: "auto", Mode: "local"}
	first, err := a.Detect(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	second, err := a.Detect(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if *first.Candidate.Reference == *second.Candidate.Reference || first.Revision >= second.Revision {
		t.Fatal("candidate not invalidated")
	}
	for _, action := range []string{"select", "confirm_change", "remove", "clear_selection"} {
		_, err := a.Action(context.Background(), DesktopAccountActionRequest{Platform: "openai", Revision: second.Revision, CandidateRef: *second.Candidate.Reference, Action: action, Confirmed: true})
		if err == nil || !strings.Contains(err.Error(), "runtime") {
			t.Fatalf("action=%s err=%v", action, err)
		}
	}
	_, err = a.Action(context.Background(), DesktopAccountActionRequest{Platform: "openai", Revision: first.Revision, CandidateRef: *first.Candidate.Reference, Action: "select", Confirmed: true})
	if err == nil || !strings.Contains(err.Error(), "revision") {
		t.Fatalf("stale candidate: %v", err)
	}
	_, err = a.Action(context.Background(), DesktopAccountActionRequest{Platform: "claude", Revision: second.Revision, CandidateRef: *second.Candidate.Reference, Action: "select", Confirmed: true})
	if err == nil {
		t.Fatal("cross-platform reference accepted")
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatalf("rejected action wrote state: %v", entries)
	}
}

func TestDesktopAccountsDetectValidationAndAuto(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CODEX_HOME", dir)
	for _, r := range []DesktopAccountDetectRequest{
		{Platform: "unknown", Store: "file", Mode: "local"},
		{Platform: "openai", Store: "keychain", Mode: "local"},
		{Platform: "claude", Store: "auto", Mode: "local"},
		{Platform: "openai", Store: "file", Mode: "refresh"},
	} {
		if _, err := NewDesktopAccounts(nil).Detect(context.Background(), r); err == nil {
			t.Fatal("invalid request accepted")
		}
	}
	path := filepath.Join(dir, "auth.json")
	if err := os.WriteFile(path, []byte(`{"secret":"synthetic-SECRET"}`), 0600); err != nil {
		t.Fatal(err)
	}
	s, err := NewDesktopAccounts(nil).Detect(context.Background(), DesktopAccountDetectRequest{Platform: "openai", Store: "auto", Mode: "local"})
	if err != nil || s.Candidate.Error == nil || s.Candidate.Error.Check != "parse_credential" {
		t.Fatalf("bad file fell back to keychain: %+v %v", s.Candidate, err)
	}
	if err := os.WriteFile(path, desktopCodexFixture(t, time.Now().Add(time.Hour)), 0600); err != nil {
		t.Fatal(err)
	}
	s, err = NewDesktopAccounts(nil).Detect(context.Background(), DesktopAccountDetectRequest{Platform: "openai", Store: "auto", Mode: "local"})
	if err != nil || s.Candidate.Source == nil || s.Candidate.Source.Store != "file" {
		t.Fatalf("default file not preferred: %+v %v", s.Candidate, err)
	}
}

func TestDesktopAccountsDetectExpiresWithoutReadingSource(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	path := filepath.Join(dir, "auth.json")
	if err := os.WriteFile(path, desktopCodexFixture(t, now.Add(time.Minute)), 0600); err != nil {
		t.Fatal(err)
	}
	a := NewDesktopAccounts(nil)
	a.now = func() time.Time { return now }
	s, err := a.Detect(context.Background(), DesktopAccountDetectRequest{Platform: "openai", Directory: &dir, Store: "file", Mode: "local"})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	now = now.Add(31 * time.Second)
	s, err = a.Snapshot(context.Background(), "openai", false)
	if err != nil || s.Candidate.State != "expired" || s.Candidate.Reference != nil {
		t.Fatalf("expired candidate remained usable: %+v %v", s.Candidate, err)
	}
}

func TestDesktopAccountsUnknownPlanIsNullInPublicDTO(t *testing.T) {
	dir := t.TempDir()
	raw := claudeSample(time.Now().Add(time.Hour))
	raw = []byte(strings.ReplaceAll(string(raw), `"pro"`, `"future-private-plan"`))
	if err := os.WriteFile(filepath.Join(dir, ".credentials.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	snapshot, err := NewDesktopAccounts(nil).Detect(context.Background(), DesktopAccountDetectRequest{Platform: "claude", Directory: &dir, Store: "file", Mode: "local"})
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Candidate.State != "unknown_plan" || snapshot.Candidate.Plan != nil {
		t.Fatalf("unknown plan public candidate=%+v", snapshot.Candidate)
	}
}
