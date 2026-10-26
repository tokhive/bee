package bee

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestDesktopAuthorizeProcessHelper(t *testing.T) {
	if os.Getenv("BEE_AUTHORIZE_HELPER") != "1" {
		return
	}
	args := os.Args
	for len(args) > 0 && args[0] != "--" {
		args = args[1:]
	}
	args = args[1:]
	mode := os.Getenv("BEE_AUTHORIZE_MODE")
	if len(args) == 1 && args[0] == "--version" {
		if mode == "unsupported" {
			fmt.Print("codex-cli 0.1.0")
		} else {
			if os.Getenv("BEE_AUTHORIZE_PLATFORM") == "claude" {
				fmt.Print("2.1.153 (Claude Code)")
			} else {
				fmt.Print("codex-cli 0.162.1")
			}
		}
		os.Exit(0)
	}
	if args[len(args)-1] == "--help" {
		fmt.Print("Usage: login --config --device-auth --claudeai")
		os.Exit(0)
	}
	if path := os.Getenv("BEE_AUTHORIZE_STARTED"); path != "" {
		os.WriteFile(path, []byte(fmt.Sprint(os.Getpid())), 0600)
	}
	fmt.Print("https://official.example/authorize?code=PRIVATE_LOGIN_SECRET\nPRIVATE_TOKEN_SECRET")
	switch mode {
	case "wait":
		for {
			time.Sleep(time.Second)
		}
	case "exit_error":
		os.Exit(7)
	case "success":
		raw, err := os.ReadFile(os.Getenv("BEE_AUTHORIZE_SOURCE"))
		if err != nil {
			os.Exit(8)
		}
		path := filepath.Join(os.Getenv("CODEX_HOME"), "auth.json")
		if os.Getenv("BEE_AUTHORIZE_PLATFORM") == "claude" {
			path = filepath.Join(os.Getenv("CLAUDE_CONFIG_DIR"), ".credentials.json")
		}
		if err = os.WriteFile(path, raw, 0600); err != nil {
			os.Exit(9)
		}
	}
	os.Exit(0)
}

func authorizeFixture(t *testing.T, mode string) (*DesktopAuthorizer, *DesktopAccounts, DesktopAuthorizeRequest, string) {
	t.Helper()
	a := NewDesktopAccounts(nil)
	owner := NewDesktopAuthorizer(context.Background(), a)
	t.Cleanup(func() { owner.Close(); a.Close() })
	directory := t.TempDir()
	sample := filepath.Join(t.TempDir(), "sample")
	if err := os.WriteFile(sample, desktopCodexFixture(t, time.Now().Add(time.Hour)), 0600); err != nil {
		t.Fatal(err)
	}
	started := filepath.Join(t.TempDir(), "started")
	owner.resolve = func(string) (string, error) { return os.Executable() }
	owner.command = func(program string, args ...string) *exec.Cmd {
		command := exec.Command(program, append([]string{"-test.run=^TestDesktopAuthorizeProcessHelper$", "--"}, args...)...)
		command.Env = append(os.Environ(), "BEE_AUTHORIZE_HELPER=1", "GORACE=atexit_sleep_ms=0", "BEE_AUTHORIZE_MODE="+mode, "BEE_AUTHORIZE_SOURCE="+sample, "BEE_AUTHORIZE_STARTED="+started)
		return command
	}
	return owner, a, DesktopAuthorizeRequest{Platform: "openai", Source: DesktopAccountSource{Directory: &directory, Store: "file"}, ExpectedRevision: 0}, started
}
func waitAuthorize(t *testing.T, owner *DesktopAuthorizer, id string) DesktopOperation {
	t.Helper()
	until := time.Now().Add(5 * time.Second)
	for time.Now().Before(until) {
		op, err := owner.Status(context.Background(), id)
		if err != nil {
			t.Fatal(err)
		}
		if op.State != "pending" && op.State != "running" {
			return op
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("official login did not reach a terminal state")
	return DesktopOperation{}
}
func TestDesktopAuthorizeRequiresVerifiedNewSource(t *testing.T) {
	for _, mode := range []string{"success", "unchanged", "exit_error", "unsupported"} {
		t.Run(mode, func(t *testing.T) {
			owner, a, request, _ := authorizeFixture(t, mode)
			op, err := owner.Start(context.Background(), request)
			if err != nil {
				t.Fatal(err)
			}
			result := waitAuthorize(t, owner, op.ID)
			want := "failed"
			if mode == "success" {
				want = "succeeded"
			}
			if result.State != want {
				t.Fatalf("mode=%s state=%s error=%v", mode, result.State, result.Error)
			}
			raw, _ := json.Marshal(result)
			if strings.Contains(string(raw), "PRIVATE_") {
				t.Fatal("login output leaked into operation")
			}
			snapshot, err := a.Snapshot(context.Background(), "openai", false)
			if err != nil {
				t.Fatal(err)
			}
			if snapshot.Selection.State != "not_selected" {
				t.Fatal("official login automatically selected account")
			}
			if mode == "success" && (snapshot.Candidate.Reference == nil || snapshot.Candidate.Fingerprint == nil) {
				t.Fatalf("login not reverified: %+v", snapshot.Candidate)
			}
		})
	}
}
func TestDesktopAuthorizeCancelAndCloseJoinOwnedProcess(t *testing.T) {
	for _, action := range []string{"cancel", "close", "timeout"} {
		t.Run(action, func(t *testing.T) {
			owner, _, request, started := authorizeFixture(t, "wait")
			if action == "timeout" {
				owner.timeout = 150 * time.Millisecond
			}
			op, err := owner.Start(context.Background(), request)
			if err != nil {
				t.Fatal(err)
			}
			deadline := time.Now().Add(3 * time.Second)
			for {
				if _, err := os.Stat(started); err == nil {
					break
				}
				if time.Now().After(deadline) {
					t.Fatal("owned login process did not start")
				}
				time.Sleep(time.Millisecond)
			}
			if _, err := owner.Start(context.Background(), request); err == nil {
				t.Fatal("second login accepted")
			}
			if action == "cancel" {
				if _, err := owner.Cancel(context.Background(), op.ID); err != nil {
					t.Fatal(err)
				}
			}
			if action == "close" {
				owner.Close()
			}
			result := waitAuthorize(t, owner, op.ID)
			if action == "timeout" && result.State != "failed" || action != "timeout" && result.State != "cancelled" {
				t.Fatalf("action=%s result=%+v", action, result)
			}
			if _, err := owner.Status(context.Background(), strings.Repeat("f", 48)); err == nil {
				t.Fatal("unowned operation accepted")
			}
		})
	}
}

func TestDesktopAuthorizeSourceRevisionRace(t *testing.T) {
	owner, a, request, _ := authorizeFixture(t, "unchanged")
	a.goos = "darwin"
	request.Source.Store = "keyring"
	old := desktopCodexFixture(t, time.Now().Add(time.Hour))
	fresh := desktopCodexFixture(t, time.Now().Add(2*time.Hour))
	reads := 0
	a.readKeyring = func(context.Context, string) ([]byte, error) {
		reads++
		if reads == 2 || reads == 3 {
			return append([]byte(nil), fresh...), nil
		}
		return append([]byte(nil), old...), nil
	}
	op, err := owner.Start(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	done := waitAuthorize(t, owner, op.ID)
	t.Logf("source reads=%d operation=%s", reads, done.State)
	if done.State == "succeeded" {
		t.Fatal("source reverted to pre-login revision after selectionSource, but authorization still succeeded")
	}
}

func TestDesktopAuthorizeStartErrorLeaksPath(t *testing.T) {
	owner, _, request, _ := authorizeFixture(t, "unchanged")
	owner.resolve = func(string) (string, error) { return "/tmp/PRIVATE_EXECUTABLE_PATH/codex", nil }
	op, err := owner.Start(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	done := waitAuthorize(t, owner, op.ID)
	raw, _ := json.Marshal(done)
	if strings.Contains(string(raw), "PRIVATE_EXECUTABLE_PATH") {
		t.Fatalf("full executable path leaked into operation: %s", raw)
	}
}

func TestDesktopAuthorizeUnchangedExistingSource(t *testing.T) {
	owner, _, request, _ := authorizeFixture(t, "unchanged")
	if err := os.WriteFile(filepath.Join(*request.Source.Directory, "auth.json"), desktopCodexFixture(t, time.Now().Add(time.Hour)), 0600); err != nil {
		t.Fatal(err)
	}
	op, err := owner.Start(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	result := waitAuthorize(t, owner, op.ID)
	if result.State != "failed" || result.Error == nil || !strings.Contains(result.Error.Message, "unchanged") {
		t.Fatalf("unchanged source accepted: %+v", result)
	}
}

func TestDesktopAuthorizeClaudeVerifiedProfileAndLateCancellation(t *testing.T) {
	for _, cancelLate := range []bool{false, true} {
		t.Run(fmt.Sprint(cancelLate), func(t *testing.T) {
			owner, a, request, _ := authorizeFixture(t, "success")
			a.goos = "linux"
			request.Platform = "claude"
			source := filepath.Join(t.TempDir(), "claude-sample")
			if err := os.WriteFile(source, claudeSample(time.Now().Add(time.Hour)), 0600); err != nil {
				t.Fatal(err)
			}
			original := owner.command
			owner.command = func(program string, args ...string) *exec.Cmd {
				cmd := original(program, args...)
				for i, entry := range cmd.Env {
					if strings.HasPrefix(entry, "BEE_AUTHORIZE_SOURCE=") {
						cmd.Env[i] = "BEE_AUTHORIZE_SOURCE=" + source
					}
				}
				cmd.Env = append(cmd.Env, "BEE_AUTHORIZE_PLATFORM=claude")
				return cmd
			}
			profile := make(chan struct{})
			release := make(chan struct{})
			a.transport = claudeTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path != "/api/oauth/profile" {
					t.Errorf("unexpected path=%s", r.URL.Path)
				}
				close(profile)
				if cancelLate {
					<-release
				}
				return claudeProfileResponse(200, `{"account":{"uuid":"11111111-1111-1111-1111-111111111111","email":"fixture@example.test"},"organization":{"uuid":"22222222-2222-2222-2222-222222222222"}}`), nil
			})
			op, err := owner.Start(context.Background(), request)
			if err != nil {
				t.Fatal(err)
			}
			if cancelLate {
				select {
				case <-profile:
				case <-time.After(5 * time.Second):
					t.Fatal("profile not requested")
				}
				_, err = owner.Cancel(context.Background(), op.ID)
				if err != nil {
					t.Fatal(err)
				}
				close(release)
			}
			result := waitAuthorize(t, owner, op.ID)
			snapshot, err := a.Snapshot(context.Background(), "claude", false)
			if err != nil {
				t.Fatal(err)
			}
			if cancelLate {
				if result.State != "cancelled" || snapshot.Candidate.Reference != nil {
					t.Fatalf("late success accepted: %+v %+v", result, snapshot.Candidate)
				}
			} else if result.State != "succeeded" || !snapshot.Candidate.IdentityVerified || snapshot.Candidate.Fingerprint == nil {
				t.Fatalf("Claude login unverified: %+v %+v", result, snapshot.Candidate)
			}
		})
	}
}
func TestDesktopAuthorizeNamespaceAndEnvironment(t *testing.T) {
	directory, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	for _, platform := range []string{"openai", "claude"} {
		request := DesktopAuthorizeRequest{Platform: platform, Source: DesktopAccountSource{Directory: &directory, Store: "file"}}
		args, env, err := desktopAuthorizationArgs(request, "linux")
		if err != nil {
			t.Fatal(err)
		}
		expected := []string{"login", "-c", `cli_auth_credentials_store="file"`}
		if platform == "claude" {
			expected = []string{"auth", "login", "--claudeai"}
			if env["CLAUDE_CONFIG_DIR"] != directory || env["CLAUDE_SECURESTORAGE_CONFIG_DIR"] != directory {
				t.Fatal("Claude namespace not propagated")
			}
		}
		if !reflect.DeepEqual(args, expected) {
			t.Fatalf("fixed arguments differ: %v", args)
		}
		result := desktopAuthorizationEnvironment([]string{"OPENAI_API_KEY=SECRET", "CODEX_ACCESS_TOKEN=SECRET", "ANTHROPIC_API_KEY=SECRET", "CLAUDE_CODE_OAUTH_TOKEN=SECRET", "CLAUDE_CODE_OAUTH_REFRESH_TOKEN=SECRET", "HTTPS_PROXY=http://127.0.0.1:7890"}, env)
		joined := strings.Join(result, "\n")
		if strings.Contains(joined, "SECRET") || !strings.Contains(joined, "HTTPS_PROXY=") {
			t.Fatal("credential overrides or proxy inheritance wrong")
		}
	}
	if _, _, err := desktopAuthorizationArgs(DesktopAuthorizeRequest{Platform: "claude", Source: DesktopAccountSource{Store: "file"}}, "darwin"); err == nil {
		t.Fatal("wrong macOS namespace accepted")
	}
}
func TestDesktopAuthorizeRejectsStaleAndRunningBeforeSourceAccess(t *testing.T) {
	owner, a, request, _ := authorizeFixture(t, "success")
	calls := 0
	owner.resolve = func(string) (string, error) { calls++; return "", fmt.Errorf("missing") }
	request.ExpectedRevision = 4
	if _, err := owner.Start(context.Background(), request); err == nil {
		t.Fatal("stale request accepted")
	}
	request.ExpectedRevision = 0
	a.runtime = &DesktopRuntime{snapshot: DesktopRuntimeSnapshot{Local: "running"}}
	if _, err := owner.Start(context.Background(), request); err == nil {
		t.Fatal("login replaced a running source")
	}
	if calls != 0 {
		t.Fatal("rejected request reached client resolver")
	}
	a.runtime = nil
	op, err := owner.Start(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	result := waitAuthorize(t, owner, op.ID)
	if result.State != "failed" || result.Error.Code != "client_missing" {
		t.Fatalf("missing client result=%+v", result)
	}
}

func TestDesktopAuthorizeAutoLoginCannotFallBackToAnotherStore(t *testing.T) {
	owner, a, request, _ := authorizeFixture(t, "unchanged")
	a.goos = "darwin"
	request.Source.Store = "auto"
	reads := 0
	raw := desktopCodexFixture(t, time.Now().Add(time.Hour))
	a.readKeyring = func(context.Context, string) ([]byte, error) { reads++; return append([]byte(nil), raw...), nil }
	op, err := owner.Start(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	result := waitAuthorize(t, owner, op.ID)
	if result.State == "succeeded" || reads != 0 {
		t.Fatalf("file login fell back to keyring: state=%s keyring_reads=%d", result.State, reads)
	}
}
