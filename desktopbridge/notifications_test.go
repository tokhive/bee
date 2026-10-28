package desktopbridge

import (
	"context"
	"encoding/json"
	"errors"
	bee "github.com/tokhive/bee/agent"
	"strings"
	"testing"
)

func TestDesktopNotificationsParamsAcceptOnlyEmptyObject(t *testing.T) {
	for _, tc := range []struct {
		raw   string
		valid bool
	}{
		{`{}`, true}, {" { \n } ", true}, {`null`, false}, {`[]`, false}, {`true`, false}, {`{"identity":"PRIVATE_MARKER"}`, false}, {`{"platform":"openai"}`, false}, {`{"enabled":true}`, false}, {`{"a":1,"a":2}`, false}, {`{} {}`, false}, {`{`, false},
	} {
		req, err := decodeNotificationParams(request{Method: "notification_snapshot"}, json.RawMessage(tc.raw))
		if (err == nil) != tc.valid {
			t.Fatalf("valid=%t error=%v", tc.valid, err)
		}
		if err != nil && strings.Contains(err.Error(), "PRIVATE_MARKER") {
			t.Fatal("notification request rejection exposed untrusted field")
		}
		if tc.valid && req.Method != "notification_snapshot" {
			t.Fatal("method changed")
		}
	}
	if _, err := decodeNotificationParams(request{Method: "notification_send"}, json.RawMessage(`{}`)); err == nil {
		t.Fatal("arbitrary notification method accepted")
	}
}

type fakeNotifications struct {
	calls int
	err   error
}

func (f *fakeNotifications) NotificationSnapshot(context.Context) (bee.DesktopNotificationSnapshot, error) {
	f.calls++
	return bee.DesktopNotificationSnapshot{Facts: []bee.DesktopNotificationFact{{Identity: strings.Repeat("a", 64), Platform: "openai", Problem: "offline", Active: true, Eligible: true}}, ObservedAt: "2026-10-27T00:00:00Z", NetworkRevision: 9}, f.err
}
func TestDesktopNotificationsResultUsesFixedEnvelopeAndPreservesFailure(t *testing.T) {
	var _ Notifications = (*fakeNotifications)(nil)
	service := &fakeNotifications{}
	value, err := notificationsResult(context.Background(), service)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]bee.DesktopNotificationSnapshot
	if err := json.Unmarshal(raw, &result); err != nil {
		t.Fatal(err)
	}
	if len(result) != 1 || len(result["notifications"].Facts) != 1 || result["notifications"].NetworkRevision != 9 || service.calls != 1 {
		t.Fatalf("notification envelope invalid: %s", raw)
	}
	sentinel := errors.New("synthetic notification failure")
	service.err = sentinel
	if _, err := notificationsResult(context.Background(), service); !errors.Is(err, sentinel) {
		t.Fatal("notification read failure swallowed")
	}
}
