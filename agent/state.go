package bee

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"syscall"

	"github.com/tokhive/bee/beewire"
)

type localState struct {
	Hive       string            `json:"hive"`
	Name       string            `json:"name"`
	Credential string            `json:"credential"`
	Pairing    *beewire.Pairing  `json:"pairing,omitempty"`
	Identity   *beewire.Identity `json:"identity,omitempty"`
}

func lockState(path string) (func(), error) {
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return nil, errors.New("failed to create Bee configuration directory")
	}
	fd, err := syscall.Open(path+".lock", syscall.O_CREAT|syscall.O_RDWR|syscall.O_NOFOLLOW, 0600)
	if err != nil {
		return nil, errors.New("failed to open Bee configuration lock")
	}
	file := os.NewFile(uintptr(fd), path+".lock")
	if err = syscall.Flock(fd, syscall.LOCK_EX|syscall.LOCK_NB); err != nil {
		file.Close()
		return nil, errors.New("a Bee process is already running with this configuration")
	}
	return func() { _ = syscall.Flock(fd, syscall.LOCK_UN); _ = file.Close() }, nil
}

func readState(path string) (localState, error) {
	var state localState
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return state, nil
	}
	if err != nil {
		return state, failCause("BEE-DEVICE-CONFIG", fmt.Errorf("inspect device configuration %s: %w", path, err))
	}
	if !info.Mode().IsRegular() {
		return state, failf("BEE-DEVICE-CONFIG", "%s: mode=%s; expected a regular file, not a directory or symbolic link", path, info.Mode())
	}
	if info.Mode().Perm()&0077 != 0 {
		return state, failf("BEE-DEVICE-CONFIG", "%s: permissions=%04o; require access only by the current user (chmod 600)", path, info.Mode().Perm())
	}
	file, err := os.Open(path)
	if err != nil {
		return state, failCause("BEE-DEVICE-CONFIG", fmt.Errorf("open device configuration %s: %w", path, err))
	}
	defer file.Close()
	decoder := json.NewDecoder(file)
	decoder.DisallowUnknownFields()
	var decoded *localState
	if err = decoder.Decode(&decoded); err != nil {
		return state, failCause("BEE-DEVICE-CONFIG", fmt.Errorf("decode device configuration %s: %w", path, err))
	}
	if decoded == nil {
		return state, failf("BEE-DEVICE-CONFIG", "%s: expected a JSON object, got null", path)
	}
	if err = decoder.Decode(new(any)); err != io.EOF {
		return state, failf("BEE-DEVICE-CONFIG", "%s: extra content after the device JSON object at byte %d; keep exactly one JSON object", path, decoder.InputOffset())
	}
	return *decoded, nil
}

func saveState(path string, state localState) error {
	data, err := json.Marshal(state)
	if err != nil {
		return errors.New("failed to write Bee configuration")
	}
	if err := writePrivateFile(path, append(data, '\n'), ".bee-*"); err != nil {
		return errors.New("failed to save Bee configuration; preserve the existing configuration and retry")
	}
	return nil
}

// writePrivateFile replaces path with data, readable only by this user, so
// that a crash leaves either the old file or the new one and never a part.
func writePrivateFile(path string, data []byte, pattern string) error {
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
	if err == nil {
		err = os.Rename(file.Name(), path)
	}
	if err != nil {
		return err
	}
	directory, err := os.Open(filepath.Dir(path))
	if err != nil {
		return err
	}
	defer directory.Close()
	return directory.Sync()
}
