//go:build darwin || linux

package bee

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

func openRegularNoFollow(path string) (*os.File, error) {
	fd, err := syscall.Open(path, syscall.O_RDONLY|syscall.O_NOFOLLOW|syscall.O_NONBLOCK|syscall.O_CLOEXEC, 0)
	if err != nil {
		return nil, &os.PathError{Op: "open regular file without following links", Path: path, Err: err}
	}
	file := os.NewFile(uintptr(fd), path)
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, err
	}
	if !info.Mode().IsRegular() {
		file.Close()
		return nil, fmt.Errorf("file %q has mode %s; required=regular file", path, info.Mode())
	}
	return file, nil
}

func validatePrivateFile(file *os.File) error {
	info, err := file.Stat()
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() || info.Mode().Perm()&0077 != 0 {
		return fmt.Errorf("file %q has mode %s (%04o); required=regular file with no group/other permissions (0600)", file.Name(), info.Mode(), info.Mode().Perm())
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return fmt.Errorf("file %q has no Unix ownership metadata; required=current user ownership", file.Name())
	}
	if stat.Uid != uint32(os.Geteuid()) {
		return fmt.Errorf("file %q has owner UID=%d; required effective UID=%d", file.Name(), stat.Uid, os.Geteuid())
	}
	return nil
}

// writePrivateFile installs a synced private file by same-directory rename.
// Existing links and non-regular targets are refused without replacing them.
func writePrivateFile(path string, data []byte, pattern string) error {
	if err := checkPrivateReplacementTarget(path); err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), pattern)
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	defer file.Close()
	if err = file.Chmod(0600); err == nil {
		_, err = file.Write(data)
	}
	if err == nil {
		err = file.Sync()
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return fmt.Errorf("prepare private replacement for %q: %w", path, err)
	}
	if err := checkPrivateReplacementTarget(path); err != nil {
		return err
	}
	if err := os.Rename(file.Name(), path); err != nil {
		return err
	}
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer directory.Close()
	if err := directory.Sync(); err != nil {
		return fmt.Errorf("sync directory after replacing %q: %w", path, err)
	}
	return nil
}

func checkPrivateReplacementTarget(path string) error {
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("replacement target %q has mode %s; required=regular file or absent", path, info.Mode())
	}
	return nil
}
