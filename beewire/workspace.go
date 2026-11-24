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

// WorkspaceLimitsHeader announces, on a Bee's connection request, the
// workspace capacity Hive may schedule against. Without it Hive assumes one
// sandbox per Bee, which is the Manager's own default and the safe minimum.
const WorkspaceLimitsHeader = "X-Bee-Workspace"

// WorkspaceLimits is the JSON value of WorkspaceLimitsHeader.
type WorkspaceLimits struct {
	MaxSessions int `json:"max_sessions"`
}

// WorkspaceEvent is the open metadata of a Bee-initiated notification stream:
// {"workspace_event":{...}}. It is how an exit reaches Hive while no buyer
// stream is attached. The tunnel is already authenticated, and Hive checks the
// workspace belongs to this Provider before acting on it.
type WorkspaceEvent struct {
	ID    string `json:"id"`
	State string `json:"state"`
	Code  int    `json:"code,omitempty"`
}

// WorkspaceLost says the Bee destroyed the sandbox because it could not reach
// Hive for the whole disconnect grace period. Hive treats it as a lost
// Provider, not as the buyer ending the session, so the block is refunded by
// the platform.
const WorkspaceLost = "lost"

// A workspace stream's action. Attach starts the sandbox if it is not running
// and streams its terminal; stop takes the whole sandbox down; status reports
// what the Bee still holds, without starting anything.
const (
	WorkspaceAttach = "attach"
	WorkspaceStop   = "stop"
	WorkspaceStatus = "status"
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
// others are JSON and travel Bee to Hive only. Status answers a status stream:
// it says whether the sandbox is still live, so Hive can decide about the next
// block without charging for a machine that is gone.
const (
	FrameData   byte = 1
	FrameExit   byte = 2
	FrameError  byte = 3
	FrameReady  byte = 4
	FrameStatus byte = 5
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

// WorkspaceReady is the frame a sandbox sends once its terminal is live. It is
// a health signal, not a billing one: Hive starts a workspace's clock on the
// buyer's first successful data frame, not on this.
type WorkspaceReady struct {
	ID string `json:"id"`
}

// Workspace status values. "unknown" means the Bee holds no record: the
// sandbox either never existed here or was lost with a Bee restart.
const (
	WorkspaceRunning = "running"
	WorkspaceExited  = "exited"
	WorkspaceUnknown = "unknown"
)

// WorkspaceStatusReport answers a status stream.
type WorkspaceStatusReport struct {
	ID    string `json:"id"`
	State string `json:"state"`
	Code  int    `json:"code,omitempty"`
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
	case FrameData, FrameExit, FrameError, FrameReady, FrameStatus:
	default:
		return 0, nil, ErrWorkspaceFrame
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(r, payload); err != nil {
		return 0, nil, err
	}
	return kind, payload, nil
}
