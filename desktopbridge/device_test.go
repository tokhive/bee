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

type fakeDevice struct{ begins int }

func (d *fakeDevice) Status(context.Context) (bee.DeviceView, error) {
	return bee.DeviceView{}, errors.New("GET /api/bee/identity: HTTP 503, code=unavailable")
}
func (d *fakeDevice) Begin(_ context.Context, hive, name string) (bee.DeviceView, error) {
	d.begins++
	return bee.DeviceView{State: "pending", Hive: hive, Name: name}, nil
}
func TestDeviceBusinessFailureDoesNotBreakManagement(t *testing.T) {
	d := &fakeDevice{}
	var out bytes.Buffer
	input := hello + request("d", "device_status") + request("p", "ping") + `{"protocol":1,"id":"b","method":"device_begin","params":{"hive":"https://hive.example","name":"Mac"}}` + "\n" + request("s", "shutdown")
	if err := desktopbridge.RunWithDevices(context.Background(), strings.NewReader(input), &out, io.Discard, "test", d); err != nil {
		t.Fatal(err)
	}
	frames := replies(t, out.String())
	if len(frames) != 5 || frames[1].Error != nil || !bytes.Contains(frames[1].Result, []byte("503")) || !bytes.Contains(frames[2].Result, []byte("true")) || d.begins != 1 {
		t.Fatalf("unexpected results: %s", out.String())
	}
}
func TestDeviceBeginStrictParameters(t *testing.T) {
	for _, params := range []string{`{}`, `{"hive":"x"}`, `{"hive":"x","name":"a","name":"b"}`, `{"hive":"x","name":null}`, `{"hive":"x","name":"a","config":"secret-config"}`} {
		d := &fakeDevice{}
		var out bytes.Buffer
		input := hello + `{"protocol":1,"id":"b","method":"device_begin","params":` + params + "}\n" + request("p", "ping")
		if err := desktopbridge.RunWithDevices(context.Background(), strings.NewReader(input), &out, io.Discard, "test", d); err != nil {
			t.Fatal(err)
		}
		frames := replies(t, out.String())
		if d.begins != 0 || frames[1].Error == nil || frames[1].Error.Code != "INVALID_REQUEST" || strings.Contains(out.String(), "secret-config") || frames[2].Error != nil {
			t.Fatalf("accepted unsafe params: %s", out.String())
		}
	}
}

type recoveryDevice struct {
	fakeDevice
	confirmations int
}

func (d *recoveryDevice) RecoveryPrepare(context.Context) (bee.DeviceRecoveryView, error) {
	return bee.DeviceRecoveryView{OperationID: strings.Repeat("a", 48), Revision: 1, Phase: "awaiting_confirmation"}, nil
}
func (d *recoveryDevice) RecoveryStatus(context.Context) (bee.DeviceRecoveryView, error) {
	return d.RecoveryPrepare(context.Background())
}
func (d *recoveryDevice) RecoveryConfirm(_ context.Context, id string, revision int64, decision string) (bee.DeviceRecoveryView, error) {
	d.confirmations++
	return d.RecoveryPrepare(context.Background())
}
func TestDeviceRecoveryBridgeStrictCommands(t *testing.T) {
	d := &recoveryDevice{}
	var out bytes.Buffer
	input := hello + request("p", "device_recovery_prepare") + request("s", "device_recovery_status") + `{"protocol":1,"id":"c","method":"device_recovery_confirm","params":{"operation_id":"` + strings.Repeat("a", 48) + `","expected_revision":1,"decision":"begin_pairing"}}` + "\n"
	for i, params := range []string{`{}`, `{"operation_id":"a","expected_revision":1,"decision":"begin_pairing"}`, `{"operation_id":"` + strings.Repeat("a", 48) + `","expected_revision":1,"decision":"begin_pairing","decision":"adopt_owner"}`} {
		input += `{"protocol":1,"id":"bad` + string(rune('0'+i)) + `","method":"device_recovery_confirm","params":` + params + "}\n"
	}
	if err := desktopbridge.RunWithDevices(context.Background(), strings.NewReader(input), &out, io.Discard, "test", d); err != nil {
		t.Fatal(err)
	}
	frames := replies(t, out.String())
	if d.confirmations != 1 || !bytes.Contains(frames[0].Result, []byte("device_recovery_prepare")) || !bytes.Contains(frames[1].Result, []byte("awaiting_confirmation")) {
		t.Fatalf("recovery dispatch rejected: %s", out.String())
	}
	for _, f := range frames[4:] {
		if f.Error == nil || f.Error.Code != "INVALID_REQUEST" {
			t.Fatalf("unsafe recovery params accepted: %s", out.String())
		}
	}
}
