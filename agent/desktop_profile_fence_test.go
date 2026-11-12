package bee

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// This deliberately exercises the pre-profile readState seam: older binaries
// reject an unknown field rather than treating a migrated root as a fresh device.
func TestDesktopProfileMigrationFenceRejectsLegacyInitialization(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bee-desktop.json")
	raw := []byte(`{"profile_migration_required":1,"migration_id":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`)
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := readState(path); err == nil || !strings.Contains(err.Error(), "unknown field") {
		t.Fatalf("legacy decoder accepted migration fence: error=%v; required=unknown-field refusal", err)
	}
	got, err := os.ReadFile(path)
	if err != nil || string(got) != string(raw) {
		t.Fatalf("legacy read modified migration fence: read_error=%v unchanged=%t", err, string(got) == string(raw))
	}
}
