package beewire

import (
	"encoding/binary"
	"errors"
	"io"
)

// ControlWorkspaces declares, in the X-Bee-Controls header, that a Bee hosts
// workspaces: long-lived sandboxes whose terminal Hive drives over one tunnel
// stream. A Bee that does not declare it is never sent one, and an older Bee
// that receives one rejects it as a host outside its allowlist, so the
// declaration is what keeps the two sides apart.
const ControlWorkspaces = "workspaces"

// A workspace stream's action. Attach starts the sandbox if it is not running
// and streams its terminal; stop takes the whole sandbox down.
const (
	WorkspaceAttach = "attach"
	WorkspaceStop   = "stop"
)

// WorkspaceSpec is the open metadata of a workspace stream. It is the whole
// authority the Bee gets: which image, how much of the machine, how long. A
// stream that carries one has already been authorized by Hive, which is why it
// does not go through the egress target allowlist.
type WorkspaceSpec struct {
	ID       string   `json:"id"`
	Action   string   `json:"action,omitempty"`
	Image    string   `json:"image,omitempty"`
	Command  []string `json:"command,omitempty"`
	CPU      float64  `json:"cpu,omitempty"`
	MemoryMB int      `json:"memory_mb,omitempty"`
	TTL      int      `json:"ttl_s,omitempty"`
}

// Workspace frame kinds. Data carries terminal bytes in either direction; the
// other three are JSON and travel Bee to Hive only.
const (
	FrameData  byte = 1
	FrameExit  byte = 2
	FrameError byte = 3
	FrameReady byte = 4
)

// MaxWorkspaceFrame bounds one frame. The tunnel carries frames of up to 1 MiB
// and a terminal write larger than this is split rather than rejected.
const MaxWorkspaceFrame = 32 << 10

// ErrWorkspaceFrame reports a frame whose length is past MaxWorkspaceFrame or
// whose kind is unknown. The stream is unusable after it.
var ErrWorkspaceFrame = errors.New("beewire: malformed workspace frame")

// WorkspaceExit is the frame a sandbox's terminal ends with.
type WorkspaceExit struct {
	Code int `json:"code"`
}

// WorkspaceError is the frame a sandbox that could not start ends with.
type WorkspaceError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// WorkspaceReady is the frame a sandbox sends once its terminal is live. Hive
// counts a workspace as running from it, not from the attach.
type WorkspaceReady struct {
	ID string `json:"id"`
}

// WriteWorkspaceFrame writes one framed message. The payload is copied into a
// single Write so a concurrent writer cannot interleave its header.
func WriteWorkspaceFrame(w io.Writer, kind byte, payload []byte) error {
	if len(payload) > MaxWorkspaceFrame {
		return ErrWorkspaceFrame
	}
	frame := make([]byte, 5+len(payload))
	frame[0] = kind
	binary.BigEndian.PutUint32(frame[1:5], uint32(len(payload)))
	copy(frame[5:], payload)
	_, err := w.Write(frame)
	return err
}

// ReadWorkspaceFrame reads one framed message. The returned payload is a fresh
// slice the caller owns.
func ReadWorkspaceFrame(r io.Reader) (byte, []byte, error) {
	var header [5]byte
	if _, err := io.ReadFull(r, header[:]); err != nil {
		return 0, nil, err
	}
	kind := header[0]
	length := binary.BigEndian.Uint32(header[1:5])
	if length > MaxWorkspaceFrame {
		return 0, nil, ErrWorkspaceFrame
	}
	switch kind {
	case FrameData, FrameExit, FrameError, FrameReady:
	default:
		return 0, nil, ErrWorkspaceFrame
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(r, payload); err != nil {
		return 0, nil, err
	}
	return kind, payload, nil
}
