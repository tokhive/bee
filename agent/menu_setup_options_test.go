package bee

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func TestMenuSupplyQueryIsIndependentOfAccountFailure(t *testing.T) {
	calls := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls = append(calls, r.URL.Path)
		if strings.HasSuffix(r.URL.Path, "/account") {
			w.WriteHeader(503)
			return
		}
		json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Ready: true})
	}))
	defer server.Close()
	m, out := pairedMenu(t, "1\n")
	state, _ := readState(m.configPath)
	state.Hive = server.URL
	if err := saveState(m.configPath, state); err != nil {
		t.Fatal(err)
	}
	if err := m.supplyStatus(); err != nil {
		t.Fatal(err)
	}
	if len(calls) != 1 || calls[0] != "/api/bee/platforms/openai" || !strings.Contains(out.String(), "可以接收新任务") {
		t.Fatal(calls, out.String())
	}
}

func TestMenuSetupExplicitSourceAndProxyTriState(t *testing.T) {
	t.Setenv("CODEX_HOME", t.TempDir())
	fakeClaude(t, errors.New("must not use Claude"))
	m, _ := menuFixture(t, "1\n")
	home := codexHome(t, time.Now().Add(time.Hour))
	proxy := "http://127.0.0.1:8088"
	m.setup = menuSetupOptions{platform: "openai", codexHome: home, proxy: &proxy, all: true}
	if err := m.configureAccountsWithNext(false); err != nil {
		t.Fatal(err)
	}
	cfg, err := readEgress(m.ctx, m.egressPath)
	if err != nil || cfg.ConnectProxy != proxy || cfg.Codex.Home != home || cfg.Claude != nil {
		t.Fatal(cfg, err)
	}
	m.setup.proxy = nil
	m.in.Reset(strings.NewReader("1\n"))
	if err := m.configureAccountsWithNext(false); err != nil {
		t.Fatal(err)
	}
	cfg, _ = readEgress(m.ctx, m.egressPath)
	if cfg.ConnectProxy != proxy {
		t.Fatal("did not keep proxy")
	}
	empty := ""
	m.setup.proxy = &empty
	m.in.Reset(strings.NewReader("1\n"))
	if err := m.configureAccountsWithNext(false); err != nil {
		t.Fatal(err)
	}
	cfg, _ = readEgress(m.ctx, m.egressPath)
	if cfg.ConnectProxy != "" {
		t.Fatal("did not clear proxy")
	}
}

func TestMenuSetupExplicitUnavailablePlatformDoesNotWrite(t *testing.T) {
	t.Setenv("CODEX_HOME", t.TempDir())
	m, _ := menuFixture(t, "1\n")
	m.setup = menuSetupOptions{platform: "openai", all: true}
	if err := m.configureAccountsWithNext(false); err == nil {
		t.Fatal("missing selected platform accepted")
	}
	if _, err := os.Stat(m.egressPath); !os.IsNotExist(err) {
		t.Fatal(err)
	}
}

func TestMenuSetupClaudeDirectoryPreservesExplicitEmpty(t *testing.T) {
	old := claudeReader
	defer func() { claudeReader = old }()
	empty := ""
	seen := false
	claudeReader = func(store string, dir *string) func(context.Context) (claudeCredential, error) {
		if dir == nil || *dir != "" {
			t.Fatal("empty directory lost")
		}
		seen = true
		return func(context.Context) (claudeCredential, error) {
			return claudeCredential{hasInferenceScope: true, expiresAt: time.Now().Add(time.Hour)}, nil
		}
	}
	m, _ := menuFixture(t, "0\n")
	m.setup = menuSetupOptions{platform: "claude", claudeDir: &empty, all: true}
	if err := m.configureAccountsWithNext(false); err != nil {
		t.Fatal(err)
	}
	if !seen {
		t.Fatal("did not read selected source")
	}
	if _, err := os.Stat(m.egressPath); !os.IsNotExist(err) {
		t.Fatal("cancel wrote configuration")
	}
}

func TestMenuSetupRejectsProxyBeforeReadingAccounts(t *testing.T) {
	m, _ := menuFixture(t, "1\n")
	proxy := "http://example.com:8080"
	m.setup.proxy = &proxy
	if err := m.configureAccountsWithNext(false); err == nil || !strings.Contains(err.Error(), "BEE-CONFIG-PROXY") {
		t.Fatal(err)
	}
}

func TestMenuStatusUsesAdjacentEgressAndStillQueriesSupplyAfterAccountFailure(t *testing.T) {
	t.Setenv("CODEX_HOME", codexHome(t, time.Now().Add(time.Hour)))
	m, out := pairedMenu(t, "1\n")
	m.setup = menuSetupOptions{platform: "openai", all: true}
	if err := m.configureAccountsWithNext(false); err != nil {
		t.Fatal(err)
	}
	paths := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		paths = append(paths, r.URL.Path)
		switch r.URL.Path {
		case "/api/bee/identity":
			json.NewEncoder(w).Encode(beewire.Identity{ID: "synthetic"})
		case "/api/bee/platforms/openai/account":
			w.WriteHeader(503)
		case "/api/bee/platforms/openai":
			json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "openai", Ready: true})
		default:
			t.Error(r.URL.Path)
			w.WriteHeader(500)
		}
	}))
	defer server.Close()
	state, _ := readState(m.configPath)
	state.Hive = server.URL
	if err := saveState(m.configPath, state); err != nil {
		t.Fatal(err)
	}
	m.egressPath += ".another"
	m.egressExplicit = true
	if err := m.status(); err != nil {
		t.Fatal(err)
	}
	if len(paths) != 3 || !strings.Contains(out.String(), "可以接收新任务") {
		t.Fatal(paths, out.String())
	}
}
