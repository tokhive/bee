package workspace

import (
	"context"
	"io"
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
