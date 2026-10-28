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

type notificationAccounts struct {
	*bee.DesktopAccounts
	calls int
	err   error
}

func (f *notificationAccounts) NotificationSnapshot(context.Context) (bee.DesktopNotificationSnapshot, error) {
	f.calls++
	return bee.DesktopNotificationSnapshot{Facts: []bee.DesktopNotificationFact{}, ObservedAt: "2026-10-27T00:00:00Z", NetworkRevision: 2}, f.err
}

type notificationNetwork struct{}

func (*notificationNetwork) Test(context.Context, bee.DesktopNetworkTestRequest) (bee.DesktopNetworkTestResult, error) {
	return bee.DesktopNetworkTestResult{}, nil
}
func (*notificationNetwork) Status(context.Context) (bee.DesktopNetworkStatus, error) {
	return bee.DesktopNetworkStatus{}, nil
}

func TestDesktopNotificationsExperienceCapabilitiesAndDispatch(t *testing.T) {
	f := &notificationAccounts{DesktopAccounts: bee.NewDesktopAccounts(nil)}
	var out bytes.Buffer
	input := hello + supplyRequest("snapshot", "notification_snapshot", `{}`) + request("ping", "ping")
	if err := desktopbridge.RunWithExperience(context.Background(), strings.NewReader(input), &out, io.Discard, "test", &fakeSupply{}, f, &runtimeFixture{}, &authorizeFixture{}, &diagnosticFixture{}, &notificationNetwork{}); err != nil {
		t.Fatal(err)
	}
	frames := replies(t, out.String())
	var metadata struct {
		Capabilities []string `json:"capabilities"`
	}
	if err := json.Unmarshal(frames[0].Result, &metadata); err != nil {
		t.Fatal(err)
	}
	want := []string{"ping", "shutdown", "device_status", "device_begin", "supply_status", "supply_set_paused", "account_defaults", "account_detect", "account_snapshot", "account_action", "runtime_snapshot", "runtime_start", "runtime_stop", "runtime_configure_network", "runtime_restore", "authorize_start", "authorize_status", "authorize_cancel", "diagnostics_start", "diagnostics_snapshot", "diagnostics_cancel", "network_status", "network_test", "notification_snapshot"}
	if !reflect.DeepEqual(metadata.Capabilities, want) || frames[1].Error != nil || !bytes.Contains(frames[1].Result, []byte(`"notifications":{"facts":[]`)) || frames[2].Error != nil || f.calls != 1 {
		t.Fatalf("notification registration failed: capabilities=%v calls=%d output=%s", metadata.Capabilities, f.calls, out.String())
	}
}

func TestDesktopNotificationsTransportRejectsInputsAndPreservesReadFailure(t *testing.T) {
	for _, params := range []string{`null`, `[]`, `{"identity":"PRIVATE_MARKER"}`, `{"platform":"openai"}`, `{"enabled":false}`, `{"a":1,"a":2}`} {
		f := &notificationAccounts{DesktopAccounts: bee.NewDesktopAccounts(nil)}
		var out bytes.Buffer
		input := hello + supplyRequest("bad", "notification_snapshot", params) + supplyRequest("good", "notification_snapshot", `{}`)
		if err := desktopbridge.RunWithExperience(context.Background(), strings.NewReader(input), &out, io.Discard, "test", &fakeSupply{}, f, nil, nil, nil, &notificationNetwork{}); err != nil {
			t.Fatal(err)
		}
		frames := replies(t, out.String())
		if frames[1].Error == nil || frames[1].Error.Code != "INVALID_REQUEST" || frames[2].Error != nil || f.calls != 1 || strings.Contains(out.String(), "PRIVATE_MARKER") {
			t.Fatalf("invalid notification inputs accepted: %s", out.String())
		}
	}
	f := &notificationAccounts{DesktopAccounts: bee.NewDesktopAccounts(nil), err: errors.New("read protected notification state: synthetic failure")}
	var out bytes.Buffer
	if err := desktopbridge.RunWithExperience(context.Background(), strings.NewReader(hello+supplyRequest("failed", "notification_snapshot", `{}`)+request("ping", "ping")), &out, io.Discard, "test", &fakeSupply{}, f, nil, nil, nil, &notificationNetwork{}); err != nil {
		t.Fatal(err)
	}
	frames := replies(t, out.String())
	if !bytes.Contains(frames[1].Result, []byte(`"code":"NOTIFICATIONS_OPERATION_FAILED"`)) || frames[2].Error != nil || f.calls != 1 {
		t.Fatalf("notification failure was swallowed or stopped transport: %s", out.String())
	}
}

func TestDesktopNotificationsDoNotExpandOlderCapabilityGroups(t *testing.T) {
	f := &notificationAccounts{DesktopAccounts: bee.NewDesktopAccounts(nil)}
	var out bytes.Buffer
	if err := desktopbridge.RunWithAccounts(context.Background(), strings.NewReader(hello+supplyRequest("snapshot", "notification_snapshot", `{}`)), &out, io.Discard, "test", &fakeSupply{}, f); err != nil {
		t.Fatal(err)
	}
	frames := replies(t, out.String())
	if bytes.Contains(frames[0].Result, []byte(`"notification_snapshot"`)) || frames[1].Error == nil || frames[1].Error.Code != "UNKNOWN_METHOD" || f.calls != 0 {
		t.Fatalf("older capability group expanded: %s", out.String())
	}
}
