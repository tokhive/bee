package bee

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStateDropsTheRemovedDesktopRuntimeEpoch(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee.json")
	written := `{"runtime_epoch":"` + strings.Repeat("a", 48) + `","hive":"https://hive.example","name":"Bee","credential":"synthetic-device"}`
	if err := os.WriteFile(path, []byte(written), 0600); err != nil {
		t.Fatal(err)
	}
	state, err := readState(path)
	if err != nil {
		t.Fatalf("configuration with the desktop app's runtime_epoch: %v", err)
	}
	if state.RuntimeEpoch != "" || state.Hive != "https://hive.example" || state.Credential != "synthetic-device" {
		t.Fatalf("state=%+v", state)
	}
	if err = saveState(path, state); err != nil {
		t.Fatal(err)
	}
	saved, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(saved), "runtime_epoch") {
		t.Fatalf("saved configuration kept runtime_epoch: %s", saved)
	}
}
