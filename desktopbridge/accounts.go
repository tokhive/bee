package desktopbridge

import (
	"bytes"
	"context"
	"encoding/hex"
	"encoding/json"
	"slices"

	bee "github.com/tokhive/bee/agent"
)

type Accounts interface {
	Defaults(context.Context) (bee.DesktopAccountDefaults, error)
	Detect(context.Context, bee.DesktopAccountDetectRequest) (bee.DesktopAccountSnapshot, error)
	Snapshot(context.Context, string, bool) (bee.DesktopAccountSnapshot, error)
	Action(context.Context, bee.DesktopAccountActionRequest) (bee.DesktopAccountSnapshot, error)
}

func decodeAccountParams(req request, raw json.RawMessage) (request, *protocolError) {
	allowed := map[string][]string{
		"account_defaults": {}, "account_detect": {"platform", "directory", "store", "mode"}, "account_snapshot": {"platform", "refresh"}, "account_action": {"platform", "revision", "candidate_ref", "action", "confirmed"},
	}[req.Method]
	d := json.NewDecoder(bytes.NewReader(raw))
	_, _ = d.Token()
	fields := map[string]json.RawMessage{}
	for d.More() {
		token, _ := d.Token()
		name := token.(string)
		if !slices.Contains(allowed, name) {
			return req, rejected("INVALID_REQUEST", "account params field at index=%d is unknown; required=fixed method fields", len(fields)+1)
		}
		if _, ok := fields[name]; ok {
			return req, rejected("INVALID_REQUEST", "account params field=%s repeated; required=unique fields", name)
		}
		var value json.RawMessage
		_ = d.Decode(&value)
		fields[name] = value
	}
	for _, name := range allowed {
		value, exists := fields[name]
		if !exists {
			return req, rejected("INVALID_REQUEST", "account params field=%s missing", name)
		}
		actual := "number"
		switch bytes.TrimSpace(value)[0] {
		case 'n':
			actual = "null"
		case '"':
			actual = "string"
		case 't', 'f':
			actual = "boolean"
		case '{':
			actual = "object"
		case '[':
			actual = "array"
		}
		expected := "string"
		switch name {
		case "refresh", "confirmed":
			expected = "boolean"
		case "revision":
			expected = "number"
		case "directory":
			if actual == "null" {
				continue
			}
		}
		if actual != expected {
			return req, rejected("INVALID_REQUEST", "account params field=%s actual_type=%s; required=%s", name, actual, expected)
		}
		var err error
		switch name {
		case "platform":
			err = json.Unmarshal(value, &req.Platform)
		case "directory":
			err = json.Unmarshal(value, &req.Detect.Directory)
		case "store":
			err = json.Unmarshal(value, &req.Detect.Store)
		case "mode":
			err = json.Unmarshal(value, &req.Detect.Mode)
		case "refresh":
			err = json.Unmarshal(value, &req.Refresh)
		case "revision":
			err = json.Unmarshal(value, &req.Action.Revision)
		case "candidate_ref":
			err = json.Unmarshal(value, &req.Action.CandidateRef)
		case "action":
			err = json.Unmarshal(value, &req.Action.Action)
		case "confirmed":
			err = json.Unmarshal(value, &req.Action.Confirmed)
		}
		if err != nil {
			return req, rejected("INVALID_REQUEST", "account params field=%s value is not representable as required type=%s", name, expected)
		}
	}
	if req.Method == "account_defaults" {
		return req, nil
	}
	if req.Platform != "openai" && req.Platform != "claude" {
		return req, rejected("INVALID_REQUEST", "account platform rejected; required=openai,claude")
	}
	req.Detect.Platform = req.Platform
	req.Action.Platform = req.Platform
	if req.Method == "account_detect" {
		if err := req.Detect.Validate(); err != nil {
			return req, rejected("INVALID_REQUEST", "%s", err)
		}
	}
	if req.Method == "account_action" {
		if req.Action.Revision < 0 || req.Action.Revision > 9007199254740991 {
			return req, rejected("INVALID_REQUEST", "account revision outside safe integer range; required=0..9007199254740991")
		}
		ref, err := hex.DecodeString(req.Action.CandidateRef)
		if !(req.Action.Action == "clear_selection" && req.Action.CandidateRef == "") && (err != nil || len(ref) != 24 || hex.EncodeToString(ref) != req.Action.CandidateRef) {
			return req, rejected("INVALID_REQUEST", "account candidate_ref format rejected; required=48 lowercase hex characters")
		}
		if !slices.Contains([]string{"select", "confirm_change", "remove", "clear_selection"}, req.Action.Action) {
			return req, rejected("INVALID_REQUEST", "account action rejected; required=select,confirm_change,remove,clear_selection")
		}
	}
	return req, nil
}
