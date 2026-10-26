//go:build !windows

package bee

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"syscall"
	"time"
)

// The fixed supervisor keeps its process-group ID reserved until the owner
// cleans the group and reaps it. Waiting directly on the official command could
// reap its PID before a concurrent cancellation signals that group. No input is
// interpolated into shell code; the executable and every argument remain argv.
const desktopAuthorizationSupervisor = `"$@" 3>&- < /dev/null &
child=$!
wait "$child"
result=$?
printf '%s\n' "$result" >&3
IFS= read -r cleanup
`

func runDesktopAuthorization(ctx context.Context, command *exec.Cmd) error {
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
	supervisor.ExtraFiles = []*os.File{statusWrite}
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
	killErr := syscall.Kill(-supervisor.Process.Pid, syscall.SIGKILL)
	if errors.Is(killErr, syscall.ESRCH) {
		killErr = nil
	}
	waitErr := supervisor.Wait()
	_ = statusRead.Close()
	if !statusReceived {
		<-done
	}
	if killErr != nil {
		result = errors.Join(result, fmt.Errorf("terminate owned login group: %w", killErr))
	}
	// SIGKILL is the expected supervisor termination, including normal login exit.
	if waitErr != nil {
		var exited *exec.ExitError
		if !errors.As(waitErr, &exited) {
			result = errors.Join(result, desktopAuthorizationExit(waitErr))
		}
	}
	if ctx.Err() != nil {
		return errors.Join(ctx.Err(), result)
	}
	return result
}
