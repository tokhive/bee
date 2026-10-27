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

type diagnosticFixture struct {
	instance string
	starts   int
}

func (f *diagnosticFixture) Start(_ context.Context, instance string) (bee.DesktopDiagnosticReport, error) {
	f.instance = instance
	f.starts++
	return bee.DesktopDiagnosticReport{Instance: instance, ID: strings.Repeat("a", 48), State: "running", Checks: []bee.DiagnosticCheck{}}, nil
}
func (f *diagnosticFixture) Snapshot(_ context.Context, id string) (bee.DesktopDiagnosticReport, error) {
	return bee.DesktopDiagnosticReport{Instance: f.instance, ID: id, State: "completed", Checks: []bee.DiagnosticCheck{}}, nil
}
func (f *diagnosticFixture) Cancel(ctx context.Context, id string) (bee.DesktopDiagnosticReport, error) {
	return f.Snapshot(ctx, id)
}
func TestDesktopDiagnosticsExperienceRegistration(t *testing.T) {
	d := &diagnosticFixture{}
	var out bytes.Buffer
	input := hello + supplyRequest("bad", "diagnostics_start", `{"path":"SECRET_MARKER"}`) + supplyRequest("start", "diagnostics_start", `{}`) + request("ping", "ping")
	err := desktopbridge.RunWithExperience(context.Background(), strings.NewReader(input), &out, io.Discard, "test", &fakeSupply{}, bee.NewDesktopAccounts(nil), &runtimeFixture{}, nil, d, nil)
	if err != nil {
		t.Fatal(err)
	}
	frames := replies(t, out.String())
	if !bytes.Contains(frames[0].Result, []byte(`"diagnostics_start"`)) || frames[1].Error == nil || frames[2].Error != nil || d.starts != 1 || len(d.instance) != 32 || strings.Contains(out.String(), "SECRET_MARKER") {
		t.Fatalf("experience registration failed: %s", out.String())
	}
}
