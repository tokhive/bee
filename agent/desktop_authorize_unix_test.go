//go:build !windows

package bee

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestDesktopAuthorizeCleansOwnedDescendantsAndPreservesExternal(t *testing.T) {
	for _, cancelled := range []bool{false, true} {
		t.Run(map[bool]string{true: "cancel", false: "normal_exit"}[cancelled], func(t *testing.T) {
			dir := t.TempDir()
			owned := filepath.Join(dir, "owned")
			external := filepath.Join(dir, "external")
			started := filepath.Join(dir, "started")
			script := `sleep 1.2; printf done > "$1"`
			other := exec.Command("/bin/sh", "-c", script, "test", external)
			if err := other.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = other.Process.Kill(); _ = other.Wait() })
			script = `/bin/sh -c 'sleep 1; printf done > "$1"' test "$1" & printf started > "$2"`
			if cancelled {
				script += `; wait`
			}
			cmd := exec.Command("/bin/sh", "-c", script, "test", owned, started)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan error, 1)
			go func() { done <- runDesktopAuthorization(ctx, cmd) }()
			limit := time.Now().Add(2 * time.Second)
			for {
				if _, err := os.Stat(started); err == nil {
					break
				}
				if time.Now().After(limit) {
					t.Fatal("child did not start")
				}
				time.Sleep(time.Millisecond)
			}
			if cancelled {
				cancel()
			}
			select {
			case err := <-done:
				if !cancelled && err != nil {
					t.Fatal(err)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("owned process was not reaped")
			}
			if err := other.Wait(); err != nil {
				t.Fatalf("external process disturbed: %v", err)
			}
			if _, err := os.Stat(owned); !os.IsNotExist(err) {
				t.Fatal("owned descendant outlived authorization")
			}
			if _, err := os.Stat(external); err != nil {
				t.Fatal("external process lost")
			}
		})
	}
}

func TestDesktopAuthorizeNamespaceHelper(t *testing.T) {
	if os.Getenv("BEE_REVIEW_NAMESPACE") == "" {
		return
	}
	sample, err := os.ReadFile(os.Getenv("BEE_REVIEW_SAMPLE"))
	if err != nil {
		os.Exit(11)
	}
	if err = os.WriteFile(filepath.Join(os.Getenv("CODEX_HOME"), "auth.json"), sample, 0600); err != nil {
		os.Exit(12)
	}
	link := os.Getenv("BEE_REVIEW_NAMESPACE")
	if err = os.Remove(link); err != nil {
		os.Exit(13)
	}
	if err = os.Symlink(os.Getenv("BEE_REVIEW_OTHER"), link); err != nil {
		os.Exit(14)
	}
	os.Exit(0)
}
func TestDesktopAuthorizeMustUseStartedNamespace(t *testing.T) {
	owner, a, request, _ := authorizeFixture(t, "unchanged")
	first, second := t.TempDir(), t.TempDir()
	link := filepath.Join(t.TempDir(), "selected")
	if err := os.Symlink(first, link); err != nil {
		t.Fatal(err)
	}
	request.Source.Directory = &link
	for i, dir := range []string{first, second} {
		if err := os.WriteFile(filepath.Join(dir, "auth.json"), desktopCodexFixture(t, time.Now().Add(time.Duration(i+1)*time.Hour)), 0600); err != nil {
			t.Fatal(err)
		}
	}
	sample := filepath.Join(t.TempDir(), "new-login.json")
	if err := os.WriteFile(sample, desktopCodexFixture(t, time.Now().Add(3*time.Hour)), 0600); err != nil {
		t.Fatal(err)
	}
	original := owner.command
	owner.command = func(program string, args ...string) *exec.Cmd {
		if len(args) == 1 && args[0] == "--version" || args[len(args)-1] == "--help" {
			return original(program, args...)
		}
		cmd := exec.Command(program, "-test.run=^TestDesktopAuthorizeNamespaceHelper$")
		cmd.Env = append(os.Environ(), "GORACE=atexit_sleep_ms=0", "BEE_REVIEW_NAMESPACE="+link, "BEE_REVIEW_SAMPLE="+sample, "BEE_REVIEW_OTHER="+second)
		return cmd
	}
	op, err := owner.Start(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	result := waitAuthorize(t, owner, op.ID)
	snapshot, err := a.Snapshot(context.Background(), "openai", false)
	if err != nil {
		t.Fatal(err)
	}
	want, err := filepath.EvalSymlinks(first)
	if err != nil {
		t.Fatal(err)
	}
	if result.State != "succeeded" || snapshot.Candidate.Source == nil || snapshot.Candidate.Source.Directory == nil || *snapshot.Candidate.Source.Directory != want {
		t.Fatalf("verification did not remain in the started namespace: state=%s source=%+v", result.State, snapshot.Candidate.Source)
	}
}
