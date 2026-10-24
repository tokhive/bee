package desktopbridge_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"strings"
	"testing"

	bee "github.com/tokhive/bee/agent"
	"github.com/tokhive/bee/desktopbridge"
)

type fakeSupply struct {
	fakeDevice
	calls  []string
	paused []bool
	fail   bool
}

func (s *fakeSupply) SupplyStatus(_ context.Context, platform string) (bee.DesktopSupply, error) {
	s.calls = append(s.calls, platform)
	if s.fail {
		return bee.DesktopSupply{}, errors.New("GET /api/bee/platforms/openai: HTTP 503, code=unavailable")
	}
	return bee.DesktopSupply{Platform: platform}, nil
}
func (s *fakeSupply) SetPaused(_ context.Context, platform string, paused bool) (bee.DesktopSupply, error) {
	s.calls = append(s.calls, platform)
	s.paused = append(s.paused, paused)
	return bee.DesktopSupply{Platform: platform, Paused: paused}, nil
}
func supplyRequest(id, method, params string) string {
	return `{"protocol":1,"id":"` + id + `","method":"` + method + `","params":` + params + "}\n"
}
func TestSupplyCapabilitiesAreOptionalAndOrdered(t *testing.T) {
	for _, tc := range []struct {
		name   string
		device desktopbridge.Devices
		want   []string
	}{
		{"p0", nil, []string{"ping", "shutdown"}},
		{"devices", &fakeDevice{}, []string{"ping", "shutdown", "device_status", "device_begin"}},
		{"supply", &fakeSupply{}, []string{"ping", "shutdown", "device_status", "device_begin", "supply_status", "supply_set_paused"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			var out bytes.Buffer
			if err := desktopbridge.RunWithDevices(context.Background(), strings.NewReader(hello), &out, io.Discard, "test", tc.device); err != nil {
				t.Fatal(err)
			}
			var result struct {
				Capabilities []string `json:"capabilities"`
			}
			if err := json.Unmarshal(replies(t, out.String())[0].Result, &result); err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(result.Capabilities, tc.want) {
				t.Fatalf("capabilities=%v; want=%v", result.Capabilities, tc.want)
			}
		})
	}
}
func TestSupplyStrictParameters(t *testing.T) {
	for _, method := range []string{"supply_status", "supply_set_paused"} {
		params := []string{`{}`, `{"platform":null}`, `{"platform":"/tmp/private-path"}`, `{"platform":"OPENAI"}`, `{"platform":false}`, `{"platform":"openai","platform":"claude"}`, `{"platform":"openai","config":"private-path"}`}
		if method == "supply_set_paused" {
			params = append(params, `{"platform":"openai"}`, `{"platform":"openai","paused":null}`, `{"platform":"openai","paused":"false"}`, `{"platform":"openai","paused":0}`, `{"platform":"openai","paused":false,"paused":true}`, `{"platform":"openai","paused":false,"url":"private-path"}`)
		} else {
			params = append(params, `{"platform":"openai","paused":false}`)
		}
		for _, p := range params {
			t.Run(method+p, func(t *testing.T) {
				d := &fakeSupply{}
				var out bytes.Buffer
				if err := desktopbridge.RunWithDevices(context.Background(), strings.NewReader(hello+supplyRequest("x", method, p)+request("p", "ping")), &out, io.Discard, "test", d); err != nil {
					t.Fatal(err)
				}
				frames := replies(t, out.String())
				if len(d.calls) != 0 || frames[1].Error == nil || frames[1].Error.Code != "INVALID_REQUEST" || frames[2].Error != nil || strings.Contains(out.String(), "private-path") {
					t.Fatalf("unsafe request accepted or secret echoed: %s", out.String())
				}
			})
		}
	}
}
func TestSupplyCallsPreservePlatformAndExplicitFalse(t *testing.T) {
	d := &fakeSupply{}
	var out bytes.Buffer
	input := hello + supplyRequest("o", "supply_status", `{"platform":"openai"}`) + supplyRequest("c", "supply_status", `{"platform":"claude"}`) + supplyRequest("f", "supply_set_paused", `{"platform":"claude","paused":false}`) + supplyRequest("t", "supply_set_paused", `{"platform":"openai","paused":true}`)
	if err := desktopbridge.RunWithDevices(context.Background(), strings.NewReader(input), &out, io.Discard, "test", d); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(d.calls, []string{"openai", "claude", "claude", "openai"}) || !reflect.DeepEqual(d.paused, []bool{false, true}) {
		t.Fatalf("calls=%v paused=%v output=%s", d.calls, d.paused, out.String())
	}
	frames := replies(t, out.String())
	for i, platform := range d.calls {
		var result struct {
			Supply bee.DesktopSupply `json:"supply"`
		}
		if frames[i+1].Error != nil {
			t.Fatal(frames[i+1].Error)
		}
		if err := json.Unmarshal(frames[i+1].Result, &result); err != nil {
			t.Fatal(err)
		}
		if result.Supply.Platform != platform {
			t.Fatalf("platform=%q want=%q", result.Supply.Platform, platform)
		}
	}
}
func TestSupplyBusinessFailureDoesNotBreakManagement(t *testing.T) {
	d := &fakeSupply{fail: true}
	var out bytes.Buffer
	if err := desktopbridge.RunWithDevices(context.Background(), strings.NewReader(hello+supplyRequest("s", "supply_status", `{"platform":"openai"}`)+request("p", "ping")), &out, io.Discard, "test", d); err != nil {
		t.Fatal(err)
	}
	frames := replies(t, out.String())
	var result struct {
		Error struct{ Code, Message string } `json:"error"`
	}
	if err := json.Unmarshal(frames[1].Result, &result); err != nil {
		t.Fatal(err)
	}
	if frames[1].Error != nil || result.Error.Code != "SUPPLY_OPERATION_FAILED" || !strings.Contains(result.Error.Message, "503") || frames[2].Error != nil {
		t.Fatalf("results=%s", out.String())
	}
}
