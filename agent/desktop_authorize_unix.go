//go:build !windows

package bee

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"reflect"
	"slices"
	"strconv"
	"syscall"
	"time"
)

// The fixed supervisor keeps its process-group ID reserved until the owner
// cleans the group and reaps it. Waiting directly on the official command could
// reap its PID before a concurrent cancellation signals that group. No input is
// interpolated into shell code; the executable and every argument remain argv.
const desktopAuthorizationSupervisor = `"$@" 3>&- <&4 4<&- &
child=$!
wait "$child"
result=$?
printf '%s\n' "$result" >&3
IFS= read -r cleanup
`

// Tests dispatch this same private entry point through their executable's
// subprocess helper. Production always reexecutes Bee's fixed internal command.
var desktopAuthorizationSupervisorArguments = []string{"desktop-login-supervisor"}

var desktopAuthorizationSupervisorEnvironment []string

var desktopAuthorizationObserveGroup = observeDesktopAuthorizationGroup

var desktopAuthorizationSignalGroup = syscall.Kill

type desktopAuthorizationSupervisorResult struct {
	Error         string `json:"error,omitempty"`
	CleanupFailed bool   `json:"cleanup_failed,omitempty"`
	GuardRetained bool   `json:"guard_retained,omitempty"`
}

type desktopAuthorizationOutput struct {
	file, reader *os.File
	done         chan error
}

func prepareDesktopAuthorizationOutput(writer io.Writer) (*desktopAuthorizationOutput, error) {
	output := &desktopAuthorizationOutput{}
	if writer == nil {
		return output, nil
	}
	if file, ok := writer.(*os.File); ok {
		output.file = file
		return output, nil
	}
	reader, file, err := os.Pipe()
	if err != nil {
		return nil, err
	}
	output.file, output.reader, output.done = file, reader, make(chan error, 1)
	go func() {
		_, err := io.Copy(writer, reader)
		output.done <- err
	}()
	return output, nil
}

func (output *desktopAuthorizationOutput) started() {
	if output.reader != nil {
		_ = output.file.Close()
	}
}

func (output *desktopAuthorizationOutput) finish(interrupt bool) error {
	if output.reader == nil {
		return nil
	}
	output.started()
	if interrupt {
		_ = output.reader.Close()
	}
	err := <-output.done
	_ = output.reader.Close()
	if interrupt && errors.Is(err, os.ErrClosed) {
		return nil
	}
	if err != nil {
		return desktopAuthorizationProcessError("forward guardian output", err)
	}
	return nil
}

// The separate Go guardian survives the management process. It is the sole
// parent/Wait owner of the reserved group leader, including after lifetime EOF.
func runDesktopAuthorization(ctx context.Context, command *exec.Cmd) (result error) {
	if err := ctx.Err(); err != nil {
		return err
	}
	program, err := os.Executable()
	if err != nil {
		return desktopAuthorizationProcessError("locate login guardian", err)
	}
	statusRead, statusWrite, err := os.Pipe()
	if err != nil {
		return desktopAuthorizationProcessError("create guardian status pipe", err)
	}
	defer statusRead.Close()
	defer statusWrite.Close()
	lifetimeRead, lifetimeWrite, err := os.Pipe()
	if err != nil {
		return desktopAuthorizationProcessError("create guardian lifetime pipe", err)
	}
	defer lifetimeRead.Close()
	defer lifetimeWrite.Close()
	input, ok := command.Stdin.(*os.File)
	if command.Stdin != nil && !ok {
		return fmt.Errorf("official input type rejected: actual=%T; required=*os.File", command.Stdin)
	}
	if input == nil {
		input, err = os.Open(os.DevNull)
		if err != nil {
			return desktopAuthorizationProcessError("open default login input", err)
		}
		defer input.Close()
	}
	leaseMode := "none"
	files := []*os.File{lifetimeRead, statusWrite, input}
	if lease := desktopLoginLeaseFromContext(ctx); lease != nil {
		leaseMode = "lease"
		files = append(files, lease.file)
	}
	args := append(append([]string{}, desktopAuthorizationSupervisorArguments...), "bee-owned-login-v1", leaseMode, command.Path)
	args = append(args, command.Args[1:]...)
	guardian := exec.Command(program, args...)
	guardian.Env, guardian.Dir = command.Env, command.Dir
	if len(desktopAuthorizationSupervisorEnvironment) != 0 {
		if guardian.Env == nil {
			guardian.Env = os.Environ()
		}
		guardian.Env = append(append([]string{}, guardian.Env...), desktopAuthorizationSupervisorEnvironment...)
	}
	stdout, err := prepareDesktopAuthorizationOutput(command.Stdout)
	if err != nil {
		return desktopAuthorizationProcessError("prepare guardian output", err)
	}
	var retained bool
	defer func() { result = errors.Join(result, stdout.finish(retained)) }()
	stderr := stdout
	if command.Stdout == nil || !reflect.TypeOf(command.Stdout).Comparable() || command.Stdout != command.Stderr {
		stderr, err = prepareDesktopAuthorizationOutput(command.Stderr)
		if err != nil {
			return desktopAuthorizationProcessError("prepare guardian error output", err)
		}
		defer func() { result = errors.Join(result, stderr.finish(retained)) }()
	}
	if stdout.file != nil {
		guardian.Stdout = stdout.file
	}
	if stderr.file != nil {
		guardian.Stderr = stderr.file
	}
	guardian.ExtraFiles = files
	guardian.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	guardian.WaitDelay = time.Second
	if err := guardian.Start(); err != nil {
		return desktopAuthorizationProcessError("start login guardian", err)
	}
	stdout.started()
	stderr.started()
	waited := make(chan error, 1)
	go func() { waited <- guardian.Wait() }()
	_ = lifetimeRead.Close()
	_ = statusWrite.Close()
	type response struct {
		status desktopAuthorizationSupervisorResult
		err    error
	}
	done := make(chan response, 1)
	go func() {
		var status desktopAuthorizationSupervisorResult
		err := json.NewDecoder(statusRead).Decode(&status)
		done <- response{status: status, err: err}
	}()
	var received response
	select {
	case received = <-done:
	case <-ctx.Done():
		// Only the management process owns this writer. Neither the guardian
		// nor the official group inherits it, so death also delivers EOF.
		_ = lifetimeWrite.Close()
		received = <-done
	}
	_ = lifetimeWrite.Close()
	retained = received.status.GuardRetained
	if received.err != nil {
		result = &desktopAuthorizationCleanupError{fmt.Errorf("login guardian exited without cleanup status: %w", received.err)}
	} else if received.status.Error != "" {
		result = errors.New(received.status.Error)
		if received.status.CleanupFailed {
			result = &desktopAuthorizationCleanupError{result}
		}
	}
	if !retained {
		if waitErr := <-waited; waitErr != nil {
			result = errors.Join(result, &desktopAuthorizationCleanupError{desktopAuthorizationProcessError("wait for login guardian", waitErr)})
		}
	}
	return errors.Join(ctx.Err(), result)
}

// This command is deliberately absent from the desktop protocol. Its fixed
// inherited pipes are required; a bridge request cannot provide an executable.
func desktopLoginSupervisor(ctx context.Context, args []string) error {
	if len(args) < 3 || args[0] != "bee-owned-login-v1" || (args[1] != "none" && args[1] != "lease") || args[2] == "" {
		return fmt.Errorf("login guardian arguments rejected: count=%d; required=private protocol, lease mode, executable", len(args))
	}
	if err := syscall.SetNonblock(3, true); err != nil {
		return desktopAuthorizationProcessError("prepare pollable guardian lifetime pipe", err)
	}
	lifetime := os.NewFile(3, "login-lifetime")
	status := os.NewFile(4, "login-status")
	input := os.NewFile(5, "login-input")
	for _, pipe := range []*os.File{lifetime, status} {
		info, err := pipe.Stat()
		if err != nil {
			return fmt.Errorf("login guardian inherited pipe unavailable: descriptor=%d; %w", pipe.Fd(), err)
		}
		if info.Mode()&os.ModeNamedPipe == 0 {
			return fmt.Errorf("login guardian inherited descriptor rejected: descriptor=%d mode=%s; required=pipe", pipe.Fd(), info.Mode())
		}
	}
	defer lifetime.Close()
	defer status.Close()
	defer input.Close()
	for _, descriptor := range []int{3, 4, 5} {
		syscall.CloseOnExec(descriptor)
	}
	managed, cancel := context.WithCancel(ctx)
	defer cancel()
	if args[1] == "lease" {
		lease := &desktopLoginProcessLease{file: os.NewFile(6, "login-operation-guard")}
		syscall.CloseOnExec(6)
		defer lease.close()
		managed = context.WithValue(managed, desktopLoginProcessContextKey{}, lease)
	}
	joined := make(chan struct{})
	go func() {
		defer close(joined)
		var buffer [1]byte
		_, _ = lifetime.Read(buffer[:])
		cancel()
	}()
	command := exec.Command(args[2], args[3:]...)
	command.Stdin, command.Stdout, command.Stderr = input, os.Stdout, os.Stderr
	reported := false
	err := runDesktopAuthorizationOwned(managed, command, func(err error) {
		// Keep the lease and the unreaped leader even if a stop observation
		// fails. The manager receives the concrete error without claiming a
		// completed cancellation. Only this original owned group is cleaned.
		reported = true
		_ = input.Close()
		_ = os.Stdout.Close()
		_ = os.Stderr.Close()
		_ = json.NewEncoder(status).Encode(desktopAuthorizationSupervisorResult{Error: err.Error(), CleanupFailed: true, GuardRetained: true})
	})
	_ = lifetime.Close()
	<-joined
	if reported {
		return nil
	}
	result := desktopAuthorizationSupervisorResult{}
	if err != nil {
		result.Error = err.Error()
		var cleanup *desktopAuthorizationCleanupError
		result.CleanupFailed = errors.As(err, &cleanup)
	}
	if err := json.NewEncoder(status).Encode(result); err != nil {
		return desktopAuthorizationProcessError("write login guardian cleanup status", err)
	}
	return nil
}

func runDesktopAuthorizationOwned(ctx context.Context, command *exec.Cmd, unconfirmed func(error)) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	statusRead, statusWrite, err := os.Pipe()
	if err != nil {
		return desktopAuthorizationProcessError("create login status pipe", err)
	}
	defer statusRead.Close()
	defer statusWrite.Close()
	controlRead, controlWrite, err := os.Pipe()
	if err != nil {
		return desktopAuthorizationProcessError("create login lifetime pipe", err)
	}
	defer controlRead.Close()
	defer controlWrite.Close()
	args := append([]string{"-c", desktopAuthorizationSupervisor, "bee-official-login", command.Path}, command.Args[1:]...)
	supervisor := exec.Command("/bin/sh", args...)
	supervisor.Env = command.Env
	supervisor.Dir = command.Dir
	supervisor.Stdout = command.Stdout
	supervisor.Stderr = command.Stderr
	supervisor.Stdin = controlRead
	input, ok := command.Stdin.(*os.File)
	if command.Stdin != nil && !ok {
		return fmt.Errorf("official input type rejected: actual=%T; required=*os.File", command.Stdin)
	}
	if input == nil {
		input, err = os.Open(os.DevNull)
		if err != nil {
			return desktopAuthorizationProcessError("open default login input", err)
		}
		defer input.Close()
	}
	supervisor.ExtraFiles = []*os.File{statusWrite, input}
	if lease := desktopLoginLeaseFromContext(ctx); lease != nil {
		supervisor.ExtraFiles = append(supervisor.ExtraFiles, lease.file)
	}
	supervisor.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	supervisor.WaitDelay = time.Second
	if err := supervisor.Start(); err != nil {
		return desktopAuthorizationProcessError("start login supervisor", err)
	}
	_ = statusWrite.Close()
	_ = controlRead.Close()
	type status struct {
		code int
		err  error
	}
	done := make(chan status, 1)
	go func() {
		line, err := bufio.NewReaderSize(statusRead, 16).ReadString('\n')
		if err != nil {
			done <- status{err: fmt.Errorf("login supervisor exited without a status: %w", err)}
			return
		}
		code, err := strconv.Atoi(line[:len(line)-1])
		if err != nil || code < 0 || code > 255 {
			done <- status{err: fmt.Errorf("login supervisor status rejected: response_bytes=%d", len(line))}
			return
		}
		done <- status{code: code}
	}()
	var result error
	statusReceived := false
	select {
	case s := <-done:
		statusReceived = true
		result = s.err
		if result == nil && s.code != 0 {
			result = fmt.Errorf("official process exited: exit_code=%d", s.code)
		}
	case <-ctx.Done():
		result = ctx.Err()
	}
	// No Wait has occurred: the leader is alive or an unreaped zombie, so the
	// process group cannot be recycled into an unrelated client's group.
	killErr := terminateDesktopAuthorizationGroup(supervisor.Process.Pid)
	if killErr != nil {
		result = errors.Join(result, &desktopAuthorizationCleanupError{fmt.Errorf("terminate owned login group: %w", killErr)})
		unconfirmed(result)
		for {
			// Do not release the original guard or reap the reserved leader
			// until the OS can prove no live member. No login or write retries.
			observed, err := desktopAuthorizationObserveGroup(supervisor.Process.Pid)
			if err == nil {
				if observed.live == 0 || terminateDesktopAuthorizationGroup(supervisor.Process.Pid) == nil {
					break
				}
			}
			time.Sleep(100 * time.Millisecond)
		}
	}
	waitErr := supervisor.Wait()
	_ = statusRead.Close()
	if !statusReceived {
		<-done
	}
	// SIGKILL is the expected supervisor termination, including normal login exit.
	if waitErr != nil {
		var exited *exec.ExitError
		if !errors.As(waitErr, &exited) {
			result = errors.Join(result, &desktopAuthorizationCleanupError{desktopAuthorizationExit(waitErr)})
		}
	}
	if ctx.Err() != nil {
		return errors.Join(ctx.Err(), result)
	}
	return result
}

type desktopAuthorizationGroupStatus struct {
	live, moving int
	members      []int
	evidence     []string
}

// The unreaped supervisor reserves this group ID throughout both observations.
// A single KILL can race with a member's fork. First freeze every live member,
// then kill the stable group and prove that no live member still owns its FDs.
func terminateDesktopAuthorizationGroup(group int) error {
	deadline := time.Now().Add(time.Second)
	stage := "freeze"
	var observed desktopAuthorizationGroupStatus
	var stopped []int
	var signalErr error
	for {
		if time.Now().After(deadline) {
			_ = desktopAuthorizationSignalGroup(-group, syscall.SIGKILL)
			return errors.Join(fmt.Errorf("owned login group stop unconfirmed: group=%d stage=%s live=%d moving=%d members=%v; required=no live members before leader reap", group, stage, observed.live, observed.moving, observed.evidence), signalErr)
		}
		if stage == "freeze" {
			if err := desktopAuthorizationSignalGroup(-group, syscall.SIGSTOP); err != nil && !errors.Is(err, syscall.ESRCH) {
				signalErr = fmt.Errorf("freeze owned login group: group=%d; %w", group, err)
				// Darwin may reject signals to members already in kernel exit.
				// Only an observation proving no live members permits success.
				if !errors.Is(err, syscall.EPERM) {
					_ = desktopAuthorizationSignalGroup(-group, syscall.SIGKILL)
					return signalErr
				}
			}
		}
		var err error
		observed, err = desktopAuthorizationObserveGroup(group)
		if err != nil {
			_ = desktopAuthorizationSignalGroup(-group, syscall.SIGKILL)
			return fmt.Errorf("observe owned login group: group=%d stage=%s; %w", group, stage, err)
		}
		if observed.live == 0 {
			return nil
		}
		if stage == "freeze" && observed.moving == 0 {
			// /proc is not an atomic snapshot. A fresh scan after all observed
			// parents have stopped must confirm the same complete membership.
			if !slices.Equal(stopped, observed.members) {
				stopped = append(stopped[:0], observed.members...)
				continue
			}
			if err := desktopAuthorizationSignalGroup(-group, syscall.SIGKILL); err != nil && !errors.Is(err, syscall.ESRCH) {
				signalErr = fmt.Errorf("kill frozen owned login group: group=%d live=%d; %w", group, observed.live, err)
				if !errors.Is(err, syscall.EPERM) {
					return signalErr
				}
			}
			stage = "exit"
			continue
		}
		if stage == "exit" {
			// A fork already inside the kernel may become visible after the
			// KILL snapshot. This is still our reserved group: stop its actual
			// remaining members and prove exit before reaping the leader.
			stage, stopped = "freeze", nil
		}
		time.Sleep(time.Millisecond)
	}
}
