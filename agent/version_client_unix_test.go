//go:build darwin || linux

package bee

import (
	"os"
	"path/filepath"
	"testing"
)

func installVersionTestClient(t *testing.T, directory, name, output string) {
	t.Helper()
	script := "#!/bin/sh\nprintf '%s\\n' '" + output + "'\n"
	if err := os.WriteFile(filepath.Join(directory, name), []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
}
