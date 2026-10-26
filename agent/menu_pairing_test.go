package bee

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"github.com/tokhive/bee/beewire"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func pairedMenu(t *testing.T, input string) (*managementMenu, *bytes.Buffer) {
	t.Helper()
	m, out := menuFixture(t, input)
	state := localState{Hive: "https://hive.example", Name: "test", Credential: "bee_" + strings.Repeat("a", 43), Identity: &beewire.Identity{ID: "old"}}
	if e := saveState(m.configPath, state); e != nil {
		t.Fatal(e)
	}
	return m, out
}
func TestMenuPairCancelKeepsConfiguration(t *testing.T) {
	m, _ := pairedMenu(t, "2\n0\n")
	before, _ := os.ReadFile(m.configPath)
	if e := m.pairing(); e != nil {
		t.Fatal(e)
	}
	after, _ := os.ReadFile(m.configPath)
	if !bytes.Equal(before, after) {
		t.Fatal("changed")
	}
	files, _ := filepath.Glob(m.configPath + ".backup.*")
	if len(files) > 0 {
		t.Fatal(files)
	}
}
func TestMenuPairBackupUsesLockAndKeepsSupply(t *testing.T) {
	m, _ := pairedMenu(t, "")
	before, _ := os.ReadFile(m.configPath)
	os.WriteFile(m.egressPath, []byte("saved supply"), 0600)
	unlock, e := lockState(m.configPath)
	if e != nil {
		t.Fatal(e)
	}
	if _, e = m.backupDevice(before); e == nil {
		t.Fatal("ignored lock")
	}
	unlock()
	path, e := m.backupDevice(before)
	if e != nil {
		t.Fatal(e)
	}
	b, _ := os.ReadFile(path)
	if !bytes.Equal(b, before) {
		t.Fatal("backup contents")
	}
	info, _ := os.Stat(filepath.Dir(path))
	if info.Mode().Perm() != 0700 {
		t.Fatal(info.Mode())
	}
	info, _ = os.Stat(path)
	if info.Mode().Perm() != 0600 {
		t.Fatal(info.Mode())
	}
	s, _ := os.ReadFile(m.egressPath)
	if string(s) != "saved supply" {
		t.Fatal("supply changed")
	}
}
func TestMenuPairBackupRejectsChangedFile(t *testing.T) {
	m, _ := pairedMenu(t, "")
	before, _ := os.ReadFile(m.configPath)
	state, _ := readState(m.configPath)
	state.Name = "changed while confirming"
	if e := saveState(m.configPath, state); e != nil {
		t.Fatal(e)
	}
	if _, e := m.backupDevice(before); e == nil {
		t.Fatal("changed config moved")
	}
}
func TestMenuPairValidationDoesNotTakeRunningLock(t *testing.T) {
	m, out := pairedMenu(t, "1\n")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(beewire.Identity{ID: "old", Name: "valid"})
	}))
	defer server.Close()
	state, _ := readState(m.configPath)
	state.Hive = server.URL
	saveState(m.configPath, state)
	unlock, e := lockState(m.configPath)
	if e != nil {
		t.Fatal(e)
	}
	defer unlock()
	if e = m.pairing(); e != nil {
		t.Fatal(e)
	}
	if !strings.Contains(out.String(), "valid") {
		t.Fatal(out.String())
	}
}
func TestMenuPairInitialCancellationDoesNotCreateCredential(t *testing.T) {
	m, _ := menuFixture(t, "https://hive.example\n0\n")
	if e := m.pairing(); e != nil {
		t.Fatal(e)
	}
	if _, e := os.Stat(m.configPath); !os.IsNotExist(e) {
		t.Fatal(e)
	}
}
func TestMenuAccountConfirmationRejectsChangedRecord(t *testing.T) {
	var posts int
	count := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "POST" {
			posts++
		}
		count++
		json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "openai", Status: "confirmation_required", PendingFingerprint: strings.Repeat("a", 64), ConfirmationID: "new"})
	}))
	defer server.Close()
	state := localState{Hive: server.URL}
	_, e := confirmAccountSnapshot(context.Background(), state, beewire.PlatformAccount{Platform: "openai", Status: "confirmation_required", PendingFingerprint: strings.Repeat("a", 64), ConfirmationID: "old"})
	if e == nil || posts != 0 || count != 1 {
		t.Fatal(e, posts, count)
	}
}

func TestMenuPairFailureKeepsBackupNewStateAndSupply(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/bee/identity" {
			w.WriteHeader(401)
		} else {
			w.WriteHeader(503)
		}
	}))
	defer server.Close()
	m, _ := pairedMenu(t, "2\n\n1\n")
	state, _ := readState(m.configPath)
	state.Hive = server.URL
	saveState(m.configPath, state)
	before, _ := os.ReadFile(m.configPath)
	os.WriteFile(m.egressPath, []byte("supply"), 0600)
	if e := m.pairing(); e == nil {
		t.Fatal("expected pairing failure")
	}
	backups, _ := filepath.Glob(m.configPath + ".backup.*/bee.json")
	if len(backups) != 1 {
		t.Fatal(backups)
	}
	raw, _ := os.ReadFile(backups[0])
	if !bytes.Equal(raw, before) {
		t.Fatal("backup differs")
	}
	current, _ := readState(m.configPath)
	if current.Credential == state.Credential || current.Credential == "" {
		t.Fatal("new state missing")
	}
	supply, _ := os.ReadFile(m.egressPath)
	if string(supply) != "supply" {
		t.Fatal("supply changed")
	}
}
func TestMenuPairBackupRejectsSymlink(t *testing.T) {
	m, _ := pairedMenu(t, "")
	raw, _ := os.ReadFile(m.configPath)
	target := m.configPath + ".real"
	os.Rename(m.configPath, target)
	os.Symlink(target, m.configPath)
	if _, e := m.backupDevice(raw); e == nil {
		t.Fatal("accepted symlink")
	}
	after, _ := os.ReadFile(target)
	if !bytes.Equal(raw, after) {
		t.Fatal("target changed")
	}
}
func TestMenuAccountSnapshotSubmitsOnlyDisplayedRecord(t *testing.T) {
	fp := strings.Repeat("a", 64)
	posts := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		a := beewire.PlatformAccount{Platform: "openai", Status: "confirmation_required", PendingFingerprint: fp, ConfirmationID: "shown"}
		if r.Method == "POST" {
			posts++
			var input map[string]string
			json.NewDecoder(r.Body).Decode(&input)
			if input["account_fingerprint"] != fp || input["confirmation_id"] != "shown" {
				t.Error(input)
			}
			a.AccountFingerprint = fp
			a.Status = "ready"
		}
		json.NewEncoder(w).Encode(a)
	}))
	defer server.Close()
	_, e := confirmAccountSnapshot(context.Background(), localState{Hive: server.URL}, beewire.PlatformAccount{Platform: "openai", PendingFingerprint: fp, ConfirmationID: "shown"})
	if e != nil || posts != 1 {
		t.Fatal(e, posts)
	}
}

func TestMenuSupplyCancellationNeverWritesRemote(t *testing.T) {
	writes := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "GET" {
			writes++
		}
		json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai"})
	}))
	defer server.Close()
	m, _ := pairedMenu(t, "1\n0\n")
	state, _ := readState(m.configPath)
	state.Hive = server.URL
	saveState(m.configPath, state)
	if e := m.changeSupply(false); e != nil {
		t.Fatal(e)
	}
	if writes != 0 {
		t.Fatal(writes)
	}
}
func TestMenuSupplyResumeDoesNotClaimReady(t *testing.T) {
	writes := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "PUT" {
			writes++
		}
		json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Ready: false, Reasons: []string{"offline"}})
	}))
	defer server.Close()
	m, out := pairedMenu(t, "1\n1\n")
	state, _ := readState(m.configPath)
	state.Hive = server.URL
	saveState(m.configPath, state)
	if e := m.changeSupply(false); e != nil {
		t.Fatal(e)
	}
	if writes != 1 || !strings.Contains(out.String(), "暂不可接单") {
		t.Fatal(writes, out.String())
	}
}

func TestMenuGuidedPairingLeavesNextStepToCallingServiceAction(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(beewire.Identity{ID: "paired"})
	}))
	defer server.Close()
	m, out := menuFixture(t, server.URL+"\n1\n")
	if e := m.pairingWithNext(false); e != nil {
		t.Fatal(e)
	}
	state, e := readState(m.configPath)
	if e != nil || state.Identity == nil {
		t.Fatal(state.Identity, e)
	}
	if strings.Contains(out.String(), "现在选择供给账号") {
		t.Fatal(out.String())
	}
}

func TestMenuPairStopFailureKeepsOriginalDevice(t *testing.T) {
	m, _ := pairedMenu(t, "2\n\n1\n")
	before, _ := os.ReadFile(m.configPath)
	s, _ := managedFixture(t)
	m.service = s
	previous := s.execute
	s.execute = func(c context.Context, n string, a []string, i io.Reader, o io.Writer) (string, error) {
		if n == "sudo" {
			return "", errors.New("exit 7: stop refused")
		}
		v, e := previous(c, n, a, i, o)
		return strings.ReplaceAll(v, "ActiveState=inactive", "ActiveState=active"), e
	}
	if e := m.pairing(); e == nil || !strings.Contains(e.Error(), "stop refused") {
		t.Fatal(e)
	}
	after, _ := os.ReadFile(m.configPath)
	backups, _ := filepath.Glob(m.configPath + ".backup.*")
	if !bytes.Equal(before, after) || len(backups) != 0 {
		t.Fatal("stop failure moved device configuration")
	}
}
