package bee

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

// NewDesktopHiveRetirementFixture uses a real, separately hosted Hive. Only
// official-account reads are synthetic; management, HTTP, persistence and WS
// use production code. The directory survives the deliberately killed child.
func NewDesktopHiveRetirementFixture(t *testing.T, fixturePath, root string) (*DesktopDevice, *DesktopAccounts, *DesktopRuntime, *DesktopNetwork) {
	t.Helper()
	var fixture struct {
		Hive       string           `json:"hive"`
		Credential string           `json:"credential"`
		Identity   beewire.Identity `json:"identity"`
		Scenario   string           `json:"scenario"`
	}
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "desktop.json")
	_, statErr := os.Stat(path)
	fresh := os.IsNotExist(statErr)
	if statErr != nil && !fresh {
		t.Fatal(statErr)
	}
	state := localState{Hive: fixture.Hive, Name: "Synthetic retirement Bee", Credential: fixture.Credential, Identity: &fixture.Identity}
	if fresh {
		if err = saveState(path, state); err != nil {
			t.Fatal(err)
		}
	}
	d := newDesktopTestDevice(t, path)
	a := NewDesktopAccounts(d)
	// Never send a synthetic official credential outside this fixture.
	a.transport = claudeTransport(func(q *http.Request) (*http.Response, error) { return claudeProfileResponse(503, `{}`), nil })
	t.Cleanup(a.Close)
	if fresh {
		dir := filepath.Join(root, "synthetic-codex")
		if err = os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(dir, "auth.json"), desktopCodexFixture(t, time.Now().Add(time.Hour)), 0600); err != nil {
			t.Fatal(err)
		}
		read, readErr := a.readAccountSource(context.Background(), DesktopAccountDetectRequest{Platform: "openai", Directory: &dir, Store: "file", Mode: "local"})
		if readErr != nil {
			t.Fatal(readErr)
		}
		defer read.clear()
		prep := strings.Repeat("a", 48)
		fingerprint := *read.fingerprint
		remoteFingerprint := fingerprint
		if fixture.Scenario == "conflict" {
			remoteFingerprint = strings.Repeat("f", 64)
		}
		if err = callState(context.Background(), httpClient(), state, "/api/bee/platforms/openai", "PUT", map[string]any{"preparation": map[string]string{"id": prep, "action": "begin", "account_fingerprint": remoteFingerprint}}, nil); err != nil {
			t.Fatal(err)
		}
		scope := newDesktopAccountScope(state)
		scope.Selections["openai"] = desktopAccountSelection{PreparationID: prep, Source: read.source, Fingerprint: fingerprint, CredentialRevision: read.revision, Revision: 1}
		scope.RuntimeIntent = desktopRuntimeIntent{Running: true, ResumePlatforms: []string{"openai"}}
		scope.Session = desktopSessionMarker{RunID: strings.Repeat("b", 32), Active: true}
		disk := desktopAccountState{Entries: map[string]desktopAccountNotice{}, Scopes: map[string]desktopAccountScope{desktopScopeKey(state.Hive, state.Identity.OwnerID, state.Identity.ID): scope}}
		if err = saveDesktopAccountState(filepath.Join(root, "ai-accounts.json"), disk, 0); err != nil {
			t.Fatal(err)
		}
		if err = os.WriteFile(filepath.Join(root, "runtime-session"), []byte(scope.Session.RunID+"\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	pid, _ := json.Marshal(os.Getpid())
	if err = os.WriteFile(filepath.Join(root, "owned-test-pid.json"), pid, 0600); err != nil {
		t.Fatal(err)
	}
	r := NewDesktopRuntime(context.Background(), d, a)
	t.Cleanup(r.Close)
	return d, a, r, NewDesktopNetwork(a)
}
