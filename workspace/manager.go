// Package workspace runs a buyer's sandbox on a Provider's machine and serves
// its terminal to Hive over one tunnel stream.
//
// Hive is the only authority over a workspace's life: it decides when one
// starts, how long it may live, and when it ends. What the Bee owns is the
// machine-time in between, which is why a sandbox outlives the attach that
// started it — a buyer who closes the tab keeps the sandbox, and keeps paying
// for it, until Hive says otherwise.
package workspace

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/tokhive/bee/beewire"
)

var (
	// ErrWorkspaceBusy reports a second attach while one is already live. A
	// terminal has one reader; a second would split the stream.
	ErrWorkspaceBusy = errors.New("workspace: already attached")
	// ErrTooMany reports the Provider's configured ceiling on live sandboxes.
	ErrTooMany = errors.New("workspace: too many live sandboxes")
	// ErrStopped reports an attach to a sandbox that is being taken down.
	ErrStopped  = errors.New("workspace: stopped")
	errDetached = errors.New("workspace: detached")
)

// maxBuffered bounds the output held for a buyer who is not attached. Past it
// the oldest bytes are dropped: a build that prints more than this while
// nobody is watching is not worth the Provider's memory.
const maxBuffered = 256 << 10

// Config is the Provider's consent to host workspaces: how many, with which
// runtime, and how much of the machine one may take.
type Config struct {
	// Runtime is "gvisor" (the supported one) or "process" (no isolation,
	// development only). Empty means gvisor.
	Runtime string `json:"runtime"`
	// Environment is the absolute path of an unpacked root filesystem — an
	// OCI image the Provider built once with docker, podman or buildah and
	// exported. Every session runs from it read-only, so it is also the only
	// environment this Bee can offer.
	Environment string `json:"environment,omitempty"`
	// Runsc is the gVisor binary; empty means "runsc" from PATH.
	Runsc string `json:"runsc,omitempty"`
	// Cgroups enforces the memory, CPU and process ceilings through the host's
	// cgroups. It is off by default because a rootless runtime needs a cgroup
	// tree delegated to the Bee before it can write one; with it off, a session
	// is still bounded by MaxSessions but not by its own ceilings.
	Cgroups bool `json:"cgroups,omitempty"`
	// Command is the default entrypoint when a spec names none.
	Command []string `json:"command,omitempty"`
	// MemoryMB is the default memory ceiling.
	MemoryMB int `json:"memory_mb,omitempty"`
	// AllowNetwork gives sandboxes outbound network. Off by default.
	AllowNetwork bool `json:"allow_network,omitempty"`
	// MaxSessions is how many sandboxes may run at once.
	MaxSessions int `json:"max_sessions,omitempty"`
}

// Validate rejects a configuration that cannot work, before a stream arrives.
func (c Config) Validate() error {
	switch c.Runtime {
	case "gvisor":
		if err := checkGVisor(c); err != nil {
			return err
		}
	case "process":
	default:
		return ErrUnsupportedRuntime
	}
	if c.MaxSessions < 0 {
		return errors.New("workspace: max_sessions must not be negative")
	}
	return nil
}

// runsc is the gVisor binary this Bee drives.
func (c Config) runsc() string {
	if c.Runsc != "" {
		return c.Runsc
	}
	return "runsc"
}

// Manager owns the sandboxes this Bee is running.
type Manager struct {
	cfg  Config
	root string

	mu   sync.Mutex
	live map[string]*sandbox
}

// New prepares the workspace root and returns a Manager. root is where every
// sandbox volume lives; it is created 0700 and never points at a home
// directory.
func New(cfg Config, root string) (*Manager, error) {
	if cfg.Runtime == "" {
		cfg.Runtime = "gvisor"
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	if cfg.MaxSessions <= 0 {
		cfg.MaxSessions = 1
	}
	if cfg.MemoryMB <= 0 {
		cfg.MemoryMB = 1024
	}
	if !filepath.IsAbs(root) {
		return nil, errors.New("workspace: root must be absolute")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, err
	}
	return &Manager{cfg: cfg, root: root, live: map[string]*sandbox{}}, nil
}

// Serve handles one workspace stream: attach to a sandbox, or stop it.
func (m *Manager) Serve(ctx context.Context, rw io.ReadWriteCloser, spec beewire.WorkspaceSpec) {
	defer rw.Close()
	if spec.ID == "" || len(spec.ID) > 128 {
		writeProblem(rw, "BEE-WORKSPACE-SPEC", "workspace id missing or too long")
		return
	}
	if spec.Action == beewire.WorkspaceStop {
		m.Stop(spec.ID)
		return
	}
	sb, err := m.target(spec)
	if err != nil {
		slog.Warn("workspace did not start", "module", "workspace", "workspace", spec.ID, "error", err)
		writeProblem(rw, "BEE-WORKSPACE-START", err.Error())
		return
	}
	if err := sb.attach(ctx, rw); err != nil && !errors.Is(err, errDetached) {
		slog.Warn("workspace attach failed", "module", "workspace", "workspace", spec.ID, "error", err)
		writeProblem(rw, "BEE-WORKSPACE-ATTACH", err.Error())
	}
}

// target returns the sandbox for spec, starting one if this is its first
// attach. A sandbox that already exited is reported, not restarted: the buyer
// pays for a session, not for however many attempts it takes.
func (m *Manager) target(spec beewire.WorkspaceSpec) (*sandbox, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if sb := m.live[spec.ID]; sb != nil {
		if !sb.finished() {
			return sb, nil
		}
		delete(m.live, spec.ID)
		sb.discard()
	}
	if len(m.live) >= m.cfg.MaxSessions {
		return nil, ErrTooMany
	}
	dir := filepath.Join(m.root, volumeName(spec.ID))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	// The runtime's own state sits beside the volume, never inside it: a buyer
	// is root in the sandbox and could otherwise reach the sockets that are
	// running it.
	state := filepath.Join(m.root, "run", volumeName(spec.ID))
	proc, err := m.cfg.start(spec, dir, state)
	if err != nil {
		return nil, err
	}
	sb := newSandbox(spec, proc, dir, m)
	m.live[spec.ID] = sb
	go sb.run()
	ttl := spec.TTL
	if ttl <= 0 {
		ttl = 600
	}
	// The TTL is the Bee's own backstop. Hive ends a workspace on its clock;
	// this only catches a Hive that stopped talking.
	time.AfterFunc(time.Duration(ttl)*time.Second, func() { m.Stop(spec.ID) })
	slog.Info("workspace started", "module", "workspace", "workspace", spec.ID,
		"runtime", m.cfg.Runtime, "environment", m.cfg.Environment, "ttl_s", ttl)
	return sb, nil
}

// Stop takes a sandbox down and forgets it.
func (m *Manager) Stop(id string) {
	m.mu.Lock()
	sb := m.live[id]
	delete(m.live, id)
	m.mu.Unlock()
	if sb == nil {
		return
	}
	sb.stop()
	slog.Info("workspace stopped", "module", "workspace", "workspace", id)
}

// Close takes every sandbox down, for shutdown.
func (m *Manager) Close() {
	m.mu.Lock()
	live := m.live
	m.live = map[string]*sandbox{}
	m.mu.Unlock()
	for _, sb := range live {
		sb.stop()
	}
}

// Live reports how many sandboxes are running, for the console and tests.
func (m *Manager) Live() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.live)
}

// sandbox is one running sandbox and the bytes waiting for its buyer.
type sandbox struct {
	id   string
	spec beewire.WorkspaceSpec
	proc *process
	dir  string
	m    *Manager

	mu       sync.Mutex
	cond     *sync.Cond
	pending  []byte
	exited   bool
	code     int
	attached bool
	stopped  bool
	pumpStop bool
	// attachSeq numbers attaches so a detached stream cannot stop the pump of
	// the one that replaced it.
	attachSeq int64
}

func newSandbox(spec beewire.WorkspaceSpec, proc *process, dir string, m *Manager) *sandbox {
	sb := &sandbox{id: spec.ID, spec: spec, proc: proc, dir: dir, m: m}
	sb.cond = sync.NewCond(&sb.mu)
	go sb.collect()
	return sb
}

// collect copies the sandbox's output into the buffer until it exits.
func (sb *sandbox) collect() {
	buf := make([]byte, 16<<10)
	for {
		n, err := sb.proc.stdout.Read(buf)
		if n > 0 {
			sb.mu.Lock()
			sb.pending = append(sb.pending, buf[:n]...)
			if over := len(sb.pending) - maxBuffered; over > 0 {
				sb.pending = sb.pending[:copy(sb.pending, sb.pending[over:])]
			}
			sb.mu.Unlock()
			sb.cond.Broadcast()
		}
		if err != nil {
			return
		}
	}
}

// run waits for the exit and releases the sandbox.
func (sb *sandbox) run() {
	code := sb.proc.Wait()
	sb.mu.Lock()
	sb.exited, sb.code = true, code
	sb.mu.Unlock()
	sb.cond.Broadcast()
	sb.m.discard(sb)
}

// discard removes the sandbox's volume and forgets it, if it is still current.
func (m *Manager) discard(sb *sandbox) {
	m.mu.Lock()
	if m.live[sb.id] == sb {
		delete(m.live, sb.id)
	}
	m.mu.Unlock()
	sb.discard()
}

func (sb *sandbox) discard() {
	if sb.proc.cleanup != nil {
		sb.proc.cleanup()
	}
	if err := os.RemoveAll(sb.dir); err != nil {
		slog.Warn("workspace volume not removed", "module", "workspace", "workspace", sb.id, "error", err)
	}
}

func (sb *sandbox) finished() bool {
	sb.mu.Lock()
	defer sb.mu.Unlock()
	return sb.exited || sb.stopped
}

func (sb *sandbox) stop() {
	sb.mu.Lock()
	sb.stopped = true
	sb.pumpStop = true
	sb.mu.Unlock()
	sb.cond.Broadcast()
	sb.proc.kill()
}

// attach streams the terminal to rw until the sandbox exits or rw fails.
func (sb *sandbox) attach(ctx context.Context, rw io.ReadWriteCloser) error {
	sb.mu.Lock()
	if sb.stopped {
		sb.mu.Unlock()
		return ErrStopped
	}
	if sb.attached {
		sb.mu.Unlock()
		return ErrWorkspaceBusy
	}
	if sb.exited {
		code := sb.code
		sb.mu.Unlock()
		return writeExit(rw, code)
	}
	sb.attached = true
	sb.pumpStop = false
	sb.attachSeq++
	attach := sb.attachSeq
	sb.mu.Unlock()
	defer func() {
		sb.mu.Lock()
		sb.attached = false
		sb.mu.Unlock()
	}()

	if err := writeFrame(rw, beewire.FrameReady, beewire.WorkspaceReady{ID: sb.id}); err != nil {
		return err
	}
	go sb.feed(rw, attach)

	// A buyer that goes away must not leave the pump waiting on a condition
	// the sandbox will never signal.
	watch := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			sb.detach(attach)
		case <-watch:
		}
	}()
	err := sb.pump(rw)
	close(watch)
	_ = rw.Close()
	return err
}

// feed copies the buyer's input into the sandbox until the stream fails, then
// releases the pump: the stream is how an attach learns the buyer is gone.
func (sb *sandbox) feed(rw io.Reader, attach int64) {
	defer sb.detach(attach)
	for {
		kind, payload, err := beewire.ReadWorkspaceFrame(rw)
		if err != nil {
			return
		}
		if kind != beewire.FrameData {
			continue
		}
		if _, err := sb.proc.stdin.Write(payload); err != nil {
			return
		}
	}
}

// detach stops the pump of the attach it belongs to, if that attach is still
// the current one.
func (sb *sandbox) detach(attach int64) {
	sb.mu.Lock()
	if sb.attachSeq == attach {
		sb.pumpStop = true
	}
	sb.mu.Unlock()
	sb.cond.Broadcast()
}

// pump drains buffered output to the buyer, then reports the exit.
func (sb *sandbox) pump(rw io.Writer) error {
	for {
		sb.mu.Lock()
		for len(sb.pending) == 0 && !sb.exited && !sb.pumpStop {
			sb.cond.Wait()
		}
		if sb.pumpStop {
			sb.mu.Unlock()
			return errDetached
		}
		if len(sb.pending) > 0 {
			chunk := sb.pending
			if len(chunk) > beewire.MaxWorkspaceFrame {
				chunk = chunk[:beewire.MaxWorkspaceFrame]
			}
			sb.pending = sb.pending[len(chunk):]
			if len(sb.pending) == 0 {
				sb.pending = nil
			}
			out := append([]byte(nil), chunk...)
			sb.mu.Unlock()
			if err := beewire.WriteWorkspaceFrame(rw, beewire.FrameData, out); err != nil {
				return err
			}
			continue
		}
		code := sb.code
		sb.mu.Unlock()
		return writeExit(rw, code)
	}
}

func writeFrame(w io.Writer, kind byte, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	return beewire.WriteWorkspaceFrame(w, kind, payload)
}

func writeExit(w io.Writer, code int) error {
	return writeFrame(w, beewire.FrameExit, beewire.WorkspaceExit{Code: code})
}

func writeProblem(w io.Writer, code, message string) {
	_ = writeFrame(w, beewire.FrameError, beewire.WorkspaceError{Code: code, Message: message})
}

// volumeName maps a workspace id onto a single safe path element.
func volumeName(id string) string {
	name := strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, id)
	if name == "" || name == "." || name == ".." {
		return "workspace"
	}
	return name
}
