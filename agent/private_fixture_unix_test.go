//go:build darwin || linux

package bee

import (
	"os"
	"testing"
)

func writeTestPrivateFile(path string, data []byte, mode os.FileMode) error {
	if err := os.WriteFile(path, data, mode); err != nil {
		return err
	}
	return os.Chmod(path, mode)
}

func assertPrivateTestFile(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("private fixture %q has mode=%04o; required=0600", path, info.Mode().Perm())
	}
}
