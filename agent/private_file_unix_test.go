//go:build darwin || linux

package bee

import (
	"os"
	"path/filepath"
	"syscall"
	"testing"
)

func TestPrivateFileRejectsPermissionsForOtherUsers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	for _, mode := range []os.FileMode{0640, 0604, 0660, 0620} {
		if err := os.WriteFile(path, []byte(`{}`), mode); err != nil {
			t.Fatal(err)
		}
		if err := os.Chmod(path, mode); err != nil {
			t.Fatal(err)
		}
		if _, err := readState(path); err == nil {
			t.Errorf("configuration accepted permissions %04o", mode)
		}
	}
	if err := writePrivateFile(path, []byte(`{}`), ".private-*"); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil || info.Mode().Perm() != 0600 {
		t.Fatalf("private replacement did not set 0600: error=%v", err)
	}
}

func TestStateLockRejectsNonRegularFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	if err := syscall.Mkfifo(path+".lock", 0600); err != nil {
		t.Fatal(err)
	}
	if unlock, err := lockState(path); err == nil {
		unlock()
		t.Fatal("configuration lock accepted a FIFO")
	}
}
