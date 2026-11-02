package desktopbridge_test

import (
	"bytes"
	"context"
	"errors"
	"io"
	"strings"
	"testing"

	bee "github.com/tokhive/bee/agent"
	"github.com/tokhive/bee/desktopbridge"
)

type startupContextDevice struct {
	fakeSupply
	reads int
}

func (d *startupContextDevice) Context(context.Context) (bee.DesktopDeviceContext, error) {
	d.reads++
	return bee.DesktopDeviceContext{Hive: "https://hive.example", Name: "Saved Mac", BindingRevision: 3}, nil
}

type startupContextRuntime struct {
	runtimeFixture
	checks, restores int
	failure          error
}

func (r *startupContextRuntime) VerifyStartup(context.Context) error {
	r.checks++
	return r.failure
}
func (r *startupContextRuntime) Restore(context.Context) (bee.DesktopOperation, error) {
	r.restores++
	return bee.DesktopOperation{}, errors.New("runtime verification must not call Restore")
}

func TestDeviceContextBridgeAndStartupVerificationUseStrictReadOnlyMethods(t *testing.T) {
	for _, failure := range []error{nil, errors.New("protected account state version=99 required=1")} {
		device, runtime := &startupContextDevice{}, &startupContextRuntime{failure: failure}
		accounts := bee.NewDesktopAccounts(nil)
		var out bytes.Buffer
		input := hello + request("context", "device_context") + request("verify", "runtime_verify") + supplyRequest("bad-context", "device_context", `{"credential":"SECRET"}`) + supplyRequest("bad-verify", "runtime_verify", `{"restore":true}`) + request("ping", "ping")
		err := desktopbridge.RunWithRuntime(context.Background(), strings.NewReader(input), &out, io.Discard, "test", device, accounts, runtime)
		accounts.Close()
		if err != nil {
			t.Fatal(err)
		}
		frames := replies(t, out.String())
		if !bytes.Contains(frames[0].Result, []byte(`"device_context","runtime_verify"`)) || !bytes.Contains(frames[1].Result, []byte(`"binding_revision":3`)) {
			t.Fatalf("local capability/context lost: %s", out.String())
		}
		if failure == nil && string(frames[2].Result) != `{"verified":true}` || failure != nil && !bytes.Contains(frames[2].Result, []byte(`"code":"STARTUP_DATA_INVALID"`)) {
			t.Fatalf("verification result lost: %s", out.String())
		}
		if device.reads != 1 || runtime.checks != 1 || runtime.restores != 0 || runtime.starts != 0 || frames[3].Error == nil || frames[4].Error == nil || frames[5].Error != nil || strings.Contains(out.String(), "SECRET") {
			t.Fatalf("read-only method boundary changed: %s", out.String())
		}
	}
}
