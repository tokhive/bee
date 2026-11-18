package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tokhive/bee/desktopbridge"
)

type synchronizedBuffer struct {
	mu sync.Mutex
	b  bytes.Buffer
}

func (b *synchronizedBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Write(p)
}

func (b *synchronizedBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.String()
}

func (b *synchronizedBuffer) Len() int {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.b.Len()
}

func TestBeeCommandHelper(t *testing.T) {
	if os.Getenv("BEE_COMMAND_TEST_HELPER") != "1" {
		return
	}
	for i, arg := range os.Args {
		if arg == "--" {
			os.Args = append(os.Args[:1], os.Args[i+1:]...)
			main()
			os.Exit(0)
		}
	}
	os.Exit(2)
}

func beeCommand(t *testing.T, args ...string) *exec.Cmd {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)
	cmd := exec.CommandContext(ctx, executable, append([]string{"-test.run=^TestBeeCommandHelper$", "--"}, args...)...)
	cmd.Env = append(os.Environ(), "BEE_COMMAND_TEST_HELPER=1")
	cmd.Dir = t.TempDir()
	return cmd
}

func desktopBridgeCaller(t *testing.T, in io.Writer, out io.Reader) func(string, any) map[string]any {
	t.Helper()
	decoder := json.NewDecoder(out)
	// A visible reply can precede the server's Write completion. Use fresh
	// request IDs just like the production client, without waiting for cleanup.
	sequence := 0
	return func(method string, params any) map[string]any {
		t.Helper()
		sequence++
		id := "lock-test-" + strconv.Itoa(sequence)
		if err := json.NewEncoder(in).Encode(map[string]any{"protocol": 1, "id": id, "method": method, "params": params}); err != nil {
			t.Fatal(err)
		}
		var frame map[string]any
		if err := decoder.Decode(&frame); err != nil {
			t.Fatal(err)
		}
		if frame["id"] != id {
			t.Fatalf("bridge reply id=%v; required=%q", frame["id"], id)
		}
		result, ok := frame["result"].(map[string]any)
		if !ok {
			t.Fatalf("missing bridge result: %v", frame)
		}
		return result
	}
}

type replyCompletionWriter struct {
	io.Writer
	release <-chan struct{}
	once    sync.Once
}

func (w *replyCompletionWriter) Write(p []byte) (int, error) {
	n, err := w.Writer.Write(p)
	w.once.Do(func() { <-w.release })
	return n, err
}

type nextRequestReader struct {
	io.Reader
	reads   int
	release func()
}

func (r *nextRequestReader) Read(p []byte) (int, error) {
	r.reads++
	if r.reads == 3 {
		// The reader has admitted the second request while the first reply's
		// bytes are visible but its Write has not returned yet.
		r.release()
	}
	return r.Reader.Read(p)
}

func TestDesktopBridgeCallerContinuesBeforePriorReplyWriteReturns(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	in, feed := io.Pipe()
	out, writer := io.Pipe()
	release := make(chan struct{})
	unblock := sync.OnceFunc(func() { close(release) })
	closeStreams := func() { unblock(); in.Close(); feed.Close(); out.Close(); writer.Close() }
	stop := context.AfterFunc(ctx, closeStreams)
	t.Cleanup(func() { cancel(); stop(); closeStreams() })
	done := make(chan error, 1)
	go func() {
		done <- desktopbridge.Run(ctx, &nextRequestReader{Reader: in, release: unblock}, &replyCompletionWriter{Writer: writer, release: release}, io.Discard, "test")
	}()
	call := desktopBridgeCaller(t, feed, out)
	call("hello", map[string]any{})
	if got := call("ping", map[string]any{}); got["alive"] != true {
		t.Fatalf("ping after visible prior reply: %v", got)
	}
	call("shutdown", map[string]any{})
	if err := <-done; err != nil {
		t.Fatal(err)
	}
}

func TestDesktopRuntimeExitReleasesOnlyOwnedConfigurationLock(t *testing.T) {
	isolated := t.TempDir()
	start := func() (*exec.Cmd, func(string, any) map[string]any) {
		cmd := beeCommand(t, "desktop")
		cmd.Env = append(cmd.Env, "HOME="+isolated, "XDG_CONFIG_HOME="+isolated, "APPDATA="+isolated)
		in, err := cmd.StdinPipe()
		if err != nil {
			t.Fatal(err)
		}
		out, err := cmd.StdoutPipe()
		if err != nil {
			t.Fatal(err)
		}
		if err = cmd.Start(); err != nil {
			t.Fatal(err)
		}
		t.Cleanup(func() {
			in.Close()
			if cmd.ProcessState == nil {
				cmd.Process.Kill()
				cmd.Wait()
			}
		})
		call := desktopBridgeCaller(t, in, out)
		call("hello", map[string]any{})
		return cmd, call
	}
	first, one := start()
	if got := one("device_status", map[string]any{}); got["error"] != nil {
		t.Fatalf("first owner: %v", got)
	}
	second, two := start()
	if got := two("device_status", map[string]any{}); got["error"] == nil {
		t.Fatal("second process acquired live first-owner lock")
	}
	if got := one("runtime_stop", map[string]any{"expected_revision": 0, "reason": "app_exit"}); got["error"] != nil {
		t.Fatal(got)
	}
	deadline := time.Now().Add(3 * time.Second)
	for {
		snapshot := one("runtime_snapshot", map[string]any{})["runtime"].(map[string]any)
		if snapshot["local"] == "stopped" {
			receipt := snapshot["stop_receipt"].(map[string]any)
			if receipt["intent_saved"] != true || receipt["session_clean"] != true || receipt["workers_stopped"] != true {
				t.Fatalf("unpaired exit failed: %v", snapshot)
			}
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("owned stop did not complete")
		}
		time.Sleep(time.Millisecond)
	}
	if got := two("device_status", map[string]any{}); got["error"] == nil {
		t.Fatal("stop released config lock before child exit")
	}
	one("shutdown", map[string]any{})
	if err := first.Wait(); err != nil {
		t.Fatal(err)
	}
	if got := two("device_status", map[string]any{}); got["error"] != nil {
		t.Fatalf("new process could not acquire released lock: %v", got)
	}
	two("shutdown", map[string]any{})
	if err := second.Wait(); err != nil {
		t.Fatal(err)
	}
}

func TestDesktopCommandHandshakeAndParentEOF(t *testing.T) {
	for _, shutdown := range []bool{false, true} {
		t.Run(map[bool]string{false: "parent-EOF", true: "shutdown"}[shutdown], func(t *testing.T) {
			versionCmd := beeCommand(t, "version")
			version, err := versionCmd.Output()
			if err != nil {
				t.Fatal(err)
			}
			cmd := beeCommand(t, "desktop")
			const fixture = `{"credential":"fixture-not-to-be-read"}`
			path := filepath.Join(cmd.Dir, "bee.json")
			if err := os.WriteFile(path, []byte(fixture), 0600); err != nil {
				t.Fatal(err)
			}
			in, err := cmd.StdinPipe()
			if err != nil {
				t.Fatal(err)
			}
			out, err := cmd.StdoutPipe()
			if err != nil {
				t.Fatal(err)
			}
			var diagnostics synchronizedBuffer
			cmd.Stderr = &diagnostics
			if err := cmd.Start(); err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = cmd.Process.Kill(); in.Close(); out.Close() })
			decoder := json.NewDecoder(out)
			var instance string
			methods := []string{"hello", "ping", "start"}
			if shutdown {
				methods = append(methods, "shutdown")
			}
			for _, method := range methods {
				if _, err := io.WriteString(in, `{"protocol":1,"id":"`+method+`","method":"`+method+`","params":{}}`+"\n"); err != nil {
					t.Fatal(err)
				}
				var frame struct {
					ID       string `json:"id"`
					Instance string `json:"instance"`
					Result   struct {
						Version string `json:"bee_version"`
					} `json:"result"`
					Error *struct{ Code string } `json:"error"`
				}
				if err := decoder.Decode(&frame); err != nil {
					t.Fatalf("desktop response: %v; stderr=%q", err, diagnostics.String())
				}
				if frame.ID != method || frame.Instance == "" || instance != "" && instance != frame.Instance {
					t.Fatalf("unexpected reply correlation: %+v", frame)
				}
				instance = frame.Instance
				if method == "start" {
					if frame.Error == nil || frame.Error.Code != "UNKNOWN_METHOD" {
						t.Fatalf("management process accepted contribution: %+v", frame)
					}
				} else if frame.Error != nil {
					t.Fatalf("management request rejected: %+v", frame)
				}
				if method == "hello" && frame.Result.Version != strings.Fields(string(version))[1] {
					t.Fatalf("hello version=%q; CLI version=%q", frame.Result.Version, version)
				}
			}
			in.Close() // Simulates the parent disappearing, without scanning or killing other Bees.
			if err := cmd.Wait(); err != nil {
				t.Fatalf("desktop did not terminate cleanly: %v; stderr=%q", err, diagnostics.String())
			}
			line := strings.TrimSpace(diagnostics.String())
			if !strings.HasPrefix(line, "BEE_DESKTOP_FAILURE ") || strings.Count(line, "BEE_DESKTOP_FAILURE ") != 1 {
				t.Fatalf("expected one record for the rejected start method: %q", line)
			}
			var event struct {
				Evidence map[string]string `json:"evidence"`
			}
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "BEE_DESKTOP_FAILURE ")), &event); err != nil || event.Evidence["failure_code"] != "UNKNOWN_METHOD" || event.Evidence["check"] != "start" {
				t.Fatalf("missing rejected-method evidence: %+v, %v", event, err)
			}
			entries, err := os.ReadDir(cmd.Dir)
			data, readErr := os.ReadFile(path)
			if err != nil || len(entries) != 1 || readErr != nil || string(data) != fixture {
				t.Fatal("management mode changed the working configuration fixture")
			}
		})
	}
}

func TestDesktopCommandSignalInterruptsIdleStdin(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("os.Interrupt cannot be delivered by os.Process.Signal on Windows; native parent EOF is covered separately")
	}
	cmd := beeCommand(t, "desktop")
	in, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var diagnostics synchronizedBuffer
	cmd.Stderr = &diagnostics
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); out.Close() })
	if _, err := io.WriteString(in, `{"protocol":1,"id":"h","method":"hello","params":{}}`+"\n"); err != nil {
		t.Fatal(err)
	}
	var frame json.RawMessage
	if err := json.NewDecoder(out).Decode(&frame); err != nil {
		t.Fatalf("hello failed before signal: %v; stderr=%q", err, diagnostics.String())
	}
	if err := cmd.Process.Signal(os.Interrupt); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatalf("signal did not cancel idle management process: %v; stderr=%q", err, diagnostics.String())
	}
}

func TestDesktopCommandSignalInterruptsBlockedStdout(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("os.Interrupt cannot be delivered by os.Process.Signal on Windows")
	}
	cmd := beeCommand(t, "desktop")
	in, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var diagnostics synchronizedBuffer
	cmd.Stderr = &diagnostics
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); out.Close() })
	// The reply is larger than a pipe buffer. Consuming only its prefix proves
	// writing began, while the parent deliberately stops draining the pipe.
	input := `{"protocol":1,"id":"` + strings.Repeat("x", 512*1024) + `","method":"hello","params":{}}` + "\n"
	if _, err := io.WriteString(in, input); err != nil {
		t.Fatal(err)
	}
	var prefix [16]byte
	if _, err := io.ReadFull(out, prefix[:]); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Process.Signal(os.Interrupt); err != nil {
		t.Fatal(err)
	}
	if err := cmd.Wait(); err != nil {
		t.Fatalf("signal did not cancel blocked output: %v; stderr=%q", err, diagnostics.String())
	}
}

func TestDesktopCommandBrokenOutputUnblocksIdleInput(t *testing.T) {
	cmd := beeCommand(t, "desktop")
	in, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	defer in.Close()
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var diagnostics synchronizedBuffer
	cmd.Stderr = &diagnostics
	if err := cmd.Start(); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); out.Close() })
	if _, err := io.WriteString(in, `{"protocol":1,"id":"h","method":"hello","params":{}}`+"\n"); err != nil {
		t.Fatal(err)
	}
	var frame json.RawMessage
	if err := json.NewDecoder(out).Decode(&frame); err != nil {
		t.Fatal(err)
	}
	out.Close()
	if _, err := io.WriteString(in, `{"protocol":1,"id":"p","method":"ping","params":{}}`+"\n"); err != nil {
		t.Fatal(err)
	}
	// Keep the parent's input writer open. Only the child's failure handling
	// can wake its next read and let Wait finish before the test deadline.
	if err := cmd.Wait(); err == nil || !strings.Contains(diagnostics.String(), "write desktop response bytes=") || !strings.Contains(diagnostics.String(), "required=") {
		t.Fatalf("broken output recovery: error=%v; stderr=%q", err, diagnostics.String())
	}
}

func TestDesktopCommandRejectsArgumentsWithoutEchoingValues(t *testing.T) {
	cmd := beeCommand(t, "desktop", "--config", "secret-value")
	var out, diagnostics bytes.Buffer
	cmd.Stdout, cmd.Stderr = &out, &diagnostics
	if err := cmd.Run(); err == nil || out.Len() != 0 || !strings.Contains(diagnostics.String(), "arguments=2") || strings.Contains(diagnostics.String(), "secret-value") {
		t.Fatalf("invalid desktop arguments: stdout=%q; stderr=%q; error=%v", out.String(), diagnostics.String(), err)
	}
}

func TestHelpListsDesktopMachineEntry(t *testing.T) {
	cmd := beeCommand(t, "help")
	out, err := cmd.Output()
	if err != nil || !strings.Contains(string(out), "bee desktop") || !strings.Contains(string(out), "stdin/stdout") {
		t.Fatalf("desktop entry missing from help: output=%q; error=%v", out, err)
	}
}

func TestDesktopProfilePrepareRestrictsRealBridge(t *testing.T) {
	profile, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	cmd := beeCommand(t, "desktop", "--profile-dir", profile, "--mode", "prepare")
	in, err := cmd.StdinPipe()
	if err != nil {
		t.Fatal(err)
	}
	out, err := cmd.StdoutPipe()
	if err != nil {
		t.Fatal(err)
	}
	var diagnostics bytes.Buffer
	cmd.Stderr = &diagnostics
	if err = cmd.Start(); err != nil {
		t.Fatal(err)
	}
	defer func() {
		in.Close()
		if cmd.ProcessState == nil {
			cmd.Process.Kill()
			cmd.Wait()
		}
	}()
	decoder := json.NewDecoder(out)
	call := func(method string, params any) map[string]any {
		t.Helper()
		if err := json.NewEncoder(in).Encode(map[string]any{"protocol": 1, "id": "profile-test", "method": method, "params": params}); err != nil {
			t.Fatal(err)
		}
		var frame map[string]any
		if err := decoder.Decode(&frame); err != nil {
			t.Fatalf("decode %s: %v diagnostics=%s", method, err, diagnostics.String())
		}
		return frame
	}
	hello := call("hello", map[string]any{})
	caps := hello["result"].(map[string]any)["capabilities"].([]any)
	for _, denied := range []string{"runtime_restore", "runtime_enable_presence", "runtime_start", "account_action", "authorize_start", "supply_set_paused"} {
		for _, cap := range caps {
			if cap == denied {
				t.Fatalf("prepare advertised forbidden capability %s", denied)
			}
		}
	}
	got := call("runtime_restore", map[string]any{})
	if got["error"] == nil {
		t.Fatalf("prepare accepted restore: %v", got)
	}
	if got := call("device_context", map[string]any{}); got["error"] != nil {
		t.Fatal(got)
	}
	if _, err := os.Stat(filepath.Join(profile, "bee-desktop.json.lock")); err != nil {
		t.Fatalf("fixed profile lock missing: %v", err)
	}
	call("shutdown", map[string]any{})
	in.Close()
	if err := cmd.Wait(); err != nil {
		t.Fatalf("exit: %v diagnostics=%s", err, diagnostics.String())
	}
}
