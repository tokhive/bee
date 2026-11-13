package desktopbridge_test

import (
	"bytes"
	"context"
	"io"
	"strings"
	"testing"

	bee "github.com/tokhive/bee/agent"
	"github.com/tokhive/bee/desktopbridge"
)

type retirementBridgeRuntime struct {
	startupContextRuntime
	reconciliations int
}

func (r *retirementBridgeRuntime) InspectRecovery(context.Context) bee.DesktopRecoveryInspection {
	return bee.DesktopRecoveryInspection{State: "blocked", Failure: &bee.DesktopStartupFailure{Code: "RECOVERY_SESSION_UNCONFIRMED", Message: "old runtime not retired"}}
}
func (r *retirementBridgeRuntime) ReconcileRecovery(context.Context) bee.DesktopRecoveryInspection {
	r.reconciliations++
	return bee.DesktopRecoveryInspection{State: "blocked", Failure: &bee.DesktopStartupFailure{Code: "RECOVERY_REMOTE_DRAINING", Message: "original retirement retained; unfinished=true"}}
}
func TestSessionRetirementBridgeKeepsStrictParamsAndDoesNotStartRuntime(t *testing.T) {
	runner := &retirementBridgeRuntime{}
	accounts := bee.NewDesktopAccounts(nil)
	defer accounts.Close()
	var output bytes.Buffer
	input := hello + request("retire", "runtime_reconcile_recovery") + supplyRequest("bad", "runtime_reconcile_recovery", `{"force":true}`) + request("ping", "ping")
	if err := desktopbridge.RunWithRuntime(context.Background(), strings.NewReader(input), &output, io.Discard, "test", &startupContextDevice{}, accounts, runner); err != nil {
		t.Fatal(err)
	}
	frames := replies(t, output.String())
	if !bytes.Contains(frames[0].Result, []byte(`"runtime_inspect_recovery","runtime_reconcile_recovery","runtime_verify"`)) || !bytes.Contains(frames[1].Result, []byte(`"code":"RECOVERY_REMOTE_DRAINING"`)) || frames[2].Error == nil || frames[2].Error.Code != "INVALID_REQUEST" || frames[3].Error != nil || runner.reconciliations != 1 || runner.starts != 0 || runner.restores != 0 {
		t.Fatalf("retirement boundary failed: %s", output.String())
	}
}
