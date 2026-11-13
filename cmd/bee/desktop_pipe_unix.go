//go:build darwin || linux

package main

import (
	"errors"
	"os"

	"golang.org/x/sys/unix"
)

func prepareDesktopPipe(file *os.File) (*os.File, error) {
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if info.Mode()&os.ModeNamedPipe == 0 {
		return file, nil // Regular file I/O does not wait for a peer.
	}
	fd, err := unix.FcntlInt(file.Fd(), unix.F_DUPFD_CLOEXEC, 0)
	if err != nil {
		return nil, err
	}
	if err := unix.SetNonblock(fd, true); err != nil {
		return nil, errors.Join(err, unix.Close(fd))
	}
	// NewFile enrolls an already nonblocking descriptor in Go's runtime
	// poller. Unlike inherited blocking stdin/stdout, Close can interrupt it.
	pipe := os.NewFile(uintptr(fd), file.Name())
	if err := file.Close(); err != nil {
		return nil, errors.Join(err, pipe.Close())
	}
	return pipe, nil
}
