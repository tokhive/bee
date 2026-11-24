package workspace

import (
	"errors"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"strings"

	"github.com/tokhive/bee/beewire"
)

// ErrUnsupportedRuntime reports a runtime name this Bee does not implement.
var ErrUnsupportedRuntime = errors.New("workspace: unsupported runtime")

// The two runtimes are "gvisor" — one OCI container per session through runsc
// on a rootless user namespace: an environment the Provider prepared, a
// read-only root, and one writable volume — and "process", which runs the
// command on the Provider's own machine and isolates nothing.

// A process is one started sandbox. stdin and stdout carry the terminal; kill
// takes down the whole group, not just the leader.
type process struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	kill   func()
	// cleanup removes the runtime's own state, which lives outside the volume
	// so the sandbox cannot reach it while it is live.
	cleanup func()
	// logPath is where the runtime wrote what it had to say about the
	// session, when it wrote anything.
	logPath string
}

// start begins a sandbox for spec. volume is the session's only writable host
// path; state is where the runtime keeps its own files, outside that volume.
func (c Config) start(spec beewire.WorkspaceSpec, volume, state string) (*process, error) {
	switch c.Runtime {
	case "gvisor":
		return startGVisor(c, spec, volume, state)
	case "process":
		return startProcess(spec, volume)
	}
	return nil, ErrUnsupportedRuntime
}

// containerID names the OCI container for a workspace. It reuses the volume's
// safe name because each session has its own state root: the id only has to be
// legal, not unique across machines.
func containerID(id string) string { return "ws-" + volumeName(id) }

// startProcess runs the sandbox on the Provider's own machine. It is the
// development runtime: it isolates nothing, and Config.Validate only admits it
// when it was asked for by name.
func startProcess(spec beewire.WorkspaceSpec, dir string) (*process, error) {
	command := spec.Command
	if len(command) == 0 {
		command = []string{"/bin/sh"}
	}
	cmd := exec.Command(command[0], command[1:]...)
	cmd.Dir = dir
	cmd.Env = append(os.Environ(), "HOME="+dir)
	cmd.Stderr = io.Discard
	setGroup(cmd)
	stdin, stdout, err := pipes(cmd)
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &process{cmd: cmd, stdin: stdin, stdout: stdout, kill: func() { signalGroup(cmd) }}, nil
}

func pipes(cmd *exec.Cmd) (io.WriteCloser, io.ReadCloser, error) {
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, nil, err
	}
	return stdin, stdout, nil
}

// Wait blocks until the sandbox exits and returns its code.
func (p *process) Wait() int {
	err := p.cmd.Wait()
	_ = p.stdin.Close()
	code := 0
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			code = exit.ExitCode()
		} else {
			code = -1
		}
	}
	// A sandbox that died before printing anything explains itself only on the
	// runtime's own log, which is where runsc puts a failed start.
	if code != 0 && p.logPath != "" {
		if tail := tailOf(p.logPath, 2<<10); tail != "" {
			slog.Warn("sandbox runtime said", "module", "workspace", "runtime_log", tail)
		}
	}
	return code
}

// tailOf returns at most n bytes from the end of path, trimmed.
func tailOf(path string, n int64) string {
	f, err := os.Open(path)
	if err != nil {
		return ""
	}
	defer f.Close()
	if size, err := f.Seek(0, io.SeekEnd); err == nil && size > n {
		if _, err := f.Seek(size-n, io.SeekStart); err != nil {
			return ""
		}
	}
	body, err := io.ReadAll(io.LimitReader(f, n))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(body))
}
