package desktopbridge_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"strings"
	"testing"

	bee "github.com/tokhive/bee/agent"
	"github.com/tokhive/bee/desktopbridge"
)

type runtimeFixture struct{ starts int }

func (f *runtimeFixture) Restore(context.Context) (bee.DesktopOperation, error) {
	return bee.DesktopOperation{ID: strings.Repeat("c", 48), Kind: "start", State: "pending"}, nil
}
func (f *runtimeFixture) Snapshot(context.Context) (bee.DesktopRuntimeSnapshot, error) {
	return bee.DesktopRuntimeSnapshot{Local: "stopped", Connection: "disconnected", Platforms: map[string]bee.DesktopRuntimePlatform{}}, nil
}
func (f *runtimeFixture) Start(context.Context, bee.DesktopStartRequest) (bee.DesktopOperation, error) {
	f.starts++
	return bee.DesktopOperation{ID: strings.Repeat("a", 48), Kind: "start", State: "pending"}, nil
}
func (f *runtimeFixture) Stop(context.Context, bee.DesktopStopRequest) (bee.DesktopOperation, error) {
	return bee.DesktopOperation{ID: strings.Repeat("b", 48), Kind: "stop", State: "pending"}, nil
}
func (f *runtimeFixture) ConfigureNetwork(context.Context, bee.DesktopNetworkConfig) error {
	return nil
}
func TestDesktopRuntimeBridgeRejectsUnknownNullAndDuplicateParams(t *testing.T) {
	for _, params := range []string{`{}`, `{"expected_revision":0,"resume_platforms":null}`, `{"expected_revision":0,"resume_platforms":["openai","openai"]}`, `{"expected_revision":0,"expected_revision":1,"resume_platforms":[]}`, `{"expected_revision":0,"resume_platforms":[],"shell":"SECRET"}`, `{"expected_revision":9007199254740992,"resume_platforms":[]}`} {
		f := &runtimeFixture{}
		var out bytes.Buffer
		input := hello + supplyRequest("start", "runtime_start", params) + request("ping", "ping")
		if e := desktopbridge.RunWithRuntime(context.Background(), strings.NewReader(input), &out, io.Discard, "test", &fakeSupply{}, bee.NewDesktopAccounts(nil), f); e != nil {
			t.Fatal(e)
		}
		frames := replies(t, out.String())
		if frames[1].Error == nil || frames[1].Error.Code != "INVALID_REQUEST" || f.starts != 0 || frames[2].Error != nil || strings.Contains(out.String(), "SECRET") {
			t.Fatalf("invalid runtime request accepted: %s", out.String())
		}
	}
}
func TestDesktopRuntimeBridgeReturnsQueryableOperation(t *testing.T) {
	f := &runtimeFixture{}
	var out bytes.Buffer
	input := hello + supplyRequest("start", "runtime_start", `{"expected_revision":0,"resume_platforms":["openai"]}`) + supplyRequest("snapshot", "runtime_snapshot", `{}`) + request("ping", "ping")
	if e := desktopbridge.RunWithRuntime(context.Background(), strings.NewReader(input), &out, io.Discard, "test", &fakeSupply{}, bee.NewDesktopAccounts(nil), f); e != nil {
		t.Fatal(e)
	}
	frames := replies(t, out.String())
	if !bytes.Contains(frames[0].Result, []byte(`"runtime_start"`)) || !bytes.Contains(frames[1].Result, []byte(`"state":"pending"`)) || !bytes.Contains(frames[2].Result, []byte(`"local":"stopped"`)) || frames[3].Error != nil || f.starts != 1 {
		t.Fatalf("runtime bridge contract: %s", out.String())
	}
}

func TestDesktopRuntimeBridgePreservesConnectionDetail(t *testing.T) {
	var out bytes.Buffer
	input := hello + supplyRequest("snapshot", "runtime_snapshot", `{}`)
	if err := desktopbridge.RunWithRuntime(context.Background(), strings.NewReader(input), &out, io.Discard, "test", &fakeSupply{}, bee.NewDesktopAccounts(nil), &runtimeFixture{}); err != nil {
		t.Fatal(err)
	}
	frames := replies(t, out.String())
	var result map[string]json.RawMessage
	if err := json.Unmarshal(frames[1].Result, &result); err != nil {
		t.Fatal(err)
	}
	var runtime map[string]json.RawMessage
	if err := json.Unmarshal(result["runtime"], &runtime); err != nil {
		t.Fatal(err)
	}
	if raw, ok := runtime["connection_detail"]; !ok || string(raw) != "null" {
		t.Fatalf("runtime lost explicit nullable detail: %s", frames[1].Result)
	}
}
