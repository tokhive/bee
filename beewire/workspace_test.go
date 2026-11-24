package beewire

import (
	"bytes"
	"errors"
	"testing"
)

func TestWorkspaceFramesRoundTrip(t *testing.T) {
	var wire bytes.Buffer
	want := []byte("hello, sandbox")
	if err := WriteWorkspaceFrame(&wire, FrameData, want); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := WriteWorkspaceFrame(&wire, FrameExit, []byte(`{"code":0}`)); err != nil {
		t.Fatalf("write exit: %v", err)
	}

	kind, payload, err := ReadWorkspaceFrame(&wire)
	if err != nil || kind != FrameData || !bytes.Equal(payload, want) {
		t.Fatalf("first frame = %d %q %v", kind, payload, err)
	}
	kind, payload, err = ReadWorkspaceFrame(&wire)
	if err != nil || kind != FrameExit || string(payload) != `{"code":0}` {
		t.Fatalf("second frame = %d %q %v", kind, payload, err)
	}
	if _, _, err := ReadWorkspaceFrame(&wire); err == nil {
		t.Fatal("expected the stream to end after two frames")
	}
}

func TestWorkspaceFrameRejectsOversize(t *testing.T) {
	var wire bytes.Buffer
	if err := WriteWorkspaceFrame(&wire, FrameData, make([]byte, MaxWorkspaceFrame+1)); !errors.Is(err, ErrWorkspaceFrame) {
		t.Fatalf("write oversize = %v, want ErrWorkspaceFrame", err)
	}
}

func TestWorkspaceFrameRejectsUnknownKind(t *testing.T) {
	wire := bytes.NewReader([]byte{9, 0, 0, 0, 0})
	if _, _, err := ReadWorkspaceFrame(wire); !errors.Is(err, ErrWorkspaceFrame) {
		t.Fatalf("read unknown kind = %v, want ErrWorkspaceFrame", err)
	}
}
