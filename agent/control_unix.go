//go:build darwin || linux

package bee

import (
	"errors"
	"log/slog"
	"net"
	"os"
	"path/filepath"
)

// listenControl opens the control socket inside a directory only the owner can
// enter, so no other user can reach it even before the socket's own mode is
// set. The caller holds the configuration lock, so a socket left at path is a
// stale one from an earlier run.
func listenControl(path string) (net.Listener, error) {
	if len(path) > maxSocketPath {
		return nil, errControlPathTooLong
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return nil, err
	}
	info, err := os.Lstat(dir)
	if err != nil {
		return nil, err
	}
	if !info.IsDir() {
		return nil, errors.New(dir + " is not a directory")
	}
	if err := os.Chmod(dir, 0o700); err != nil {
		return nil, err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	listener, err := net.Listen("unix", path)
	if err != nil {
		return nil, err
	}
	// Removing the socket on close is serveControl's job, after shutdown.
	listener.(*net.UnixListener).SetUnlinkOnClose(false)
	if err := os.Chmod(path, 0o600); err != nil {
		listener.Close()
		return nil, err
	}
	return &peerListener{Listener: listener}, nil
}

// peerListener drops a connection from any other user before HTTP sees it.
type peerListener struct{ net.Listener }

func (l *peerListener) Accept() (net.Conn, error) {
	for {
		conn, err := l.Listener.Accept()
		if err != nil {
			return nil, err
		}
		uid, err := peerUID(conn.(*net.UnixConn))
		if err == nil && uid == os.Getuid() {
			return conn, nil
		}
		if err != nil {
			slog.Warn("control connection rejected: peer unknown", "module", "control", "error", err.Error())
		} else {
			slog.Warn("control connection rejected: another user", "module", "control", "uid", uid)
		}
		conn.Close()
	}
}
