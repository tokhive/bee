//go:build darwin || linux

package bee

import (
	"bufio"
	"io"
	"net"
	"net/http"
	"os"
	"testing"
)

// connectProxy answers every CONNECT with status and, when it is 200, lets the
// tunnel stay open; it reports the targets it was asked for.
func connectProxy(t *testing.T, status int) (address string, targets <-chan string) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { listener.Close() })
	asked := make(chan string, 8)
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func() {
				defer conn.Close()
				request, err := http.ReadRequest(bufio.NewReader(conn))
				if err != nil {
					return
				}
				asked <- request.Host
				if status == http.StatusOK {
					io.WriteString(conn, "HTTP/1.1 200 Connection established\r\n\r\n")
					io.Copy(io.Discard, conn)
					return
				}
				io.WriteString(conn, "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n")
			}()
		}
	}()
	return listener.Addr().String(), asked
}

func closedAddress(t *testing.T) string {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	address := listener.Addr().String()
	listener.Close()
	return address
}

type networkReply struct {
	controlNetwork
	Error struct {
		Code string `json:"code"`
	} `json:"error"`
}

func TestNetworkSettingRoutes(t *testing.T) {
	hive := newAccountsHive(t)
	r := newAccountsRunner(t, hive.URL)
	stop := serveControl(r.configPath, r.egress, r.status, r, io.Discard)
	defer stop()
	client := unixClient(controlSocketPath(r.configPath))

	var got networkReply
	if code := getJSON(t, client, "GET", "/v1/network", "", &got); code != 200 || got.ConnectProxy != "" || !got.Editable || got.RestartRequired || got.Source != "" {
		t.Fatalf("initial: %d %+v", code, got)
	}

	if code := getJSON(t, client, "PUT", "/v1/network", `{"connect_proxy":"http://127.0.0.1:7890"}`, &got); code != 200 {
		t.Fatalf("save: %d %+v", code, got)
	}
	if got.ConnectProxy != "http://127.0.0.1:7890" || got.Source != "desktop" || got.ActiveProxy != "" || !got.RestartRequired {
		t.Fatalf("after save: %+v", got)
	}
	info, err := os.Stat(networkPath(r.configPath))
	if err != nil || info.Mode().Perm() != 0o600 {
		t.Fatalf("network.json: %v %v", info, err)
	}

	// A bad value is refused and leaves the saved one alone.
	for _, bad := range []string{"http://localhost:7890", "http://user:pass@127.0.0.1:7890", "https://127.0.0.1:7890", "http://127.0.0.1", "http://proxy.example.com:7890", "127.0.0.1:7890", "http://127.0.0.1:99999"} {
		var refused networkReply
		body := `{"connect_proxy":"` + bad + `"}`
		if code := getJSON(t, client, "PUT", "/v1/network", body, &refused); code != 400 || refused.Error.Code != "invalid_proxy" {
			t.Fatalf("%s: %d %+v", bad, code, refused)
		}
	}
	if saved, err := readDesktopProxy(r.configPath); err != nil || saved != "http://127.0.0.1:7890" {
		t.Fatalf("saved after refusals = %q, %v", saved, err)
	}
	var missing networkReply
	if code := getJSON(t, client, "PUT", "/v1/network", `{}`, &missing); code != 400 || missing.Error.Code != "invalid_request" {
		t.Fatalf("missing field: %d %+v", code, missing)
	}

	// Clearing removes the file, and nothing needs a restart when the
	// running Bee never used one.
	if code := getJSON(t, client, "PUT", "/v1/network", `{"connect_proxy":""}`, &got); code != 200 || got.ConnectProxy != "" || got.Source != "" || got.RestartRequired {
		t.Fatalf("clear: %d %+v", code, got)
	}
	if _, err := os.Stat(networkPath(r.configPath)); !os.IsNotExist(err) {
		t.Fatalf("network.json after clearing: %v", err)
	}
}

func TestNetworkRestartRequiredTracksTheRunningProxy(t *testing.T) {
	hive := newAccountsHive(t)
	r := newAccountsRunner(t, hive.URL)
	if err := writeDesktopProxy(r.configPath, "http://127.0.0.1:7890"); err != nil {
		t.Fatal(err)
	}
	if err := r.egress.useDesktopProxy(r.configPath); err != nil {
		t.Fatal(err)
	}
	stop := serveControl(r.configPath, r.egress, r.status, r, io.Discard)
	defer stop()
	client := unixClient(controlSocketPath(r.configPath))

	var got networkReply
	if code := getJSON(t, client, "GET", "/v1/network", "", &got); code != 200 || got.ActiveProxy != "http://127.0.0.1:7890" || got.RestartRequired || got.Source != "desktop" {
		t.Fatalf("running with it: %d %+v", code, got)
	}
	getJSON(t, client, "PUT", "/v1/network", `{"connect_proxy":""}`, &got)
	if got.ActiveProxy == "" || got.ConnectProxy != "" || !got.RestartRequired {
		t.Fatalf("cleared while running: %+v", got)
	}
}

func TestNetworkProxyInEgressIsReadOnly(t *testing.T) {
	hive := newAccountsHive(t)
	r := newAccountsRunner(t, hive.URL)
	r.egress.ConnectProxy = "http://127.0.0.1:7890"
	if err := writeDesktopProxy(r.configPath, "http://127.0.0.1:9999"); err != nil {
		t.Fatal(err)
	}
	if err := r.egress.useDesktopProxy(r.configPath); err != nil || r.egress.desktopProxy || r.egress.ConnectProxy != "http://127.0.0.1:7890" {
		t.Fatalf("the egress configuration's proxy must win: %v %+v", err, r.egress)
	}
	stop := serveControl(r.configPath, r.egress, r.status, r, io.Discard)
	defer stop()
	client := unixClient(controlSocketPath(r.configPath))

	var got networkReply
	if code := getJSON(t, client, "GET", "/v1/network", "", &got); code != 200 || got.Source != "egress" || got.Editable || got.ConnectProxy != "http://127.0.0.1:7890" {
		t.Fatalf("get: %d %+v", code, got)
	}
	if code := getJSON(t, client, "PUT", "/v1/network", `{"connect_proxy":""}`, &got); code != 409 || got.Error.Code != "proxy_in_egress" {
		t.Fatalf("put: %d %+v", code, got)
	}
}

func TestNetworkOfACommandLineBeeIsReadOnly(t *testing.T) {
	client, _, _ := startControl(t, "https://hive.example", &egressConfig{ConnectProxy: "http://127.0.0.1:7890"})
	var got networkReply
	if code := getJSON(t, client, "GET", "/v1/network", "", &got); code != 200 || got.Editable || got.ActiveProxy != "http://127.0.0.1:7890" {
		t.Fatalf("get: %d %+v", code, got)
	}
	if code := getJSON(t, client, "PUT", "/v1/network", `{"connect_proxy":""}`, &got); code != 409 {
		t.Fatalf("put: %d %+v", code, got)
	}
}

func TestNetworkReportsAnEnvironmentProxy(t *testing.T) {
	t.Setenv("HTTPS_PROXY", "http://127.0.0.1:1")
	client, _, _ := startControl(t, "https://hive.example", &egressConfig{})
	var got networkReply
	if code := getJSON(t, client, "GET", "/v1/network", "", &got); code != 200 || !got.EnvOverride {
		t.Fatalf("get: %d %+v", code, got)
	}
}

func TestSavedProxyReachesTheOfficialSources(t *testing.T) {
	config := shortConfigPath(t)
	if err := writeDesktopProxy(config, "http://127.0.0.1:7890"); err != nil {
		t.Fatal(err)
	}
	egress := &egressConfig{Codex: &codexSource{}, Claude: &claudeSource{Store: claudeStoreFile}}
	if err := egress.useDesktopProxy(config); err != nil {
		t.Fatal(err)
	}
	if egress.ConnectProxy != "http://127.0.0.1:7890" || !egress.desktopProxy || egress.Codex.transport == nil || egress.Claude.transport == nil {
		t.Fatalf("not applied: %+v", egress)
	}
}

func TestAnUnusableSavedProxyIsNotUsed(t *testing.T) {
	config := shortConfigPath(t)
	if err := os.WriteFile(networkPath(config), []byte(`{"connect_proxy":"http://proxy.example.com:80"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	egress := &egressConfig{}
	if err := egress.useDesktopProxy(config); err == nil || egress.ConnectProxy != "" {
		t.Fatalf("err = %v, proxy = %q", err, egress.ConnectProxy)
	}
}

func TestNetworkCheck(t *testing.T) {
	proxy, asked := connectProxy(t, http.StatusOK)
	refusing, _ := connectProxy(t, http.StatusForbidden)
	direct, _ := connectProxy(t, http.StatusOK)

	egress := &egressConfig{Targets: []string{"chatgpt.com:443"}}
	client, _, _ := startControl(t, "https://hive.example", egress)
	var got controlNetworkCheck
	body := func(proxy string) string { return `{"connect_proxy":"` + proxy + `"}` }

	if code := getJSON(t, client, "POST", "/v1/network/check", body("http://"+proxy), &got); code != 200 || !got.OK || got.Target != "chatgpt.com:443" {
		t.Fatalf("working proxy: %d %+v", code, got)
	}
	if target := <-asked; target != "chatgpt.com:443" {
		t.Fatalf("the proxy was asked for %q", target)
	}
	if code := getJSON(t, client, "POST", "/v1/network/check", body("http://"+refusing), &got); code != 200 || got.OK || got.Problem == nil || got.Problem.Code != "proxy_refused" {
		t.Fatalf("refusing proxy: %d %+v", code, got)
	}
	if code := getJSON(t, client, "POST", "/v1/network/check", body("http://"+closedAddress(t)), &got); code != 200 || got.OK || got.Problem == nil || got.Problem.Code != "proxy_unreachable" {
		t.Fatalf("nothing at the proxy: %d %+v", code, got)
	}
	var refused networkReply
	if code := getJSON(t, client, "POST", "/v1/network/check", body("http://localhost:7890"), &refused); code != 400 || refused.Error.Code != "invalid_proxy" {
		t.Fatalf("bad proxy: %d %+v", code, refused)
	}

	// With no proxy the target is tried directly.
	egress.Targets = []string{direct}
	if code := getJSON(t, client, "POST", "/v1/network/check", body(""), &got); code != 200 || !got.OK || got.Target != direct {
		t.Fatalf("direct: %d %+v", code, got)
	}
	egress.Targets = []string{closedAddress(t)}
	if code := getJSON(t, client, "POST", "/v1/network/check", body(""), &got); code != 200 || got.OK || got.Problem == nil || got.Problem.Code != "target_unreachable" {
		t.Fatalf("direct, unreachable: %d %+v", code, got)
	}
}
