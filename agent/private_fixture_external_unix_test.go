//go:build darwin || linux

package bee_test

import (
	"os"
	"testing"
)

func writePrivateFixture(path string, data []byte) error {
	return os.WriteFile(path, data, 0600)
}

func assertPrivateFixture(t *testing.T, path string) {
	t.Helper()
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0600 {
		t.Fatalf("private fixture %q has mode=%04o; required=0600", path, info.Mode().Perm())
	}
}

func preventTestReplacement(t *testing.T, directory, path string) func() {
	t.Helper()
	if err := os.Chmod(directory, 0500); err != nil {
		t.Fatalf("prevent fixture replacement: %v", err)
	}
	return func() { _ = os.Chmod(directory, 0700) }
}
