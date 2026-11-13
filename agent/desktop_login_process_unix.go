//go:build !windows

package bee

import (
	"context"
	"fmt"
	"os"
	"syscall"
)

func openDesktopLoginProcessLock(path string, create bool) (*os.File, error) {
	flags := syscall.O_RDWR | syscall.O_NOFOLLOW | syscall.O_CLOEXEC
	if create {
		flags |= syscall.O_CREAT
	}
	fd, err := syscall.Open(path, flags, 0600)
	if err != nil {
		return nil, &os.PathError{Op: "open original login process guard", Path: path, Err: err}
	}
	file := os.NewFile(uintptr(fd), path)
	if err := validatePrivateFile(file); err != nil {
		file.Close()
		return nil, err
	}
	if err := syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return nil, fmt.Errorf("original login process guard still held: %w", err)
	}
	// Closing the parent's descriptor must never explicitly unlock the shared
	// open description inherited by a still-running owned supervisor/child.
	return file, nil
}

func confirmDesktopLoginProcessStopped(context.Context, *desktopLoginProcessLease) error { return nil }
