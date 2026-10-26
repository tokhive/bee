package bee

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
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
