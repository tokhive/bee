package bee

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strings"
)

var errServiceUnavailable = errors.New("managed system service unavailable")

type serviceState struct{ LoadState, ActiveState, UnitFileState string }
type managedService struct {
	configPath, egressPath, binary, username, uid, platform, unitPath string
	in                                                                io.Reader
	out                                                               io.Writer
	execute                                                           func(context.Context, string, []string, io.Reader, io.Writer) (string, error)
}

func newManagedService(configPath, egressPath string, in io.Reader, out io.Writer) (*managedService, error) {
	current, err := user.Current()
	if err != nil {
		return nil, fmt.Errorf("identify service user: %w", err)
	}
	binary, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("locate Bee executable: %w", err)
	}
	binary, err = filepath.EvalSymlinks(binary)
	if err != nil {
		return nil, fmt.Errorf("resolve Bee executable %q: %w", binary, err)
	}
	return &managedService{configPath: configPath, egressPath: egressPath, binary: binary, username: current.Username, uid: current.Uid, platform: runtime.GOOS, unitPath: "/etc/systemd/system/tokhive-bee.service", in: in, out: out, execute: executeService}, nil
}
func executeService(ctx context.Context, name string, args []string, in io.Reader, out io.Writer) (string, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Stdin = in
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	if out != nil {
		cmd.Stdout = io.MultiWriter(&stdout, out)
	}
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return stdout.String(), fmt.Errorf("%s %q: %w; stderr: %s", name, args, err, strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}
func (s *managedService) inspect(ctx context.Context) (serviceState, error) {
	var state serviceState
	if s.platform != "linux" {
		return state, fmt.Errorf("%w: platform=%s; use bee start for foreground operation", errServiceUnavailable, s.platform)
	}
	raw, err := s.execute(ctx, "systemctl", []string{"show", "tokhive-bee", "--property=LoadState,ActiveState,UnitFileState,User,FragmentPath,DropInPaths,NeedDaemonReload"}, nil, nil)
	if err != nil {
		return state, fmt.Errorf("inspect tokhive-bee: %w", err)
	}
	props := map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(raw), "\n") {
		k, v, ok := strings.Cut(line, "=")
		if ok {
			props[k] = v
		}
	}
	state = serviceState{props["LoadState"], props["ActiveState"], props["UnitFileState"]}
	if state.LoadState == "not-found" {
		return state, fmt.Errorf("%w: tokhive-bee LoadState=not-found; run install.sh to install the service", errServiceUnavailable)
	}
	if state.LoadState != "loaded" {
		return state, fmt.Errorf("tokhive-bee LoadState=%q; expected loaded", state.LoadState)
	}
	if props["User"] != s.username && props["User"] != s.uid {
		return state, fmt.Errorf("tokhive-bee User=%q; expected current user %q (%s); manage it manually", props["User"], s.username, s.uid)
	}
	if props["FragmentPath"] != s.unitPath {
		return state, fmt.Errorf("tokhive-bee FragmentPath=%q; expected %q; manage it manually", props["FragmentPath"], s.unitPath)
	}
	if props["DropInPaths"] != "" {
		return state, fmt.Errorf("tokhive-bee DropInPaths=%q; customized units require manual management", props["DropInPaths"])
	}
	if props["NeedDaemonReload"] != "no" {
		return state, fmt.Errorf("tokhive-bee NeedDaemonReload=%q; loaded and saved settings must agree", props["NeedDaemonReload"])
	}
	if err := s.validateUnit(props["User"]); err != nil {
		return state, err
	}
	return state, nil
}
func (s *managedService) apply(ctx context.Context, action string) (serviceState, error) {
	switch action {
	case "start", "stop", "restart", "enable", "disable":
	default:
		return serviceState{}, fmt.Errorf("unsupported service action %q", action)
	}
	state, err := s.inspect(ctx)
	if err != nil {
		return state, err
	}
	switch state.ActiveState {
	case "active", "inactive", "failed":
	default:
		return state, fmt.Errorf("tokhive-bee ActiveState=%q; wait for a stable service state before %s", state.ActiveState, action)
	}
	name, args := "systemctl", []string{action, "tokhive-bee"}
	if s.uid != "0" {
		name = "sudo"
		args = append([]string{"systemctl"}, args...)
	}
	if _, err = s.execute(ctx, name, args, s.in, s.out); err != nil {
		return state, fmt.Errorf("service %s result unconfirmed; query its state again: %w", action, err)
	}
	state, err = s.inspect(ctx)
	if err != nil {
		return state, fmt.Errorf("service %s finished but verification failed: %w", action, err)
	}
	want := "active"
	actual := state.ActiveState
	switch action {
	case "stop":
		want = "inactive"
	case "enable":
		want = "enabled"
		actual = state.UnitFileState
	case "disable":
		want = "disabled"
		actual = state.UnitFileState
	}
	if actual != want {
		return state, fmt.Errorf("tokhive-bee after %s: state=%q; expected %q; operation is not confirmed", action, actual, want)
	}
	return state, nil
}
func (s *managedService) logs(ctx context.Context, elevated bool) error {
	if _, err := s.inspect(ctx); err != nil {
		return err
	}
	name, args := "journalctl", []string{"-u", "tokhive-bee", "-n", "50", "--no-pager"}
	if elevated && s.uid != "0" {
		name = "sudo"
		args = append([]string{"journalctl"}, args...)
	}
	_, err := s.execute(ctx, name, args, s.in, s.out)
	return err
}
