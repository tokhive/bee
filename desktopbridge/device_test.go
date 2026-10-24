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
