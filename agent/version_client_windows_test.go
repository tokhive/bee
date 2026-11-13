//go:build windows

package bee

import (
	"fmt"
	"io"
	"os"
	"path/filepath"
	"testing"
)

// The copied test executable is an actual Windows client process. It only
// handles --version when the explicit synthetic fixture variable is present.
func TestMain(m *testing.M) {
	if output, ok := os.LookupEnv("BEE_TEST_CLIENT_VERSION"); ok && len(os.Args) == 2 && os.Args[1] == "--version" {
		fmt.Fprintln(os.Stdout, output)
		os.Exit(0)
	}
	os.Exit(m.Run())
}

func installVersionTestClient(t *testing.T, directory, name, output string) {
	t.Helper()
	t.Setenv("BEE_TEST_CLIENT_VERSION", output)
	path := filepath.Join(directory, name+".exe")
	if _, err := os.Stat(path); err == nil {
		return
	}
	source, err := os.Open(os.Args[0])
	if err != nil {
		t.Fatal(err)
	}
	defer source.Close()
	target, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer target.Close()
	if _, err := io.Copy(target, source); err != nil {
		t.Fatal(err)
	}
	if err := target.Close(); err != nil {
		t.Fatal(err)
	}
}
