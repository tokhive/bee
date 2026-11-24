//go:build unix

package workspace

import (
	"os/exec"
	"syscall"
)

// setGroup puts the sandbox in its own process group, so stopping it stops
// whatever it started.
func setGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}

func signalGroup(cmd *exec.Cmd) {
	if cmd.Process == nil {
		return
	}
	_ = syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
}
