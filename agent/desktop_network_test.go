package bee

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

func clearDesktopProxyEnvironment(t *testing.T) {
	t.Helper()
	for _, name := range []string{"HTTP_PROXY", "http_proxy", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "no_proxy", "REQUEST_METHOD"} {
		t.Setenv(name, "")
	}
}

func TestConnectProxyOfficialNoProxyAppliesToDedicatedProxy(t *testing.T) {
	clearDesktopProxyEnvironment(t)
	t.Setenv("NO_PROXY", "chatgpt.com")
	transport := officialTransport("127.0.0.1:7890").(*http.Transport)
	defer transport.CloseIdleConnections()
	for _, host := range []string{"chatgpt.com", "api.anthropic.com"} {
		req, _ := http.NewRequest(http.MethodGet, "https://"+host+"/", nil)
		proxy, err := transport.Proxy(req)
		if err != nil {
			t.Fatal(err)
		}
		if host == "chatgpt.com" && proxy != nil {
			t.Fatal("NO_PROXY official host was routed through the dedicated local proxy")
		}
		if host == "api.anthropic.com" && (proxy == nil || proxy.Host != "127.0.0.1:7890") {
			t.Fatal("official host outside NO_PROXY did not use the dedicated local proxy")
		}
	}
}

// The ledger independently records real HTTP/CONNECT requests, rather than
// inferring the chosen path from configuration fields.
type desktopNetworkLedger struct {
	mu      sync.Mutex
	entries []string
}

func (l *desktopNetworkLedger) add(value string) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.entries = append(l.entries, value)
}
func (l *desktopNetworkLedger) all() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.entries...)
}

func desktopNetworkProxy(t *testing.T, upstream string, ledger *desktopNetworkLedger) *httptest.Server {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ledger.add(r.Method + " " + r.Host)
		if r.Method != http.MethodConnect || (r.Host != "chatgpt.com:443" && r.Host != "api.anthropic.com:443" && r.Host != "auth.openai.com:443") {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		target, err := net.Dial("tcp", upstream)
		if err != nil {
			w.WriteHeader(http.StatusBadGateway)
			return
		}
		defer target.Close()
		conn, buffered, err := w.(http.Hijacker).Hijack()
		if err != nil {
			return
		}
		defer conn.Close()
		_, _ = buffered.WriteString("HTTP/1.1 200 Connection Established\r\n\r\n")
		_ = buffered.Flush()
		done := make(chan struct{})
		go func() { _, _ = io.Copy(target, buffered); _ = target.Close(); close(done) }()
		_, _ = io.Copy(conn, target)
		_ = conn.Close()
		<-done
	}))
	t.Cleanup(server.Close)
	return server
}

func desktopProxyHost(raw string) string { u, _ := url.Parse(raw); return u.Host }

func TestConnectProxyValidationRejectsUnsafeShapes(t *testing.T) {
	for _, raw := range []string{"socks5://127.0.0.1:7890", "http://localhost:7890", "http://example.com:7890", "http://192.168.1.1:7890", "http://user:secret@127.0.0.1:7890", "http://127.0.0.1:7890/path", "http://127.0.0.1:7890/?secret=value", "http://127.0.0.1:0", "http://127.0.0.1:65536", "http://127.0.0.1:bad", "http://[::1]:7890#fragment"} {
		if _, err := localConnectProxy(raw); err == nil {
			t.Fatalf("unsafe proxy accepted: scheme/host/credentials/path/port must be constrained")
		}
	}
	for _, raw := range []string{"http://127.0.0.1:1", "http://127.3.4.5:65535", "http://[::1]:7890"} {
		if _, err := localConnectProxy(raw); err != nil {
			t.Fatalf("valid explicit loopback proxy rejected: %v", err)
		}
	}
}

func TestConnectProxyOfficialEnvironmentPriorityAndNoProxy(t *testing.T) {
	clearDesktopProxyEnvironment(t)
	var local, environment desktopNetworkLedger
	localProxy := desktopNetworkProxy(t, "127.0.0.1:1", &local)
	environmentProxy := desktopNetworkProxy(t, "127.0.0.1:1", &environment)
	t.Setenv("HTTPS_PROXY", environmentProxy.URL)
	t.Setenv("NO_PROXY", "api.anthropic.com")
	transport := officialTransport(desktopProxyHost(localProxy.URL))
	client := &http.Client{Transport: transport}
	_, _ = client.Get("https://chatgpt.com/backend-api/wham/usage")
	if got := environment.all(); len(got) != 1 || got[0] != "CONNECT chatgpt.com:443" {
		t.Fatalf("environment proxy ledger=%v; required=one official CONNECT", got)
	}
	if got := local.all(); len(got) != 0 {
		t.Fatalf("dedicated proxy overrode environment proxy: %v", got)
	}
	if transport == nil {
		t.Fatal("official transport does not capture current environment and NO_PROXY policy")
	}
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, "https://api.anthropic.com/api/oauth/profile", nil)
	proxy, err := transport.(*http.Transport).Proxy(req)
	if err != nil || proxy != nil {
		t.Fatalf("environment NO_PROXY bypass not applied: proxy_present=%t error=%v", proxy != nil, err)
	}
	if strings.Contains(strings.Join(environment.all(), ","), "secret") {
		t.Fatal("ledger contains credential")
	}
}

func TestConnectProxyRejectedStatusCarriesEvidence(t *testing.T) {
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusProxyAuthRequired) }))
	defer proxy.Close()
	cfg := egressConfig{ConnectProxy: proxy.URL}
	_, err := cfg.dialEgress(context.Background(), "chatgpt.com:443")
	if err == nil || !strings.Contains(err.Error(), "407") {
		t.Fatalf("CONNECT rejection lacks actual HTTP status: %v", err)
	}
}

func desktopNetworkOfficial(t *testing.T, ledger *desktopNetworkLedger, response func(http.ResponseWriter, *http.Request)) *httptest.Server {
	t.Helper()
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		ledger.add(r.Method + " " + r.Host + r.URL.Path)
		response(w, r)
	}))
	server.Config.ErrorLog = log.New(io.Discard, "", 0)
	server.StartTLS()
	t.Cleanup(server.Close)
	return server
}

func desktopNetworkTestTransport(t *testing.T, official *httptest.Server, address string) http.RoundTripper {
	t.Helper()
	transport := officialTransport(address).(*http.Transport)
	// Only synthetic TLS fixtures use this trust override. URL, CONNECT target,
	// method and proxy selection remain the production behavior.
	transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	upstream := desktopProxyHost(official.URL)
	transport.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
		if addr == "chatgpt.com:443" || addr == "api.anthropic.com:443" || addr == "auth.openai.com:443" {
			addr = upstream
		}
		return (&net.Dialer{}).DialContext(ctx, network, addr)
	}
	t.Cleanup(transport.CloseIdleConnections)
	return transport
}

func TestDesktopNetworkTestUsesFixedReadOnlyEndpointsAndDraftProxy(t *testing.T) {
	clearDesktopProxyEnvironment(t)
	var requests, connects desktopNetworkLedger
	official := desktopNetworkOfficial(t, &requests, func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet || r.Header.Get("Authorization") != "" {
			t.Error("network test sent credentials or a non-read-only request")
		}
		w.WriteHeader(http.StatusUnauthorized)
	})
	proxy := desktopNetworkProxy(t, desktopProxyHost(official.URL), &connects)
	service := NewDesktopNetwork()
	service.transport = func(address string) http.RoundTripper { return desktopNetworkTestTransport(t, official, address) }
	result, err := service.Test(context.Background(), DesktopNetworkTestRequest{Proxy: proxy.URL})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Checks) != 3 || len(connects.all()) != 3 {
		t.Fatalf("checks=%+v CONNECT ledger=%v", result.Checks, connects.all())
	}
	for _, check := range result.Checks {
		if check.Status != "ok" || check.Path != "local_proxy" {
			t.Fatalf("unexpected check=%+v", check)
		}
		if check.ID != "local_proxy" && (check.HTTPStatus == nil || *check.HTTPStatus != 401 || !strings.Contains(check.Message, "401")) {
			t.Fatalf("HTTP evidence missing=%+v", check)
		}
	}
	got := requests.all()
	if len(got) != 2 || got[0] != "GET chatgpt.com/backend-api/wham/usage" || got[1] != "GET api.anthropic.com/api/oauth/profile" {
		t.Fatalf("official ledger=%v", got)
	}
}

func TestDesktopNetworkDraftValidationAndRedirectBoundary(t *testing.T) {
	clearDesktopProxyEnvironment(t)
	for _, raw := range []string{"", "http://127.0.0.1:7890", "http://[::1]:7890"} {
		if err := ValidateDesktopConnectProxy(raw); err != nil {
			t.Fatalf("valid draft rejected: %v", err)
		}
	}
	for _, raw := range []string{"http://localhost:7890", "http://user:password@127.0.0.1:7890", "https://127.0.0.1:7890", "http://127.0.0.1:7890/arbitrary", "http://127.0.0.1:7890?token=secret"} {
		if _, err := NewDesktopNetwork().Test(context.Background(), DesktopNetworkTestRequest{Proxy: raw}); err == nil || strings.Contains(err.Error(), "password") || strings.Contains(err.Error(), "secret") {
			t.Fatalf("unsafe draft was accepted or echoed secrets: %v", err)
		}
	}
	var requests desktopNetworkLedger
	official := desktopNetworkOfficial(t, &requests, func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Location", "https://arbitrary.example/write")
		w.WriteHeader(http.StatusFound)
	})
	service := NewDesktopNetwork()
	service.transport = func(address string) http.RoundTripper { return desktopNetworkTestTransport(t, official, address) }
	result, err := service.Test(context.Background(), DesktopNetworkTestRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if result.Checks[0].Status != "skipped" || len(requests.all()) != 2 {
		t.Fatalf("empty proxy or redirect boundary failed: %+v ledger=%v", result, requests.all())
	}
	for _, check := range result.Checks[1:] {
		if check.Status != "failed" || check.HTTPStatus == nil || *check.HTTPStatus != 302 {
			t.Fatalf("redirect check=%+v", check)
		}
	}
}

func TestDesktopNetworkAccountsDiscardLateOldRevisionAndCache(t *testing.T) {
	clearDesktopProxyEnvironment(t)
	a := NewDesktopAccounts(nil)
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), desktopCodexFixture(t, time.Now().Add(time.Hour)), 0600); err != nil {
		t.Fatal(err)
	}
	started, release := make(chan struct{}), make(chan struct{})
	var once sync.Once
	calls := 0
	a.transport = claudeTransport(func(r *http.Request) (*http.Response, error) {
		calls++
		once.Do(func() { close(started); <-release })
		if r.URL.Path == "/backend-api/codex/models" {
			return claudeProfileResponse(200, `{"models":[{"slug":"gpt-5.4"}]}`), nil
		}
		return claudeProfileResponse(200, fmt.Sprintf(`{"plan_type":"plus","rate_limit":{"allowed":true,"limit_reached":false,"primary_window":{"used_percent":20,"limit_window_seconds":18000,"reset_after_seconds":3600,"reset_at":%d},"secondary_window":{"used_percent":10,"limit_window_seconds":604800,"reset_after_seconds":3600,"reset_at":%d}}}`, time.Now().Add(time.Hour).Unix(), time.Now().Add(time.Hour).Unix())), nil
	})
	request := DesktopAccountDetectRequest{Platform: "openai", Directory: &dir, Store: "file", Mode: "official"}
	done := make(chan DesktopAccountSnapshot)
	go func() { snapshot, _ := a.Detect(context.Background(), request); done <- snapshot }()
	<-started
	if err := a.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 1}); err != nil {
		t.Fatal(err)
	}
	close(release)
	old := <-done
	if old.Capabilities[0].Status == "ready" || a.platforms["openai"].official != nil {
		t.Fatal("late result from old network revision repopulated the official cache")
	}
	current, err := a.Detect(context.Background(), request)
	if err != nil || current.Capabilities[0].Status != "ready" {
		t.Fatalf("current revision could not observe: %+v %v", current.Capabilities[0], err)
	}
	before := calls
	_, _ = a.Detect(context.Background(), request)
	if calls != before {
		t.Fatal("same revision did not reuse cache")
	}
	if err = a.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 2}); err != nil {
		t.Fatal(err)
	}
	snapshot, _ := a.Snapshot(context.Background(), "openai", false)
	if snapshot.Capabilities[0].Status != "unknown" {
		t.Fatal("snapshot exposed cache from an older network revision")
	}
	_, _ = a.Detect(context.Background(), request)
	if calls <= before {
		t.Fatal("new revision reused old official cache")
	}
	for _, invalid := range []DesktopNetworkConfig{{Revision: 1}, {Revision: 2, ConnectProxy: "http://127.0.0.1:7890"}, {Revision: 3, ConnectProxy: "http://remote.example:7890"}, {Revision: -1}} {
		if err := a.ConfigureNetwork(context.Background(), invalid); err == nil {
			t.Fatal("invalid/conflicting network config accepted")
		}
	}
	if a.network.Revision != 2 || a.network.ConnectProxy != "" {
		t.Fatal("failed configuration erased the previous effective network")
	}
}

func TestDesktopNetworkOfficialRequestPathLedger(t *testing.T) {
	for _, scenario := range []string{"dedicated", "direct", "HTTPS_PROXY", "https_proxy", "NO_PROXY", "environment_NO_PROXY", "environment_same_address"} {
		t.Run(scenario, func(t *testing.T) {
			clearDesktopProxyEnvironment(t)
			var requests, dedicated, environment desktopNetworkLedger
			official := desktopNetworkOfficial(t, &requests, func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(403) })
			local := desktopNetworkProxy(t, desktopProxyHost(official.URL), &dedicated)
			env := desktopNetworkProxy(t, desktopProxyHost(official.URL), &environment)
			proxyAddress, expectedPath := desktopProxyHost(local.URL), "local_proxy"
			switch scenario {
			case "direct":
				proxyAddress, expectedPath = "", "direct"
			case "HTTPS_PROXY", "https_proxy":
				t.Setenv(scenario, env.URL)
				expectedPath = "environment_proxy"
			case "NO_PROXY":
				t.Setenv("NO_PROXY", "chatgpt.com")
				expectedPath = "direct"
			case "environment_NO_PROXY":
				t.Setenv("HTTPS_PROXY", env.URL)
				t.Setenv("NO_PROXY", "chatgpt.com")
				expectedPath = "direct"
			case "environment_same_address":
				t.Setenv("HTTPS_PROXY", local.URL)
				expectedPath = "environment_proxy"
			}
			transport := desktopNetworkTestTransport(t, official, proxyAddress)
			client := &http.Client{Transport: transport}
			response, err := client.Get("https://chatgpt.com/backend-api/wham/usage")
			if err != nil {
				t.Fatal(err)
			}
			_ = response.Body.Close()
			if got := len(requests.all()); got != 1 {
				t.Fatalf("official HTTP ledger entries=%d; required=1", got)
			}
			wantDedicated, wantEnvironment := 0, 0
			if scenario == "dedicated" || scenario == "environment_same_address" {
				wantDedicated = 1
			}
			if scenario == "HTTPS_PROXY" || scenario == "https_proxy" {
				wantEnvironment = 1
			}
			if len(dedicated.all()) != wantDedicated || len(environment.all()) != wantEnvironment {
				t.Fatalf("proxy ledger dedicated=%v environment=%v", dedicated.all(), environment.all())
			}
			req, _ := http.NewRequest(http.MethodGet, "https://chatgpt.com/backend-api/wham/usage", nil)
			if got := officialNetworkPath(req, proxyAddress); got != expectedPath {
				t.Fatalf("path=%s required=%s", got, expectedPath)
			}
		})
	}
}

func TestDesktopNetworkAppliedOfficialTransportDoesNotRewriteHiveOrLogin(t *testing.T) {
	clearDesktopProxyEnvironment(t)
	var requests, connects, hive desktopNetworkLedger
	raw := desktopCodexFixture(t, time.Now().Add(time.Hour))
	var next struct {
		Tokens map[string]string `json:"tokens"`
	}
	_ = json.Unmarshal(desktopCodexFixture(t, time.Now().Add(2*time.Hour)), &next)
	official := desktopNetworkOfficial(t, &requests, func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/backend-api/codex/models":
			_, _ = io.WriteString(w, `{"models":[{"slug":"gpt-5.4"}]}`)
		case "/backend-api/wham/usage":
			_, _ = fmt.Fprintf(w, `{"plan_type":"plus","rate_limit":{"allowed":true,"limit_reached":false,"primary_window":{"used_percent":20,"limit_window_seconds":18000,"reset_after_seconds":3600,"reset_at":%d},"secondary_window":{"used_percent":10,"limit_window_seconds":604800,"reset_after_seconds":3600,"reset_at":%d}}}`, time.Now().Add(time.Hour).Unix(), time.Now().Add(time.Hour).Unix())
		case "/oauth/token":
			_ = json.NewEncoder(w).Encode(map[string]string{"access_token": next.Tokens["access_token"]})
		default:
			t.Error("unexpected fixed official request path")
			w.WriteHeader(404)
		}
	})
	proxy := desktopNetworkProxy(t, desktopProxyHost(official.URL), &connects)
	d := desktopSupplyFixture(t, func(w http.ResponseWriter, r *http.Request) {
		hive.add(r.Method + " " + r.URL.Path)
		switch {
		case r.URL.Path == "/api/bee/identity":
			_ = json.NewEncoder(w).Encode(desktopSupplyIdentity())
		case strings.HasSuffix(r.URL.Path, "/account"):
			_ = json.NewEncoder(w).Encode(beewire.PlatformAccount{Platform: "openai", Status: "ready", AccountFingerprint: strings.Repeat("a", 64), Generation: 1, CredentialRevision: strings.Repeat("b", 64)})
		case strings.HasSuffix(r.URL.Path, "/capabilities"):
			_ = json.NewEncoder(w).Encode(beewire.Capabilities{Status: "unknown"})
		default:
			t.Error("unexpected Hive request")
			w.WriteHeader(404)
		}
	})
	a := NewDesktopAccounts(d)
	loginEnvironment := desktopAuthorizationEnvironment(nil, nil)
	if err := a.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 1, ConnectProxy: proxy.URL}); err != nil {
		t.Fatal(err)
	}
	a.networkTransport.(*http.Transport).TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	dir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "auth.json"), raw, 0600); err != nil {
		t.Fatal(err)
	}
	snapshot, err := a.Detect(context.Background(), DesktopAccountDetectRequest{Platform: "openai", Directory: &dir, Store: "file", Mode: "official"})
	if err != nil || snapshot.Capabilities[0].Status != "ready" {
		t.Fatalf("applied official path failed: %+v %v", snapshot.Capabilities[0], err)
	}
	current, err := parseCodexCredential(raw)
	if err != nil {
		t.Fatal(err)
	}
	current.raw = raw
	if _, err := refreshCodex(context.Background(), current, a.OfficialTransport(), ""); err != nil {
		t.Fatalf("shared official refresh transport failed: %v", err)
	}
	before := len(connects.all())
	if _, err := a.Snapshot(context.Background(), "openai", true); err != nil {
		t.Fatal(err)
	}
	if len(hive.all()) == 0 || len(connects.all()) != before {
		t.Fatalf("dedicated proxy changed Hive path; Hive=%v CONNECT=%v", hive.all(), connects.all())
	}
	if !reflect.DeepEqual(loginEnvironment, desktopAuthorizationEnvironment(nil, nil)) {
		t.Fatal("dedicated proxy rewrote official-client inherited environment")
	}
	if got := requests.all(); len(got) != 3 || got[2] != "POST auth.openai.com/oauth/token" {
		t.Fatalf("official query/refresh ledger=%v", got)
	}
}

func TestDesktopNetworkFailuresDoNotExposeEnvironmentProxyCredentials(t *testing.T) {
	clearDesktopProxyEnvironment(t)
	t.Setenv("HTTPS_PROXY", "http://user:synthetic-PROXY-SECRET@127.0.0.1:1")
	result, err := NewDesktopNetwork().Test(context.Background(), DesktopNetworkTestRequest{})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	if strings.Contains(string(raw), "synthetic-PROXY-SECRET") || strings.Contains(string(raw), "http://user") {
		t.Fatal("network test exposed environment proxy credentials")
	}
	for _, check := range result.Checks[1:] {
		if check.Status != "failed" || check.Path != "environment_proxy" || check.HTTPStatus != nil {
			t.Fatalf("unsafe failure summary=%+v", check)
		}
		if !strings.Contains(check.Message, "connection refused") {
			t.Fatalf("network failure lost safe system evidence: %s", check.Message)
		}
	}
}

func TestDesktopNetworkStatusUsesAppliedRevisionAndSafePolicy(t *testing.T) {
	clearDesktopProxyEnvironment(t)
	t.Setenv("HTTPS_PROXY", "http://user:synthetic-STATUS-SECRET@127.0.0.1:7891")
	t.Setenv("NO_PROXY", "chatgpt.com")
	a := NewDesktopAccounts(nil)
	if err := a.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 3, ConnectProxy: "http://127.0.0.1:7890"}); err != nil {
		t.Fatal(err)
	}
	status, err := NewDesktopNetwork(a).Status(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if status.EffectiveRevision != 3 || status.EffectiveProxy != "http://127.0.0.1:7890" || status.Paths.Relay != "local_proxy" || status.Paths.Official != "openai=direct;claude=environment_proxy" || status.Paths.Hive != "process_environment" || status.Paths.OfficialLogin != "official_client" {
		t.Fatalf("status does not describe applied policy: %+v", status)
	}
	raw, _ := json.Marshal(status)
	if strings.Contains(string(raw), "synthetic-STATUS-SECRET") || strings.Contains(string(raw), "7891") {
		t.Fatal("status exposed environment proxy configuration")
	}
	if err := a.ConfigureNetwork(context.Background(), DesktopNetworkConfig{Revision: 4, ConnectProxy: "http://remote.example:7890"}); err == nil {
		t.Fatal("unsafe config accepted")
	}
	after, _ := NewDesktopNetwork(a).Status(context.Background())
	if !reflect.DeepEqual(status, after) {
		t.Fatal("failed configuration altered effective network status")
	}
}

func TestDesktopNetworkRuntimeConfigurePublishesSharedOfficialTransportAtomically(t *testing.T) {
	clearDesktopProxyEnvironment(t)
	var requests, connects desktopNetworkLedger
	official := desktopNetworkOfficial(t, &requests, func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusForbidden) })
	proxy := desktopNetworkProxy(t, desktopProxyHost(official.URL), &connects)
	device := NewDesktopDevice()
	accounts := NewDesktopAccounts(device)
	runtime := NewDesktopRuntime(context.Background(), device, accounts)
	defer runtime.Close()
	config := DesktopNetworkConfig{Revision: 4, ConnectProxy: proxy.URL}
	if err := runtime.ConfigureNetwork(context.Background(), config); err != nil {
		t.Fatal(err)
	}
	actual, transport := accounts.OfficialNetwork()
	if actual != config {
		t.Fatalf("runtime configured relay but official transport kept a different revision: actual=%+v required=%+v", actual, config)
	}
	// Keep the production transport's captured proxy policy. Trust only this
	// synthetic TLS endpoint; the fixed official host still travels over CONNECT.
	httpTransport := transport.(*http.Transport).Clone()
	httpTransport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	defer httpTransport.CloseIdleConnections()
	response, err := (&http.Client{Transport: httpTransport}).Get("https://chatgpt.com/backend-api/wham/usage")
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusForbidden || !reflect.DeepEqual(connects.all(), []string{"CONNECT chatgpt.com:443"}) || !reflect.DeepEqual(requests.all(), []string{"GET chatgpt.com/backend-api/wham/usage"}) {
		t.Fatalf("configured transport path was not observed: status=%d CONNECT=%v HTTP=%v", response.StatusCode, connects.all(), requests.all())
	}
	before, err := runtime.Snapshot(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	for _, rejected := range []DesktopNetworkConfig{{Revision: 4}, {Revision: 3, ConnectProxy: proxy.URL}, {Revision: 5, ConnectProxy: "http://remote.example:7890"}} {
		if err := runtime.ConfigureNetwork(context.Background(), rejected); err == nil {
			t.Fatalf("invalid/conflicting configuration accepted: revision=%d", rejected.Revision)
		}
		after, _ := runtime.Snapshot(context.Background())
		actual, nextTransport := accounts.OfficialNetwork()
		if after.Revision != before.Revision || after.NetworkRevision != before.NetworkRevision || actual != config || nextTransport != transport {
			t.Fatalf("rejected configuration changed published state: runtime_revision=%d/%d network_revision=%d/%d official_revision=%d", after.Revision, before.Revision, after.NetworkRevision, before.NetworkRevision, actual.Revision)
		}
	}
}
