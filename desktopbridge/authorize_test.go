package desktopbridge_test

import (
	"bytes"
	"context"
	bee "github.com/tokhive/bee/agent"
	"github.com/tokhive/bee/desktopbridge"
	"io"
	"strings"
	"testing"
)

type authorizeFixture struct{ starts, statuses, cancels int }

func (f *authorizeFixture) Start(_ context.Context, r bee.DesktopAuthorizeRequest) (bee.DesktopOperation, error) {
	f.starts++
	return bee.DesktopOperation{ID: strings.Repeat("a", 48), Kind: "authorize", Platform: &r.Platform, State: "pending"}, nil
}
func (f *authorizeFixture) Status(_ context.Context, id string) (bee.DesktopOperation, error) {
	f.statuses++
	p := "openai"
	return bee.DesktopOperation{ID: id, Kind: "authorize", Platform: &p, State: "running"}, nil
}
func (f *authorizeFixture) Cancel(_ context.Context, id string) (bee.DesktopOperation, error) {
	f.cancels++
	p := "openai"
	return bee.DesktopOperation{ID: id, Kind: "authorize", Platform: &p, State: "cancelled"}, nil
}
func TestDesktopAuthorizeBridgeStrictRequests(t *testing.T) {
	valid := `{"platform":"openai","source":{"directory":null,"store":"file"},"expected_revision":0}`
	cases := []string{`{}`, strings.Replace(valid, `"store":"file"`, `"store":"file","store":"keyring"`, 1), strings.Replace(valid, `"directory":null,`, "", 1), strings.Replace(valid, `"expected_revision":0`, `"expected_revision":9007199254740992`, 1), strings.Replace(valid, `"source":{`, `"source":{"program":"PRIVATE_SECRET",`, 1), strings.Replace(valid, `"platform":"openai"`, `"platform":"openai","platform":"claude"`, 1), strings.Replace(valid, `"expected_revision":0`, `"expected_revision":null`, 1)}
	for _, params := range cases {
		f := &authorizeFixture{}
		var out bytes.Buffer
		input := hello + supplyRequest("start", "authorize_start", params) + request("ping", "ping")
		if err := desktopbridge.RunWithAuthorization(context.Background(), strings.NewReader(input), &out, io.Discard, "test", &fakeSupply{}, bee.NewDesktopAccounts(nil), &runtimeFixture{}, f); err != nil {
			t.Fatal(err)
		}
		frames := replies(t, out.String())
		if frames[1].Error == nil || frames[1].Error.Code != "INVALID_REQUEST" || frames[2].Error != nil || f.starts != 0 || strings.Contains(out.String(), "PRIVATE_SECRET") {
			t.Fatalf("invalid authorization request accepted: %s", out.String())
		}
	}
	f := &authorizeFixture{}
	var out bytes.Buffer
	input := hello + supplyRequest("start", "authorize_start", valid) + supplyRequest("status", "authorize_status", `{"operation_id":"`+strings.Repeat("a", 48)+`"}`) + supplyRequest("cancel", "authorize_cancel", `{"operation_id":"`+strings.Repeat("a", 48)+`"}`)
	if err := desktopbridge.RunWithAuthorization(context.Background(), strings.NewReader(input), &out, io.Discard, "test", &fakeSupply{}, bee.NewDesktopAccounts(nil), &runtimeFixture{}, f); err != nil {
		t.Fatal(err)
	}
	frames := replies(t, out.String())
	if f.starts != 1 || f.statuses != 1 || f.cancels != 1 || !bytes.Contains(frames[0].Result, []byte(`"authorize_cancel"`)) || !bytes.Contains(frames[3].Result, []byte(`"state":"cancelled"`)) {
		t.Fatalf("authorization contract: %s", out.String())
	}
}
