package bee

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tokhive/tee/tee"
)

// A Bee that names only connect_proxy sends its own official-host HTTPS there
// too; one that sets HTTPS_PROXY keeps the process's proxy for them.
func TestConnectProxyCarriesOfficialRequestsWithoutHTTPSProxy(t *testing.T) {
	var mu sync.Mutex
	var connects []string
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		connects = append(connects, r.Method+" "+r.Host)
		mu.Unlock()
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer proxy.Close()
	raw, _ := json.Marshal(map[string]any{
		"targets":       []string{"chatgpt.com:443", "api.anthropic.com:443"},
		"connect_proxy": proxy.URL,
		"codex":         map[string]string{"home": t.TempDir(), "store": "file"},
		"claude":        map[string]string{"store": "keychain"},
		"capabilities":  map[string]any{},
	})
	path := filepath.Join(t.TempDir(), "egress.json")
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	credential := codexCredential{Secret: tee.Secret{Header: "authorization", Scheme: "Bearer", Token: "synthetic-access"}, AccountID: "account", UserID: "user", Plan: "plus", ExpiresAt: time.Now().Add(time.Hour)}

	t.Run("connect_proxy", func(t *testing.T) {
		t.Setenv("HTTPS_PROXY", "")
		t.Setenv("https_proxy", "")
		cfg, err := readEgress(context.Background(), path)
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Codex.transport == nil || cfg.Claude.transport == nil || cfg.Capabilities.transport == nil {
			t.Fatal("official requests not routed through connect_proxy")
		}
		if got := cfg.Capabilities.observe(context.Background(), credential, 1); got.Status != "unknown" {
			t.Fatalf("status %s", got.Status)
		}
		mu.Lock()
		defer mu.Unlock()
		if len(connects) == 0 || connects[0] != "CONNECT chatgpt.com:443" {
			t.Fatalf("proxy saw %q", connects)
		}
		local, _ := http.NewRequest("GET", "http://127.0.0.1:1/", nil)
		if u, _ := cfg.Capabilities.transport.(*http.Transport).Proxy(local); u != nil {
			t.Fatal("loopback fixture sent through the proxy")
		}
	})

	t.Run("HTTPS_PROXY", func(t *testing.T) {
		t.Setenv("HTTPS_PROXY", "http://127.0.0.1:9")
		cfg, err := readEgress(context.Background(), path)
		if err != nil {
			t.Fatal(err)
		}
		if cfg.Codex.transport != nil || cfg.Claude.transport != nil || cfg.Capabilities.transport != nil {
			t.Fatal("HTTPS_PROXY overridden by connect_proxy")
		}
	})

	if failure := capabilityTransportFailure(context.DeadlineExceeded); !strings.Contains(failure, "connect_proxy") {
		t.Fatal(failure)
	}
}
