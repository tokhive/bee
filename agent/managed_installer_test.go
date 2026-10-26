package bee

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

// The actual installer is the independent authority for unit formatting. Its
// existing fixture redirects downloads, root writes and systemctl to temp files.
func TestManagedAcceptsUnitsGeneratedByRealInstaller(t *testing.T) {
	const generate = `
import importlib.util, json, sys
sys.dont_write_bytecode = True
from pathlib import Path
spec = importlib.util.spec_from_file_location('installer', '../scripts/test-install.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
units = []
for special in (False, True):
    fixture = module.InstallTest()
    try:
        fixture.setUp()
        destination = fixture.root / ('bin $HOME%"; literal' if special else 'bin')
        xdg = fixture.home / ('config %" $HOME' if special else '.config')
        result = fixture.run_install(BEE_INSTALL_DIR=str(destination), XDG_CONFIG_HOME=str(xdg), CODEX_HOME=str(fixture.home / 'codex %" $HOME'))
        if result.returncode != 0:
            raise RuntimeError(result.stdout + result.stderr)
        units.append(dict(unit=fixture.unit.read_text(), binary=str(destination / 'bee'), config=str(xdg / 'tokhive/bee.json'), egress=str(xdg / 'tokhive/egress.json')))
    finally:
        fixture.doCleanups()
print(json.dumps(units))
`
	raw, e := exec.Command("python3", "-c", generate).CombinedOutput()
	if e != nil {
		t.Fatalf("generate installer units: %v\n%s", e, raw)
	}
	var fixtures []struct{ Unit, Binary, Config, Egress string }
	if e = json.Unmarshal(raw, &fixtures); e != nil {
		t.Fatal(e)
	}
	if len(fixtures) != 2 {
		t.Fatalf("generated %d fixtures; expected 2", len(fixtures))
	}
	for _, f := range fixtures {
		s := &managedService{unitPath: filepath.Join(t.TempDir(), "tokhive-bee.service"), configPath: f.Config, egressPath: f.Egress, binary: f.Binary}
		if e = os.WriteFile(s.unitPath, []byte(f.Unit), 0644); e != nil {
			t.Fatal(e)
		}
		if e = s.validateUnit("dayong"); e != nil {
			t.Fatalf("real installer unit rejected: %v\n%s", e, f.Unit)
		}
		s.binary += ".other"
		if e = s.validateUnit("dayong"); e == nil {
			t.Fatal("mismatching executable accepted")
		}
	}
}
