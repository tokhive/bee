//go:build darwin || linux

package bee

import (
	"context"
	"net/http"
	"os"
	"path/filepath"
	"syscall"
	"testing"
	"time"
)

func TestDesktopAccountsOfficialMetadataFIFO(t *testing.T) {
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), desktopCodexFixture(t, time.Now().Add(time.Hour)), 0600); err != nil {
		t.Fatal(err)
	}
	fifo := filepath.Join(dir, "models_cache.json")
	if err := syscall.Mkfifo(fifo, 0600); err != nil {
		t.Fatal(err)
	}
	a := NewDesktopAccounts(nil)
	a.transport = claudeTransport(func(r *http.Request) (*http.Response, error) {
		return claudeProfileResponse(503, "{}"), nil
	})
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		_, _ = a.Detect(ctx, DesktopAccountDetectRequest{Platform: "openai", Directory: &dir, Store: "file", Mode: "official"})
	}()
	select {
	case <-done:
		return
	case <-time.After(300 * time.Millisecond):
	}
	// Unblock the old implementation before failing, so regression runs leak
	// neither a goroutine nor an official-source operation.
	file, err := os.OpenFile(fifo, os.O_RDWR, 0)
	if err != nil {
		t.Fatal(err)
	}
	_, _ = file.Write([]byte("{}\n"))
	_ = file.Close()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("official metadata read stayed blocked after FIFO release")
	}
	t.Fatal("official detection exceeded canceled context while reading metadata FIFO; required=nonblocking regular-file read")
}

func TestCachedCodexVersionRejectsSymlink(t *testing.T) {
	dir := t.TempDir()
	target := filepath.Join(t.TempDir(), "cache.json")
	if err := os.WriteFile(target, []byte(`{"client_version":"0.163.0"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, filepath.Join(dir, "models_cache.json")); err != nil {
		t.Fatal(err)
	}
	if version := cachedCodexVersion(dir); version != "" {
		t.Fatalf("metadata symlink returned version=%q; required=ignore nonregular source", version)
	}
}

func TestDesktopAccountsOfficialVersionPipeDeadline(t *testing.T) {
	oldCodex, oldClaude := installedCodexVersion, claudeVersion
	installedCodexVersion, claudeVersion = codexOnPath, localClaudeVersion
	t.Cleanup(func() { installedCodexVersion, claudeVersion = oldCodex, oldClaude })
	for _, platform := range []string{"openai", "claude"} {
		t.Run(platform, func(t *testing.T) {
			dir := t.TempDir()
			name, version, file := "codex", "codex-cli 0.163.0", "auth.json"
			raw := desktopCodexFixture(t, time.Now().Add(time.Hour))
			if platform == "claude" {
				name, version, file = "claude", "2.1.303 (Claude Code)", ".credentials.json"
				raw = claudeSample(time.Now().Add(time.Hour))
			}
			if err := os.WriteFile(filepath.Join(dir, file), raw, 0600); err != nil {
				t.Fatal(err)
			}
			// The wrapper exits, but its short-lived descendant keeps stdout
			// open. Canceling the exited wrapper cannot close that pipe.
			marker := filepath.Join(dir, "version-probe-started")
			t.Setenv("BEE_VERSION_TEST_MARKER", marker)
			wrapper := "#!/bin/sh\nprintf started > \"$BEE_VERSION_TEST_MARKER\"\n/bin/sleep 4 &\nprintf '%s\\n' '" + version + "'\n"
			if err := os.WriteFile(filepath.Join(dir, name), []byte(wrapper), 0700); err != nil {
				t.Fatal(err)
			}
			t.Setenv("PATH", dir)
			a := NewDesktopAccounts(nil)
			a.transport = claudeTransport(func(r *http.Request) (*http.Response, error) {
				if r.URL.Path == "/api/oauth/profile" {
					return claudeProfileResponse(200, `{"account":{"uuid":"11111111-1111-1111-1111-111111111111","email":"synthetic@secret.test"},"organization":{"uuid":"22222222-2222-2222-2222-222222222222"}}`), nil
				}
				return claudeProfileResponse(503, "{}"), nil
			})
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()
			started := time.Now()
			_, _ = a.Detect(ctx, DesktopAccountDetectRequest{Platform: platform, Directory: &dir, Store: "file", Mode: "official"})
			elapsed := time.Since(started)
			if contents, err := os.ReadFile(marker); err != nil || string(contents) != "started" {
				t.Fatalf("version probe was not exercised: marker_error=%v; required=wrapper execution before deadline", err)
			}
			if elapsed > 3*time.Second {
				t.Fatalf("official version probe returned after %s with 2s context; required=bounded inherited pipe wait", elapsed)
			}
		})
	}
}
