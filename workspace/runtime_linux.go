//go:build linux

package workspace

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"time"

	"github.com/tokhive/bee/beewire"
)

// checkGVisor refuses a configuration this machine cannot honor, before a buyer
// is charged for a session that would fail to start.
func checkGVisor(c Config) error {
	if c.Environment == "" {
		return errors.New("workspace: gvisor needs an environment: set environment to an unpacked root filesystem")
	}
	if !filepath.IsAbs(c.Environment) {
		return errors.New("workspace: environment must be an absolute path")
	}
	info, err := os.Stat(c.Environment)
	if err != nil {
		return fmt.Errorf("workspace: environment: %w", err)
	}
	if !info.IsDir() {
		return errors.New("workspace: environment must be a directory holding an unpacked root filesystem")
	}
	if _, err := exec.LookPath(c.runsc()); err != nil {
		return fmt.Errorf("workspace: %s not found: install gVisor or set runsc to it", c.runsc())
	}
	return nil
}

// startGVisor starts one session as one OCI container under runsc. There is no
// daemon and no image pull: the bundle is a directory this function writes and
// the runtime executes, so a session costs a boot and nothing else.
func startGVisor(c Config, spec beewire.WorkspaceSpec, volume, state string) (*process, error) {
	// The environment is the Provider's, not the one Hive named: a Bee hosts
	// the image its operator prepared, and saying so beats pretending the two
	// are the same file.
	if spec.Image != "" {
		slog.Warn("workspace image ignored: this Bee runs its own environment",
			"module", "workspace", "workspace", spec.ID, "requested", spec.Image, "environment", c.Environment)
	}
	if err := os.MkdirAll(state, 0o700); err != nil {
		return nil, err
	}
	// A start that fails leaves nothing behind; once it works, the state lives
	// until the sandbox is discarded.
	started := false
	defer func() {
		if !started {
			_ = os.RemoveAll(state)
		}
	}()
	// The CLIs keep their state under HOME, which is the read-only root's
	// writable neighbour; both directories must exist before the first prompt.
	if err := os.MkdirAll(filepath.Join(volume, ".tmp"), 0o700); err != nil {
		return nil, err
	}
	bundle := filepath.Join(state, "bundle")
	if err := os.MkdirAll(bundle, 0o700); err != nil {
		return nil, err
	}
	config, err := buildSpec(c, spec, volume, uint32(os.Getuid()), uint32(os.Getgid()))
	if err != nil {
		return nil, err
	}
	if err := os.WriteFile(filepath.Join(bundle, "config.json"), config, 0o600); err != nil {
		return nil, err
	}
	logPath := filepath.Join(state, "runtime.log")
	logFile, err := os.OpenFile(logPath, os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil, err
	}
	id := containerID(spec.ID)
	cmd := exec.Command(c.runsc(), gvisorArgs(c, state, id, bundle)...)
	cmd.Stderr = logFile
	setGroup(cmd)
	stdin, stdout, err := pipes(cmd)
	if err != nil {
		_ = logFile.Close()
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		_ = logFile.Close()
		return nil, err
	}
	started = true
	// The child holds its own copy of the descriptor; the parent's is done.
	_ = logFile.Close()
	return &process{
		cmd:    cmd,
		stdin:  stdin,
		stdout: stdout,
		kill: func() {
			killGVisor(c, state, id)
			signalGroup(cmd)
		},
		cleanup: func() { _ = os.RemoveAll(state) },
		logPath: logPath,
	}, nil
}

// killGVisor takes the container down through the runtime. Killing the runsc
// process alone leaves the sentry and the gofer behind, holding the volume.
func killGVisor(c Config, state, id string) {
	root := "--root=" + filepath.Join(state, "runsc")
	runsc(c, root, "kill", id, "KILL")
	runsc(c, root, "delete", "--force", id)
}

// runsc runs one best-effort runtime command with a bound, for teardown paths
// that must not wait on a runtime that has already given up.
func runsc(c Config, args ...string) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = exec.CommandContext(ctx, c.runsc(), args...).Run()
}
