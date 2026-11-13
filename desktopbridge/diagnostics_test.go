package desktopbridge

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	bee "github.com/tokhive/bee/agent"
)

func TestDesktopDiagnosticsParamsAreClosedAndNeverEchoUntrustedValues(t *testing.T) {
	for _, tc := range []struct {
		method, params string
		valid          bool
	}{
		{"diagnostics_start", `{}`, true},
		{"diagnostics_snapshot", `{"id":"` + strings.Repeat("a", 48) + `"}`, true},
		{"diagnostics_cancel", `{"id":"` + strings.Repeat("b", 48) + `"}`, true},
		{"diagnostics_start", `{"config":"/Users/MARKER/bee.json"}`, false},
		{"diagnostics_start", `{"instance":"MARKER"}`, false},
		{"diagnostics_snapshot", `{}`, false},
		{"diagnostics_snapshot", `{"id":null}`, false},
		{"diagnostics_snapshot", `{"id":1}`, false},
		{"diagnostics_snapshot", `{"id":"MARKER"}`, false},
		{"diagnostics_cancel", `{"id":"` + strings.Repeat("b", 48) + `","id":"MARKER"}`, false},
		{"diagnostics_cancel", `{"id":"` + strings.Repeat("B", 48) + `"}`, false},
		{"diagnostics_cancel", `[]`, false},
		{"diagnostics_cancel", `null`, false},
	} {
		req, err := decodeDiagnosticsParams(request{Method: tc.method}, json.RawMessage(tc.params))
		if (err == nil) != tc.valid {
			t.Fatalf("method=%s valid=%t actual_error=%v", tc.method, tc.valid, err)
		}
		if err != nil && strings.Contains(err.Error(), "MARKER") {
			t.Fatal("parameter rejection leaked untrusted input")
		}
		if tc.valid && tc.method != "diagnostics_start" && len(req.OperationID) != 48 {
			t.Fatal("validated report ID not retained")
		}
	}
}

type fakeDiagnostics struct{ action, instance, id string }

func (d *fakeDiagnostics) Start(_ context.Context, instance string) (bee.DesktopDiagnosticReport, error) {
	d.action = "start"
	d.instance = instance
	return bee.DesktopDiagnosticReport{ID: strings.Repeat("a", 48), Instance: instance, State: "running"}, nil
}
func (d *fakeDiagnostics) Snapshot(_ context.Context, id string) (bee.DesktopDiagnosticReport, error) {
	d.action = "snapshot"
	d.id = id
	return bee.DesktopDiagnosticReport{ID: id, State: "completed"}, nil
}
func (d *fakeDiagnostics) Cancel(_ context.Context, id string) (bee.DesktopDiagnosticReport, error) {
	d.action = "cancel"
	d.id = id
	return bee.DesktopDiagnosticReport{ID: id, State: "cancelled"}, nil
}
func TestDesktopDiagnosticsResultBindsTrustedBridgeInstance(t *testing.T) {
	service := &fakeDiagnostics{}
	for _, method := range diagnosticMethods {
		value, err := diagnosticsResult(context.Background(), service, request{Method: method, OperationID: strings.Repeat("b", 48)}, strings.Repeat("1", 32))
		if err != nil {
			t.Fatal(err)
		}
		raw, _ := json.Marshal(value)
		if !strings.Contains(string(raw), `"report"`) {
			t.Fatal("result lacks report envelope")
		}
	}
	if service.instance != strings.Repeat("1", 32) || service.id != strings.Repeat("b", 48) || service.action != "cancel" {
		t.Fatal("trusted instance/report dispatch failed")
	}
}
