//go:build windows

package bee

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"golang.org/x/sys/windows"
)

func lockState(path string) (func(), error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, fmt.Errorf("create Bee configuration directory: %w", err)
	}
	security, err := privateWindowsSecurity()
	if err != nil {
		return nil, err
	}
	file, err := openWindowsRegularFile(path+".lock", windows.GENERIC_READ|windows.GENERIC_WRITE, windows.OPEN_ALWAYS, security)
	if err != nil {
		return nil, err
	}
	if err := validatePrivateFile(file); err != nil {
		file.Close()
		return nil, fmt.Errorf("check Bee configuration lock protection: %w", err)
	}
	handle := windows.Handle(file.Fd())
	overlapped := new(windows.Overlapped)
	if err := windows.LockFileEx(handle, windows.LOCKFILE_EXCLUSIVE_LOCK|windows.LOCKFILE_FAIL_IMMEDIATELY, 0, 1, 0, overlapped); err != nil {
		file.Close()
		return nil, fmt.Errorf("acquire exclusive Bee configuration lock %q: %w", file.Name(), err)
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			_ = windows.UnlockFileEx(handle, 0, 1, 0, overlapped)
			_ = file.Close()
		})
	}, nil
}
