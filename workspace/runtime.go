package workspace

import (
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"

	"github.com/tokhive/bee/beewire"
)

// ErrUnsupportedRuntime reports a runtime name this Bee does not implement.
var ErrUnsupportedRuntime = errors.New("workspace: unsupported runtime")

// imageName admits the characters an image reference uses. The spec arrives
// from Hive, but it reaches a command line, so it is checked rather than
// trusted.
var imageName = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,200}$`)

// A process is one started sandbox. stdin and stdout carry the terminal; kill
// takes down the whole group, not just the leader.
type process struct {
	cmd    *exec.Cmd
	stdin  io.WriteCloser
	stdout io.ReadCloser
	kill   func()
}

// start begins a sandbox for spec, with dir as its only writable host path.
func (c Config) start(spec beewire.WorkspaceSpec, dir string) (*process, error) {
	switch c.Runtime {
	case "docker":
		return startDocker(c, spec, dir)
	case "process":
		return startProcess(spec, dir)
	}
	return nil, ErrUnsupportedRuntime
}

// containerName maps a workspace id onto the characters a container name
// accepts, so two ids that differ only outside that set cannot collide in a
// way that matters: the label check in stop catches it.
func containerName(id string) string {
	return "tokhive-ws-" + strings.Map(func(r rune) rune {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' {
			return r
		}
		return '-'
	}, id)
}

func startDocker(c Config, spec beewire.WorkspaceSpec, dir string) (*process, error) {
	if !imageName.MatchString(spec.Image) {
		return nil, fmt.Errorf("image %q is not a valid reference", spec.Image)
	}
	name := containerName(spec.ID)
	command := spec.Command
	if len(command) == 0 {
		command = c.Command
	}
	if len(command) == 0 {
		command = []string{"sh"}
	}
	memory := spec.MemoryMB
	if memory <= 0 {
		memory = c.MemoryMB
	}
	if memory <= 0 {
		memory = 1024
	}
	cpus := spec.CPU
	if cpus <= 0 {
		cpus = 1
	}
	args := []string{
		"run", "--rm", "-i",
		"--name", name,
		"--label", "tokhive.workspace=" + spec.ID,
		// The sandbox reaches nothing on the Provider's machine beyond its own
		// volume, and holds no capability that would let it try.
		"--cap-drop", "ALL",
		"--security-opt", "no-new-privileges",
		"--pids-limit", "256",
		"--memory", strconv.Itoa(memory) + "m",
		"--cpus", strconv.FormatFloat(cpus, 'f', 2, 64),
		"-v", dir + ":/workspace",
		"-w", "/workspace",
	}
	if !c.AllowNetwork {
		args = append(args, "--network", "none")
	}
	args = append(args, spec.Image)
	args = append(args, command...)
	cmd := exec.Command("docker", args...)
	cmd.Stderr = io.Discard
	stdin, stdout, err := pipes(cmd)
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	return &process{cmd: cmd, stdin: stdin, stdout: stdout, kill: func() {
		_ = exec.Command("docker", "rm", "-f", name).Run()
	}}, nil
}

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
	if err == nil {
		return 0
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return exit.ExitCode()
	}
	return -1
}
