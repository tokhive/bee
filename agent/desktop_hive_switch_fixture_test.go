package bee

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"testing"
)

// NewDesktopHiveSwitchFixture keeps the production fixed-profile constructor,
// runtime, drain client and relay. Only official account HTTP is redirected to
// an explicitly supplied synthetic upstream; no synthetic token can go online.
func NewDesktopHiveSwitchFixture(t *testing.T, directory, mode, fixturePath string) (*DesktopDevice, *DesktopAccounts, *DesktopRuntime, *DesktopNetwork) {
	t.Helper()
	var fixture struct {
		Official string `json:"official"`
	}
	raw, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatal(err)
	}
	if err = json.Unmarshal(raw, &fixture); err != nil {
		t.Fatal(err)
	}
	official, err := url.Parse(fixture.Official)
	if err != nil || official.Scheme != "http" || official.Hostname() != "127.0.0.1" {
		t.Fatalf("synthetic official origin rejected: origin=%q error=%v; required=HTTP loopback", fixture.Official, err)
	}
	safe := filepath.Join(directory, "synthetic-empty-sources")
	if err = os.MkdirAll(safe, 0700); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"CODEX_HOME", "CLAUDE_CONFIG_DIR", "CLAUDE_SECURESTORAGE_CONFIG_DIR"} {
		t.Setenv(name, safe)
	}
	d, err := NewDesktopProfileDevice(directory, DesktopProfileMode(mode))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := d.Close(); err != nil {
			t.Error(err)
		}
	})
	a := NewDesktopAccounts(d)
	a.goos = "linux"
	a.readKeyring = func(context.Context, string) ([]byte, error) {
		return nil, fmt.Errorf("synthetic fixture has no keyring")
	}
	transport := &http.Transport{Proxy: nil}
	t.Cleanup(transport.CloseIdleConnections)
	a.transport = claudeTransport(func(q *http.Request) (*http.Response, error) {
		copy := q.Clone(q.Context())
		u := *q.URL
		copy.URL = &u
		copy.URL.Scheme = official.Scheme
		copy.URL.Host = official.Host
		copy.Host = official.Host
		return transport.RoundTrip(copy)
	})
	t.Cleanup(a.Close)
	r := NewDesktopRuntime(context.Background(), d, a)
	t.Cleanup(r.Close)
	return d, a, r, NewDesktopNetwork(a)
}
