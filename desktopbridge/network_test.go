package desktopbridge

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	bee "github.com/tokhive/bee/agent"
)

func TestDesktopNetworkParamsOnlyAllowProxyDraft(t *testing.T) {
	for _, raw := range []string{`{"proxy":""}`, `{"proxy":"http://127.0.0.1:7890"}`, `{"proxy":"http://[::1]:7890"}`} {
		if _, err := decodeNetworkTestParams(json.RawMessage(raw)); err != nil {
			t.Fatalf("valid draft rejected: %v", err)
		}
	}
	for _, raw := range []string{`{}`, `null`, `[]`, `{"proxy":null}`, `{"proxy":false}`, `{"proxy":123}`, `{"proxy":"","proxy":"http://127.0.0.1:7890"}`, `{"proxy":"","url":"https://arbitrary.example/write"}`, `{"proxy":"http://user:password@127.0.0.1:7890"}`, `{"proxy":"http://localhost:7890"}`, `{"proxy":"http://remote.example:7890"}`} {
		if _, err := decodeNetworkTestParams(json.RawMessage(raw)); err == nil || strings.Contains(err.Error(), "password") || strings.Contains(err.Error(), "arbitrary.example") {
			t.Fatalf("unsafe params accepted or secret echoed: %v", err)
		}
	}
}

type desktopNetworkFixture struct{ received bee.DesktopNetworkTestRequest }

func (f *desktopNetworkFixture) Status(context.Context) (bee.DesktopNetworkStatus, error) {
	return bee.DesktopNetworkStatus{Paths: bee.DesktopNetworkPaths{Relay: "direct", Official: "openai=direct;claude=direct", Hive: "process_environment", OfficialLogin: "official_client"}}, nil
}

func (f *desktopNetworkFixture) Test(ctx context.Context, input bee.DesktopNetworkTestRequest) (bee.DesktopNetworkTestResult, error) {
	f.received = input
	return bee.DesktopNetworkTestResult{ObservedAt: "2026-10-27T00:00:00Z", Checks: []bee.DesktopNetworkCheck{{ID: "local_proxy", Status: "skipped", Path: "direct", Message: "No dedicated proxy."}}}, nil
}

func TestDesktopNetworkBridgeTestNeedsNoDeviceOrAccount(t *testing.T) {
	fixture := &desktopNetworkFixture{}
	result, err := networkTestResult(context.Background(), fixture, bee.DesktopNetworkTestRequest{Proxy: "http://127.0.0.1:7890"})
	if err != nil || fixture.received.Proxy != "http://127.0.0.1:7890" {
		t.Fatalf("draft test required account/device or lost proxy: %v", err)
	}
	raw, _ := json.Marshal(result)
	if !strings.Contains(string(raw), `"network_test"`) || strings.Contains(string(raw), `"hive"`) {
		t.Fatalf("unexpected result wrapper: %s", raw)
	}
}

func TestDesktopNetworkStatusParamsAreEmptyAndFixed(t *testing.T) {
	if _, err := decodeNetworkParams(request{Method: "network_status"}, json.RawMessage(`{}`)); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{`{"proxy":"http://127.0.0.1:7890"}`, `{"url":"https://arbitrary.example"}`, `null`, `[]`} {
		if _, err := decodeNetworkParams(request{Method: "network_status"}, json.RawMessage(raw)); err == nil {
			t.Fatal("network status accepted inputs")
		}
	}
	if _, err := decodeNetworkParams(request{Method: "network_test"}, json.RawMessage(`{"proxy":""}`)); err != nil {
		t.Fatal(err)
	}
	result, err := networkResult(context.Background(), &desktopNetworkFixture{}, request{Method: "network_status"})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(result)
	if !strings.Contains(string(raw), `"network"`) || !strings.Contains(string(raw), `"effective_revision":0`) {
		t.Fatalf("status wrapper=%s", raw)
	}
}
