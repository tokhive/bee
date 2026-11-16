package desktopbridge_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"

	bee "github.com/tokhive/bee/agent"
	"github.com/tokhive/bee/desktopbridge"
)

type fakeSupply struct {
	fakeDevice
	mu     sync.Mutex
	calls  []string
	paused []bool
	fail   bool
}

func (s *fakeSupply) SupplyStatus(_ context.Context, platform string) (bee.DesktopSupply, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, platform)
	if s.fail {
		return bee.DesktopSupply{}, errors.New("GET /api/bee/platforms/openai: HTTP 503, code=unavailable")
	}
	return bee.DesktopSupply{Platform: platform}, nil
}
func (s *fakeSupply) SetPaused(_ context.Context, platform string, paused bool) (bee.DesktopSupply, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
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
	out.WriteString(runDeviceFrames(t, d, strings.SplitAfter(input, "\n")))
	first := append([]string(nil), d.calls[:2]...)
	sort.Strings(first)
	if !reflect.DeepEqual(first, []string{"claude", "openai"}) || !reflect.DeepEqual(d.calls[2:], []string{"claude", "openai"}) || !reflect.DeepEqual(d.paused, []bool{false, true}) {
		t.Fatalf("calls=%v paused=%v", d.calls, d.paused)
	}
	frames := replies(t, out.String())
	for _, frame := range frames[1:] {
		var result struct {
			Supply bee.DesktopSupply `json:"supply"`
		}
		if frame.Error != nil {
			t.Fatal(frame.Error)
		}
		if err := json.Unmarshal(frame.Result, &result); err != nil {
			t.Fatal(err)
		}
		want := map[string]string{"o": "openai", "c": "claude", "f": "claude", "t": "openai"}[frame.ID]
		if result.Supply.Platform != want {
			t.Fatalf("id=%s platform=%s want=%s", frame.ID, result.Supply.Platform, want)
		}
	}

}
func TestSupplyBusinessFailureDoesNotBreakManagement(t *testing.T) {
	d := &fakeSupply{fail: true}
	var out bytes.Buffer
	out.WriteString(runDeviceFrames(t, d, []string{hello, supplyRequest("s", "supply_status", `{"platform":"openai"}`), request("p", "ping")}))
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

func TestSupplyParameterErrorsIdentifyTheObservedJSONTypeWithoutPayload(t *testing.T) {
	for _, tc := range []struct {
		name, method, params string
		want                 []string
	}{
		{"platform-null", "supply_status", `{"platform":null}`, []string{"platform is null", "actual type=null"}},
		{"platform-number", "supply_status", `{"platform":42}`, []string{"platform JSON type rejected", "actual type=number", "required=string"}},
		{"platform-bool", "supply_status", `{"platform":false}`, []string{"platform JSON type rejected", "actual type=boolean"}},
		{"platform-object", "supply_status", `{"platform":{}}`, []string{"platform JSON type rejected", "actual type=object"}},
		{"platform-array", "supply_status", `{"platform":[]}`, []string{"platform JSON type rejected", "actual type=array"}},
		{"platform-enum", "supply_status", `{"platform":"/private/诊断-secret"}`, []string{"platform enum rejected", "actual type=string", "string bytes=22"}},
		{"paused-null", "supply_set_paused", `{"platform":"openai","paused":null}`, []string{"paused JSON type rejected", "actual type=null"}},
		{"paused-string", "supply_set_paused", `{"platform":"openai","paused":"private-secret"}`, []string{"paused JSON type rejected", "actual type=string"}},
		{"paused-number", "supply_set_paused", `{"platform":"openai","paused":0}`, []string{"paused JSON type rejected", "actual type=number"}},
		{"paused-object", "supply_set_paused", `{"platform":"openai","paused":{}}`, []string{"paused JSON type rejected", "actual type=object"}},
		{"paused-array", "supply_set_paused", `{"platform":"openai","paused":[]}`, []string{"paused JSON type rejected", "actual type=array"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			d := &fakeSupply{}
			var out bytes.Buffer
			if err := desktopbridge.RunWithDevices(context.Background(), strings.NewReader(hello+supplyRequest("e", tc.method, tc.params)+request("p", "ping")), &out, io.Discard, "test", d); err != nil {
				t.Fatal(err)
			}
			frames := replies(t, out.String())
			if frames[1].Error == nil {
				t.Fatalf("request accepted: %s", out.String())
			}
			message := frames[1].Error.Message
			for _, want := range tc.want {
				if !strings.Contains(message, want) {
					t.Errorf("message=%q; missing=%q", message, want)
				}
			}
			if strings.Contains(message, "private") || strings.Contains(message, "secret") || strings.Contains(message, "诊断") || len(d.calls) != 0 || frames[2].Error != nil {
				t.Fatalf("unsafe error or dispatch: %s", out.String())
			}
		})
	}
}

type detailedSupply struct{ fakeSupply }

func (s *detailedSupply) SupplyStatus(_ context.Context, platform string) (bee.DesktopSupply, error) {
	return bee.DesktopSupply{Platform: platform, Reasons: []string{"account_not_registered", "market_not_open", "supply_not_enabled", "supply_device_restricted", "account_not_admitted"}}, nil
}
func TestSupplyDetailedReasonsSurviveBridgeEnvelope(t *testing.T) {
	for _, platform := range []string{"openai", "claude"} {
		d := &detailedSupply{}
		var out bytes.Buffer
		out.WriteString(runDeviceFrames(t, d, []string{hello, supplyRequest("s", "supply_status", `{"platform":"`+platform+`"}`)}))
		frame := replies(t, out.String())[1]
		if frame.Error != nil {
			t.Fatal(frame.Error)
		}
		var result struct {
			Supply bee.DesktopSupply `json:"supply"`
		}
		if err := json.Unmarshal(frame.Result, &result); err != nil {
			t.Fatal(err)
		}
		want, _ := d.SupplyStatus(context.Background(), platform)
		if !reflect.DeepEqual(result.Supply, want) {
			t.Fatalf("supply bridge changed detailed reasons: actual=%+v required=%+v", result.Supply, want)
		}
	}
}
