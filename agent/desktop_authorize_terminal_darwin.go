package bee

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync/atomic"
	"time"

	"golang.org/x/sys/unix"
)

func runDesktopInteractiveAuthorization(ctx context.Context, command *exec.Cmd) error {
	return desktopAuthorizationTerminal(ctx, command, func(ctx context.Context, script, _, _ string) error {
		// The command file contains only our executable, private socket, and session
		// ID. No official authorization URL, code, token, or user text enters a shell.
		return desktopAuthorizationExit(exec.CommandContext(ctx, "/usr/bin/open", "-a", "Terminal", script).Run())
	})
}

func desktopTerminalError(check string, err error) error {
	var operation *net.OpError
	if errors.As(err, &operation) {
		err = operation.Err
	}
	return desktopAuthorizationProcessError(check, err)
}
func desktopTerminalQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", `'\''`) + "'"
}

func desktopAuthorizationTerminal(ctx context.Context, command *exec.Cmd, launch func(context.Context, string, string, string) error) error {
	// Keep AF_UNIX paths below macOS's bound, independently of a long TMPDIR.
	directory, err := os.MkdirTemp("/tmp", "bee-login-")
	if err != nil {
		return desktopTerminalError("create private official terminal session", err)
	}
	defer os.RemoveAll(directory)
	path := filepath.Join(directory, "io.sock")
	listener, err := net.ListenUnix("unix", &net.UnixAddr{Name: path, Net: "unix"})
	if err != nil {
		return desktopTerminalError("listen for official terminal", err)
	}
	defer listener.Close()
	if err = os.Chmod(path, 0600); err != nil {
		return desktopTerminalError("protect official terminal socket", err)
	}
	nonce := make([]byte, 32)
	if _, err = rand.Read(nonce); err != nil {
		return fmt.Errorf("create official terminal session ID: %w", err)
	}
	session := hex.EncodeToString(nonce)
	clear(nonce)
	program, err := os.Executable()
	if err != nil {
		return desktopTerminalError("locate official terminal helper", err)
	}
	script := filepath.Join(directory, "Claude-login.command")
	body := "#!/bin/sh\nexec " + desktopTerminalQuote(program) + " desktop-login-terminal " + desktopTerminalQuote(path) + " " + desktopTerminalQuote(session) + "\n"
	if err = os.WriteFile(script, []byte(body), 0700); err != nil {
		return desktopTerminalError("prepare official interaction terminal", err)
	}
	setup, stopSetup := context.WithTimeout(ctx, 45*time.Second)
	defer stopSetup()
	stopAccept := context.AfterFunc(setup, func() { _ = listener.Close() })
	defer stopAccept()
	if err = launch(setup, script, path, session); err != nil {
		return fmt.Errorf("open official interaction terminal: %w", err)
	}
	conn, err := listener.AcceptUnix()
	if err != nil {
		return errors.Join(setup.Err(), desktopTerminalError("wait for official terminal connection", err))
	}
	defer conn.Close()
	stopConnection := context.AfterFunc(setup, func() { _ = conn.Close() })
	_ = conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	proof := make([]byte, 65)
	_, err = io.ReadFull(conn, proof)
	authenticated := err == nil && subtle.ConstantTimeCompare(proof, []byte(session+"\n")) == 1
	clear(proof)
	if err != nil {
		return desktopTerminalError("read official terminal authentication", err)
	}
	if !authenticated {
		return fmt.Errorf("official terminal authentication rejected: required=current session")
	}
	if !stopConnection() {
		return errors.Join(setup.Err(), fmt.Errorf("official terminal setup ended before authentication completed"))
	}
	stopAccept()
	stopSetup()
	_ = listener.Close()
	if err = conn.SetReadDeadline(time.Time{}); err != nil {
		return desktopTerminalError("prepare official terminal stream", err)
	}
	stream, err := conn.File()
	if err != nil {
		return desktopTerminalError("open official terminal stream", err)
	}
	defer stream.Close()
	_ = conn.Close()
	command.Stdin, command.Stdout, command.Stderr = stream, stream, stream
	live, cancel := context.WithCancel(ctx)
	defer cancel()
	var disconnected atomic.Bool
	joined := make(chan struct{})
	go func() {
		defer close(joined)
		for live.Err() == nil {
			// Darwin reports socket hangup only when read events are requested.
			fds := []unix.PollFd{{Fd: int32(stream.Fd()), Events: unix.POLLIN}}
			_, err := unix.Poll(fds, 100)
			if errors.Is(err, unix.EINTR) {
				continue
			}
			if err != nil || fds[0].Revents&(unix.POLLHUP|unix.POLLERR|unix.POLLNVAL) != 0 {
				disconnected.Store(true)
				cancel()
				return
			}
			// The official client owns reads. Buffered input can keep POLLIN
			// ready until it reads, so avoid spinning while waiting for that.
			if fds[0].Revents&unix.POLLIN != 0 {
				select {
				case <-live.Done():
					return
				case <-time.After(25 * time.Millisecond):
				}
			}
		}
	}()
	result := runDesktopAuthorization(live, command)
	// EOF can make the official client exit before the watcher observes HUP.
	// Check again while this descriptor is still owned and cannot be recycled.
	fds := []unix.PollFd{{Fd: int32(stream.Fd()), Events: unix.POLLIN}}
	if _, err := unix.Poll(fds, 0); err == nil && fds[0].Revents&(unix.POLLHUP|unix.POLLERR|unix.POLLNVAL) != 0 {
		disconnected.Store(true)
	}
	cancel()
	<-joined
	if disconnected.Load() {
		return errors.Join(fmt.Errorf("official interaction terminal closed before login completed"), result, context.Canceled)
	}
	return result
}
