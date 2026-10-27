package bee

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
	"github.com/tokhive/tee/tee"
)

func writeKey(t *testing.T, content string, mode os.FileMode) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "wokey.key")
	if err := os.WriteFile(path, []byte(content), mode); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestResellerKeyFileRules(t *testing.T) {
	good := &resellerSource{Reseller: "wokey", KeyFile: writeKey(t, "sk-reseller-key\n", 0600)}
	if err := good.validate(); err != nil {
		t.Fatal(err)
	}
	if key, _ := good.key(); key != "sk-reseller-key" {
		t.Fatalf("key = %q", key)
	}
	for name, source := range map[string]*resellerSource{
		"unknown reseller":   {Reseller: "openrouter", KeyFile: good.KeyFile},
		"relative path":      {Reseller: "wokey", KeyFile: "wokey.key"},
		"readable by others": {Reseller: "wokey", KeyFile: writeKey(t, "sk-reseller-key", 0644)},
		"two tokens":         {Reseller: "wokey", KeyFile: writeKey(t, "sk-one sk-two", 0600)},
		"empty":              {Reseller: "wokey", KeyFile: writeKey(t, "\n", 0600)},
		"missing":            {Reseller: "wokey", KeyFile: filepath.Join(t.TempDir(), "absent")},
	} {
		err := source.validate()
		if err == nil {
			t.Errorf("%s: accepted", name)
			continue
		}
		if strings.Contains(err.Error(), "sk-") {
			t.Errorf("%s: the error echoes the key: %v", name, err)
		}
	}
}

func TestResellerConfigNeedsItsTarget(t *testing.T) {
	cfg := &egressConfig{Targets: []string{"chatgpt.com:443"}, Reseller: &resellerSource{Reseller: "wokey", KeyFile: writeKey(t, "sk-reseller-key", 0600)}}
	if err := cfg.validate(); err == nil || !strings.Contains(err.Error(), "api.wokey.ai:443") {
		t.Fatalf("missing target accepted: %v", err)
	}
	cfg.Targets = []string{"api.wokey.ai:443"}
	if err := cfg.validate(); err != nil {
		t.Fatalf("reseller-only configuration rejected: %v", err)
	}
}

// fakeReseller answers the model list and balance the way wokey does.
func fakeReseller(t *testing.T, models, balance int, balanceBody string) *httptest.Server {
	t.Helper()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-reseller-key" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.URL.Path {
		case "/v1/models":
			w.WriteHeader(models)
			io.WriteString(w, `{"object":"list","data":[{"id":"gpt-6-astra"},{"id":"claude-opus-5-5"},{"id":"gpt-6-astra"}]}`)
		case "/v1/dashboard/balance":
			w.WriteHeader(balance)
			io.WriteString(w, balanceBody)
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(s.Close)
	return s
}

func TestResellerObservation(t *testing.T) {
	keyPrint := fingerprint("sk-reseller-key")
	for name, check := range map[string]struct {
		models, balance int
		body, key       string
		state, usd      string
		count           int
	}{
		"ready":          {200, 200, `{"userId":"u","availableUsd":9.995931,"reservedUsd":0}`, "sk-reseller-key", beewire.ResellerReady, "9.995931", 2},
		"spent":          {200, 200, `{"availableUsd":0}`, "sk-reseller-key", beewire.ResellerInsufficientBalance, "0", 2},
		"payment needed": {200, 402, `{}`, "sk-reseller-key", beewire.ResellerInsufficientBalance, "", 2},
		"rejected key":   {200, 200, `{}`, "sk-wrong-key", beewire.ResellerInvalidKey, "", 0},
	} {
		source := &resellerSource{Reseller: "wokey", api: fakeReseller(t, check.models, check.balance, check.body).URL}
		status := source.observe(context.Background(), check.key, keyPrint)
		if status.State != check.state || status.AvailableUSD != check.usd || len(status.Models) != check.count || !status.Valid() {
			t.Errorf("%s: %+v", name, status)
		}
	}
	unreachable := &resellerSource{Reseller: "wokey", api: "http://127.0.0.1:1"}
	if status := unreachable.observe(context.Background(), "sk-reseller-key", keyPrint); status.State != beewire.ResellerReady || len(status.Models) != 0 {
		t.Fatalf("an unreachable reseller took the key out of supply: %+v", status)
	}
}

// fakeHive records what a Bee registers and reports for a reseller.
type fakeHive struct {
	mu           sync.Mutex
	inbox        tee.InboxPublic
	registered   []beewire.CredentialRegistration
	reports      []beewire.ResellerStatus
	staleReports int
}

func (h *fakeHive) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	h.mu.Lock()
	defer h.mu.Unlock()
	switch r.URL.Path {
	case "/api/bee/credential-key":
		json.NewEncoder(w).Encode(h.inbox)
	case "/api/bee/credentials":
		var input beewire.CredentialRegistration
		json.NewDecoder(r.Body).Decode(&input)
		h.registered = append(h.registered, input)
		w.WriteHeader(http.StatusCreated)
		io.WriteString(w, `{"status":"registered"}`)
	case "/api/bee/resellers/wokey/status":
		var input beewire.ResellerStatus
		json.NewDecoder(r.Body).Decode(&input)
		if h.staleReports > 0 {
			h.staleReports--
			w.WriteHeader(http.StatusConflict)
			io.WriteString(w, `{"error":{"code":"stale_reseller_key","message":"register it again"}}`)
			return
		}
		h.reports = append(h.reports, input)
		io.WriteString(w, `{"status":"reported"}`)
	default:
		http.NotFound(w, r)
	}
}

func TestResellerSynchronization(t *testing.T) {
	key, err := tee.GenerateInboxKey()
	if err != nil {
		t.Fatal(err)
	}
	hive := &fakeHive{inbox: key.Public()}
	server := httptest.NewServer(hive)
	defer server.Close()
	keyFile := writeKey(t, "sk-reseller-key", 0600)
	cfg := &egressConfig{Reseller: &resellerSource{Reseller: "wokey", KeyFile: keyFile, api: fakeReseller(t, 200, 200, `{"availableUsd":5}`).URL}}
	state := localState{Hive: server.URL, Credential: "device-secret", Identity: &beewire.Identity{ID: "device-1"}}
	var out strings.Builder
	sync := func(lease string, force bool) {
		t.Helper()
		if err := cfg.synchronizeReseller(context.Background(), state, lease, &out, force); err != nil {
			t.Fatal(err)
		}
	}

	sync("lease-1", true)
	sync("lease-1", false)
	if len(hive.registered) != 1 || len(hive.reports) != 1 {
		t.Fatalf("registered %d, reported %d; want once each", len(hive.registered), len(hive.reports))
	}
	registration := hive.registered[0]
	if registration.Lease != "lease-1" || registration.Reseller == nil || registration.Reseller.KeyFingerprint != fingerprint("sk-reseller-key") || registration.Codex != nil {
		t.Fatalf("registration: %+v", registration)
	}
	opened, provider, err := key.Open(registration.Envelope)
	if err != nil || provider != beewire.ProviderID("device-1") || opened.Token != "sk-reseller-key" || opened.Scheme != "Bearer" {
		t.Fatalf("envelope does not carry the key as a bearer token: %v", err)
	}
	if hive.reports[0].State != beewire.ResellerReady || hive.reports[0].AvailableUSD != "5" {
		t.Fatalf("report: %+v", hive.reports[0])
	}

	// A new connection registers again; a replaced key registers and reports again.
	sync("lease-2", false)
	if err := os.WriteFile(keyFile, []byte("sk-replaced-key"), 0600); err != nil {
		t.Fatal(err)
	}
	sync("lease-2", false)
	if len(hive.registered) != 3 || hive.registered[2].Reseller.KeyFingerprint != fingerprint("sk-replaced-key") {
		t.Fatalf("re-registration: %d", len(hive.registered))
	}
	if last := hive.reports[len(hive.reports)-1]; last.State != beewire.ResellerInvalidKey {
		t.Fatalf("the reseller's refusal of the replaced key was not reported: %+v", last)
	}

	// Hive refusing a report about a superseded key makes the Bee register again.
	hive.staleReports = 1
	sync("lease-2", true)
	before := len(hive.registered)
	sync("lease-2", false)
	if len(hive.registered) != before+1 {
		t.Fatal("a stale key report did not lead to a new registration")
	}
	if strings.Contains(out.String(), "sk-") {
		t.Fatal("the key reached the console")
	}
}

func TestResellerChargesReportOnlyWhatIsNew(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	var pages atomic.Int32
	records := func(page string) string {
		switch page {
		case "1":
			return `{"data":[{"id":"r3","modelId":"gpt-6-astra","status":"succeeded","actualAmount":"0.000021","createdAt":"` + now.Format(time.RFC3339) + `"},` +
				`{"id":"r2","modelId":"gpt-6-astra","status":"failed","actualAmount":null,"createdAt":"` + now.Add(-time.Minute).Format(time.RFC3339) + `"}]}`
		case "2":
			return `{"data":[{"id":"r1","modelId":"gpt-6-astra","status":"succeeded","actualAmount":"0.5","createdAt":"` + now.Add(-time.Hour).Format(time.RFC3339) + `"}]}`
		}
		return `{"data":[]}`
	}
	reseller := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer sk-reseller-key" || r.URL.Path != "/v1/requests" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		pages.Add(1)
		io.WriteString(w, records(r.URL.Query().Get("page")))
	}))
	defer reseller.Close()
	var reported []beewire.ResellerCharge
	hive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var input beewire.ResellerCharges
		json.NewDecoder(r.Body).Decode(&input)
		if r.URL.Path != "/api/bee/resellers/wokey/charges" || !input.Valid() {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		reported = append(reported, input.Charges...)
		io.WriteString(w, `{"stored":1}`)
	}))
	defer hive.Close()
	source := &resellerSource{Reseller: "wokey", api: reseller.URL}
	state := localState{Hive: hive.URL, Credential: "device-secret"}
	if err := source.reportCharges(context.Background(), state, "sk-reseller-key", fingerprint("sk-reseller-key")); err != nil {
		t.Fatal(err)
	}
	if len(reported) != 3 || reported[1].AmountUSD != "0" || reported[2].RequestID != "r1" {
		t.Fatalf("first report: %+v", reported)
	}
	reported = nil
	pages.Store(0)
	if err := source.reportCharges(context.Background(), state, "sk-reseller-key", fingerprint("sk-reseller-key")); err != nil {
		t.Fatal(err)
	}
	if len(reported) != 0 || pages.Load() != 1 {
		t.Fatalf("records already reported were sent again, or more than one page read: %+v %d", reported, pages.Load())
	}
}
