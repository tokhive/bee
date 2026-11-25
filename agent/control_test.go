//go:build darwin || linux

package bee

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tokhive/bee/beewire"
)

// shortConfigPath returns a device configuration path whose control socket
// fits the platform limit; t.TempDir is too deep on macOS.
func shortConfigPath(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "bee")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	return filepath.Join(dir, "bee.json")
}

func unixClient(path string) *http.Client {
	return &http.Client{Transport: &http.Transport{DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, "unix", path)
	}}}
}

// startControl serves a control interface for a paired Bee whose Hive is hive.
func startControl(t *testing.T, hive string, egress *egressConfig) (*http.Client, *runStatus, localState) {
	t.Helper()
	config := shortConfigPath(t)
	state := localState{Hive: hive, Name: "laptop", Credential: "bee_" + strings.Repeat("c", 43), Identity: &beewire.Identity{ID: "dev_1", Name: "laptop", OwnerID: "u1", OwnerEmail: "owner@example.com"}}
	status := newRunStatus()
	stop := serveControl(config, state, egress, status, io.Discard)
	t.Cleanup(stop)
	return unixClient(controlSocketPath(config)), status, state
}

func getJSON(t *testing.T, client *http.Client, method, path, body string, out any) int {
	t.Helper()
	req, _ := http.NewRequest(method, "http://bee"+path, strings.NewReader(body))
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			t.Fatalf("%s %s: %v: %s", method, path, err, raw)
		}
	}
	return res.StatusCode
}

func TestControlOverview(t *testing.T) {
	egress := &egressConfig{Codex: &codexSource{}, Claude: &claudeSource{Store: claudeStoreFile}}
	client, status, state := startControl(t, "https://hive.example", egress)
	status.setConnection(connectionConnected)

	req, _ := http.NewRequest("GET", "http://bee/v1/overview", nil)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := io.ReadAll(res.Body)
	res.Body.Close()
	if strings.Contains(string(raw), state.Credential) {
		t.Fatal("overview exposes the device credential")
	}
	var overview controlOverview
	if err := json.Unmarshal(raw, &overview); err != nil {
		t.Fatal(err)
	}
	if overview.Hive != "https://hive.example" || overview.Connection != connectionConnected || overview.PID != os.Getpid() {
		t.Fatalf("overview = %+v", overview)
	}
	if overview.Device == nil || overview.Device.OwnerEmail != "owner@example.com" || overview.Device.ID != "dev_1" {
		t.Fatalf("device = %+v", overview.Device)
	}
	want := []controlSource{{"openai", "openai"}, {"claude", "claude"}}
	if len(overview.Sources) != 2 || overview.Sources[0] != want[0] || overview.Sources[1] != want[1] {
		t.Fatalf("sources = %+v", overview.Sources)
	}
}

func TestControlOverviewWithoutEgress(t *testing.T) {
	client, _, _ := startControl(t, "https://hive.example", nil)
	var overview controlOverview
	if code := getJSON(t, client, "GET", "/v1/overview", "", &overview); code != 200 {
		t.Fatalf("status %d", code)
	}
	if overview.Sources == nil || len(overview.Sources) != 0 || overview.Connection != connectionConnecting {
		t.Fatalf("overview = %+v", overview)
	}
}

// Pausing goes to Hive, returns what Hive confirmed and is pushed to every
// event stream, as are connection changes.
func TestControlSupplyAndEvents(t *testing.T) {
	hive := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method + " " + r.URL.Path {
		case "PUT /api/bee/platforms/claude":
			var input struct{ Paused bool }
			json.NewDecoder(r.Body).Decode(&input)
			json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "claude", Paused: input.Paused, Reasons: []string{"manually_paused"}})
		case "GET /api/bee/platforms/claude":
			json.NewEncoder(w).Encode(beewire.PlatformSupply{Platform: "claude", Ready: true, Reasons: []string{}})
		case "GET /api/bee/platforms/claude/capabilities":
			used := 42
			json.NewEncoder(w).Encode(beewire.Capabilities{Status: "ready", Plan: "max", Models: []string{}, Windows: []beewire.QuotaWindow{{Seconds: 18000, UsedPercent: &used}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer hive.Close()
	client, status, _ := startControl(t, hive.URL, nil)

	req, _ := http.NewRequest("GET", "http://bee/v1/events", nil)
	res, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	events := make(chan string, 8)
	go func() {
		scanner := bufio.NewScanner(res.Body)
		for scanner.Scan() {
			if name, ok := strings.CutPrefix(scanner.Text(), "event: "); ok {
				events <- name
			}
		}
	}()
	expect := func(name string) {
		t.Helper()
		select {
		case got := <-events:
			if got != name {
				t.Fatalf("event %q, want %q", got, name)
			}
		case <-time.After(3 * time.Second):
			t.Fatalf("no %q event", name)
		}
	}
	expect("overview")

	var supply beewire.PlatformSupply
	if code := getJSON(t, client, "PUT", "/v1/platforms/claude/supply", `{"paused":true}`, &supply); code != 200 || !supply.Paused || supply.Platform != "claude" {
		t.Fatalf("pause: %d %+v", code, supply)
	}
	expect("supply")

	status.setConnection(connectionConnected)
	expect("connection")
	status.setConnection(connectionConnected)
	status.setConnection(connectionDisconnected)
	expect("connection") // an unchanged state is not repeated

	var platform controlPlatform
	if code := getJSON(t, client, "GET", "/v1/platforms/claude", "", &platform); code != 200 || !platform.Supply.Ready || platform.Capabilities.Plan != "max" || len(platform.Capabilities.Windows) != 1 {
		t.Fatalf("platform: %d %+v", code, platform)
	}
}

func TestControlRejectsBadRequests(t *testing.T) {
	hive := httptest.NewServer(http.NotFoundHandler())
	defer hive.Close()
	client, _, _ := startControl(t, hive.URL, nil)
	var failure struct {
		Error struct{ Code string } `json:"error"`
	}
	if code := getJSON(t, client, "GET", "/v1/platforms/gemini", "", &failure); code != 404 || failure.Error.Code != "unknown_platform" {
		t.Fatalf("unknown platform: %d %+v", code, failure)
	}
	for _, body := range []string{"", `{}`, `{"paused":"yes"}`, `{"paused":true,"extra":1}`} {
		if code := getJSON(t, client, "PUT", "/v1/platforms/openai/supply", body, &failure); code != 400 || failure.Error.Code != "invalid_request" {
			t.Fatalf("body %q: %d %+v", body, code, failure)
		}
	}
	if code := getJSON(t, client, "PUT", "/v1/platforms/openai/supply", `{"paused":true}`, &failure); code != 502 || failure.Error.Code != "supply_unconfirmed" {
		t.Fatalf("hive failure: %d %+v", code, failure)
	}
}

func TestControlSocketIsPrivateAndReplacesStale(t *testing.T) {
	config := shortConfigPath(t)
	path := controlSocketPath(config)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte("stale"), 0o644); err != nil {
		t.Fatal(err)
	}
	stop := serveControl(config, localState{}, nil, newRunStatus(), io.Discard)
	dir, _ := os.Stat(filepath.Dir(path))
	socket, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if dir.Mode().Perm() != 0o700 || socket.Mode().Perm() != 0o600 || socket.Mode()&os.ModeSocket == 0 {
		t.Fatalf("dir %v socket %v", dir.Mode(), socket.Mode())
	}
	stop()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("socket left behind after stop: %v", err)
	}
}

func TestControlPathTooLong(t *testing.T) {
	if _, err := listenControl("/tmp/" + strings.Repeat("x", maxSocketPath)); err != errControlPathTooLong {
		t.Fatalf("err = %v", err)
	}
	// A Bee whose socket cannot be opened keeps running and says why.
	var out strings.Builder
	stop := serveControl("/tmp/"+strings.Repeat("y", maxSocketPath)+"/bee.json", localState{}, nil, newRunStatus(), &out)
	stop()
	if !strings.Contains(out.String(), "local control interface unavailable") {
		t.Fatalf("no warning: %q", out.String())
	}
}
