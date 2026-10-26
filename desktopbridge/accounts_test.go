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

func TestAccountsStrictParametersAndFailureIsolation(t *testing.T) {
	for _, tc := range []struct{ method, params string }{
		{"account_defaults", `{"extra":"synthetic-SECRET"}`},
		{"account_detect", `{}`},
		{"account_detect", `{"platform":"openai","directory":null,"store":"file","mode":null}`},
		{"account_detect", `{"platform":"openai","directory":null,"store":"keychain","mode":"local"}`},
		{"account_detect", `{"platform":"openai","directory":"relative","store":"file","mode":"local"}`},
		{"account_detect", `{"platform":"openai","directory":null,"store":"file","mode":"local","store":"file"}`},
		{"account_detect", `{"platform":"openai","directory":null,"store":"file","mode":"local","token":"synthetic-SECRET"}`},
		{"account_snapshot", `{"platform":"openai","refresh":null}`},
		{"account_snapshot", `{"platform":"openai","refresh":0}`},
		{"account_snapshot", `{"platform":"openai","refresh":false,"refresh":true}`},
		{"account_action", `{"platform":"openai","revision":9007199254740992,"candidate_ref":"abc","action":"select","confirmed":true}`},
		{"account_action", `{"platform":"openai","revision":0,"candidate_ref":null,"action":"select","confirmed":true}`},
		{"account_action", `{"platform":"openai","revision":0,"candidate_ref":"abc","action":"select","confirmed":null}`},
	} {
		t.Run(tc.method+tc.params, func(t *testing.T) {
			var out bytes.Buffer
			input := hello + supplyRequest("a", tc.method, tc.params) + request("p", "ping")
			if err := desktopbridge.RunWithAccounts(context.Background(), strings.NewReader(input), &out, io.Discard, "test", &fakeSupply{}, bee.NewDesktopAccounts(nil)); err != nil {
				t.Fatal(err)
			}
			frames := replies(t, out.String())
			if frames[1].Error == nil || frames[1].Error.Code != "INVALID_REQUEST" || frames[2].Error != nil || strings.Contains(out.String(), "synthetic-SECRET") {
				t.Fatalf("invalid request admitted or poisoned bridge: %s", out.String())
			}
		})
	}
}

func TestAccountsFixedMethodsAndOrderedCapabilities(t *testing.T) {
	var out bytes.Buffer
	input := hello + supplyRequest("d", "account_defaults", `{}`) + supplyRequest("s", "account_snapshot", `{"platform":"claude","refresh":false}`) + supplyRequest("a", "account_action", `{"platform":"openai","revision":0,"candidate_ref":"`+strings.Repeat("a", 48)+`","action":"select","confirmed":false}`) + request("p", "ping")
	if err := desktopbridge.RunWithAccounts(context.Background(), strings.NewReader(input), &out, io.Discard, "test", &fakeSupply{}, bee.NewDesktopAccounts(nil)); err != nil {
		t.Fatal(err)
	}
	frames := replies(t, out.String())
	var metadata struct {
		Capabilities []string `json:"capabilities"`
	}
	if err := json.Unmarshal(frames[0].Result, &metadata); err != nil {
		t.Fatal(err)
	}
	want := []string{"ping", "shutdown", "device_status", "device_begin", "supply_status", "supply_set_paused", "account_defaults", "account_detect", "account_snapshot", "account_action"}
	if strings.Join(metadata.Capabilities, ",") != strings.Join(want, ",") {
		t.Fatalf("capabilities=%v", metadata.Capabilities)
	}
	if !bytes.Contains(frames[1].Result, []byte(`"defaults"`)) || !bytes.Contains(frames[2].Result, []byte(`"account"`)) || !bytes.Contains(frames[3].Result, []byte(`"ACCOUNT_OPERATION_FAILED"`)) || frames[4].Error != nil {
		t.Fatalf("fixed method result mismatch: %s", out.String())
	}
}
