//go:build workspace_process

package workspace

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

// duplex joins one reader and one writer into the stream shape a tunnel
// stream has.
type duplex struct {
	r *io.PipeReader
	w *io.PipeWriter
}

func (d *duplex) Read(p []byte) (int, error)  { return d.r.Read(p) }
func (d *duplex) Write(p []byte) (int, error) { return d.w.Write(p) }
func (d *duplex) Close() error {
	_ = d.r.Close()
	return d.w.Close()
}

// pair returns the two ends of a stream: the sandbox side and the Hive side.
func pair() (io.ReadWriteCloser, io.ReadWriteCloser) {
	toSandbox, fromHive := io.Pipe()
	toHive, fromSandbox := io.Pipe()
	return &duplex{r: toSandbox, w: fromSandbox}, &duplex{r: toHive, w: fromHive}
}

type frame struct {
	kind    byte
	payload []byte
	err     error
}

func collect(r io.Reader) <-chan frame {
	frames := make(chan frame, 32)
	go func() {
		defer close(frames)
		for {
			kind, payload, err := beewire.ReadWorkspaceFrame(r)
			frames <- frame{kind: kind, payload: payload, err: err}
			if err != nil {
				return
			}
		}
	}()
	return frames
}

func awaitKind(t *testing.T, frames <-chan frame, kinds ...byte) frame {
	t.Helper()
	deadline := time.After(5 * time.Second)
	for {
		select {
		case got, ok := <-frames:
			if !ok {
				t.Fatal("stream ended before the expected frame")
			}
			if got.err != nil {
				t.Fatalf("read frame: %v", got.err)
			}
			for _, kind := range kinds {
				if got.kind == kind {
					return got
				}
			}
		case <-deadline:
			t.Fatalf("timed out waiting for frame kind %v", kinds)
		}
	}
}

func newTestManager(t *testing.T, sessions int) *Manager {
	t.Helper()
	m, err := New(Config{Runtime: "process", MaxSessions: sessions}, t.TempDir())
	if err != nil {
		t.Fatalf("new manager: %v", err)
	}
	t.Cleanup(m.Close)
	return m
}

// A sandbox echoes what it is given over one attach and reports its exit when
// the buyer stops it.
func TestSandboxEchoesOverOneAttach(t *testing.T) {
	m := newTestManager(t, 2)
	sandbox, hive := pair()
	spec := beewire.WorkspaceSpec{ID: "ws-echo", Action: beewire.WorkspaceAttach, Command: []string{"/bin/cat"}}
	served := make(chan struct{})
	go func() {
		defer close(served)
		m.Serve(context.Background(), sandbox, spec)
	}()

	frames := collect(hive)
	awaitKind(t, frames, beewire.FrameReady)

	if err := beewire.WriteWorkspaceFrame(hive, beewire.FrameData, []byte("ping\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	var echoed strings.Builder
	for !strings.Contains(echoed.String(), "ping") {
		got := awaitKind(t, frames, beewire.FrameData, beewire.FrameExit)
		if got.kind == beewire.FrameExit {
			t.Fatalf("sandbox exited before echoing: %s", got.payload)
		}
		echoed.Write(got.payload)
	}

	m.Stop("ws-echo")
	if err := hive.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	select {
	case <-served:
	case <-time.After(5 * time.Second):
		t.Fatal("serve did not return after stop")
	}
	waitFor(t, func() bool { return m.Live() == 0 })
}

// Detaching ends the attach but leaves the sandbox running, which is what
// lets a buyer close the tab without ending the session.
func TestDetachKeepsSandboxRunning(t *testing.T) {
	m := newTestManager(t, 2)
	sandbox, hive := pair()
	spec := beewire.WorkspaceSpec{ID: "ws-detach", Action: beewire.WorkspaceAttach, Command: []string{"/bin/cat"}}
	served := make(chan struct{})
	go func() {
		defer close(served)
		m.Serve(context.Background(), sandbox, spec)
	}()
	frames := collect(hive)
	awaitKind(t, frames, beewire.FrameReady)

	if err := hive.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	select {
	case <-served:
	case <-time.After(5 * time.Second):
		t.Fatal("serve did not return after the buyer went away")
	}
	if m.Live() != 1 {
		t.Fatalf("live sandboxes = %d, want 1", m.Live())
	}
	m.Stop("ws-detach")
	waitFor(t, func() bool { return m.Live() == 0 })
}

// Reattaching replays what the sandbox printed while nobody was attached.
func TestReattachReplaysBufferedOutput(t *testing.T) {
	m := newTestManager(t, 2)
	first, firstHive := pair()
	spec := beewire.WorkspaceSpec{ID: "ws-replay", Action: beewire.WorkspaceAttach, Command: []string{"/bin/cat"}}
	done := make(chan struct{})
	go func() {
		defer close(done)
		m.Serve(context.Background(), first, spec)
	}()
	awaitKind(t, collect(firstHive), beewire.FrameReady)
	if err := beewire.WriteWorkspaceFrame(firstHive, beewire.FrameData, []byte("kept\n")); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := firstHive.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("first attach did not return")
	}

	second, secondHive := pair()
	served := make(chan struct{})
	go func() {
		defer close(served)
		m.Serve(context.Background(), second, spec)
	}()
	frames := collect(secondHive)
	awaitKind(t, frames, beewire.FrameReady)
	var replayed strings.Builder
	for !strings.Contains(replayed.String(), "kept") {
		got := awaitKind(t, frames, beewire.FrameData, beewire.FrameExit)
		if got.kind == beewire.FrameExit {
			t.Fatalf("sandbox exited before replaying: %s", got.payload)
		}
		replayed.Write(got.payload)
	}
	m.Stop("ws-replay")
	waitFor(t, func() bool { return m.Live() == 0 })
}

// The stop action takes the sandbox down without a terminal.
func TestStopActionEndsSandbox(t *testing.T) {
	m := newTestManager(t, 1)
	sandbox, hive := pair()
	spec := beewire.WorkspaceSpec{ID: "ws-stop", Action: beewire.WorkspaceAttach, Command: []string{"/bin/cat"}}
	go func() { m.Serve(context.Background(), sandbox, spec) }()
	awaitKind(t, collect(hive), beewire.FrameReady)
	waitFor(t, func() bool { return m.Live() == 1 })

	stopSandbox, stopHive := pair()
	m.Serve(context.Background(), stopSandbox, beewire.WorkspaceSpec{ID: "ws-stop", Action: beewire.WorkspaceStop})
	_ = stopHive.Close()
	waitFor(t, func() bool { return m.Live() == 0 })
}

// A Provider that has not consented hosts nothing.
func TestUnconfiguredManagerRejected(t *testing.T) {
	if _, err := New(Config{Runtime: "nowhere"}, t.TempDir()); err == nil {
		t.Fatal("expected an unsupported runtime to be rejected")
	}
}

// An exit is remembered: status says so, and a reattach gets the exit instead
// of a second sandbox the buyer did not ask for.
func TestExitedSandboxIsReportedNotRestarted(t *testing.T) {
	m := newTestManager(t, 2)
	spec := beewire.WorkspaceSpec{ID: "ws-done", Action: beewire.WorkspaceAttach, Command: []string{"/bin/sh", "-c", "echo done; exit 7"}}
	sandbox, hive := pair()
	go func() { m.Serve(context.Background(), sandbox, spec) }()
	frames := collect(hive)
	awaitKind(t, frames, beewire.FrameReady)
	awaitKind(t, frames, beewire.FrameExit)
	waitFor(t, func() bool { return m.Live() == 0 })

	if state, code := m.status("ws-done"); state != beewire.WorkspaceExited || code != 7 {
		t.Fatalf("status = %s/%d, want exited/7", state, code)
	}

	again, againHive := pair()
	go func() { m.Serve(context.Background(), again, spec) }()
	awaitKind(t, collect(againHive), beewire.FrameExit)
	if m.Live() != 0 {
		t.Fatalf("live sandboxes = %d after reattach to an exited session", m.Live())
	}
}

// A status stream is answered with one frame and starts nothing.
func TestStatusStreamAnswers(t *testing.T) {
	m := newTestManager(t, 1)
	sandbox, hive := pair()
	go m.Serve(context.Background(), sandbox, beewire.WorkspaceSpec{ID: "ws-ask", Action: beewire.WorkspaceStatus})
	kind, payload, err := beewire.ReadWorkspaceFrame(hive)
	if err != nil || kind != beewire.FrameStatus {
		t.Fatalf("status frame = %d %v", kind, err)
	}
	var report beewire.WorkspaceStatusReport
	if err := json.Unmarshal(payload, &report); err != nil || report.State != beewire.WorkspaceUnknown {
		t.Fatalf("status report = %+v, %v", report, err)
	}
	if m.Live() != 0 {
		t.Fatalf("status started %d sandboxes", m.Live())
	}
}

// Status answers the reaper without starting anything, and a session this Bee
// never had is unknown rather than a free restart.
func TestStatusReportsRunningExitedUnknown(t *testing.T) {
	m := newTestManager(t, 1)
	if state, _ := m.status("ws-missing"); state != beewire.WorkspaceUnknown {
		t.Fatalf("unknown session reported as %s", state)
	}

	sandbox, hive := pair()
	spec := beewire.WorkspaceSpec{ID: "ws-live", Action: beewire.WorkspaceAttach, Command: []string{"/bin/cat"}}
	go func() { m.Serve(context.Background(), sandbox, spec) }()
	awaitKind(t, collect(hive), beewire.FrameReady)
	if state, _ := m.status("ws-live"); state != beewire.WorkspaceRunning {
		t.Fatalf("live session reported as %s", state)
	}
	m.Stop("ws-live")
	waitFor(t, func() bool { return m.Live() == 0 })
	if state, _ := m.status("ws-live"); state != beewire.WorkspaceUnknown {
		t.Fatalf("stopped session reported as %s", state)
	}
}

// A stop is the end of the session: the next status must not resurrect an exit
// record the buyer already ended.
func TestStopClearsExitRecord(t *testing.T) {
	m := newTestManager(t, 1)
	spec := beewire.WorkspaceSpec{ID: "ws-clear", Action: beewire.WorkspaceAttach, Command: []string{"/bin/sh", "-c", "exit 3"}}
	sandbox, hive := pair()
	go func() { m.Serve(context.Background(), sandbox, spec) }()
	awaitKind(t, collect(hive), beewire.FrameExit)
	waitFor(t, func() bool { return m.Live() == 0 })
	m.Stop("ws-clear")
	if state, _ := m.status("ws-clear"); state != beewire.WorkspaceUnknown {
		t.Fatalf("exit record survived stop: %s", state)
	}
}

// The disk watchdog measures the volume it would stop.
func TestTreeSizeAddsFiles(t *testing.T) {
	root := t.TempDir()
	if err := os.WriteFile(filepath.Join(root, "a"), make([]byte, 10), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(root, "nested"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "nested", "b"), make([]byte, 5), 0o600); err != nil {
		t.Fatal(err)
	}
	size, err := treeSize(root)
	if err != nil || size != 15 {
		t.Fatalf("treeSize = %d, %v; want 15", size, err)
	}
}

// A sandbox outlives a lost tunnel only for the grace period; after it, the
// Provider destroys it and queues the loss for the next connection.
func TestDisconnectDestroysSandboxesAfterGrace(t *testing.T) {
	m := newTestManager(t, 2)
	sandbox, hive := pair()
	spec := beewire.WorkspaceSpec{ID: "ws-offline", Action: beewire.WorkspaceAttach, Command: []string{"/bin/cat"}}
	go m.Serve(context.Background(), sandbox, spec)
	frames := collect(hive)
	awaitKind(t, frames, beewire.FrameReady)
	m.Disconnected(20 * time.Millisecond)
	waitFor(t, func() bool { return m.Live() == 0 })
	if state, _ := m.status("ws-offline"); state != beewire.WorkspaceUnknown {
		t.Fatalf("destroyed sandbox reported %q, want unknown", state)
	}
	lost := m.TakeLost()
	if len(lost) != 1 || lost[0] != "ws-offline" {
		t.Fatalf("lost = %v, want [ws-offline]", lost)
	}
	if again := m.TakeLost(); len(again) != 0 {
		t.Fatalf("lost not drained: %v", again)
	}
	_ = hive.Close()
}

// A reconnect inside the grace period cancels the destruction.
func TestConnectedCancelsDisconnectDestruction(t *testing.T) {
	m := newTestManager(t, 2)
	sandbox, hive := pair()
	defer hive.Close()
	spec := beewire.WorkspaceSpec{ID: "ws-back", Action: beewire.WorkspaceAttach, Command: []string{"/bin/cat"}}
	go m.Serve(context.Background(), sandbox, spec)
	frames := collect(hive)
	awaitKind(t, frames, beewire.FrameReady)
	m.Disconnected(80 * time.Millisecond)
	m.Connected()
	time.Sleep(150 * time.Millisecond)
	if m.Live() != 1 {
		t.Fatalf("sandbox destroyed after reconnect: live=%d", m.Live())
	}
	m.Stop("ws-back")
}

// A natural exit with nobody attached is reported so Hive does not have to
// wait for the next status poll.
func TestExitNotifierFiresOnNaturalExit(t *testing.T) {
	m := newTestManager(t, 2)
	exits := make(chan string, 1)
	m.SetExitNotifier(func(id string, code int) {
		exits <- fmt.Sprintf("%s:%d", id, code)
	})
	sandbox, hive := pair()
	spec := beewire.WorkspaceSpec{ID: "ws-natural", Action: beewire.WorkspaceAttach, Command: []string{"/bin/sh", "-c", "sleep 0.1"}}
	go m.Serve(context.Background(), sandbox, spec)
	frames := collect(hive)
	awaitKind(t, frames, beewire.FrameReady)
	_ = hive.Close()
	select {
	case got := <-exits:
		if got != "ws-natural:0" {
			t.Fatalf("notified %q, want ws-natural:0", got)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("natural exit was not reported")
	}
}

func waitFor(t *testing.T, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if ok() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("condition not reached in time")
}
