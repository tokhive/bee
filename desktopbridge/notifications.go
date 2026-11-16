package desktopbridge

import (
	"bytes"
	"context"
	"encoding/json"
	bee "github.com/tokhive/bee/agent"
)

type Notifications interface {
	NotificationSnapshot(context.Context) (bee.DesktopNotificationSnapshot, error)
}

var notificationMethods = []string{"notification_snapshot"}

func decodeNotificationParams(req request, raw json.RawMessage) (request, *protocolError) {
	if req.Method != "notification_snapshot" {
		return req, rejected("INVALID_REQUEST", "notification method rejected; required=notification_snapshot")
	}
	if !json.Valid(raw) {
		return req, rejected("INVALID_REQUEST", "notification params JSON syntax rejected: bytes=%d", len(raw))
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	first, _ := decoder.Token()
	if first != json.Delim('{') {
		return req, rejected("INVALID_REQUEST", "notification params root rejected; required=empty object")
	}
	if decoder.More() {
		return req, rejected("INVALID_REQUEST", "notification params field_count>0; required=empty object with no caller-selected identity or action")
	}
	return req, nil
}
func notificationsResult(ctx context.Context, service Notifications) (any, error) {
	value, err := service.NotificationSnapshot(ctx)
	return struct {
		Notifications bee.DesktopNotificationSnapshot `json:"notifications"`
	}{value}, err
}
