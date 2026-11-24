//go:build workspace_process

package workspace

import (
	"io"
	"os"
	"os/exec"

	"github.com/tokhive/bee/beewire"
)

// processRuntimeEnabled is true only in a development build. The process
// runtime runs buyer commands directly on the Provider's machine with the
// Provider's environment; a release build must not contain it at all.
const processRuntimeEnabled = true

// startProcess runs the sandbox on the Provider's own machine. It isolates
// nothing and exists for development on hosts without gVisor.
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
