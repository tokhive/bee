package bee

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tokhive/bee/beewire"
)

func TestMenuStatusIncludesAccountAndReadinessSeparately(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/bee/identity":
			json.NewEncoder(w).Encode(beewire.Identity{Name: "test"})
		case "/api/bee/platforms/openai/account":
			json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "openai", Status: "confirmation_required", PendingFingerprint: strings.Repeat("a", 64)})
		case "/api/bee/platforms/openai":
			json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Reasons: []string{"codex_confirmation_required"}})
		default:
			t.Error(r.URL.Path)
			w.WriteHeader(404)
		}
	}))
	defer server.Close()
	m, out := pairedMenu(t, "")
	state, _ := readState(m.configPath)
	state.Hive = server.URL
	if e := saveState(m.configPath, state); e != nil {
		t.Fatal(e)
	}
	if e := os.WriteFile(m.egressPath, []byte(`{"targets":["chatgpt.com:443"],"codex":{"home":"/tmp/menu-synthetic-codex","store":"file"}}`), 0600); e != nil {
		t.Fatal(e)
	}
	if e := m.status(); e != nil {
		t.Fatal(e)
	}
	for _, label := range []string{"账号变更等待确认", strings.Repeat("a", 64), "暂不可接单", "OpenAI 账号已变更，等待确认"} {
		if !strings.Contains(out.String(), label) {
			t.Fatalf("missing %q in %s", label, out.String())
		}
	}
}

func TestMenuStartRejectsInvalidSupplyBeforeChangingService(t *testing.T) {
	m, _ := pairedMenu(t, "1\n")
	s, calls := managedFixture(t)
	m.service = s
	if e := os.WriteFile(m.egressPath, []byte("broken json"), 0600); e != nil {
		t.Fatal(e)
	}
	if e := m.serviceAction("start"); e == nil || !strings.Contains(e.Error(), "BEE-CONFIG-SYNTAX") {
		t.Fatalf("%v", e)
	}
	for _, c := range *calls {
		if strings.HasPrefix(c, "sudo ") {
			t.Fatalf("invalid configuration caused service mutation: %s", c)
		}
	}
}

func TestMenuReplacedDeviceHasLocalizedRecoveryAndEvidence(t *testing.T) {
	requests := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		w.WriteHeader(401)
		fmt.Fprint(w, `{"error":{"code":"device_replaced"}}`)
	}))
	defer server.Close()
	m, out := pairedMenu(t, "1\n\n0\n")
	state, _ := readState(m.configPath)
	state.Hive = server.URL
	if err := saveState(m.configPath, state); err != nil {
		t.Fatal(err)
	}
	s, _ := managedFixture(t)
	s.platform = "darwin"
	m.service = s
	if err := m.loop("管理", []menuAction{{"Status", "运行状态", m.status}}); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"替换", "凭证已撤销", "重新配对", "HTTP 401", "device_replaced", "macOS 暂不支持"} {
		if !strings.Contains(out.String(), want) {
			t.Fatalf("missing %q\n%s", want, out)
		}
	}
	if requests != 1 || strings.Contains(out.String(), "old device credential") || strings.Contains(out.String(), "managed system service unavailable") {
		t.Fatalf("requests=%d\n%s", requests, out)
	}
}

func TestMenuDiagnosticsDoesNotTreatUnreadablePathAsAbsent(t *testing.T) {
	m, out := menuFixture(t, "")
	blocker := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(blocker, []byte("fixture"), 0600); err != nil {
		t.Fatal(err)
	}
	m.egressPath = filepath.Join(blocker, "egress.json")
	if err := m.diagnostics(); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out.String(), "BEE-CONFIG-UNREADABLE") || !strings.Contains(out.String(), m.egressPath) {
		t.Fatal(out.String())
	}
}
