//go:build darwin || linux

package bee

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"syscall"
)

func lockState(path string) (func(), error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, fmt.Errorf("create Bee configuration directory: %w", err)
	}
	fd, err := syscall.Open(path+".lock", syscall.O_CREAT|syscall.O_RDWR|syscall.O_NOFOLLOW|syscall.O_CLOEXEC, 0600)
	if err != nil {
		return nil, &os.PathError{Op: "open Bee configuration lock", Path: path + ".lock", Err: err}
	}
	file := os.NewFile(uintptr(fd), path+".lock")
	if err := validatePrivateFile(file); err != nil {
		file.Close()
		return nil, fmt.Errorf("check Bee configuration lock protection: %w", err)
	}
	if err := syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return nil, fmt.Errorf("acquire exclusive Bee configuration lock %q: %w", file.Name(), err)
	}
	var once sync.Once
	return func() { once.Do(func() { _ = syscall.Flock(fd, syscall.LOCK_UN); _ = file.Close() }) }, nil
}
